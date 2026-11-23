import crypto from 'node:crypto';
import {
  CHALLENGE_ID_RE,
  CODE_RE,
  EMAIL_RE,
  MAX_OTP_ATTEMPTS,
  OTP_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  OTP_WINDOW_LIMIT,
  SESSION_COOKIE_NAME,
  buildSessionCookieHeader,
  constantTimeHexEqual,
  ensureAccountSchema,
  generateOtpCode,
  getDatabaseUrl,
  getMailConfig,
  getSql,
  hashOtpCode,
  hashSessionToken,
  isSameOriginRequest,
  isSecureRequest,
  jsonResponse,
  maskEmail,
  parseCookies,
  resolveAuthenticatedUser,
  sendOtpEmail,
  verifyDomainAcceptsMail,
} from '../lib/server/auth-core.js';

export async function GET(request, { sqlClient = null } = {}) {
  const configured = {
    db: Boolean(getDatabaseUrl() || sqlClient),
    email: Boolean(getMailConfig()),
  };
  if (!configured.db) {
    return jsonResponse({ ok: true, configured, authenticated: false, user: null });
  }

  try {
    const sql = sqlClient || getSql();
    await ensureAccountSchema(sql);
    const user = await resolveAuthenticatedUser(request, sql);
    return jsonResponse({
      ok: true,
      configured,
      authenticated: Boolean(user),
      user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
    });
  } catch (error) {
    console.error('[api/auth GET]', error);
    return jsonResponse({ ok: false, error: 'Unable to check authentication status.' }, 500);
  }
}

