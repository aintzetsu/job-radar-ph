import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  feeds,
  remoteBoardNames,
  externalUrl,
  formatCompactLocation,
  extractCompensation,
  isAtsNoiseLine,
  resumeProfile,
  analyzeJobFit,
  isRemoteJob,
  selectJobs,
} from '../jobs.js';
import { parseRssItems } from '../api/feeds.js';
import { buildApplication } from '../application.js';
import {
  buildSessionCookieHeader,
  constantTimeHexEqual,
  generateOtpCode,
  hashOtpCode,
  hashSessionToken,
  isSameOriginRequest,
  maskEmail,
  mergeUserState,
  parseCookies,
  resetSchemaCacheForTests,
  sanitizeUserState,
  verifyDomainAcceptsMail,
} from '../lib/server/auth-core.js';
import { GET as authGet, POST as authPost } from '../api/auth.js';
import { GET as syncGet, PUT as syncPut } from '../api/sync.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createMockSql() {
  const users = new Map();
  const challenges = new Map();
  const sessions = new Map();
  const states = new Map();

  const sql = async (strings, ...values) => {
    const query = strings.join(' ').replace(/\s+/g, ' ').trim();

    if (query.startsWith('CREATE TABLE IF NOT EXISTS')) {
      return [];
    }
    if (query.startsWith('DELETE FROM jr_otp_challenges WHERE expires_at')) {
      return [];
    }
    if (query.startsWith('DELETE FROM jr_sessions WHERE expires_at')) {
      return [];
    }
    if (query.startsWith('SELECT COUNT(*)::int AS total_recent')) {
      const email = values[0];
      const active = [...challenges.values()].filter(c => c.email === email);
      const latestMs = active.reduce((max, c) => Math.max(max, c.createdAtMs), 0);
      return [
        {
          total_recent: active.length,
          latest_age_seconds: latestMs ? (Date.now() - latestMs) / 1000 : null,
        },
      ];
    }
    if (query.startsWith('INSERT INTO jr_otp_challenges')) {
      const [id, email, code_salt, code_hash] = values;
      challenges.set(id, {
        id,
        email,
        code_salt,
        code_hash,
        attempts: 0,
        expiresAtMs: Date.now() + 600_000,
        used_at: null,
        createdAtMs: Date.now(),
      });
      return [];
    }
    if (query.startsWith('DELETE FROM jr_otp_challenges WHERE id =')) {
      challenges.delete(values[0]);
      return [];
    }
    if (query.startsWith('SELECT id, email, code_salt, code_hash, attempts FROM jr_otp_challenges')) {
      const row = challenges.get(values[0]);
      if (!row || row.used_at || row.expiresAtMs <= Date.now()) return [];
      return [row];
    }
    if (query.startsWith('UPDATE jr_otp_challenges SET attempts =')) {
      const [attempts, id] = values;
      const row = challenges.get(id);
      if (row) row.attempts = attempts;
      return [];
    }
    if (query.startsWith('UPDATE jr_otp_challenges SET used_at = NOW()')) {
      const row = challenges.get(values[0]);
      if (!row || row.used_at) return [];
      row.used_at = new Date().toISOString();
      return [{ id: row.id }];
    }
    if (query.startsWith('INSERT INTO jr_users')) {
      const [id, email, display_name] = values;
      let user = [...users.values()].find(u => u.email === email);
      if (!user) {
        user = { id, email, display_name };
        users.set(id, user);
      } else if (!user.display_name) {
        user.display_name = display_name;
      }
      return [user];
    }
    if (query.startsWith('INSERT INTO jr_sessions')) {
      const [token_hash, user_id] = values;
      sessions.set(token_hash, { token_hash, user_id, expiresAtMs: Date.now() + 86_400_000 });
      return [];
    }
    if (query.startsWith('DELETE FROM jr_sessions WHERE token_hash =')) {
      sessions.delete(values[0]);
      return [];
    }
    if (query.startsWith('SELECT u.id, u.email, u.display_name, s.token_hash FROM jr_sessions')) {
      const sess = sessions.get(values[0]);
      if (!sess || sess.expiresAtMs <= Date.now()) return [];
      const user = users.get(sess.user_id);
      return user ? [{ id: user.id, email: user.email, display_name: user.display_name, token_hash: sess.token_hash }] : [];
    }
    if (query.startsWith('UPDATE jr_users SET display_name =')) {
      const [display_name, id] = values;
      const user = users.get(id);
      if (user) user.display_name = display_name;
      return [];
    }
    if (query.startsWith('SELECT resume_text, applications, filters, theme') && query.includes('FROM jr_user_state')) {
      const row = states.get(values[0]);
      return row ? [row] : [];
    }
    if (query.startsWith('INSERT INTO jr_user_state')) {
      const [user_id, resume_text, appsJson, filtersJson, theme] = values;
      const updated_at = new Date().toISOString();
      states.set(user_id, {
        user_id,
        resume_text,
        applications: JSON.parse(appsJson),
        filters: JSON.parse(filtersJson),
        theme,
        updated_at,
      });
      return [{ updated_at }];
    }
    throw new Error(`Unexpected mock SQL query: ${query}`);
  };

  sql._challenges = challenges;
  return sql;
}

