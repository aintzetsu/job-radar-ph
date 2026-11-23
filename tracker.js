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
  if (content) node.textContent = content;
  return node;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function initTracker({ container, onChange, onOpen }) {
  let entries = [];
  let canPersist = true;
  const heading = element('h2', '', 'Application tracker');
  heading.id = 'tracker-title';
  heading.tabIndex = -1;
  const number = element('span', 'tracker-count');
  const bar = element('div', 'tracker-heading');
  bar.append(heading, number);
  const note = element('p', 'tracker-note');
  const list = element('ul', 'tracker-list');
  list.setAttribute('aria-label', 'Tracked applications');
  const empty = element('p', 'tracker-empty', 'Save a job from its details to start tracking it here.');
  const feedback = element('p', 'tracker-feedback');
  feedback.setAttribute('role', 'status');
  container.classList.add('application-tracker');
  container.setAttribute('aria-labelledby', heading.id);
  container.replaceChildren(bar, note, list, empty, feedback);

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
        return [{
          job,
          status: STATUSES.includes(record.status) ? record.status : 'Saved',
          followUp: /^\d{4}-\d{2}-\d{2}$/.test(record.followUp) ? record.followUp : '',
        }];
      });
    } catch {
      canPersist = false;
    }
  }

  function updateSummary() {
    number.textContent = entries.length === 1 ? '1 job' : `${entries.length} jobs`;
    note.textContent = canPersist
      ? 'Your saved jobs, application status, and follow-up dates stay in this browser.'
      : 'Browser storage is unavailable. Changes will be lost when you leave this page.';
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
    feedback.textContent = message;
    onChange?.(snapshot());
  }

  function render() {
    updateSummary();
    list.hidden = entries.length === 0;
    empty.hidden = entries.length > 0;
    list.replaceChildren(...entries.map(entry => {
      const { job } = entry;
      const item = element('li', 'tracker-row');
      const identity = element('div', 'tracker-identity');
      const title = element('h3', '', job.title);
      const meta = [job.company, job.location, job.source].filter(Boolean).join(' · ');
      identity.append(title);
      if (meta) identity.append(element('p', 'tracker-note', meta));

      const controls = element('div', 'tracker-controls');
      const statusLabel = element('label', 'tracker-input', 'Status');
      const status = element('select');
      status.setAttribute('aria-label', 'Application status for ' + job.title);
      for (const choice of STATUSES) {
        const option = element('option', '', choice);
        option.value = choice;
        status.append(option);
      }
      status.value = entry.status;
      statusLabel.append(status);

      const dateLabel = element('label', 'tracker-input', 'Follow-up date');
      const date = element('input');
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
        due.textContent = open && followUp && followUp <= current
          ? (followUp === current ? 'Due today' : 'Overdue')
          : '';
        due.hidden = due.textContent === '';
      }

      status.addEventListener('change', () => {
        entry.status = status.value;
        updateDue();
        recordChange(`${job.title} marked ${entry.status.toLowerCase()}.`);
      });
      date.addEventListener('change', () => {
        entry.followUp = date.value;
        updateDue();
        recordChange(entry.followUp
          ? `Follow-up date saved for ${job.title}.`
          : `Follow-up date cleared for ${job.title}.`);
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
        const link = element('a', 'tracker-button', 'Open posting');
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
        recordChange(`${job.title} removed from tracker.`);
        const next = list.children[Math.min(nextIndex, entries.length - 1)];
        (next?.querySelector('select') ?? heading).focus();
      });
      actions.append(remove);
      item.append(identity, controls, actions);
      return item;
    }));
  }

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
      entries.unshift({ job, status: 'Saved', followUp: '' });
      render();
      recordChange(`${job.title} saved to your tracker.`);
      return true;
    },
    isSaved(job) {
      const id = String(job?.id ?? job ?? '').trim();
      return entries.some(entry => entry.job.id === id);
    },
    list: snapshot,
  };
}
