import {initBoards} from './boards.js';
import {initTracker} from './tracker.js';
import {initApplication} from './application.js';
import {externalUrl,feeds,loadFeed,resumeProfile,selectJobs} from './jobs.js';

const byId = id => document.getElementById(id);
const role = byId('role');
const locationInput = byId('location');
const age = byId('age');
const sort = byId('sort-jobs');
const results = byId('job-results');
const detail = byId('job-detail');
const resumeField = byId('resume-text');
const resumePanel = byId('resume-panel');
const presetRow = document.querySelector('.presets');
const defaultPresets = ['Data Annotation','Audio Annotation','Data Quality Analyst','Transcription','IT Support'];
const filtersKey = 'job-radar-ph-filters';
const resumeKey = 'job-radar-ph-resume';
const pageSize = 8;
const renderBoards = initBoards();

function readLocal(key,fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key,value) {
  try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; }
}

const savedFilters = readLocal(filtersKey,{});
if (typeof savedFilters.role === 'string') role.value = savedFilters.role.slice(0,120);
if ([...locationInput.options].some(option=>option.value===savedFilters.location)) locationInput.value = savedFilters.location;
const preferredAge = savedFilters.liveAge ?? '0';
age.value = [...age.options].some(option=>option.value===preferredAge) ? preferredAge : '0';
let resumeText = readLocal(resumeKey,'');
if (typeof resumeText !== 'string') resumeText = '';
resumeField.value = resumeText;
let profile = resumeProfile(resumeText);
let allJobs = [];
let selectedJob = null;
let visibleCount = pageSize;
let loading = false;
let failedFeeds = 0;
let filtersTimer;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text,handler,className) {
  const node = element('button',text,className);
  node.type = 'button';
  node.addEventListener('click',handler);
  return node;
}
function actionLink(text,href) {
  const node = element('a',text,'link');
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
function openResume() {
  resumePanel.open = true;
  resumeField.focus();
  byId('resume-status').textContent = 'Paste your résumé and select Match jobs to generate application drafts.';
}
const application = initApplication({getResume:()=>resumeText,onMissingResume:openResume});
const tracker = initTracker({
  container:byId('application-tracker'),
  onChange:()=>{ updateSaveButton(); },
  onOpen: job => {
    showJob(job);
    detail.focus({preventScroll:true});
    detail.scrollIntoView({behavior:'smooth',block:'start'});
  },
});

function renderPresets() {
  byId('resume-badge').textContent = profile ? 'Résumé matching on' : 'Add résumé';
  const labels = profile?.groups.length ? profile.groups.map(group=>group.label) : defaultPresets;
  presetRow.replaceChildren(...labels.map(label=>{
    const node = button(label,()=>{role.value = label; resetResults();});
    node.setAttribute('aria-pressed',String(role.value.trim()===label));
    return node;
  }));
}

function useResume() {
  const pasted = resumeField.value.trim();
  if (pasted.length < 25) {
    byId('resume-status').textContent = 'Paste at least a few lines of experience or skills.';
    resumeField.focus();
    return;
  }
  resumeText = pasted;
  profile = resumeProfile(pasted);
  const stored = writeLocal(resumeKey,pasted);
  byId('resume-status').textContent = stored ? 'Résumé saved. Jobs are ranked by the skills and experience in your résumé.' : 'Résumé matching is active for this visit. Browser storage is unavailable.';
  role.value = '';
  sort.value = 'match';
  resetResults();
}
byId('use-resume').addEventListener('click',useResume);
byId('clear-resume').addEventListener('click',()=>{
  resumeField.value = resumeText = '';
  profile = null;
  writeLocal(resumeKey,'');
  byId('resume-status').textContent = 'Résumé cleared.';
  role.value = 'Data Annotation';
  resetResults();
});

const dateFormatter = new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'});
function dateText(job) {
  return job.date ? (job.dateLabel || 'Listing date')+' '+dateFormatter.format(job.date) : 'Date not listed';
}
function makeRow({job,resumeMatch}) {
  const row = button('',()=>{
    showJob(job);
    markSelection();
    if (matchMedia('(max-width: 735px)').matches) detail.scrollIntoView({behavior:'smooth',block:'start'});
  },'job-row');
  row.dataset.jobId = job.id;
  row.setAttribute('aria-controls','job-detail');
  row.setAttribute('aria-pressed',String(selectedJob?.id===job.id));
  row.append(element('strong',job.title),element('small',job.company+' · '+job.location));
  const badges = element('span','','row-badges');
  badges.append(element('span',dateText(job),'job-tag'));
  if (profile && resumeMatch>=15) badges.append(element('span','Résumé skills match','job-tag match'));
  row.append(badges);
  return row;
}
function markSelection() {
  for (const row of results.querySelectorAll('.job-row')) row.setAttribute('aria-pressed',String(row.dataset.jobId===selectedJob?.id));
}
function updateSaveButton() {
  const save = byId('save-current-job');
  if (save && selectedJob) {
    const isSaved = tracker.isSaved(selectedJob);
    save.textContent = isSaved ? 'Saved to tracker' : 'Save to tracker';
    save.disabled = isSaved;
  }
}

const detailHeadings = [
  [/^(?:what (?:you.ll|you will) do|(?:key )?responsibilities|day to day|your role|duties)(?:\s*[:–-]\s*|$)/i,'Responsibilities'],
  [/^(?:what you(?:.ll| will) need|what you bring|who you are|(?:minimum |preferred |basic |desired )?(?:requirements|qualifications)|(?:required |preferred )?skills|education)(?:\s*[:–-]\s*|$)/i,'Qualifications'],
  [/^(?:benefits|perks|what we offer|why join us)(?:\s*[:–-]\s*|$)/i,'Benefits'],
];

function descriptionParts(description) {
  const intro = [];
  const sections = new Map();
  let current = intro;
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[•*]\s*/,'');
    if (!line) continue;
    const heading = detailHeadings.find(([pattern])=>pattern.test(line));
    if (heading) {
      if (!sections.has(heading[1])) sections.set(heading[1],[]);
      current = sections.get(heading[1]);
      const tail = line.replace(heading[0],'').trim();
      if (tail) current.push(tail);
    } else current.push(line);
  }
  let summary = intro.find(line=>line.length>=60) || intro[0] || '';
  if (summary.length>500) summary = summary.slice(0,500).replace(/\s+\S*$/,'')+'…';
  return {summary,sections};
}

