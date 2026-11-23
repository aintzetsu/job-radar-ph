import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  feeds,
  externalUrl,
  formatCompactLocation,
  extractCompensation,
  isAtsNoiseLine,
  resumeProfile,
  analyzeJobFit,
  isRemoteJob,
  selectJobs,
} from '../jobs.js';
import { buildApplication } from '../application.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  const empty = formatCompactLocation('');
  assert.equal(empty.short, 'Location not listed');
  assert.equal(empty.extraCount, 0);
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
  assert.ok(fit.matched.includes('audio') || fit.matched.includes('labeling'));
  assert.ok(fit.missing.some(word => word === 'python' || word === 'rubric'));
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
    {
      id: '3',
      title: 'Office Receptionist',
      company: 'London Ltd',
      country: 'GB',
      location: 'London',
      workplace: 'onsite',
      description: 'Front desk.',
      date: now - 86400000,
    },
  ];

  assert.equal(isRemoteJob(sample[0]), true);
  assert.equal(isRemoteJob(sample[1]), false);

  const phAll = selectJobs(sample, { location: 'Philippines', now });
  assert.deepEqual(
    phAll.map(item => item.job.id),
    ['1', '2']
  );

  const remoteRecent = selectJobs(sample, { location: 'Philippines', workMode: 'remote', days: 7, now });
  assert.deepEqual(
    remoteRecent.map(item => item.job.id),
    ['1']
  );

  const byCompany = selectJobs(sample, { location: 'Philippines', sort: 'company', now });
  assert.deepEqual(
    byCompany.map(item => item.job.company),
    ['Acme AI', 'Bayan Corp']
  );

  const bySource = selectJobs(sample, { location: 'Philippines', source: 'Innodata', now });
  assert.deepEqual(
    bySource.map(item => item.job.id),
    ['2']
  );
});

test('buildApplication tailors resume and supports balanced, concise, and technical tones', () => {
  const resume = [
    'Juan Dela Cruz',
    'Summary',
    'Detail-oriented data specialist focused on accuracy and guidelines.',
    'Experience',
    '• Annotated 15,000+ audio and search evaluation prompts with 98% QA accuracy.',
    '• Audited Filipino and English transcription datasets using rubric checks.',
  ].join('\n');
  const job = {
    title: 'Data Annotation Specialist',
    company: 'RWS TrainAI',
    description: 'Requirements\nStrong audio annotation, search evaluation, and QA rubric accuracy.',
  };

  const balanced = buildApplication(resume, job, { tone: 'balanced' });
  const concise = buildApplication(resume, job, { tone: 'concise' });
  const technical = buildApplication(resume, job, { tone: 'technical' });

  assert.match(balanced.resume, /Applying for Data Annotation Specialist at RWS TrainAI/);
  assert.match(balanced.cover, /Dear RWS TrainAI hiring team,/);
  assert.match(concise.cover, /I am writing to apply for Data Annotation Specialist at RWS TrainAI/);
  assert.match(technical.cover, /verified attention to guidelines, structured tooling, and measurable execution/);
  assert.ok(concise.cover.length < technical.cover.length);
});

test('feeds, HTML bindings, and CSS select appearance rules are intact', async () => {
  assert.equal(feeds.length, 8);
  const [html, dashboardCss] = await Promise.all([
    fs.readFile(path.join(rootDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rootDir, 'dashboard.css'), 'utf8'),
  ]);

  for (const id of [
    'theme-toggle',
    'stat-feeds',
    'stat-matches',
    'stat-resume',
    'stat-pipeline',
    'resume-dropzone',
    'resume-file',
    'resume-text',
    'resume-detected',
    'work-mode-group',
    'source-filter',
    'sort-jobs',
    'job-results',
    'job-detail',
    'application-tracker',
    'platforms',
    'official-platforms',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Expected index.html to contain id="${id}"`);
  }

  assert.match(dashboardCss, /appearance:\s*none;/);
  assert.match(dashboardCss, /-webkit-appearance:\s*none;/);
});