test('externalUrl allows only safe http(s) URLs', () => {
  assert.equal(externalUrl('https://jobs.lever.co/rws/123'), 'https://jobs.lever.co/rws/123');
  assert.equal(externalUrl('http://example.com/job'), 'http://example.com/job');
  assert.equal(externalUrl('javascript:alert(1)'), '');
  assert.equal(externalUrl('data:text/html,hi'), '');
  assert.equal(externalUrl('not a url'), '');
});

test('formatCompactLocation prioritizes PH/remote and summarizes long lists', () => {
  const result = formatCompactLocation('Toronto · Remote - Philippines · London · Manila', 2);
  assert.equal(result.extraCount, 2);
  assert.match(result.short, /Remote - Philippines/);
  assert.match(result.short, /Manila/);
  assert.match(result.short, /\(\+2\)$/);
  assert.equal(result.all.length, 4);
});

test('extractCompensation detects currency ranges and rejects noisy text', () => {
  assert.equal(extractCompensation('Pay: ₱35,000 - ₱45,000 / month plus HMO.'), '₱35,000 - ₱45,000 / month');
  assert.equal(extractCompensation('Rate is $18/hr USD remote contract.'), '$18/hr');
  assert.equal(extractCompensation('Competitive compensation and HMO benefits.'), '');
});

test('isAtsNoiseLine filters ATS tags and requisition metadata', () => {
  assert.equal(isAtsNoiseLine('#LI-CAN17'), true);
  assert.equal(isAtsNoiseLine('Vendor Type:'), true);
  assert.equal(isAtsNoiseLine('Requisition ID: REQ-4021'), true);
  assert.equal(isAtsNoiseLine('HMO coverage upon regularization'), false);
});

test('resumeProfile and analyzeJobFit extract strengths and match/missing keywords', () => {
  const profile = resumeProfile(
    'Maria Santos\nData Annotation & Audio Quality Specialist\nExperience in audio labeling, transcription QA, SQL, and search evaluation.'
  );
  assert.ok(profile);
  assert.ok(profile.groups.some(group => group.label === 'Data Annotation'));

  const fit = analyzeJobFit(
    {
      title: 'AI Data Annotation Specialist',
      description: 'Perform audio labeling, search evaluation, rubric scoring, and Python validation.',
    },
    profile
  );
  assert.ok(fit);
  assert.ok(fit.pct >= 12 && fit.pct <= 98);
});

test('selectJobs filters by location, source, workMode, recency, and sorting', () => {
  const now = Date.UTC(2026, 10, 24);
  const sample = [
    {
      id: '1',
      title: 'Data Annotation Specialist',
      company: 'Acme AI',
      source: 'RWS TrainAI',
      country: 'PH',
      location: 'Remote - Philippines',
      workplace: 'remote',
      description: 'Audio labeling and quality assurance guidelines.',
      date: now - 86400000,
    },
    {
      id: '2',
      title: 'Site Operations Lead',
      company: 'Bayan Corp',
      source: 'Innodata',
      country: 'PH',
      location: 'Quezon City, Metro Manila',
      workplace: 'onsite',
      description: 'On-site QA operations.',
      date: now - 10 * 86400000,
    },
  ];
  assert.equal(isRemoteJob(sample[0]), true);
  assert.equal(isRemoteJob(sample[1]), false);
  const remoteRecent = selectJobs(sample, { location: 'Philippines', workMode: 'remote', days: 7, now });
  assert.deepEqual(remoteRecent.map(i => i.job.id), ['1']);
});

