const STORAGE_KEY = 'job-radar-ph-applications';
const STATUSES = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Closed'];

function safeLink(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeJob(job) {
  if (!job || typeof job !== 'object') return null;
  const id = String(job.id ?? '').trim();
  const title = typeof job.title === 'string' ? job.title.trim() : '';
  if (!id || !title) return null;
  return {
    ...job,
    id,
    title,
    company: typeof job.company === 'string' ? job.company : '',
    location: typeof job.location === 'string' ? job.location : '',
    source: typeof job.source === 'string' ? job.source : '',
    description: typeof job.description === 'string' ? job.description : '',
    url: safeLink(job.url),
  };
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined && content !== '') node.textContent = content;
  return node;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replaceAll('"', '""')}"`;
}

export function initTracker({ container, onChange, onOpen }) {
  let entries = [];
  let canPersist = true;
  let stageFilter = 'All';
  let viewMode = 'list';

  const heading = element('h2', '', 'Application pipeline');
  heading.id = 'tracker-title';
  heading.tabIndex = -1;
  const number = element('span', 'tracker-count');

  const viewToggle = element('div', 'tracker-view-switch');
  const listBtn = element('button', 'tracker-pill', 'List');
  listBtn.type = 'button';
  const boardBtn = element('button', 'tracker-pill', 'Board');
  boardBtn.type = 'button';
  const exportBtn = element('button', 'tracker-pill', 'Export CSV');
  exportBtn.type = 'button';
  viewToggle.append(listBtn, boardBtn, exportBtn);

  const bar = element('div', 'tracker-heading');
  const barLeft = element('div', 'tracker-heading-left');
  barLeft.append(heading, number);
  bar.append(barLeft, viewToggle);

  const note = element('p', 'tracker-note');
  const stageBar = element('div', 'tracker-stages');
  stageBar.setAttribute('role', 'group');
  stageBar.setAttribute('aria-label', 'Filter pipeline by stage');

  const list = element('ul', 'tracker-list');
  list.setAttribute('aria-label', 'Tracked applications');
  const board = element('div', 'tracker-board');
  board.hidden = true;

  const empty = element('p', 'tracker-empty', 'Save any job above to track its status, follow-up date, and interview notes here.');
  const feedback = element('p', 'tracker-feedback');
  feedback.setAttribute('role', 'status');

  container.classList.add('application-tracker');
  container.setAttribute('aria-labelledby', heading.id);
  container.replaceChildren(bar, note, stageBar, list, board, empty, feedback);

  function reload() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      const unique = new Set();
      entries = parsed.flatMap(record => {
        const job = normalizeJob(record?.job);
        if (!job || unique.has(job.id)) return [];
        unique.add(job.id);
        return [
          {
            job,
            status: STATUSES.includes(record.status) ? record.status : 'Saved',
            followUp: /^\d{4}-\d{2}-\d{2}$/.test(record.followUp) ? record.followUp : '',
            notes: typeof record.notes === 'string' ? record.notes.slice(0, 400) : '',
          },
        ];
      });
    } catch {
      canPersist = false;
    }
  }

  function countsByStage() {
    const map = { All: entries.length };
    for (const s of STATUSES) map[s] = 0;
    for (const entry of entries) map[entry.status] = (map[entry.status] || 0) + 1;
    return map;
  }

  function snapshot() {
    return entries.map(entry => ({ ...entry, job: { ...entry.job } }));
  }

  function recordChange(message) {
    if (canPersist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      } catch {
        canPersist = false;
      }
    }
    updateSummary();
    renderStageBar();
    feedback.textContent = message;
    onChange?.(snapshot());
  }

  function updateSummary() {
    const counts = countsByStage();
    const active = counts.Applied + counts.Interviewing + counts.Offer;
    number.textContent = entries.length === 1 ? '1 saved' : `${entries.length} saved${active ? ` · ${active} active` : ''}`;
    note.textContent = canPersist
      ? 'Saved locally in your browser with stage filters, follow-up reminders, notes, and CSV backup.'
      : 'Browser storage is unavailable. Changes apply only to this tab session.';
    exportBtn.disabled = entries.length === 0;
  }

  function renderStageBar() {
    const counts = countsByStage();
    const stages = ['All', ...STATUSES];
    stageBar.replaceChildren(
      ...stages.map(stage => {
        const btn = element('button', 'tracker-stage-pill', `${stage} (${counts[stage] || 0})`);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(stageFilter === stage));
        btn.addEventListener('click', () => {
          stageFilter = stage;
          render();
        });
        return btn;
      })
    );
  }

  function buildMeta(job) {
    const parts = [job.company, job.location];
    if (job.source && job.source.toLowerCase() !== (job.company || '').toLowerCase()) parts.push(job.source);
    return parts.filter(Boolean).join(' · ');
  }

  function createRow(entry) {
    const { job } = entry;
    const item = element('li', 'tracker-row');
    const identity = element('div', 'tracker-identity');
    identity.append(element('h3', '', job.title));
    const meta = buildMeta(job);
    if (meta) identity.append(element('p', 'tracker-note', meta));

    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.className = 'tracker-notes-input';
    notesInput.maxLength = 400;
    notesInput.value = entry.notes || '';
    notesInput.placeholder = 'Add recruiter contact, pay rate, or interview note…';
    notesInput.setAttribute('aria-label', 'Application notes for ' + job.title);
    notesInput.addEventListener('change', () => {
      entry.notes = notesInput.value.trim();
      recordChange(`Notes updated for ${job.title}.`);
    });
    identity.append(notesInput);

    const controls = element('div', 'tracker-controls');
    const statusLabel = element('label', 'tracker-input', 'Stage');
    const status = document.createElement('select');
    status.setAttribute('aria-label', 'Application status for ' + job.title);
    for (const choice of STATUSES) {
      const option = element('option', '', choice);
      option.value = choice;
      status.append(option);
    }
    status.value = entry.status;
    statusLabel.append(status);

    const dateLabel = element('label', 'tracker-input', 'Follow-up');
    const date = document.createElement('input');
    date.type = 'date';
    date.value = entry.followUp;
    date.setAttribute('aria-label', 'Follow-up date for ' + job.title);
    dateLabel.append(date);

    const due = element('p', 'tracker-due');
    const dateControl = element('div', 'tracker-date');
    dateControl.append(dateLabel, due);

    function updateDue() {
      const followUp = entry.followUp;
      const current = today();
      const open = entry.status !== 'Closed';
      due.textContent = open && followUp && followUp <= current ? (followUp === current ? 'Due today' : 'Overdue') : '';
      due.hidden = due.textContent === '';
    }

    status.addEventListener('change', () => {
      entry.status = status.value;
      updateDue();
      recordChange(`${job.title} moved to ${entry.status}.`);
      if (stageFilter !== 'All' || viewMode === 'board') render();
    });
    date.addEventListener('change', () => {
      entry.followUp = date.value;
      updateDue();
      recordChange(entry.followUp ? `Follow-up saved for ${job.title}.` : `Follow-up cleared for ${job.title}.`);
    });
    updateDue();
    controls.append(statusLabel, dateControl);

    const actions = element('div', 'tracker-actions');
    if (onOpen) {
      const details = element('button', 'tracker-button', 'Details');
      details.type = 'button';
      details.setAttribute('aria-label', 'View details for ' + job.title);
      details.addEventListener('click', () => onOpen({ ...job }));
      actions.append(details);
    }
    if (job.url) {
      const link = element('a', 'tracker-button', 'Open posting ↗');
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', 'Open posting for ' + job.title + ' in a new tab');
      actions.append(link);
    }
    const remove = element('button', 'tracker-button tracker-remove', 'Remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + job.title + ' from tracker');
    remove.addEventListener('click', () => {
      const nextIndex = [...list.children].indexOf(item);
      entries = entries.filter(previous => previous.job.id !== job.id);
      render();
      recordChange(`${job.title} removed from pipeline.`);
      const next = list.children[Math.min(nextIndex, entries.length - 1)];
      (next?.querySelector('select') ?? heading).focus();
    });
    actions.append(remove);

    item.append(identity, controls, actions);
    return item;
  }

  function renderBoard() {
    board.replaceChildren(
      ...STATUSES.map(stage => {
        const col = element('section', 'tracker-col');
        const colEntries = entries.filter(e => e.status === stage);
        const colHead = element('div', 'tracker-col-head');
        colHead.append(element('strong', '', stage), element('span', 'tracker-col-badge', String(colEntries.length)));
        col.append(colHead);

        const cards = element('div', 'tracker-col-cards');
        if (!colEntries.length) {
          cards.append(element('p', 'tracker-col-empty', 'No roles'));
        } else {
          for (const entry of colEntries) {
            const card = element('article', 'tracker-mini-card');
            card.append(element('strong', '', entry.job.title), element('small', '', entry.job.company));
            if (entry.followUp) card.append(element('span', 'tracker-mini-date', `Follow-up: ${entry.followUp}`));
            const row = element('div', 'tracker-mini-actions');
            const moveSel = document.createElement('select');
            moveSel.setAttribute('aria-label', `Move ${entry.job.title} stage`);
            for (const s of STATUSES) {
              const o = element('option', '', s);
              o.value = s;
              moveSel.append(o);
            }
            moveSel.value = entry.status;
            moveSel.addEventListener('change', () => {
              entry.status = moveSel.value;
              recordChange(`${entry.job.title} moved to ${entry.status}.`);
              render();
            });
            row.append(moveSel);
            if (onOpen) {
              const viewBtn = element('button', 'tracker-button', 'Open');
              viewBtn.type = 'button';
              viewBtn.addEventListener('click', () => onOpen({ ...entry.job }));
              row.append(viewBtn);
            }
            card.append(row);
            cards.append(card);
          }
        }
        col.append(cards);
        return col;
      })
    );
  }

  function render() {
    updateSummary();
    renderStageBar();
    listBtn.setAttribute('aria-pressed', String(viewMode === 'list'));
    boardBtn.setAttribute('aria-pressed', String(viewMode === 'board'));

    const filtered = stageFilter === 'All' ? entries : entries.filter(e => e.status === stageFilter);
    empty.hidden = entries.length > 0;

    if (viewMode === 'board') {
      list.hidden = true;
      board.hidden = entries.length === 0;
      if (entries.length > 0) renderBoard();
    } else {
      board.hidden = true;
      list.hidden = filtered.length === 0;
      if (entries.length > 0 && filtered.length === 0) {
        empty.hidden = false;
        empty.textContent = `No applications in "${stageFilter}" yet.`;
      } else {
        empty.textContent = 'Save any job above to track its status, follow-up date, and interview notes here.';
      }
      list.replaceChildren(...filtered.map(createRow));
    }
  }

  listBtn.addEventListener('click', () => {
    viewMode = 'list';
    render();
  });
  boardBtn.addEventListener('click', () => {
    viewMode = 'board';
    render();
  });
  exportBtn.addEventListener('click', () => {
    if (!entries.length) return;
    const header = ['Title', 'Company', 'Location', 'Stage', 'Follow-Up', 'Notes', 'URL'].join(',');
    const rows = entries.map(e =>
      [e.job.title, e.job.company, e.job.location, e.status, e.followUp, e.notes, e.job.url].map(csvCell).join(',')
    );
    const csv = [header, ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `job-radar-ph-pipeline-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    feedback.textContent = `Exported ${entries.length} tracked role${entries.length === 1 ? '' : 's'} to CSV.`;
  });

  reload();
  render();
  window.addEventListener('storage', event => {
    if (!canPersist || (event.key !== STORAGE_KEY && event.key !== null)) return;
    reload();
    render();
    onChange?.(snapshot());
  });

  return {
    save(input) {
      const job = normalizeJob(input);
      if (!job || entries.some(entry => entry.job.id === job.id)) return false;
      entries.unshift({ job, status: 'Saved', followUp: '', notes: '' });
      render();
      recordChange(`${job.title} saved to your pipeline.`);
      return true;
    },
    isSaved(job) {
      const id = String(job?.id ?? job ?? '').trim();
      return entries.some(entry => entry.job.id === id);
    },
    list: snapshot,
    getCounts: countsByStage,
  };
}
