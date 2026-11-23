import { initBoards } from './boards.js';
import { initTracker } from './tracker.js';
import { initResumeImport } from './resume-import.js';
import { initApplication } from './application.js';
import {
  analyzeJobFit,
  extractCompensation,
  externalUrl,
  feeds,
  formatCompactLocation,
  isAtsNoiseLine,
  isRemoteJob,
  loadFeed,
  resumeProfile,
  selectJobs,
} from './jobs.js';

const byId = id => document.getElementById(id);
const role = byId('role');
const locationInput = byId('location');
const sourceInput = byId('source-filter');
const age = byId('age');
const sort = byId('sort-jobs');
const results = byId('job-results');
const detail = byId('job-detail');
const resumeField = byId('resume-text');
const resumePanel = byId('resume-panel');
const presetRow = document.querySelector('.presets');
const workModeGroup = byId('work-mode-group');
const defaultPresets = ['Data Annotation', 'Audio Annotation', 'Data Quality Analyst', 'Transcription', 'IT Support'];
const filtersKey = 'job-radar-ph-filters';
const resumeKey = 'job-radar-ph-resume';
const pageSize = 8;
const renderBoards = initBoards();

function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const savedFilters = readLocal(filtersKey, {});
if (typeof savedFilters.role === 'string') role.value = savedFilters.role.slice(0, 120);
if ([...locationInput.options].some(option => option.value === savedFilters.location)) locationInput.value = savedFilters.location;
if ([...sourceInput.options].some(option => option.value === savedFilters.source)) sourceInput.value = savedFilters.source;
const preferredAge = savedFilters.liveAge ?? '0';
age.value = [...age.options].some(option => option.value === preferredAge) ? preferredAge : '0';
let workMode = ['all', 'remote', 'onsite'].includes(savedFilters.workMode) ? savedFilters.workMode : 'all';

