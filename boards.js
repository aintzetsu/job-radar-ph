const urlWith = (base, params) => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') url.searchParams.set(key, value);
  }
  return url.href;
};

function platforms(q, location, days) {
  const remote = location === 'Remote';
  const place = remote ? 'Philippines' : location === 'Anywhere' ? '' : location;
  const keyword = remote && q ? q + ' remote' : q || (remote ? 'remote' : '');
  const slug = value => encodeURIComponent(value.toLowerCase().trim().replace(/\s+/g, '-'));
  const indexed = days ? (days === 1 ? 'qdr:d' : days === 7 ? 'qdr:w' : days === 30 ? 'qdr:m' : 'qdr:d3') : '';
  const linkedinDays = days === 3 ? 7 : days;
  return [
    [
      'in',
      'LinkedIn',
      'Global + PH',
      linkedinDays ? 'Past ' + (linkedinDays === 1 ? '24 hours' : linkedinDays === 30 ? 'month' : 'week') + ' · newest first' : 'Newest openings first',
      urlWith('https://www.linkedin.com/jobs/search/', { keywords: q, location: place, f_TPR: linkedinDays ? 'r' + linkedinDays * 86400 : '', f_WT: remote ? '2' : '', sortBy: 'DD' }),
    ],
    [
      'i',
      'Indeed Philippines',
      'PH Aggregator',
      days ? (days === 1 ? 'Last 24 hours' : 'Last ' + days + ' days') + ' · newest first' : 'Philippine & remote feed',
      urlWith('https://ph.indeed.com/jobs', { q: keyword, l: place, fromage: days || '', sort: 'date' }),
    ],
    [
      'JS',
      'JobStreet PH',
      'PH Local',
      days ? 'Date filter requested · newest first' : 'Top local employers & BPO',
      urlWith('https://ph.jobstreet.com/' + (keyword ? slug(keyword) + '-jobs' : 'jobs') + (remote || !place || place === 'Philippines' ? '' : '/in-' + slug(place)), {
        daterange: days || '',
        sortmode: 'ListedDate',
      }),
    ],
    [
      'K',
      'Kalibrr',
      'PH Startup & Tech',
      'Keyword search · tech, QA, and remote teams',
      urlWith('https://www.kalibrr.com/job-board/te', { q: [keyword, remote || place === 'Philippines' ? '' : place].filter(Boolean).join(' ') }),
    ],
    [
      'OJ',
      'OnlineJobs.ph',
      'PH Remote',
      'Direct remote contracts for Filipino talent',
      urlWith('https://www.onlinejobs.ph/jobseekers/jobsearch', { jobkeyword: keyword }),
    ],
    [
      'G',
      'ATS Career Pages',
      'Direct ATS',
      indexed ? 'Google recent index across Greenhouse, Lever & Ashby' : 'Search Greenhouse, Lever, and Ashby boards directly',
      urlWith('https://www.google.com/search', {
        q: [keyword, place, '(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com)'].filter(Boolean).join(' '),
        tbs: indexed,
      }),
    ],
    [
      'U',
      'Upwork',
      'Freelance',
      'Hourly & fixed freelance contracts · newest first',
      urlWith('https://www.upwork.com/nx/search/jobs/', { q: q, sort: 'recency' }),
    ],
    [
      'F',
      'Foundit PH',
      'Corporate & IT',
      'Keyword search across IT, ops, and analyst roles',
      'https://www.foundit.com.ph/srp/results?' + new URLSearchParams({ query: keyword, locations: place }),
    ],
    [
      'J',
      'Jora Philippines',
      'Aggregator',
      days ? 'Date filter requested · newest first' : 'Broad regional job index',
      urlWith('https://ph.jora.com/j', { q: keyword, l: place, sp: days ? 'date' : '', d: days || '', sort: 'date' }),
    ],
  ];
}

