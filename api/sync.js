import {
  ensureAccountSchema,
  getDatabaseUrl,
  getSql,
  isSameOriginRequest,
  jsonResponse,
  mergeUserState,
  resolveAuthenticatedUser,
  sanitizeUserState,
} from '../lib/server/auth-core.js';

export async function GET(request, { sqlClient = null } = {}) {
  if (!getDatabaseUrl() && !sqlClient) {
    return jsonResponse({ ok: false, error: 'Cloud sync database is not configured.' }, 503);
  }

  try {
    const sql = sqlClient || getSql();
    await ensureAccountSchema(sql);
    const user = await resolveAuthenticatedUser(request, sql);
    if (!user) {
      return jsonResponse({ ok: false, error: 'Sign in required.' }, 401);
    }

    const rows = await sql`
      SELECT resume_text, applications, filters, theme, updated_at
      FROM jr_user_state
      WHERE user_id = ${user.id}
      LIMIT 1
    `;
    const row = rows[0];
    const state = row
      ? sanitizeUserState({
          resumeText: row.resume_text,
          applications: row.applications,
          filters: row.filters,
          theme: row.theme,
        })
      : sanitizeUserState({});

    return jsonResponse({
      ok: true,
      state,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    });
  } catch (error) {
    console.error('[api/sync GET]', error);
    return jsonResponse({ ok: false, error: 'Unable to load saved account workspace.' }, 500);
  }
}

async function handleSave(request, { sqlClient = null } = {}) {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
  }
  if (!getDatabaseUrl() && !sqlClient) {
    return jsonResponse({ ok: false, error: 'Cloud sync database is not configured.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
  }

  try {
    const sql = sqlClient || getSql();
    await ensureAccountSchema(sql);
    const user = await resolveAuthenticatedUser(request, sql);
    if (!user) {
      return jsonResponse({ ok: false, error: 'Sign in required.' }, 401);
    }

    const mode = body?.mode === 'merge' ? 'merge' : 'replace';
    let nextState = sanitizeUserState(body?.state);

    if (mode === 'merge') {
      const existingRows = await sql`
        SELECT resume_text, applications, filters, theme
        FROM jr_user_state
        WHERE user_id = ${user.id}
        LIMIT 1
      `;
      const row = existingRows[0];
      const existingCloud = row
        ? {
            resumeText: row.resume_text,
            applications: row.applications,
            filters: row.filters,
            theme: row.theme,
          }
        : null;
      nextState = mergeUserState(existingCloud, body?.state);
    }

    const savedRows = await sql`
      INSERT INTO jr_user_state (user_id, resume_text, applications, filters, theme, updated_at)
      VALUES (
        ${user.id},
        ${nextState.resumeText},
        ${JSON.stringify(nextState.applications)}::jsonb,
        ${JSON.stringify(nextState.filters)}::jsonb,
        ${nextState.theme},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE
      SET resume_text = EXCLUDED.resume_text,
          applications = EXCLUDED.applications,
          filters = EXCLUDED.filters,
          theme = EXCLUDED.theme,
          updated_at = NOW()
      RETURNING updated_at
    `;

    return jsonResponse({
      ok: true,
      state: nextState,
      updatedAt: savedRows[0]?.updated_at ? new Date(savedRows[0].updated_at).toISOString() : new Date().toISOString(),
    });
  } catch (error) {
    console.error('[api/sync PUT]', error);
    return jsonResponse({ ok: false, error: 'Unable to save workspace to cloud.' }, 500);
  }
}

export async function PUT(request, deps = {}) {
  return handleSave(request, deps);
}

export async function POST(request, deps = {}) {
  return handleSave(request, deps);
}