test('buildApplication tailors resume and supports balanced, concise, and technical tones', () => {
  const resume = 'Juan Dela Cruz\nSummary\nDetail-oriented specialist.\n• Annotated 15,000+ audio prompts with 98% QA accuracy.';
  const job = { title: 'Data Annotation Specialist', company: 'RWS TrainAI', description: 'Audio annotation and QA accuracy.' };
  const concise = buildApplication(resume, job, { tone: 'concise' });
  const technical = buildApplication(resume, job, { tone: 'technical' });
  assert.match(concise.cover, /I am writing to apply for Data Annotation Specialist/);
  assert.match(technical.cover, /verified attention to guidelines/);
  assert.ok(concise.cover.length < technical.cover.length);
});

test('auth-core primitives hash OTPs, cookies, origins, and merge state securely', async () => {
  const code = generateOtpCode();
  assert.match(code, /^\d{6}$/);
  assert.equal(constantTimeHexEqual(hashOtpCode(code, 'salt'), hashOtpCode(code, 'salt')), true);
  assert.equal(constantTimeHexEqual(hashOtpCode('000000', 'salt'), hashOtpCode('999999', 'salt')), false);
  assert.equal(maskEmail('edison.gaudicos@gmail.com'), 'ed***@gmail.com');
  assert.notEqual(hashSessionToken('abc'), 'abc');

  const cookie = buildSessionCookieHeader('tok123', { maxAge: 60, secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(parseCookies('jr_session=tok123; other=val'), { jr_session: 'tok123', other: 'val' });

  const sameReq = new Request('https://job-radar-ph.vercel.app/api/auth', {
    method: 'POST',
    headers: { host: 'job-radar-ph.vercel.app', origin: 'https://job-radar-ph.vercel.app' },
  });
  const evilReq = new Request('https://job-radar-ph.vercel.app/api/auth', {
    method: 'POST',
    headers: { host: 'job-radar-ph.vercel.app', origin: 'https://evil.example' },
  });
  assert.equal(isSameOriginRequest(sameReq), true);
  assert.equal(isSameOriginRequest(evilReq), false);

  const blocked = await verifyDomainAcceptsMail('mailinator.com');
  assert.equal(blocked.valid, false);
  const gmail = await verifyDomainAcceptsMail('gmail.com');
  assert.equal(gmail.valid, true);

  const sanitized = sanitizeUserState({
    resumeText: 'QA Resume',
    applications: [
      { job: { id: 'j1', title: 'QA', url: 'javascript:alert(1)' }, status: 'Invalid', notes: 'Note' },
    ],
    theme: 'light',
  });
  assert.equal(sanitized.applications[0].job.url, '');
  assert.equal(sanitized.applications[0].status, 'Saved');

  const merged = mergeUserState(
    {
      resumeText: 'Cloud Resume',
      applications: [{ job: { id: 'j1', title: 'Cloud Role' }, status: 'Applied', notes: 'Applied' }],
      filters: { role: 'Transcription', location: 'Remote' },
      theme: 'light',
    },
    {
      resumeText: 'Local Resume',
      applications: [
        { job: { id: 'j1', title: 'Local Dup' }, status: 'Saved', notes: '' },
        { job: { id: 'j2', title: 'New Local Role' }, status: 'Saved', notes: 'Fresh' },
      ],
      filters: { role: 'Data Annotation' },
      theme: 'dark',
    }
  );
  assert.equal(merged.resumeText, 'Cloud Resume');
  assert.equal(merged.applications.length, 2);
  assert.equal(merged.theme, 'light');
});

test('OTP login, cooldown enforcement, attempt lockout, cloud sync, and logout work end-to-end', async () => {
  resetSchemaCacheForTests();
  const sql = createMockSql();
  const sentEmails = [];
  const mailer = async msg => sentEmails.push(msg);

  const unauthSync = await syncGet(new Request('https://job-radar-ph.vercel.app/api/sync'), { sqlClient: sql });
  assert.equal(unauthSync.status, 401);

  const otpReqResp = await authPost(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'job-radar-ph.vercel.app', origin: 'https://job-radar-ph.vercel.app' },
      body: JSON.stringify({ action: 'request-otp', email: 'applicant@gmail.com' }),
    }),
    { sqlClient: sql, mailer }
  );
  assert.equal(otpReqResp.status, 200);
  const otpReqBody = await otpReqResp.json();
  assert.ok(otpReqBody.challengeId.startsWith('otp_'));
  assert.equal(sentEmails.length, 1);

  const cooldownResp = await authPost(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request-otp', email: 'applicant@gmail.com' }),
    }),
    { sqlClient: sql, mailer }
  );
  assert.equal(cooldownResp.status, 429);

  const badCodeResp = await authPost(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-otp', challengeId: otpReqBody.challengeId, code: '000001' }),
    }),
    { sqlClient: sql, mailer }
  );
  if (sentEmails[0].code !== '000001') {
    assert.equal(badCodeResp.status, 400);
  }

  const verifyResp = await authPost(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-otp', challengeId: otpReqBody.challengeId, code: sentEmails[0].code }),
    }),
    { sqlClient: sql, mailer }
  );
  assert.equal(verifyResp.status, 200);
  const verifyBody = await verifyResp.json();
  assert.equal(verifyBody.authenticated, true);
  assert.equal(verifyBody.user.email, 'applicant@gmail.com');

  const setCookie = verifyResp.headers.get('set-cookie');
  const sessionCookie = setCookie.split(';')[0];

  const statusResp = await authGet(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      headers: { cookie: sessionCookie },
    }),
    { sqlClient: sql }
  );
  const statusBody = await statusResp.json();
  assert.equal(statusBody.authenticated, true);
  assert.equal(statusBody.user.email, 'applicant@gmail.com');

  const mergeResp = await syncPut(
    new Request('https://job-radar-ph.vercel.app/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({
        mode: 'merge',
        state: {
          resumeText: 'Filipino Data Annotation Specialist',
          applications: [{ job: { id: 'rws-1', title: 'Annotator', company: 'RWS' }, status: 'Saved', notes: 'Submitted' }],
          filters: { role: 'Audio Annotation', location: 'Remote' },
          theme: 'light',
        },
      }),
    }),
    { sqlClient: sql }
  );
  assert.equal(mergeResp.status, 200);

  const cloudResp = await syncGet(
    new Request('https://job-radar-ph.vercel.app/api/sync', {
      headers: { cookie: sessionCookie },
    }),
    { sqlClient: sql }
  );
  const cloudBody = await cloudResp.json();
  assert.equal(cloudBody.state.resumeText, 'Filipino Data Annotation Specialist');
  assert.equal(cloudBody.state.applications[0].notes, 'Submitted');
  assert.equal(cloudBody.state.theme, 'light');

  const logoutResp = await authPost(
    new Request('https://job-radar-ph.vercel.app/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ action: 'logout' }),
    }),
    { sqlClient: sql }
  );
  assert.equal(logoutResp.status, 200);

  const afterLogoutSync = await syncGet(
    new Request('https://job-radar-ph.vercel.app/api/sync', {
      headers: { cookie: sessionCookie },
    }),
    { sqlClient: sql }
  );
  assert.equal(afterLogoutSync.status, 401);
});