let resumeText = readLocal(resumeKey, '');
if (typeof resumeText !== 'string') resumeText = '';
resumeField.value = resumeText;
let profile = resumeProfile(resumeText);
let allJobs = [];
let selectedJob = null;
let visibleCount = pageSize;
let loading = false;
let failedFeeds = 0;
let filtersTimer;
let currentMatches = [];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function actionLink(text, href) {
  const node = element('a', text, 'link');
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

function companyInitials(name) {
  return String(name || 'JR')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function updateResumeMeta() {
  const countEl = byId('resume-char-count');
  if (countEl) countEl.textContent = `${resumeField.value.length.toLocaleString()} / 25,000 chars`;
  const toggleHint = byId('resume-toggle-hint');
  if (toggleHint) toggleHint.textContent = resumePanel.open ? 'Hide' : 'Open matcher';
  const statResume = byId('stat-resume');
  const statResumeSub = byId('stat-resume-sub');
  const detectedEl = byId('resume-detected');

  if (profile) {
    byId('resume-badge').textContent = 'Résumé matching on';
    if (statResume) statResume.textContent = `${profile.terms.length} skills`;
    if (statResumeSub) {
      statResumeSub.textContent = profile.groups.length
        ? profile.groups.slice(0, 2).map(g => g.label).join(' · ')
        : 'Custom skill keywords active';
    }
    if (detectedEl) {
      const tags = profile.groups.length
        ? profile.groups.map(g => g.label)
        : profile.terms.slice(0, 5);
      detectedEl.replaceChildren(
        element('span', 'Detected focus:', 'fit-row-label'),
        ...tags.map(tag => element('span', tag, 'job-tag match'))
      );
      detectedEl.hidden = false;
    }
  } else {
    byId('resume-badge').textContent = 'Add résumé';
    if (statResume) statResume.textContent = 'Off';
    if (statResumeSub) statResumeSub.textContent = 'Click to upload PDF / paste';
    if (detectedEl) detectedEl.hidden = true;
  }
}

function openResume() {
  resumePanel.open = true;
  updateResumeMeta();
  resumePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  resumeField.focus();
  byId('resume-status').textContent = 'Paste your résumé or drop a PDF/DOCX file, then click Match jobs.';
}

const application = initApplication({ getResume: () => resumeText, onMissingResume: openResume });
const tracker = initTracker({
  container: byId('application-tracker'),
  onChange: () => {
    updateSaveButton();
    updatePipelineStats();
    if (allJobs.length) renderResults();
  },
  onOpen: job => {
    showJob(job);
    detail.focus({ preventScroll: true });
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
});

function updatePipelineStats() {
  const counts = tracker.getCounts();
  const total = counts.All || 0;
  const active = (counts.Applied || 0) + (counts.Interviewing || 0) + (counts.Offer || 0);
  const navCount = byId('nav-tracker-count');
  if (navCount) navCount.textContent = String(total);
  const statPipeline = byId('stat-pipeline');
  const statPipelineSub = byId('stat-pipeline-sub');
  if (statPipeline) statPipeline.textContent = total === 1 ? '1 saved' : `${total} saved`;
  if (statPipelineSub) {
    statPipelineSub.textContent = active ? `${counts.Applied || 0} applied · ${counts.Interviewing || 0} interviewing` : 'Track stages & follow-ups →';
  }
}

resumePanel.addEventListener('toggle', updateResumeMeta);
resumeField.addEventListener('input', updateResumeMeta);
byId('stat-resume-card')?.addEventListener('click', () => {
  resumePanel.open = !resumePanel.open;
  updateResumeMeta();
  if (resumePanel.open) resumeField.focus();
});

function renderPresets() {
  updateResumeMeta();
  const labels = profile?.groups.length ? profile.groups.map(group => group.label) : defaultPresets;
  presetRow.replaceChildren(
    ...labels.map(label => {
      const node = button(label, () => {
        role.value = label;
        resetResults();
      });
      node.setAttribute('aria-pressed', String(role.value.trim() === label));
      return node;
    })
  );
  if (workModeGroup) {
    workModeGroup.querySelectorAll('[data-work-mode]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.workMode === workMode));
    });
  }
}

function useResume() {
  const pasted = resumeField.value.trim();
  if (pasted.length < 25) {
    byId('resume-status').textContent = 'Paste at least a few lines of experience or skills.';
    resumeField.focus();
    return;
  }
  const previousId = selectedJob?.id;
  resumeText = pasted;
  profile = resumeProfile(pasted);
  const stored = writeLocal(resumeKey, pasted);
  byId('resume-status').textContent = stored
    ? 'Résumé saved locally. Roles are ranked by skill overlap.'
    : 'Résumé matching active for this visit (browser storage unavailable).';
  role.value = '';
  sort.value = 'match';
  resetResults();
  if (selectedJob && selectedJob.id === previousId) showJob(selectedJob);
}

const resumeImport = initResumeImport({
  input: byId('resume-file'),
  status: byId('resume-file-status'),
  field: resumeField,
  matchButton: byId('use-resume'),
  dropzone: byId('resume-dropzone'),
});

byId('use-resume').addEventListener('click', useResume);
byId('clear-resume').addEventListener('click', () => {
  const previousId = selectedJob?.id;
  resumeImport.clear();
  resumeField.value = resumeText = '';
  profile = null;
  writeLocal(resumeKey, '');
  byId('resume-status').textContent = 'Résumé cleared.';
  role.value = 'Data Annotation';
  resetResults();
  if (selectedJob && selectedJob.id === previousId) showJob(selectedJob);
});

byId('clear-role')?.addEventListener('click', () => {
  role.value = '';
  role.focus();
  resetResults();
});

byId('focus-search-btn')?.addEventListener('click', () => {
  role.focus();
  role.select();
});

document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  role.focus();
  role.select();
});

