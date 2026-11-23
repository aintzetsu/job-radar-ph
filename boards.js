const urlWith = (base, params) => {
  const url = new URL(base);
  for (const [key,value] of Object.entries(params)) if (value !== '') url.searchParams.set(key,value);
  return url.href;
};

function platforms(q, location, days) {
  const remote = location === 'Remote';
  const place = remote ? 'Philippines' : location === 'Anywhere' ? '' : location;
  const keyword = remote && q ? q + ' remote' : q || (remote ? 'remote' : '');
  const slug = value => encodeURIComponent(value.toLowerCase().trim().replace(/\s+/g,'-'));
  const indexed = days ? (days === 1 ? 'qdr:d' : days === 7 ? 'qdr:w' : days === 30 ? 'qdr:m' : 'qdr:d3') : '';
  const linkedinDays = days === 3 ? 7 : days;
  return [
    ['in','LinkedIn',linkedinDays ? 'Past ' + (linkedinDays === 1 ? '24 hours' : linkedinDays === 30 ? 'month' : 'week') + ' on LinkedIn · newest first' : 'Newest first',
      urlWith('https://www.linkedin.com/jobs/search/',{keywords:q,location:place,f_TPR:linkedinDays ? 'r'+linkedinDays*86400 : '',f_WT:remote?'2':'',sortBy:'DD'})],
    ['i','Indeed Philippines',days ? (days === 1 ? 'Last 24 hours' : 'Last '+days+' days')+' requested · newest first' : 'Newest first',
      urlWith('https://ph.indeed.com/jobs',{q:keyword,l:place,fromage:days || '',sort:'date'})],
    ['JS','Jobstreet',days ? 'Date filter requested · newest first' : 'Newest first',
      urlWith('https://ph.jobstreet.com/'+(keyword ? slug(keyword)+'-jobs' : 'jobs')+(remote || !place || place==='Philippines'?'':'/in-'+slug(place)),{daterange:days||'',sortmode:'ListedDate'})],
    ['K','Kalibrr','Keyword search · check dates on Kalibrr',
      urlWith('https://www.kalibrr.com/job-board/te',{q:[keyword,remote||place==='Philippines'?'':place].filter(Boolean).join(' ')})],
    ['OJ','OnlineJobs.ph','Keyword search · remote jobs for Filipinos',
      urlWith('https://www.onlinejobs.ph/jobseekers/jobsearch',{jobkeyword:keyword})],
    ['G','Employer career pages',indexed ? 'Google index recency · check the original posting date' : 'Search Greenhouse, Lever, and Ashby career pages',
      urlWith('https://www.google.com/search',{q:[keyword,place,'(site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com)'].filter(Boolean).join(' '),tbs:indexed})],
    ['U','Upwork','Freelance projects · newest first',
      urlWith('https://www.upwork.com/nx/search/jobs/',{q:q,sort:'recency'})],
    ['F','Foundit Philippines','Keyword search · check dates on Foundit',
      'https://www.foundit.com.ph/srp/results?'+new URLSearchParams({query:keyword,locations:place})],
    ['J','Jora Philippines',days ? 'Date filter requested · newest first' : 'Newest first',
      urlWith('https://ph.jora.com/j',{q:keyword,l:place,sp:days?'date':'' ,d:days||'',sort:'date'})],
  ];
}

const officialPlatforms = [
  ['B','Bossjob Philippines','Search local and remote openings on the Philippine job board.','https://bossjob.ph/en-us'],
  ['PH','PhilJobNet','DOLE job portal with listings from accredited employers and recruitment agencies.','https://philjobnet.gov.ph/'],
  ['CS','Civil Service Commission','Official Philippine government vacancies.','https://csc.gov.ph/career/'],

  ['RW','RWS TrainAI','Direct employer board for AI training and data projects. Check country eligibility.','https://jobs.lever.co/rws/'],
  ['WD','Welo Data','Philippines-filtered employer board for language, audio, and AI data projects.','https://jobs.lever.co/weloglobal/?location=Philippines'],
  ['TD','TELUS Digital Philippines','Direct employer board for Philippine openings, including AI and operations roles.','https://jobs.telusdigital.com/search/jobs/in/country/philippines'],
  ['IN','Innodata','Direct employer board for AI evaluation and annotation. Check country eligibility.','https://job-boards.greenhouse.io/innodatainc'],
  ['AC','Accenture Philippines','Direct employer job search for Philippine technology and operations roles.','https://www.accenture.com/ph-en/careers/jobsearch'],
];

function sourceCard([initials,name,hint,href], action) {
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = '<div class="card-top"><span class="icon" aria-hidden="true"></span><h3></h3></div><p></p><a class="link" target="_blank" rel="noopener noreferrer"></a>';
  card.querySelector('.icon').textContent = initials;
  card.querySelector('h3').textContent = name;
  card.querySelector('p').textContent = hint;
  const link = card.querySelector('a');
  link.href = href;
  link.textContent = action;
  link.setAttribute('aria-label',action+' on '+name+' in a new tab');
  return card;
}



export function initBoards() {
  document.querySelector('#official-platforms').replaceChildren(...officialPlatforms.map(source => sourceCard(source,'Browse jobs')));
  return (keyword,location,days) => {
    document.querySelector('#platforms').replaceChildren(...platforms(keyword,location,days).map(source => sourceCard(source,'Open search')));
  };
}
