(() => {
  const key = 'job-radar-ph-theme';
  const root = document.documentElement;
  let savedTheme;
  try { savedTheme = localStorage.getItem(key); } catch {}
  root.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('theme-toggle');

    function applyTheme(theme) {
      root.dataset.theme = theme;
      const dark = theme === 'dark';
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }

    function setTheme(theme, { silent = false } = {}) {
      const next = theme === 'light' ? 'light' : 'dark';
      root.classList.add('theme-animated');
      applyTheme(next);
      try { localStorage.setItem(key, next); } catch {}
      if (!silent) {
        window.dispatchEvent(new CustomEvent('job-radar-theme-change', { detail: { theme: next } }));
      }
    }

    window.setJobRadarTheme = setTheme;

    applyTheme(root.dataset.theme);
    toggle.disabled = false;
    toggle.addEventListener('click', () => {
      setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    window.addEventListener('storage', event => {
      if (event.key !== key && event.key !== null) return;
      root.classList.add('theme-animated');
      applyTheme(event.newValue === 'light' ? 'light' : 'dark');
    });
  }, { once: true });
})();
