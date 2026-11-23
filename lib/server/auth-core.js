import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { neon } from '@neondatabase/serverless';
import nodemailer from 'nodemailer';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const CHALLENGE_ID_RE = /^otp_[a-f0-9]{16,64}$/;
export const CODE_RE = /^\d{6}$/;
export const SESSION_COOKIE_NAME = 'jr_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_COOLDOWN_SECONDS = 45;
export const OTP_WINDOW_LIMIT = 5;
export const MAX_OTP_ATTEMPTS = 5;
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const ALLOWED_STATUSES = new Set(['Saved', 'Applied', 'Interviewing', 'Offer', 'Closed']);

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'invalid',
  'localhost',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.net',
  'yopmail.com',
  '10minutemail.com',
  'sharklasers.com',
  'trashmail.com',
  'throwawaymail.com',
  'dispostable.com',
  'fakeinbox.com',
  'getnada.com',
  'maildrop.cc',
]);

let schemaPromise = null;

/** Build a no-store JSON response. */
export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

/** Resolve active Postgres connection URL from Vercel/Neon env vars. */
export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

/** Resolve email delivery configuration from environment variables. */
export function getMailConfig() {
  if (process.env.RESEND_API_KEY) {
    return { provider: 'resend' };
  }
  const user = process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '';
  if (user && pass) {
    return { provider: 'smtp', user, pass };
  }
  return null;
}

/** Return Neon SQL tagged-template client. */
export function getSql() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  return neon(connectionString);
}

/** Idempotently create Job Radar PH auth & sync tables in Postgres. */
export async function ensureAccountSchema(sql) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS jr_users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS jr_otp_challenges (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          code_salt TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS jr_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES jr_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS jr_user_state (
          user_id TEXT PRIMARY KEY REFERENCES jr_users(id) ON DELETE CASCADE,
          resume_text TEXT NOT NULL DEFAULT '',
          applications JSONB NOT NULL DEFAULT '[]'::jsonb,
          filters JSONB NOT NULL DEFAULT '{}'::jsonb,
          theme TEXT NOT NULL DEFAULT 'dark',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export function resetSchemaCacheForTests() {
  schemaPromise = null;
}

/** Mask an email address for UI confirmation (e.g. "ed***@gmail.com"). */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  if (!local || !domain) return email;
  const shown = local.length <= 2 ? local[0] : `${local.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}

/** Generate a 6-digit numeric OTP using crypto.randomInt. */
export function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

/** Hash an OTP code with a per-challenge salt using scrypt. */
export function hashOtpCode(code, salt) {
  return crypto.scryptSync(code, salt, 32).toString('hex');
}

/** Constant-time equality comparison for hex hashes. */
export function constantTimeHexEqual(expectedHex, candidateHex) {
  const a = Buffer.from(String(expectedHex || ''), 'hex');
  const b = Buffer.from(String(candidateHex || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Derive peppered HMAC digest of a raw session token so raw tokens never touch storage. */
export function hashSessionToken(rawToken, secret = process.env.SESSION_SECRET || getDatabaseUrl() || 'job-radar-ph-dev') {
  return crypto.createHmac('sha256', secret).update(String(rawToken || '')).digest('hex');
}

/** Parse Cookie header into a key/value map. */
export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const rawVal = part.slice(eq + 1).trim();
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      out[key] = rawVal;
    }
  }
  return out;
}

/** Detect whether the incoming request arrived over HTTPS. */
export function isSecureRequest(request) {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  return String(request.url || '').startsWith('https://');
}

/** Format Set-Cookie header value for establishing or clearing a session. */
export function buildSessionCookieHeader(value, { maxAge = SESSION_TTL_SECONDS, secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Enforce same-origin when Origin header is present on state-changing requests. */
export function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('DNS lookup timeout')), ms)),
  ]);
}

/** Validate that a target email domain is not disposable and can receive mail. */
export async function verifyDomainAcceptsMail(domain, resolver = dns) {
  const cleanDomain = String(domain || '').trim().toLowerCase();
  if (!cleanDomain || cleanDomain.includes('..') || BLOCKED_EMAIL_DOMAINS.has(cleanDomain)) {
    return { valid: false, reason: 'disposable_or_blocked' };
  }
  if (cleanDomain === 'gmail.com' || cleanDomain === 'googlemail.com') {
    return { valid: true, via: 'known_provider' };
  }
  try {
    const mxRecords = await withTimeout(resolver.resolveMx(cleanDomain));
    const activeMx = Array.isArray(mxRecords) ? mxRecords.filter(r => r && r.exchange && r.exchange !== '.') : [];
    if (activeMx.length > 0) return { valid: true, via: 'mx' };
    return { valid: false, reason: 'no_mx' };
  } catch (error) {
    if (error?.code === 'ENOTFOUND' || error?.code === 'ENODATA') {
      try {
        const aRecords = await withTimeout(resolver.resolve4(cleanDomain));
        if (Array.isArray(aRecords) && aRecords.length > 0) return { valid: true, via: 'a' };
      } catch {
        // Reject domain when neither MX nor A resolves.
      }
      return { valid: false, reason: error.code || 'not_found' };
    }
    return { valid: true, via: 'dns_timeout_bypass' };
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Deliver a 6-digit Job Radar PH sign-in OTP email via Gmail SMTP (or Resend). */
export async function sendOtpEmail({ to, code }) {
  const mail = getMailConfig();
  if (!mail) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  const subject = `${code} is your Job Radar PH sign-in code`;
  const text = [
    `Your Job Radar PH sign-in code is: ${code}`,
    '',
    'Enter this 6-digit code in the sign-in dialog to sync your résumé, saved pipeline, notes, filters, and theme.',
    'This code expires in 10 minutes. If you did not request it, you can safely ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0e1518;color:#f1f6f3;border-radius:14px;border:1px solid #243137;">
      <p style="margin:0 0 8px;color:#a8f57e;font-size:13px;font-weight:700;letter-spacing:0.06em;">JOB RADAR PH</p>
      <h1 style="margin:0 0 12px;font-size:20px;color:#ffffff;">Sign-in verification code</h1>
      <p style="margin:0 0 18px;color:#b2c4be;font-size:14px;line-height:1.5;">Use the 6-digit code below to sign in and sync your résumé, application pipeline, notes, and preferences across devices:</p>
      <div style="padding:16px 20px;background:#151e22;border:1px solid #35583a;border-radius:10px;text-align:center;font-family:monospace;font-size:30px;font-weight:700;letter-spacing:0.24em;color:#a8f57e;">${escapeHtml(code)}</div>
      <p style="margin:18px 0 0;color:#8fa39d;font-size:12px;">Expires in 10 minutes. If you didn’t request this code, ignore this message.</p>
    </div>
  `;

  if (mail.provider === 'resend') {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Job Radar PH <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
        html,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Resend HTTP ${resp.status}: ${errBody.slice(0, 160)}`);
    }
    return;
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: mail.user, pass: mail.pass },
    tls: { rejectUnauthorized: true },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Job Radar PH" <${mail.user}>`,
    to,
    subject,
    text,
    html,
  });
}

function safeHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function sanitizeApplications(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const record of list) {
    const rawJob = record?.job;
    if (!rawJob || typeof rawJob !== 'object') continue;
    const id = String(rawJob.id ?? '').trim().slice(0, 200);
    const title = typeof rawJob.title === 'string' ? rawJob.title.trim().slice(0, 220) : '';
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({
      job: {
        id,
        title,
        company: typeof rawJob.company === 'string' ? rawJob.company.slice(0, 140) : '',
        location: typeof rawJob.location === 'string' ? rawJob.location.slice(0, 220) : '',
        source: typeof rawJob.source === 'string' ? rawJob.source.slice(0, 80) : '',
        workplace: typeof rawJob.workplace === 'string' ? rawJob.workplace.slice(0, 40) : '',
        type: typeof rawJob.type === 'string' ? rawJob.type.slice(0, 60) : '',
        country: typeof rawJob.country === 'string' ? rawJob.country.slice(0, 16) : '',
        date: typeof rawJob.date === 'number' && Number.isFinite(rawJob.date) ? rawJob.date : 0,
        description: typeof rawJob.description === 'string' ? rawJob.description.slice(0, 15000) : '',
        url: safeHttpUrl(rawJob.url),
      },
      status: ALLOWED_STATUSES.has(record.status) ? record.status : 'Saved',
      followUp: /^\d{4}-\d{2}-\d{2}$/.test(record.followUp || '') ? record.followUp : '',
      notes: typeof record.notes === 'string' ? record.notes.slice(0, 400) : '',
    });
    if (out.length >= 200) break;
  }
  return out;
}

function sanitizeFilters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return {
    role: typeof raw.role === 'string' ? raw.role.slice(0, 120) : '',
    location: typeof raw.location === 'string' ? raw.location.slice(0, 80) : 'Philippines',
    source: typeof raw.source === 'string' ? raw.source.slice(0, 80) : 'all',
    liveAge: typeof raw.liveAge === 'string' && /^(?:0|1|3|7|30)$/.test(raw.liveAge) ? raw.liveAge : '0',
    workMode: ['all', 'remote', 'onsite'].includes(raw.workMode) ? raw.workMode : 'all',
  };
}

/** Validate and clamp user workspace state before persistence. */
export function sanitizeUserState(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    resumeText: typeof input.resumeText === 'string' ? input.resumeText.slice(0, 25000) : '',
    applications: sanitizeApplications(input.applications),
    filters: sanitizeFilters(input.filters),
    theme: input.theme === 'light' ? 'light' : 'dark',
  };
}

/** Merge local guest workspace into existing cloud state on first sign-in. */
export function mergeUserState(cloudRaw, localRaw) {
  const cloud = sanitizeUserState(cloudRaw);
  const local = sanitizeUserState(localRaw);
  const byId = new Map();

  for (const entry of cloud.applications) {
    byId.set(entry.job.id, entry);
  }
  for (const entry of local.applications) {
    if (!byId.has(entry.job.id)) {
      byId.set(entry.job.id, entry);
    }
  }

  const hasCloudFilters = Object.keys(cloudRaw?.filters || {}).length > 0;
  return {
    resumeText: cloud.resumeText || local.resumeText,
    applications: [...byId.values()].slice(0, 200),
    filters: hasCloudFilters ? cloud.filters : local.filters,
    theme: cloudRaw?.theme ? cloud.theme : local.theme,
  };
}

/** Look up active authenticated user from session cookie. */
export async function resolveAuthenticatedUser(request, sql) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken || rawToken.length < 16) return null;

  const tokenHash = hashSessionToken(rawToken);
  const rows = await sql`
    SELECT u.id, u.email, u.display_name, s.token_hash
    FROM jr_sessions s
    JOIN jr_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email.split('@')[0],
    tokenHash: row.token_hash,
  };
}
