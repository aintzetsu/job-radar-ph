const standardHeadings =
  /^(summary|professional summary|profile|objective|relevant experience highlights|work experience|professional experience|employment history|experience|education|education and awards|skills|additional skills|technical skills|certifications?|awards?|projects?|languages)$/i;
const bullet = /^(?:[•●▪◦‣*–—-]|\d+[.)])\s+/u;
const stopWords = new Set(
  (
    'a an and are as at be been being by can could did do does for from had has have if in into is it its may must of on or our ' +
    'per should than that the their them then there these they this those through to up us was we were what when where which who ' +
    'will with would you your job company apply applicant candidate opportunity position role hiring new years experience work team ' +
    'include including required requirement responsibilities qualifications skills preferred ability working support strong based using used'
  ).split(' ')
);

function wordRoot(word) {
  if (word.startsWith('annotat')) return 'annotat';
  if (/^transcri(?:b|p)/.test(word)) return 'transcribe';
  return word.length > 5 ? word.replace(/(?:ation|ated|ating|ate|ings|ing|ed|ers|er|ies|s)$/, '') : word;
}

function tokens(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu) || [])
    .map(word => word.replace(/\.+$/, ''))
    .filter(word => word.length > 1 && !stopWords.has(word));
}

function jobKeywords(job) {
  const words = new Map();
  const lines = (job.description || '').split(/\n+/);
  let weight = 2;
  for (const line of lines) {
    if (/^(?:qualifications|requirements|responsibilities|what you(?:’ll|'ll| will) do|(?:preferred|required) skills)\s*:?\s*$/i.test(line.trim()))
      weight = 5;
    if (/^(?:benefits|about us|equal opportunity|how to apply)\s*:?\s*$/i.test(line.trim())) weight = 1;
    for (const word of tokens(line)) {
      const root = wordRoot(word);
      words.set(root, Math.max(words.get(root) || 0, weight));
    }
  }
  for (const word of tokens(job.title || '')) {
    const root = wordRoot(word);
    words.set(root, (words.get(root) || 0) + 3);
  }
  return words;
}

function score(value, keywords) {
  return [...new Set(tokens(value).map(wordRoot))].reduce((total, word) => total + (keywords.get(word) || 0), 0);
}

function isHeading(value) {
  return standardHeadings.test(value.replace(/[:\s]+$/, ''));
}

function prioritizeBullets(lines, keywords) {
  const ordered = [...lines];
  for (let start = 0; start < lines.length; ) {
    if (!bullet.test(lines[start])) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < lines.length && bullet.test(lines[end])) end += 1;
    const following = lines[end];
    if (!following || isHeading(following) || /\s\|\s/.test(following)) {
      const group = lines.slice(start, end).sort((a, b) => score(b, keywords) - score(a, keywords));
      ordered.splice(start, end - start, ...group);
    }
    start = end;
  }
  return ordered;
}

function findName(line) {
  const name = line.split(/\s*[|•]\s*/)[0];
  return name.length <= 64 &&
    !isHeading(name) &&
    /^[\p{L}][\p{L}.'’, -]+$/u.test(name) &&
    name.trim().split(/\s+/).length >= 2
    ? name.trim()
    : '';
}

function relevantEvidence(lines, keywords) {
  return [
    ...new Set(
      lines
        .map(line => line.replace(bullet, '').trim())
        .filter(
          line =>
            line.length >= 24 &&
            line.length <= 410 &&
            !isHeading(line) &&
            !/@|https?:\/\//i.test(line) &&
            !/^(?:[A-Z][a-z]{2}\s+)?\d{4}\s*[-–]/.test(line)
        )
    ),
  ]
    .map(line => ({ line, score: score(line, keywords) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.line);
}

function sharedTopics(evidence, keywords, description) {
  const roots = new Set(evidence.flatMap(line => tokens(line).map(wordRoot)));
  const byRoot = new Map();
  for (const word of tokens(description)) {
    const root = wordRoot(word);
    if (roots.has(root) && !byRoot.has(root) && /^[\p{L}][\p{L}+#-]*$/u.test(word)) {
      byRoot.set(root, word);
    }
  }
  return [...byRoot.entries()]
    .sort(([a], [b]) => (keywords.get(b) || 0) - (keywords.get(a) || 0))
    .slice(0, 4)
    .map(([, word]) => word);
}

export function buildApplication(resume, job, { tone = 'balanced' } = {}) {
  const lines = resume
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map(line => line.trim());
  const title = String(job.title || '').trim() || 'this position';
  const company = String(job.company || '').trim();
  const keywords = jobKeywords({ ...job, title });
  const applicant = findName(lines[0]);
  const evidence = relevantEvidence(lines.slice(applicant ? 1 : 0), keywords);
  const topics = sharedTopics(evidence, keywords, job.description || '');
  const prioritized = prioritizeBullets(lines, keywords);
  const opening = prioritized.findIndex(isHeading);
  const insertAt = opening > 0 ? opening : applicant ? 1 : 0;
  const target = ['', 'Applying for ' + title + (company ? ' at ' + company : ''), ''];
  if (evidence.length) target.push('Relevant Experience Highlights', ...evidence.slice(0, 2).map(line => '• ' + line), '');
  prioritized.splice(insertAt, 0, ...target);

  const greeting = 'Dear ' + (company ? company + ' hiring team' : 'Hiring Team') + ',';
  const focus = topics.length ? new Intl.ListFormat('en', { type: 'conjunction' }).format(topics.slice(0, 3)) : '';
  const cover = [greeting, ''];

  if (tone === 'concise') {
    cover.push(
      `I am writing to apply for ${title}${company ? ` at ${company}` : ''}.${focus ? ` My background directly covers ${focus}.` : ''}`
    );
    if (evidence.length) {
      cover.push('', ...evidence.slice(0, 2).map(line => '• ' + line));
    }
    cover.push('', 'Thank you for your consideration.', '', 'Best regards,', applicant || '[Your name]');
  } else if (tone === 'technical') {
    cover.push(
      `I am excited to submit my application for ${title}${company ? ` at ${company}` : ''}. Across hands-on delivery${focus ? ` in ${focus}` : ''}, I bring verified attention to guidelines, structured tooling, and measurable execution:`
    );
    if (evidence.length) {
      cover.push('', ...evidence.map(line => '• ' + line));
    }
    cover.push(
      '',
      'I would welcome a conversation to walk through my relevant experience and availability.',
      '',
      'Sincerely,',
      applicant || '[Your name]'
    );
  } else {
    cover.push('I’m applying for the ' + title + ' position' + (company ? ' at ' + company : '') + '.');
    if (evidence.length) {
      cover.push(
        '',
        focus
          ? 'Your posting’s focus on ' + focus + ' stood out to me. Below are examples from my experience that relate to the role.'
          : 'Below are examples from my experience that relate to the role.',
        '',
        ...evidence.map(line => '• ' + line)
      );
    }
    cover.push(
      '',
      'Thank you for reviewing my application. I’d welcome the opportunity to discuss how I could contribute to your team.',
      '',
      'Sincerely,',
      applicant || '[Your name]'
    );
  }

  return {
    resume: prioritized.join('\n').trim().replace(/\n{3,}/g, '\n\n'),
    cover: cover.join('\n'),
  };
}

function rtfEscape(value) {
  return value.replace(/[\\{}\n\u0080-\uffff]/g, character => {
    if (character === '\n') return '\\par\n';
    if ('\\{}'.includes(character)) return '\\' + character;
    const code = character.charCodeAt(0);
    return '\\u' + (code > 32767 ? code - 65536 : code) + '?';
  });
}

function downloadDraft(value, title, kind) {
  const body = value
    .split('\n')
    .map((line, index) => {
      const text = rtfEscape(line);
      if (kind === 'resume' && (index === 0 || isHeading(line))) return '{\\b ' + text + '}';
      return text;
    })
    .join('\\par\n');
  const rtf = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\margl950\\margr950\\margt900\\margb900\\f0\\fs22\\sa80 ' + body + '}';
  const url = URL.createObjectURL(new Blob([rtf], { type: 'application/rtf' }));
  const anchor = document.createElement('a');
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  anchor.href = url;
  anchor.download = [kind === 'resume' ? 'resume' : 'cover-letter', safeTitle].filter(Boolean).join('-') + '.rtf';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initApplication({ getResume, onGenerated, onMissingResume }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'apply-dialog';
  dialog.className = 'application-dialog';
  dialog.setAttribute('aria-labelledby', 'application-heading');
  dialog.innerHTML = `
    <div class="application-shell">
      <div class="application-header">
        <div><h2 id="application-heading">Tailored application drafts</h2><p class="application-job"></p></div>
        <button type="button" class="application-close" aria-label="Close application drafts">Close</button>
      </div>
      <div class="application-toolbar">
        <div role="tablist" aria-label="Application documents" class="application-tabs">
          <button type="button" id="application-resume-tab" role="tab" aria-selected="true" aria-controls="application-panel" data-application-tab="resume">Tailored Résumé</button>
          <button type="button" id="application-cover-tab" role="tab" aria-selected="false" aria-controls="application-panel" data-application-tab="cover" tabindex="-1">Cover Letter</button>
        </div>
        <div class="application-tones" role="group" aria-label="Cover letter tone">
          <button type="button" data-tone="balanced" aria-pressed="true">Balanced</button>
          <button type="button" data-tone="concise" aria-pressed="false">Concise</button>
          <button type="button" data-tone="technical" aria-pressed="false">Technical</button>
        </div>
      </div>
      <div id="application-panel" class="application-body" role="tabpanel" aria-labelledby="application-resume-tab">
        <article class="application-paper" aria-label="Document preview"></article>
        <label class="application-edit-area" hidden>
          <span>Edit document text</span>
          <textarea spellcheck="true"></textarea>
        </label>
      </div>
      <div class="application-footer">
        <span class="application-stats" aria-live="polite"></span>
        <div class="application-footer-actions">
          <button type="button" class="application-copy">Copy text</button>
          <button type="button" class="application-edit">Edit text</button>
          <button type="button" class="application-print">Print / PDF</button>
          <button type="button" class="application-download">Download RTF</button>
        </div>
      </div>
    </div>`;
  document.body.append(dialog);

  const panel = dialog.querySelector('#application-panel');
  const paper = dialog.querySelector('.application-paper');
  const editArea = dialog.querySelector('.application-edit-area');
  const editButton = dialog.querySelector('.application-edit');
  const copyButton = dialog.querySelector('.application-copy');
  const editText = dialog.querySelector('textarea');
  const statsEl = dialog.querySelector('.application-stats');
  const tonesWrap = dialog.querySelector('.application-tones');
  const toneButtons = [...dialog.querySelectorAll('[data-tone]')];
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  const cache = new Map();
  let sourceResume = '';
  let job;
  let draft;
  let kind = 'resume';
  let tone = 'balanced';
  let editing = false;

  function drawPaper() {
    const currentText = draft[kind] || '';
    const elements = currentText.split('\n').map((line, index) => {
      const className =
        kind === 'resume' && index === 0
          ? 'application-name'
          : kind === 'resume' && isHeading(line)
            ? 'application-section'
            : bullet.test(line)
              ? 'application-bullet'
              : '';
      const item = document.createElement('div');
      item.className = className;
      item.textContent = line || '\u00a0';
      return item;
    });
    paper.replaceChildren(...elements);
    const wordsCount = currentText.trim().split(/\s+/).filter(Boolean).length;
    if (statsEl) statsEl.textContent = `${wordsCount} words · Review before sending`;
  }

  function update() {
    for (const tab of tabs) {
      const active = tab.dataset.applicationTab === kind;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active) panel.setAttribute('aria-labelledby', tab.id);
    }
    if (tonesWrap) tonesWrap.hidden = kind !== 'cover';
    for (const btn of toneButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tone === tone));
    }
    editArea.hidden = !editing;
    paper.hidden = editing;
    editButton.textContent = editing ? 'Preview' : 'Edit text';
    copyButton.textContent = 'Copy text';
    if (editing) editText.value = draft[kind];
    drawPaper();
    panel.scrollTop = 0;
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      kind = tab.dataset.applicationTab;
      update();
    });
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const next = {
        ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length],
        ArrowRight: tabs[(index + 1) % tabs.length],
        Home: tabs[0],
        End: tabs.at(-1),
      }[event.key];
      if (!next) return;
      event.preventDefault();
      next.click();
      next.focus();
    });
  }

  for (const btn of toneButtons) {
    btn.addEventListener('click', () => {
      if (!job || btn.dataset.tone === tone) return;
      tone = btn.dataset.tone;
      const key = (job.id || job.url || job.title) + '::' + tone;
      draft = cache.get(key) || buildApplication(sourceResume, job, { tone });
      cache.set(key, draft);
      update();
    });
  }

  editText.addEventListener('input', () => {
    draft[kind] = editText.value;
    drawPaper();
  });
  editButton.addEventListener('click', () => {
    editing = !editing;
    update();
    if (editing) editText.focus();
  });
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(draft[kind] || '');
      copyButton.textContent = 'Copied ✓';
      setTimeout(() => {
        copyButton.textContent = 'Copy text';
      }, 1800);
    } catch {
      copyButton.textContent = 'Copy manually';
    }
  });
  dialog.querySelector('.application-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelector('.application-download').addEventListener('click', () => downloadDraft(draft[kind], job.title || '', kind));
  dialog.querySelector('.application-print').addEventListener('click', () => {
    drawPaper();
    document.body.classList.add('application-printing');
    try {
      window.print();
    } finally {
      document.body.classList.remove('application-printing');
    }
  });

  return {
    open(selection) {
      const resume = String(getResume?.() || '').trim();
      if (!resume) {
        onMissingResume?.();
        return false;
      }
      if (sourceResume !== resume) {
        cache.clear();
        sourceResume = resume;
      }
      const key = (selection.id || selection.url || selection.title + ' ' + selection.company) + '::' + tone;
      const previous = cache.get(key);
      job = selection;
      draft = previous || buildApplication(resume, job, { tone });
      cache.set(key, draft);
      kind = 'resume';
      editing = false;
      dialog.querySelector('.application-job').textContent = [job.title, job.company].filter(Boolean).join(' · ');
      update();
      if (!dialog.open) dialog.showModal();
      if (!previous) onGenerated?.(job);
      return true;
    },
  };
}