function showJob(job) {
  selectedJob = job;
  const tags = element('div','','job-tags');
  for (const value of [job.location,job.workplace,job.kind,dateText(job)].filter(Boolean)) {
    if (![...tags.children].some(item=>item.textContent.toLowerCase()===value.toLowerCase())) tags.append(element('span',value,'job-tag'));
  }
  const heading = element('h3',job.title);
  const company = element('p',job.company,'company-line');
  const actions = element('div','','actions');
  const apply = externalUrl(job.applyUrl || job.url);
  if (apply) actions.append(actionLink('Apply on source',apply));
  const save = button('Save to tracker',()=>{
    const saved = tracker.save(job);
    updateSaveButton();
    if (!saved) message.textContent = 'The posting could not be saved. Check your browser storage.';
    else message.textContent = 'Saved to your application tracker.';
  });
  save.id = 'save-current-job';
  const message = element('p','','source-notes');
  message.setAttribute('role','status');
  actions.append(save);

  const applicationBox = element('div','','apply-box');
  applicationBox.append(element('h4','Tailor your application'),element('p','Use your résumé and this posting to draft a résumé and cover letter.'),
    button('Generate application',()=>application.open(job),'primary'));
  detail.replaceChildren(heading,company,tags,actions,message,applicationBox);

  const description = job.description || '';
  const {summary,sections} = descriptionParts(description);
  if (summary) {
    const panel = element('section','','detail-section');
    panel.append(element('h4','Job summary'),element('p',summary));
    detail.append(panel);
  }
  for (const [label,items] of sections) {
    if (!items.length) continue;
    const panel = element('section','','detail-section');
    const list = element('ul');
    for (const line of items.slice(0,5)) list.append(element('li',line));
    panel.append(element('h4',label),list);
    detail.append(panel);
  }
  if (description) {
    const full = element('details','','description-toggle');
    full.append(element('summary','Full job description'),element('div',description,'job-description'));
    detail.append(full);
  } else detail.append(element('p','The source did not provide a description. Open the employer posting for details.'));
  updateSaveButton();
  markSelection();
}