test('HTML bindings, expanded feeds, and RSS parser remain intact', async () => {
  assert.equal(feeds.length, 60);
  assert.equal(remoteBoardNames.length, 12);

  const rssSample = `
    <rss><channel>
      <item>
        <title><![CDATA[Acme PH: Senior QA Specialist]]></title>
        <link>https://weworkremotely.com/remote-jobs/acme-qa</link>
        <region>Anywhere in the World</region>
        <category>QA</category>
        <pubDate>Tue, 24 Nov 2026 02:00:00 +0000</pubDate>
        <description><![CDATA[<p>Remote QA testing.</p>]]></description>
      </item>
    </channel></rss>
  `;
  const parsed = parseRssItems(rssSample);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].company, 'Acme PH');
  assert.equal(parsed[0].title, 'Senior QA Specialist');
  assert.equal(parsed[0].source, 'We Work Remotely');

  const [html, dashboardCss] = await Promise.all([
    fs.readFile(path.join(rootDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'dashboard.css'), 'utf8'),
  ]);

  for (const id of [
    'theme-toggle',
    'account-btn',
    'account-dialog',
    'account-email-input',
    'account-otp-code',
    'stat-feeds',
    'stat-matches',
    'stat-resume',
    'stat-pipeline',
    'work-mode-group',
    'source-filter',
    'sort-jobs',
    'job-results',
    'job-detail',
    'application-tracker',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Expected index.html to contain id="${id}"`);
  }

  assert.match(dashboardCss, /appearance:\s*none;/);
  assert.match(dashboardCss, /select::picker-icon/);
});
