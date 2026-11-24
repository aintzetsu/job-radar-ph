export const feeds = [
  { name: 'RWS TrainAI', provider: 'lever', url: 'https://api.lever.co/v0/postings/rws?mode=json' },
  { name: 'Welo Data', provider: 'lever', url: 'https://api.lever.co/v0/postings/weloglobal?mode=json&location=Philippines' },
  { name: 'Innodata', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/innodatainc/jobs?content=true' },
  { name: 'LILT', provider: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/lilt-production' },
  { name: 'TSMG', provider: 'lever', url: 'https://api.lever.co/v0/postings/tsmg?mode=json&location=Remote%20in%20Philippines' },
  { name: 'ReadyOn', provider: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/readyon.ai' },
  { name: 'LevelUp', provider: 'lever', url: 'https://api.lever.co/v0/postings/levelup?mode=json' },
  { name: 'Outsourced Staff', provider: 'lever', url: 'https://api.lever.co/v0/postings/outsourcedstaff?mode=json' },
  { name: 'Scale AI', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' },
  { name: 'Appen', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/appen/jobs?content=true' },
  { name: 'Canonical', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/canonical/jobs?content=true' },
  { name: 'GitLab', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true' },
  { name: 'Anthropic', provider: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true' },
  { name: 'Linear', provider: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/linear' },
];

export const remoteBoardNames = [
  'Remotive',
  'Jobicy',
  'Working Nomads',
  'RemoteOK',
  'We Work Remotely',
  'Himalayas',
  'Arbeitnow',
];

export function externalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function plain(value) {
  return typeof value === 'string' ? value.trim().slice(0, 30000) : '';
}

function htmlText(value) {
  let input = plain(value);
  if (!input) return '';
  const template = document.createElement('template');
  if (/^\s*&lt;|&lt;\/?(?:div|p|ul|li|strong|h[1-6])\b/i.test(input) && !/<[a-z]/i.test(input)) {
    template.innerHTML = input;
    input = template.content.textContent;
  }
  template.innerHTML = input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(?:div|p|li|ul|ol|h[1-6]|tr)>/gi, '\n');
  template.content.querySelectorAll('script,style,iframe,object,noscript').forEach(node => node.remove());
  return plain(
    template.content.textContent
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  );
}

function normalize(raw, feed) {
  const base = { company: feed.name, source: feed.name };
  if (feed.provider === 'lever') {
    const categories = raw.categories ?? {};
    const allLocations = Array.isArray(categories.allLocations) ? categories.allLocations : [];
    const locations = [...new Set([...allLocations, categories.location].filter(Boolean))];
    const sections = Array.isArray(raw.lists)
      ? raw.lists.map(item => [plain(item.text), htmlText(item.content)].filter(Boolean).join('\n'))
      : [];
    return {
      ...base,
      id: feed.provider + ':' + raw.id,
      title: raw.text,
      location: locations.join(' · '),
      country: raw.country,
      workplace: raw.workplaceType,
      kind: categories.commitment,
      department: categories.department || categories.team,
      date: raw.createdAt,
      dateLabel: 'Listing created',
      url: raw.hostedUrl,
      applyUrl: raw.applyUrl,
      description: [plain(raw.descriptionPlain) || htmlText(raw.description), ...sections, plain(raw.additionalPlain)]
        .filter(Boolean)
        .join('\n\n'),
    };
  }
  if (feed.provider === 'ashby') {
    const extra = Array.isArray(raw.secondaryLocations) ? raw.secondaryLocations.map(place => place.location) : [];
    return {
      ...base,
      id: feed.provider + ':' + raw.id,
      title: raw.title,
      location: [raw.location, ...extra].filter(Boolean).join(' · '),
      workplace: raw.workplaceType || (raw.isRemote ? 'Remote' : ''),
      kind: raw.employmentType,
      department: raw.department,
      date: raw.publishedAt,
      dateLabel: 'Published',
      url: raw.jobUrl,
      applyUrl: raw.applyUrl,
      description: plain(raw.descriptionPlain) || htmlText(raw.descriptionHtml),
    };
  }
  return {
    ...base,
    id: feed.provider + ':' + raw.id,
    title: raw.title,
    location: raw.location?.name,
    department: raw.departments?.map(item => item.name).filter(Boolean).join(', '),
    date: raw.first_published,
    dateLabel: 'First published',
    url: raw.absolute_url,
    description: htmlText(raw.content),
  };
}

export async function loadFeed(feed, fetcher = fetch) {
  const response = await fetcher(feed.url, { signal: AbortSignal.timeout(15000), credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error('Job feed returned ' + response.status);
  const data = await response.json();
  const items = feed.provider === 'lever' ? data : data.jobs;
  if (!Array.isArray(items)) throw new Error('Unexpected job feed format');
  return items
    .filter(raw => raw?.id && raw.isListed !== false)
    .map(raw => normalize(raw, feed))
    .filter(
      job =>
        typeof job.title === 'string' &&
        job.title.trim() &&
        !/talent pool|trainers network|expression of interest|future opportunit|general application/i.test(job.title) &&
        externalUrl(job.url)
    )
    .map(job => ({
      ...job,
      title: job.title.trim(),
      location: plain(job.location) || 'Location not listed',
      workplace: plain(job.workplace),
      kind: plain(job.kind),
      date: new Date(job.date ?? NaN).getTime() || null,
      url: externalUrl(job.url),
      applyUrl: externalUrl(job.applyUrl),
    }));
}

export async function loadRemoteBoards(fetcher = fetch) {
  const response = await fetcher('/api/feeds', { signal: AbortSignal.timeout(15000), cache: 'no-cache' });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('application/json')) {
    return { sources: [], jobs: [] };
  }
  const data = await response.json();
  if (!data?.ok || !Array.isArray(data.jobs)) {
    return { sources: [], jobs: [] };
  }
  const jobs = data.jobs
    .filter(raw => raw?.id && typeof raw.title === 'string' && raw.title.trim() && externalUrl(raw.url))
    .map(raw => ({
      ...raw,
      title: raw.title.trim(),
      location: plain(raw.location) || 'Remote · Worldwide',
      workplace: plain(raw.workplace),
      kind: plain(raw.kind),
      date: typeof raw.date === 'number' && Number.isFinite(raw.date) ? raw.date : null,
      url: externalUrl(raw.url),
      applyUrl: externalUrl(raw.applyUrl || raw.url),
    }));
  return {
    sources: Array.isArray(data.sources) ? data.sources : [],
    jobs,
  };
}

export function formatCompactLocation(location, maxShown = 2) {
  const parts = String(location || '')
    .split(/\s*[·|]\s*/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return { short: 'Location not listed', extraCount: 0, all: [] };
  const phFirst = [...parts].sort((a, b) => {
    const aPh = /philippines|manila|quezon|makati|cebu|davao|remote/i.test(a) ? 0 : 1;
    const bPh = /philippines|manila|quezon|makati|cebu|davao|remote/i.test(b) ? 0 : 1;
    return aPh - bPh;
  });
  const shown = phFirst.slice(0, maxShown);
  const extraCount = Math.max(0, phFirst.length - shown.length);
  return {
    short: extraCount ? `${shown.join(' · ')} (+${extraCount})` : shown.join(' · '),
    extraCount,
    all: phFirst,
  };
}

export function extractCompensation(description) {
  const text = String(description || '');
  const match = text.match(
    /(?:₱|PHP|USD|\$)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?[kK])?(?:\s*(?:-|to|–)\s*(?:₱|PHP|USD|\$)?\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?[kK])?)?(?:\s*(?:per|\/)\s*(?:hour|hr|month|mo|year|yr|annum))?/i
  );
  if (!match) return '';
  const candidate = match[0].trim();
  return /\d/.test(candidate) && candidate.length <= 42 ? candidate : '';
}

export function isAtsNoiseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length < 3) return true;
  if (/^#LI-[A-Z0-9_-]+$/i.test(trimmed)) return true;
  if (/^(?:vendor type|requisition id|req id|job id|posting id|external id)\s*[:–-]?\s*\S*$/i.test(trimmed)) return true;
  return false;
}

const roleGroups = [
  ['Data Annotation', /annotat|labeling|labelling|ai train|data collection|search evaluation|model evaluat/gi],
  ['Audio Annotation', /audio|speech.to.text|voice biometric/gi],
  ['Data Quality Analyst', /quality assurance|quality checks|data quality|data validat|\bqa\b/gi],
  ['Transcription', /transcri|transcrib/gi],
  ['IT Support', /it support|help\s?desk|service desk|hardware|troubleshoot|network support/gi],
  ['Software Developer', /developer|software engineer|web development|javascript|\breact\b/gi],
  ['Data Analyst', /data analy|business intelligen|power bi|\bsql\b|tableau/gi],
  ['Customer Support', /customer (?:service|support)|contact cent(?:er|re)|\bbpo\b/gi],
  ['Virtual Assistant', /virtual assistant|administrative assistant|office administration/gi],
  ['Graphic Designer', /graphic design|illustrat|photoshop|branding/gi],
  ['Bookkeeping', /bookkeep|accounting|accounts payable|quickbooks/gi],
  ['Digital Marketing', /digital marketing|\bseo\b|social media market|google ads/gi],
];

const ignoredWords = new Set(
  'about above across after also and application apply are before both can candidate candidates company could description during each education employees employer employment experience for from have hiring here into job jobs join location looking make more most name offer other our people position provide qualifications related required requirements responsibilities role skills some such than that the their them then there these they this title under use using want was were what when where which who will with within work working would years you your city philippines remote manila global worldwide'.split(
    ' '
  )
);

function words(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#-]{1,}/g) || []).map(word => word.replace(/s$/, ''));
}

function usefulWords(text) {
  return [...new Set(words(text).filter(word => word.length >= 3 && !ignoredWords.has(word)))];
}

function groupCount(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

export function resumeProfile(resume) {
  if (!resume?.trim()) return null;
  const groups = roleGroups
    .map(([label, pattern]) => ({ label, pattern, strength: groupCount(resume, pattern) }))
    .filter(group => group.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
  const terms = usefulWords(resume);
  return { groups, terms };
}

export function analyzeJobFit(job, profile) {
  if (!profile) return null;
  const jobTerms = usefulWords(`${job.title || ''} ${job.description || ''}`);
  const termSet = new Set(profile.terms);
  const matched = jobTerms.filter(term => termSet.has(term)).slice(0, 6);
  const missing = jobTerms.filter(term => !termSet.has(term) && term.length >= 4).slice(0, 5);
  const rawScore = resumeScore(job, profile);
  const pct = Math.min(98, Math.max(12, Math.round(rawScore * 2.1)));
  return { score: rawScore, pct, matched, missing };
}

function keywordScore(job, keyword) {
  if (!keyword) return 1;
  const title = job.title.toLowerCase();
  const content = job.description.toLowerCase();
  if (title.includes(keyword.toLowerCase())) return 16;
  const known = roleGroups.find(([label]) => label.toLowerCase() === keyword.toLowerCase());
  if (known) {
    if (groupCount(title, known[1])) return 12;
    if (groupCount(content, known[1])) return 4;
  }
  const terms = usefulWords(keyword);
  if (!terms.length) return 0;
  const titleWords = new Set(words(title));
  const descriptionWords = new Set(words(content));
  if (terms.every(term => titleWords.has(term))) return 10;
  if (terms.every(term => titleWords.has(term) || descriptionWords.has(term))) return 3;
  return 0;
}

function resumeScore(job, profile) {
  if (!profile) return 0;
  const title = new Set(usefulWords(job.title));
  const content = new Set(usefulWords(job.description));
  const titleTerms = profile.terms.filter(term => title.has(term));
  const contentTerms = profile.terms.filter(term => content.has(term) && !title.has(term));
  const roleMatches = profile.groups.map(group => {
    const relevance = groupCount(job.title, group.pattern) ? 10 : groupCount(job.description, group.pattern) ? 3 : 0;
    return relevance * Math.min(group.strength, 4);
  });
  return Math.max(0, ...roleMatches) + titleTerms.length * 5 + Math.min(contentTerms.length, 8);
}

const countryPattern =
  /\b(philippines|filipino|manila|quezon city|makati|pasig|taguig|mandaluyong|cebu|davao|pampanga|iloilo|muntinlupa|parañaque|ncr|caloocan|marikina|batangas|laguna|bacolod|alabang|pasay|baguio|cavite|angeles city)\b/i;
const regionPattern = /\b(worldwide|globally|global|anywhere|apac|asia.pacific|southeast asia)\b/i;

export function isRemoteJob(job) {
  return /\bremote\b|work from home|wfh/i.test(`${job.workplace || ''} ${job.location || ''} ${job.title || ''}`);
}

function locationMatches(job, location) {
  if (location === 'Anywhere') return true;
  const place = job.location || '';
  const remote = isRemoteJob(job);
  const ph = job.country === 'PH' || countryPattern.test(place);
  const broadRemote = remote && regionPattern.test(place);
  if (location === 'Remote') return remote && (ph || broadRemote);
  if (location === 'Quezon City') return /\bquezon city\b/i.test(place);
  if (location === 'Metro Manila') {
    return /\b(manila|ncr|quezon city|makati|pasig|taguig|mandaluyong|muntinlupa|parañaque|caloocan|marikina|alabang|pasay)\b/i.test(place);
  }
  return ph || broadRemote;
}

export function selectJobs(
  jobs,
  { keyword = '', location = 'Philippines', days = 0, source = 'all', workMode = 'all', profile = null, sort = 'match', now = Date.now() }
) {
  return jobs
    .filter(job => {
      if (!locationMatches(job, location)) return false;
      if (source && source !== 'all' && job.source !== source) return false;
      if (workMode === 'remote' && !isRemoteJob(job)) return false;
      if (workMode === 'onsite' && isRemoteJob(job)) return false;
      if (days && (!job.date || job.date < now - days * 86400000 || job.date > now + 600000)) return false;
      return true;
    })
    .map(job => ({
      job,
      keywordMatch: keywordScore(job, keyword),
      resumeMatch: resumeScore(job, profile),
    }))
    .filter(item => item.keywordMatch && (!profile || item.resumeMatch >= 5))
    .sort((a, b) => {
      const byDate = (b.job.date || 0) - (a.job.date || 0);
      const byMatch = b.resumeMatch + b.keywordMatch - (a.resumeMatch + a.keywordMatch);
      if (sort === 'company') return a.job.company.localeCompare(b.job.company) || byMatch || byDate;
      return sort === 'recent' ? byDate || byMatch : byMatch || byDate;
    });
}