function renderResults() {
  renderPresets();
  const keyword = role.value.trim();
  const location = locationInput.value;
  const days = Number(age.value);
  writeLocal(filtersKey,{role:keyword,location,liveAge:age.value});
  byId('summary').textContent = [keyword || 'All roles',location,age.selectedOptions[0].text].join(' · ');
  renderBoards(keyword || profile?.groups[0]?.label || '',location,days);
  const matches = selectJobs(allJobs,{keyword,location,days,profile,sort:sort.value});
  byId('result-count').textContent = loading && !allJobs.length ? 'Loading…' : matches.length+' '+(matches.length===1?'job':'jobs');
  byId('more-jobs').hidden = matches.length<=visibleCount;
  if (matches.length) {
    if (!selectedJob || (selectedJob.source!=='Pasted posting' && !matches.some(item=>item.job.id===selectedJob.id))) showJob(matches[0].job);
    results.replaceChildren(...matches.slice(0,visibleCount).map(makeRow));
    return;
  }
  const empty = element('div','','empty-jobs');
  let copy = 'No listings match these filters.';
  if (loading) copy = 'Checking employer feeds…';
  else if (failedFeeds===feeds.length) copy = 'The live feeds could not load. Try Refresh or add a posting from a job board.';
  empty.append(element('p',copy));
  if (!loading && days) empty.append(button('Search any time',()=>{age.value='0';resetResults();}));
  if (!loading && keyword) empty.append(button('Clear keyword',()=>{role.value='';resetResults();}));
  if (!loading && location!=='Anywhere') empty.append(button('Search all locations',()=>{locationInput.value='Anywhere';resetResults();}));
  if (!selectedJob || selectedJob.source!=='Pasted posting') {
    selectedJob = null;
    detail.replaceChildren(element('p','Choose a listing to view job details, or add a posting from another site.'));
  }
  results.replaceChildren(empty);
}
function resetResults() { visibleCount=pageSize;renderResults(); }

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
  status.textContent = 'Checking '+feeds.length+' employer feeds…';
  if (!allJobs.length) renderResults();
  const responses = await Promise.allSettled(feeds.map(feed=>loadFeed(feed)));
  failedFeeds = 0;
  responses.forEach((response,index)=>{
    if (response.status==='fulfilled') cachedFeeds.set(feeds[index].name,response.value);
    else failedFeeds++;
  });
  allJobs = [...new Map([...cachedFeeds.values()].flat().map(job=>[job.id,job])).values()];
  lastCheck = Date.now();
  const checkedAt = new Intl.DateTimeFormat('en-PH',{timeStyle:'short',timeZone:'Asia/Manila'}).format(lastCheck);
  const loaded = feeds.length-failedFeeds;
  status.textContent = loaded ? loaded+' of '+feeds.length+' feeds loaded · '+checkedAt+' PHT'+(failedFeeds ? ' · Some feeds unavailable' : '') :
    (allJobs.length ? 'Live feeds unavailable. Showing results from the last successful check.' : 'Live feeds unavailable.');
  loading = false;
  refreshTimer = setTimeout(refreshJobs,refreshInterval);
  refresh.disabled = false;
  renderResults();
}

const pasteDialog = byId('paste-dialog');
const manual = byId('manual-form');
byId('paste-job').addEventListener('click',()=>{byId('manual-status').textContent='';pasteDialog.showModal();});
byId('close-paste').addEventListener('click',()=>pasteDialog.close());
manual.addEventListener('submit',event=>{
  event.preventDefault();
  const data = new FormData(manual);
  const input = field=>String(data.get(field) || '').trim();
  const url = externalUrl(input('url'));
  if (!input('title') || !input('company') || !input('description') || (input('url') && !url)) {
    byId('manual-status').textContent = 'Enter a title, company, and description. If you add a link, use an HTTPS or HTTP URL.';
    return;
  }
  const savedJob = url && tracker.list().find(entry=>entry.job?.url===url && entry.job.source==='Pasted posting');
  const job = {id:savedJob?.job.id || 'pasted:'+crypto.randomUUID(),title:input('title'),company:input('company'),
    location:input('location') || 'Location not listed',description:input('description'),url,source:'Pasted posting'};
  if (!tracker.isSaved(job) && !tracker.save(job)) {
    byId('manual-status').textContent = 'Browser storage is unavailable. You can still view and draft for this posting.';
  }
  showJob(tracker.isSaved(job) && savedJob ? savedJob.job : job);
  pasteDialog.close();
  manual.reset();
  detail.focus({preventScroll:true});
  detail.scrollIntoView({behavior:'smooth',block:'start'});
});

byId('filters').addEventListener('input',event=>{
  clearTimeout(filtersTimer);
  if (event.target === role) filtersTimer = setTimeout(resetResults,150);
  else resetResults();
});
byId('filters').addEventListener('submit',event=>{event.preventDefault();resetResults();});
byId('sort-jobs').addEventListener('input',resetResults);
byId('refresh-jobs').addEventListener('click',refreshJobs);
document.addEventListener('visibilitychange',()=>{
  if (!document.hidden) refreshIfDue();
});
window.addEventListener('pageshow',refreshIfDue);
byId('more-jobs').addEventListener('click',()=>{visibleCount+=pageSize;renderResults();});
refreshJobs();

