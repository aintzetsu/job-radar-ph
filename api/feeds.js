const BOARD_TIMEOUT_MS = 7000;

export const REMOTE_BOARD_NAMES = [
  'Remotive',
  'Jobicy',
  'Working Nomads',
  'RemoteOK',
  'We Work Remotely',
  'Himalayas',
  'Arbeitnow',
  'Canva',
  'Alorica',
  'Ubisoft',
  'Sutherland',
  'Bosch',
];

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<\/(?:div|p|li|ul|ol|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const ms = new Date(value ?? NaN).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

export function parseRssItems(xmlText) {
  const items = [];
  const matches = String(xmlText || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of matches.slice(0, 60)) {
    const rawTitle = stripHtml(extractXmlTag(block, 'title'));
    const link = safeUrl(extractXmlTag(block, 'link'));
    if (!rawTitle || !link) continue;
    const colonIdx = rawTitle.indexOf(':');
    const company = colonIdx > 0 ? rawTitle.slice(0, colonIdx).trim() : 'We Work Remotely';
    const title = colonIdx > 0 ? rawTitle.slice(colonIdx + 1).trim() : rawTitle;
    const region = stripHtml(extractXmlTag(block, 'region')) || 'Remote · Worldwide';
    const category = stripHtml(extractXmlTag(block, 'category'));
    const pubDate = toTimestamp(extractXmlTag(block, 'pubDate'));
    const description = stripHtml(extractXmlTag(block, 'description'));
    items.push({
      id: `wwr:${link}`,
      source: 'We Work Remotely',
      company,
      title,
      location: /remote|worldwide|anywhere/i.test(region) ? region : `Remote · ${region}`,
      workplace: 'Remote',
      kind: 'Remote',
      department: category,
      date: pubDate,
      dateLabel: 'Published',
      url: link,
      applyUrl: link,
      description,
    });
  }
  return items;
}

async function fetchJson(url, fetcher = fetch) {
  const resp = await fetcher(url, {
    signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
    headers: { 'User-Agent': 'JobRadarPH/2.0' },
  });
  if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
  return resp.json();
}

async function fetchRemotive(fetcher) {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=60', fetcher);
  return (data?.jobs || []).slice(0, 60).map(raw => ({
    id: `remotive:${raw.id}`,
    source: 'Remotive',
    company: String(raw.company_name || 'Remotive Employer').trim(),
    title: String(raw.title || '').trim(),
    location: String(raw.candidate_required_location || 'Remote · Worldwide').trim(),
    workplace: 'Remote',
    kind: String(raw.job_type || '').replace(/_/g, ' '),
    department: String(raw.category || ''),
    date: toTimestamp(raw.publication_date),
    dateLabel: 'Published',
    url: safeUrl(raw.url),
    applyUrl: safeUrl(raw.url),
    description: [raw.salary ? `Compensation: ${raw.salary}` : '', stripHtml(raw.description)].filter(Boolean).join('\n\n'),
  }));
}

async function fetchJobicy(fetcher) {
  const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50', fetcher);
  return (data?.jobs || []).slice(0, 50).map(raw => {
    const pay =
      raw.annualSalaryMin && raw.annualSalaryMax
        ? `${raw.salaryCurrency || 'USD'} ${raw.annualSalaryMin} - ${raw.annualSalaryMax} / year`
        : '';
    return {
      id: `jobicy:${raw.id}`,
      source: 'Jobicy',
      company: String(raw.companyName || 'Jobicy Employer').trim(),
      title: String(raw.jobTitle || '').trim(),
      location: `Remote · ${raw.jobGeo || 'Worldwide'}`,
      workplace: 'Remote',
      kind: Array.isArray(raw.jobType) ? raw.jobType.join(', ') : String(raw.jobType || ''),
      department: Array.isArray(raw.jobIndustry) ? raw.jobIndustry.join(', ') : String(raw.jobIndustry || ''),
      date: toTimestamp(raw.pubDate),
      dateLabel: 'Published',
      url: safeUrl(raw.url),
      applyUrl: safeUrl(raw.url),
      description: [pay ? `Compensation: ${pay}` : '', stripHtml(raw.jobDescription || raw.jobExcerpt)].filter(Boolean).join('\n\n'),
    };
  });
}

async function fetchWorkingNomads(fetcher) {
  const data = await fetchJson('https://www.workingnomads.com/api/exposed_jobs/', fetcher);
  return (Array.isArray(data) ? data : []).slice(0, 50).map((raw, i) => ({
    id: `wn:${raw.url || i}`,
    source: 'Working Nomads',
    company: String(raw.company_name || 'Working Nomads').trim(),
    title: String(raw.title || '').trim(),
    location: `Remote · ${raw.location || 'Worldwide'}`,
    workplace: 'Remote',
    kind: 'Remote',
    department: String(raw.category_name || ''),
    date: toTimestamp(raw.pub_date),
    dateLabel: 'Published',
    url: safeUrl(raw.url),
    applyUrl: safeUrl(raw.url),
    description: stripHtml(raw.description),
  }));
}

async function fetchRemoteOk(fetcher) {
  const data = await fetchJson('https://remoteok.com/api', fetcher);
  const rows = Array.isArray(data) ? data.filter(item => item && item.id && item.position) : [];
  return rows.slice(0, 60).map(raw => {
    const pay =
      raw.salary_min && raw.salary_max
        ? `$${Number(raw.salary_min).toLocaleString()} - $${Number(raw.salary_max).toLocaleString()} / year`
        : '';
    return {
      id: `remoteok:${raw.id}`,
      source: 'RemoteOK',
      company: String(raw.company || 'RemoteOK').trim(),
      title: String(raw.position || '').trim(),
      location: raw.location ? `Remote · ${raw.location}` : 'Remote · Worldwide',
      workplace: 'Remote',
      kind: 'Remote',
      department: Array.isArray(raw.tags) ? raw.tags.slice(0, 4).join(', ') : '',
      date: toTimestamp(raw.date),
      dateLabel: 'Published',
      url: safeUrl(raw.url || raw.apply_url),
      applyUrl: safeUrl(raw.apply_url || raw.url),
      description: [pay ? `Compensation: ${pay}` : '', stripHtml(raw.description)].filter(Boolean).join('\n\n'),
    };
  });
}

async function fetchWwr(fetcher) {
  const resp = await fetcher('https://weworkremotely.com/remote-jobs.rss', {
    signal: AbortSignal.timeout(BOARD_TIMEOUT_MS),
    headers: { 'User-Agent': 'JobRadarPH/2.0' },
  });
  if (!resp.ok) throw new Error(`WWR -> HTTP ${resp.status}`);
  return parseRssItems(await resp.text());
}

async function fetchHimalayas(fetcher) {
  const data = await fetchJson('https://himalayas.app/jobs/api?limit=50', fetcher);
  return (data?.jobs || []).slice(0, 50).map((raw, i) => {
    const locs = Array.isArray(raw.locationRestrictions) && raw.locationRestrictions.length
      ? raw.locationRestrictions.join(' · ')
      : 'Worldwide';
    const pay =
      raw.minSalary && raw.maxSalary
        ? `${raw.currency || 'USD'} ${Number(raw.minSalary).toLocaleString()} - ${Number(raw.maxSalary).toLocaleString()} / year`
        : '';
    return {
      id: `himalayas:${raw.guid || raw.applicationLink || i}`,
      source: 'Himalayas',
      company: String(raw.companyName || 'Himalayas').trim(),
      title: String(raw.title || '').trim(),
      location: `Remote · ${locs}`,
      workplace: 'Remote',
      kind: String(raw.employmentType || ''),
      department: Array.isArray(raw.categories) ? raw.categories.slice(0, 3).join(', ') : '',
      date: toTimestamp(raw.pubDate),
      dateLabel: 'Published',
      url: safeUrl(raw.applicationLink || raw.guid),
      applyUrl: safeUrl(raw.applicationLink || raw.guid),
      description: [pay ? `Compensation: ${pay}` : '', stripHtml(raw.description || raw.excerpt)].filter(Boolean).join('\n\n'),
    };
  });
}

async function fetchArbeitnow(fetcher) {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api', fetcher);
  return (data?.data || []).slice(0, 60).map(raw => ({
    id: `arbeitnow:${raw.slug}`,
    source: 'Arbeitnow',
    company: String(raw.company_name || 'Arbeitnow').trim(),
    title: String(raw.title || '').trim(),
    location: raw.remote ? `Remote · ${raw.location || 'Worldwide'}` : String(raw.location || ''),
    workplace: raw.remote ? 'Remote' : 'Onsite / Hybrid',
    kind: Array.isArray(raw.job_types) ? raw.job_types.join(', ') : '',
    department: Array.isArray(raw.tags) ? raw.tags.slice(0, 4).join(', ') : '',
    date: toTimestamp(raw.created_at),
    dateLabel: 'Published',
    url: safeUrl(raw.url),
    applyUrl: safeUrl(raw.url),
    description: stripHtml(raw.description),
  }));
}

async function fetchSmartRecruiters(companySlug, sourceName, fetcher) {
  const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${companySlug}/postings?limit=50`, fetcher);
  return (data?.content || []).map(raw => {
    const loc = raw.location || {};
    const place = [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', ');
    const isRem = Boolean(loc.remote);
    const refUrl = `https://jobs.smartrecruiters.com/${companySlug}/${raw.id}`;
    return {
      id: `sr:${companySlug}:${raw.id}`,
      source: sourceName,
      company: raw.company?.name || sourceName,
      title: String(raw.name || '').trim(),
      location: isRem ? `Remote · ${place || 'Global'}` : place || 'Location not listed',
      country: loc.country ? String(loc.country).toUpperCase() : '',
      workplace: isRem ? 'Remote' : 'Onsite / Hybrid',
      kind: raw.typeOfEmployment?.label || '',
      department: raw.department?.label || '',
      date: toTimestamp(raw.releasedDate),
      dateLabel: 'Published',
      url: safeUrl(refUrl),
      applyUrl: safeUrl(refUrl),
      description: [
        raw.department?.label ? `Department: ${raw.department.label}` : '',
        raw.experienceLevel?.label ? `Experience: ${raw.experienceLevel.label}` : '',
        place ? `Location: ${place}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  });
}

export async function collectRemoteBoards(fetcher = fetch) {
  const tasks = [
    ['Remotive', fetchRemotive],
    ['Jobicy', fetchJobicy],
    ['Working Nomads', fetchWorkingNomads],
    ['RemoteOK', fetchRemoteOk],
    ['We Work Remotely', fetchWwr],
    ['Himalayas', fetchHimalayas],
    ['Arbeitnow', fetchArbeitnow],
    ['Canva', f => fetchSmartRecruiters('Canva', 'Canva', f)],
    ['Alorica', f => fetchSmartRecruiters('Alorica', 'Alorica', f)],
    ['Ubisoft', f => fetchSmartRecruiters('Ubisoft2', 'Ubisoft', f)],
    ['Sutherland', f => fetchSmartRecruiters('Sutherland', 'Sutherland', f)],
    ['Bosch', f => fetchSmartRecruiters('BoschGroup', 'Bosch', f)],
  ];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn(fetcher)));
  const jobs = [];
  const sources = [];

  settled.forEach((result, idx) => {
    const name = tasks[idx][0];
    if (result.status === 'fulfilled') {
      const valid = result.value.filter(job => job.title && job.url);
      jobs.push(...valid);
      sources.push({ name, ok: true, count: valid.length });
    } else {
      sources.push({ name, ok: false, count: 0 });
    }
  });

  return { jobs, sources };
}

export async function GET() {
  try {
    const { jobs, sources } = await collectRemoteBoards();
    return Response.json(
      { ok: true, sources, jobs },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('[api/feeds GET]', error);
    return Response.json({ ok: false, sources: [], jobs: [] }, { status: 502 });
  }
}