export async function POST(
  request,
  { verifyDomain = verifyDomainAcceptsMail, mailer = sendOtpEmail, sqlClient = null } = {}
) {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  const action = typeof body?.action === 'string' ? body.action.trim() : '';
  const hasDb = Boolean(getDatabaseUrl() || sqlClient);

  if (action === 'logout') {
    if (hasDb) {
      try {
        const sql = sqlClient || getSql();
        await ensureAccountSchema(sql);
        const cookies = parseCookies(request.headers.get('cookie'));
        const rawToken = cookies[SESSION_COOKIE_NAME];
        if (rawToken) {
          await sql`DELETE FROM jr_sessions WHERE token_hash = ${hashSessionToken(rawToken)}`;
        }
      } catch (error) {
        console.error('[api/auth logout]', error);
      }
    }
    const clearHeader = buildSessionCookieHeader('', { maxAge: 0, secure: isSecureRequest(request) });
    return jsonResponse({ ok: true, authenticated: false, user: null }, 200, { 'Set-Cookie': clearHeader });
  }

  if (!hasDb) {
    return jsonResponse({ ok: false, error: 'Account database is not configured yet.' }, 503);
  }

  const sql = sqlClient || getSql();
  await ensureAccountSchema(sql);

  if (action === 'request-otp') {
    const hasEmail = Boolean(getMailConfig() || mailer !== sendOtpEmail);
    if (!hasEmail) {
      return jsonResponse({ ok: false, error: 'Gmail OTP delivery is not configured on the server yet.' }, 503);
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return jsonResponse({ ok: false, error: 'Enter a valid email or Gmail address.' }, 400);
    }

    const domain = email.split('@')[1];
    const domainCheck = await verifyDomain(domain);
    if (!domainCheck.valid) {
      return jsonResponse(
        { ok: false, error: 'This email domain cannot receive mail or uses a disposable provider.' },
        400
      );
    }

    const recentRows = await sql`
      SELECT
        COUNT(*)::int AS total_recent,
        MAX(EXTRACT(EPOCH FROM (NOW() - created_at))) AS latest_age_seconds
      FROM jr_otp_challenges
      WHERE email = ${email}
        AND created_at > NOW() - INTERVAL '15 minutes'
    `;
    const totalRecent = Number(recentRows[0]?.total_recent || 0);
    const latestAge = recentRows[0]?.latest_age_seconds == null ? Infinity : Number(recentRows[0].latest_age_seconds);

    if (latestAge < OTP_COOLDOWN_SECONDS) {
      const waitSec = Math.max(1, Math.ceil(OTP_COOLDOWN_SECONDS - latestAge));
      return jsonResponse(
        { ok: false, error: `Please wait ${waitSec}s before requesting another verification code.`, retryAfter: waitSec },
        429
      );
    }
    if (totalRecent >= OTP_WINDOW_LIMIT) {
      return jsonResponse(
        { ok: false, error: 'Too many OTP requests for this email. Please try again in a few minutes.' },
        429
      );
    }

    const challengeId = `otp_${crypto.randomBytes(16).toString('hex')}`;
    const code = generateOtpCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const codeHash = hashOtpCode(code, salt);

    await sql`DELETE FROM jr_otp_challenges WHERE expires_at < NOW() - INTERVAL '1 day'`;
    await sql`
      INSERT INTO jr_otp_challenges (id, email, code_salt, code_hash, expires_at)
      VALUES (${challengeId}, ${email}, ${salt}, ${codeHash}, NOW() + INTERVAL '10 minutes')
    `;

    try {
      await mailer({ to: email, code });
    } catch (error) {
      await sql`DELETE FROM jr_otp_challenges WHERE id = ${challengeId}`.catch(() => {});
      console.error('[api/auth sendOtpEmail]', error);
      return jsonResponse({ ok: false, error: 'Failed to send verification email. Check Gmail SMTP settings.' }, 502);
    }

    return jsonResponse({
      ok: true,
      challengeId,
      maskedEmail: maskEmail(email),
      expiresInSeconds: OTP_TTL_SECONDS,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    });
  }

  if (action === 'verify-otp') {
    const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : '';
    const code = typeof body?.code === 'string' ? body.code.trim().replace(/\s+/g, '') : '';

    if (!CHALLENGE_ID_RE.test(challengeId)) {
      return jsonResponse({ ok: false, error: 'Invalid or missing OTP challenge.' }, 400);
    }
    if (!CODE_RE.test(code)) {
      return jsonResponse({ ok: false, error: 'Enter the 6-digit verification code sent to your inbox.' }, 400);
    }

    const challengeRows = await sql`
      SELECT id, email, code_salt, code_hash, attempts
      FROM jr_otp_challenges
      WHERE id = ${challengeId}
        AND used_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
    `;
    const challenge = challengeRows[0];
    if (!challenge) {
      return jsonResponse({ ok: false, error: 'Verification code expired or invalid. Request a new code.' }, 400);
    }
    if (Number(challenge.attempts) >= MAX_OTP_ATTEMPTS) {
      return jsonResponse({ ok: false, error: 'Too many incorrect attempts. Request a new code.' }, 429);
    }

    const candidateHash = hashOtpCode(code, challenge.code_salt);
    if (!constantTimeHexEqual(challenge.code_hash, candidateHash)) {
      const nextAttempts = Number(challenge.attempts) + 1;
      await sql`UPDATE jr_otp_challenges SET attempts = ${nextAttempts} WHERE id = ${challenge.id}`;
      const remaining = Math.max(0, MAX_OTP_ATTEMPTS - nextAttempts);
      return jsonResponse(
        {
          ok: false,
          error: remaining
            ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
            : 'Too many incorrect attempts. Request a new code.',
        },
        400
      );
    }

    const consumed = await sql`
      UPDATE jr_otp_challenges
      SET used_at = NOW()
      WHERE id = ${challenge.id} AND used_at IS NULL
      RETURNING id
    `;
    if (!consumed.length) {
      return jsonResponse({ ok: false, error: 'Verification code already used. Request a new code.' }, 400);
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const defaultName = challenge.email.split('@')[0].slice(0, 40);
    const userRows = await sql`
      INSERT INTO jr_users (id, email, display_name, last_login_at)
      VALUES (${userId}, ${challenge.email}, ${defaultName}, NOW())
      ON CONFLICT (email) DO UPDATE
      SET last_login_at = NOW(),
          display_name = CASE WHEN jr_users.display_name = '' THEN EXCLUDED.display_name ELSE jr_users.display_name END
      RETURNING id, email, display_name
    `;
    const userRow = userRows[0];

    const rawSessionToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(rawSessionToken);
    await sql`DELETE FROM jr_sessions WHERE expires_at < NOW()`;
    await sql`
      INSERT INTO jr_sessions (token_hash, user_id, expires_at)
      VALUES (${tokenHash}, ${userRow.id}, NOW() + INTERVAL '30 days')
    `;

    const sessionCookie = buildSessionCookieHeader(rawSessionToken, { secure: isSecureRequest(request) });
    return jsonResponse(
      {
        ok: true,
        authenticated: true,
        user: {
          id: userRow.id,
          email: userRow.email,
          displayName: userRow.display_name || defaultName,
        },
      },
      200,
      { 'Set-Cookie': sessionCookie }
    );
  }

  if (action === 'update-profile') {
    const user = await resolveAuthenticatedUser(request, sql);
    if (!user) {
      return jsonResponse({ ok: false, error: 'Sign in required.' }, 401);
    }
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 60) : '';
    if (displayName.length < 2) {
      return jsonResponse({ ok: false, error: 'Display name must be at least 2 characters.' }, 400);
    }
    await sql`UPDATE jr_users SET display_name = ${displayName} WHERE id = ${user.id}`;
    return jsonResponse({
      ok: true,
      user: { id: user.id, email: user.email, displayName },
    });
  }

  return jsonResponse({ ok: false, error: 'Unsupported auth action.' }, 400);
}