workModeGroup?.querySelectorAll('[data-work-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    workMode = btn.dataset.workMode;
    resetResults();
  });
});

const dateFormatter = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
function dateText(job) {
  return job.date ? (job.dateLabel || 'Listed') + ' ' + dateFormatter.format(job.date) : 'Date not listed';
}

function isRecentJob(job) {
  return Boolean(job.date && Date.now() - job.date <= 3 * 86400000);
}

function makeRow({ job, resumeMatch }) {
  const row = button('', () => {
    showJob(job);
    markSelection();
    if (matchMedia('(max-width: 860px)').matches) {
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 'job-row');
  row.dataset.jobId = job.id;
  row.setAttribute('aria-controls', 'job-detail');
  row.setAttribute('aria-pressed', String(selectedJob?.id === job.id));

  const head = element('div', '', 'job-row-head');
  const identity = element('div', '', 'job-row-identity');
  identity.append(element('span', companyInitials(job.company), 'company-monogram'));

  const titles = element('div', '', 'job-row-titles');
  const loc = formatCompactLocation(job.location, 2);
  titles.append(element('strong', job.title), element('small', `${job.company} · ${loc.short}`));
  identity.append(titles);

  const isSaved = tracker.isSaved(job);
  const savedBadge = element('span', isSaved ? 'Saved ✓' : 'Save', `quick-save-pill${isSaved ? ' is-saved' : ''}`);
  savedBadge.addEventListener('click', event => {
    event.stopPropagation();
    if (!tracker.isSaved(job)) {
      tracker.save(job);
    }
  });

  head.append(identity, savedBadge);
  row.append(head);

  const badges = element('span', '', 'row-badges');
  if (isRecentJob(job)) badges.append(element('span', 'New', 'job-tag fresh'));
  if (isRemoteJob(job)) badges.append(element('span', 'Remote', 'job-tag'));
  const pay = extractCompensation(job.description);
  if (pay) badges.append(element('span', pay, 'job-tag pay'));
  badges.append(element('span', dateText(job), 'job-tag'));
  if (profile && resumeMatch >= 10) {
    const pct = Math.min(98, Math.max(18, Math.round(resumeMatch * 2.1)));
    badges.append(element('span', `${pct}% match`, 'job-tag match'));
  }
  row.append(badges);
  return row;
}

function markSelection() {
  for (const row of results.querySelectorAll('.job-row')) {
    row.setAttribute('aria-pressed', String(row.dataset.jobId === selectedJob?.id));
  }
}

function updateSaveButton() {
  const save = byId('save-current-job');
  const message = byId('detail-save-status');
  if (!save || !selectedJob) return;
  const isSaved = tracker.isSaved(selectedJob);
  save.textContent = isSaved ? 'Saved to pipeline ✓' : 'Save to pipeline';
  save.disabled = isSaved;
  if (message && !isSaved) {
    message.textContent = '';
  }
}

const detailHeadings = [
  [/^(?:what (?:you.ll|you will) do|(?:key )?responsibilities|day to day|your role|duties)(?:\s*[:–-]\s*|$)/i, 'Responsibilities'],
  [
    /^(?:what you(?:.ll| will) need|what you bring|who you are|(?:minimum |preferred |basic |desired )?(?:requirements|qualifications)|(?:required |preferred )?skills|education)(?:\s*[:–-]\s*|$)/i,
    'Qualifications',
  ],
  [/^(?:benefits|perks|what we offer|why join us)(?:\s*[:–-]\s*|$)/i, 'Benefits'],
];

function descriptionParts(description) {
  const intro = [];
  const sections = new Map();
  let current = intro;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[•*]\s*/, '');
    if (!line || isAtsNoiseLine(line)) continue;
    const heading = detailHeadings.find(([pattern]) => pattern.test(line));
    if (heading) {
      if (!sections.has(heading[1])) sections.set(heading[1], []);
      current = sections.get(heading[1]);
      const tail = line.replace(heading[0], '').trim();
      if (tail && !isAtsNoiseLine(tail)) current.push(tail);
    } else {
      current.push(line);
    }
  }
  let summary = intro.find(line => line.length >= 60) || intro[0] || '';
  if (summary.length > 500) summary = summary.slice(0, 500).replace(/\s+\S*$/, '') + '…';
  return { summary, sections };
}