const officialPlatforms = [
  ['B', 'Bossjob Philippines', 'PH Chat Hiring', 'Fast direct-chat hiring for local and remote openings.', 'https://bossjob.ph/en-us'],
  ['PH', 'PhilJobNet', 'DOLE Portal', 'Official DOLE portal with accredited Philippine employers.', 'https://philjobnet.gov.ph/'],
  ['CS', 'Civil Service Commission', 'Government', 'Official Philippine government & agency vacancies.', 'https://csc.gov.ph/career/'],
  ['RW', 'RWS TrainAI', 'AI & Language', 'Direct board for AI training, audio & data QA projects.', 'https://jobs.lever.co/rws/'],
  ['WD', 'Welo Data', 'AI & Language', 'Philippines-filtered board for speech, text & AI data.', 'https://jobs.lever.co/weloglobal/?location=Philippines'],
  ['TD', 'TELUS Digital PH', 'AI & Ops', 'Philippine AI community, annotation & operations openings.', 'https://jobs.telusdigital.com/search/jobs/in/country/philippines'],
  ['IN', 'Innodata', 'AI Evaluation', 'Direct Greenhouse board for data annotation and QA.', 'https://job-boards.greenhouse.io/innodatainc'],
  ['AC', 'Accenture PH', 'Enterprise Tech', 'Technology, cloud & BPO openings across Metro Manila & Cebu.', 'https://www.accenture.com/ph-en/careers/jobsearch'],
  ['SA', 'Scale AI', 'AI Data & RLHF', 'Global AI training, rubric QA, and engineering openings.', 'https://job-boards.greenhouse.io/scaleai'],
  ['AP', 'Appen', 'AI Crowd Data', 'Remote annotation, linguistic QA, and data project listings.', 'https://job-boards.greenhouse.io/appen'],
  ['TU', 'TaskUs PH', 'BPO & AI Trust', 'Digital CX, content moderation, and AI ops hubs across PH.', 'https://www.taskus.com/careers/'],
  ['GL', 'GitLab', 'All-Remote Tech', '100% remote global software, support, and operations roles.', 'https://job-boards.greenhouse.io/gitlab'],
  ['CV', 'Canva', 'Design & Tech PH', 'Manila & global engineering, design, QA, and ops roles.', 'https://www.lifeatcanva.com/en/jobs/'],
  ['MY', 'Maya PH', 'PH FinTech', 'Philippine digital banking, payments, data, and tech roles.', 'https://jobs.lever.co/maya'],
  ['OA', 'OpenAI', 'Frontier AI', 'Global AI research, safety, operations, and engineering.', 'https://jobs.ashbyhq.com/openai'],
  ['VC', 'Vercel', 'Web Platform', 'Remote-first frontend cloud, DX, and infrastructure roles.', 'https://job-boards.greenhouse.io/vercel'],
];

function sourceCard([initials, name, category, hint, href], action) {
  const card = document.createElement('article');
  card.className = 'card board-card';

  const top = document.createElement('div');
  top.className = 'card-top';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = initials;

  const titleWrap = document.createElement('div');
  titleWrap.className = 'card-title-wrap';
  const h3 = document.createElement('h3');
  h3.textContent = name;
  const tag = document.createElement('span');
  tag.className = 'board-badge';
  tag.textContent = category;
  titleWrap.append(h3, tag);

  top.append(icon, titleWrap);

  const desc = document.createElement('p');
  desc.textContent = hint;

  const link = document.createElement('a');
  link.className = 'board-cta';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${action} ↗`;
  link.setAttribute('aria-label', `${action} on ${name} in a new tab`);

  card.append(top, desc, link);
  return card;
}

export function initBoards() {
  const officialEl = document.querySelector('#official-platforms');
  if (officialEl) {
    officialEl.replaceChildren(...officialPlatforms.map(source => sourceCard(source, 'Browse board')));
  }
  return (keyword, location, days) => {
    const platformsEl = document.querySelector('#platforms');
    if (platformsEl) {
      platformsEl.replaceChildren(...platforms(keyword, location, days).map(source => sourceCard(source, 'Open search')));
    }
  };
}