function showJob(job) {
  selectedJob = job;
  const backBar = element('div', '', 'mobile-back-bar');
  backBar.append(
    button(`↑ Back to ${currentMatches.length} listings`, () => {
      byId('live-jobs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );

  const header = element('div', '', 'detail-header');
  header.append(element('h3', job.title), element('p', job.company, 'company-line'));

  const loc = formatCompactLocation(job.location, 3);
  const pay = extractCompensation(job.description);
  const tags = element('div', '', 'job-tags');
  for (const [label, cls] of [
    [loc.short, 'job-tag'],
    [job.workplace || (isRemoteJob(job) ? 'Remote' : ''), 'job-tag'],
    [job.kind, 'job-tag'],
    [pay, 'job-tag pay'],
    [dateText(job), 'job-tag'],
  ]) {
    if (!label) continue;
    if (![...tags.children].some(item => item.textContent.toLowerCase() === label.toLowerCase())) {
      tags.append(element('span', label, cls));
    }
  }

  const actions = element('div', '', 'actions');
  const apply = externalUrl(job.applyUrl || job.url);
  if (apply) actions.append(actionLink('Apply on source ↗', apply));

  const message = element('p', '', 'source-notes');
  message.id = 'detail-save-status';
  message.setAttribute('role', 'status');

  const save = button('Save to pipeline', () => {
    const saved = tracker.save(job);
    updateSaveButton();
    message.textContent = saved ? 'Saved to your application pipeline.' : 'Already saved or storage unavailable.';
  });
  save.id = 'save-current-job';
  actions.append(save);

  if (apply) {
    const copyBtn = button('Copy link', async () => {
      try {
        await navigator.clipboard.writeText(apply);
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => {
          copyBtn.textContent = 'Copy link';
        }, 1600);
      } catch {
        message.textContent = apply;
      }
    });
    actions.append(copyBtn);
  }

  const children = [backBar, header, tags, actions, message];

  const fit = analyzeJobFit(job, profile);
  if (fit) {
    const fitBox = element('div', '', 'fit-box');
    const fitHead = element('div', '', 'fit-head');
    fitHead.append(element('h4', 'Why your résumé matches'), element('span', `${fit.pct}% fit score`, 'fit-score'));
    const fitRows = element('div', '', 'fit-rows');
    if (fit.matched.length) {
      const row = element('div', '', 'fit-row');
      row.append(element('span', 'Matched:', 'fit-row-label'), ...fit.matched.map(t => element('span', t, 'job-tag match')));
      fitRows.append(row);
    }
    if (fit.missing.length) {
      const row = element('div', '', 'fit-row');
      row.append(element('span', 'Keywords in posting:', 'fit-row-label'), ...fit.missing.map(t => element('span', t, 'job-tag')));
      fitRows.append(row);
    }
    fitBox.append(fitHead, fitRows);
    children.push(fitBox);
  }

  const applicationBox = element('div', '', 'apply-box');
  const boxCopy = element('div');
  boxCopy.append(element('h4', 'Tailor your application'), element('p', 'Generate a role-aligned résumé and cover letter draft with tone options.'));
  applicationBox.append(boxCopy, button('Generate application', () => application.open(job), 'primary'));
  children.push(applicationBox);

  const description = job.description || '';
  const { summary, sections } = descriptionParts(description);
  if (summary) {
    const panel = element('section', '', 'detail-section');
    panel.append(element('h4', 'Job summary'), element('p', summary));
    children.push(panel);
  }
  for (const [label, items] of sections) {
    if (!items.length) continue;
    const panel = element('section', '', 'detail-section');
    const list = document.createElement('ul');
    for (const line of items.slice(0, 5)) list.append(element('li', line));
    panel.append(element('h4', label), list);
    children.push(panel);
  }
  if (loc.extraCount > 0) {
    const locPanel = element('section', '', 'detail-section');
    locPanel.append(element('h4', `All listed locations (${loc.all.length})`), element('p', loc.all.join(' · ')));
    children.push(locPanel);
  }
  if (description) {
    const full = element('details', '', 'description-toggle');
    full.append(element('summary', 'Full job description'), element('div', description, 'job-description'));
    children.push(full);
  } else {
    children.push(element('p', 'The source did not include a full description. Open the employer link above for complete details.'));
  }

  detail.replaceChildren(...children);
  updateSaveButton();
  markSelection();
}

function renderResults() {
  renderPresets();
  const keyword = role.value.trim();
  const location = locationInput.value;
  const source = sourceInput.value;
  const days = Number(age.value);
  const boardQuery = keyword || profile?.groups[0]?.label || '';
  writeLocal(filtersKey, { role: keyword, location, source, liveAge: age.value, workMode });

  byId('summary').textContent = [boardQuery || 'All roles', location, age.selectedOptions[0].text].join(' · ');
  renderBoards(boardQuery, location, days);

  const matches = selectJobs(allJobs, { keyword, location, days, source, workMode, profile, sort: sort.value });
  currentMatches = matches;

  const totalText = loading && !allJobs.length ? 'Loading…' : `${matches.length} ${matches.length === 1 ? 'job' : 'jobs'}`;
  byId('result-count').textContent = totalText;
  const navJobsCount = byId('nav-jobs-count');
  if (navJobsCount) navJobsCount.textContent = String(matches.length);
  const statMatches = byId('stat-matches');
  const statMatchesSub = byId('stat-matches-sub');
  if (statMatches) statMatches.textContent = String(matches.length);
  if (statMatchesSub) statMatchesSub.textContent = `${allJobs.length} total roles across boards`;

  byId('more-jobs').hidden = matches.length <= visibleCount;
  if (matches.length) {
    if (!selectedJob || (selectedJob.source !== 'Pasted posting' && !matches.some(item => item.job.id === selectedJob.id))) {
      showJob(matches[0].job);
    }
    results.replaceChildren(...matches.slice(0, visibleCount).map(makeRow));
    return;
  }

  const empty = element('div', '', 'empty-jobs');
  let copy = 'No listings match these exact filters.';
  if (loading) copy = 'Checking employer feeds…';
  else if (failedFeeds === feeds.length) copy = 'Live feeds could not load right now. Try Refresh or add a posting directly.';
  empty.append(element('p', copy));
  if (!loading && days) empty.append(button('Search any time', () => { age.value = '0'; resetResults(); }));
  if (!loading && keyword) empty.append(button('Clear keyword', () => { role.value = ''; resetResults(); }));
  if (!loading && (source !== 'all' || workMode !== 'all')) {
    empty.append(button('Reset source & setup', () => { sourceInput.value = 'all'; workMode = 'all'; resetResults(); }));
  }
  if (!loading && location !== 'Anywhere') empty.append(button('Search all locations', () => { locationInput.value = 'Anywhere'; resetResults(); }));
  if (!selectedJob || selectedJob.source !== 'Pasted posting') {
    selectedJob = null;
    detail.replaceChildren(element('p', 'Choose a listing to inspect its details, or use + Add a posting above.', 'empty-detail'));
  }
  results.replaceChildren(empty);
}

function resetResults() {
  visibleCount = pageSize;
  renderResults();
}

const cachedFeeds = new Map();
const refreshInterval = 5 * 60 * 1000;
let lastCheck = 0;
let refreshTimer;

function refreshIfDue() {
  if (!loading && Date.now() - lastCheck >= refreshInterval) refreshJobs();
}

async function refreshJobs() {
  if (loading) return;
  clearTimeout(refreshTimer);
  loading = true;
  const refresh = byId('refresh-jobs');
  const status = byId('feed-status');
  refresh.disabled = true;
  status.textContent = 'Checking ' + feeds.length + ' live employer feeds…';
  if (!allJobs.length) renderResults();

  const responses = await Promise.allSettled(feeds.map(feed => loadFeed(feed)));
  failedFeeds = 0;
  responses.forEach((response, index) => {
    if (response.status === 'fulfilled') cachedFeeds.set(feeds[index].name, response.value);
    else failedFeeds++;
  });
  allJobs = [...new Map([...cachedFeeds.values()].flat().map(job => [job.id, job])).values()];
  lastCheck = Date.now();
  const checkedAt = new Intl.DateTimeFormat('en-PH', { timeStyle: 'short', timeZone: 'Asia/Manila' }).format(lastCheck);
  const loaded = feeds.length - failedFeeds;

  byId('stat-feeds').textContent = `${loaded}/${feeds.length} live`;
  byId('stat-feeds-sub').textContent = `Updated ${checkedAt} PHT`;

  status.textContent = loaded
    ? `${loaded} of ${feeds.length} feeds synced · ${checkedAt} PHT` + (failedFeeds ? ' · Partial feed failure' : ' · Auto-refresh every 5m')
    : allJobs.length
      ? 'Live feeds unavailable. Showing cached results.'
      : 'Live feeds unavailable.';

  loading = false;
  refreshTimer = setTimeout(refreshJobs, refreshInterval);
  refresh.disabled = false;
  renderResults();
}

const pasteDialog = byId('paste-dialog');
const manual = byId('manual-form');
byId('paste-job').addEventListener('click', () => {
  byId('manual-status').textContent = '';
  pasteDialog.showModal();
});
byId('close-paste').addEventListener('click', () => pasteDialog.close());
pasteDialog.addEventListener('click', event => {
  if (event.target === pasteDialog) pasteDialog.close();
});

manual.addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(manual);
  const input = field => String(data.get(field) || '').trim();
  const url = externalUrl(input('url'));
  if (!input('title') || !input('company') || !input('description') || (input('url') && !url)) {
    byId('manual-status').textContent = 'Enter a title, company, and description. Use an HTTP or HTTPS posting link.';
    return;
  }
  const savedJob = url && tracker.list().find(entry => entry.job?.url === url && entry.job.source === 'Pasted posting');
  const job = {
    id: savedJob?.job.id || 'pasted:' + crypto.randomUUID(),
    title: input('title'),
    company: input('company'),
    location: input('location') || 'Location not listed',
    description: input('description'),
    url,
    source: 'Pasted posting',
  };
  if (!tracker.isSaved(job) && !tracker.save(job)) {
    byId('manual-status').textContent = 'Browser storage unavailable. Preview opened without saving.';
  }
  showJob(tracker.isSaved(job) && savedJob ? savedJob.job : job);
  pasteDialog.close();
  manual.reset();
  detail.focus({ preventScroll: true });
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

byId('filters').addEventListener('input', event => {
  clearTimeout(filtersTimer);
  if (event.target === role) filtersTimer = setTimeout(resetResults, 150);
  else resetResults();
});
byId('filters').addEventListener('submit', event => {
  event.preventDefault();
  resetResults();
});
byId('sort-jobs').addEventListener('input', resetResults);
byId('refresh-jobs').addEventListener('click', refreshJobs);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshIfDue();
});
window.addEventListener('pageshow', refreshIfDue);
byId('more-jobs').addEventListener('click', () => {
  visibleCount += pageSize;
  renderResults();
});

updatePipelineStats();
updateResumeMeta();
refreshJobs();
