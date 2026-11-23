/** Read JSON safely from fetch responses (gracefully handles static 404/500 pages). */
async function readJsonSafe(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatSyncTime(iso) {
  if (!iso) return 'Just synced';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Just synced';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(date) + ' PHT';
}

export function initAccount({ getLocalState, applyCloudState, onStatusChange }) {
  const button = document.getElementById('account-btn');
  const buttonLabel = document.getElementById('account-btn-label');
  const dialog = document.getElementById('account-dialog');
  const closeBtn = document.getElementById('close-account');

  const emailView = document.getElementById('account-email-view');
  const emailForm = document.getElementById('account-email-form');
  const emailInput = document.getElementById('account-email-input');
  const sendOtpBtn = document.getElementById('account-send-otp');
  const configBanner = document.getElementById('account-config-banner');

  const otpView = document.getElementById('account-otp-view');
  const otpForm = document.getElementById('account-otp-form');
  const otpPrompt = document.getElementById('account-otp-prompt');
  const otpInput = document.getElementById('account-otp-code');
  const verifyOtpBtn = document.getElementById('account-verify-otp');
  const resendBtn = document.getElementById('account-resend-otp');
  const backEmailBtn = document.getElementById('account-change-email');

  const profileView = document.getElementById('account-profile-view');
  const avatarEl = document.getElementById('account-avatar');
  const nameTitleEl = document.getElementById('account-user-name');
  const emailSubEl = document.getElementById('account-user-email');
  const syncTimestampEl = document.getElementById('account-sync-time');
  const tileResumeEl = document.getElementById('account-tile-resume');
  const tilePipelineEl = document.getElementById('account-tile-pipeline');
  const displayNameForm = document.getElementById('account-name-form');
  const displayNameInput = document.getElementById('account-display-name');
  const syncNowBtn = document.getElementById('account-sync-now');
  const logoutBtn = document.getElementById('account-logout');

  const statusEl = document.getElementById('account-status-msg');

  let state = {
    configured: { db: false, email: false },
    backendReachable: false,
    user: null,
    challengeId: '',
    pendingEmail: '',
    cooldownUntil: 0,
    syncState: 'guest',
    lastSyncedAt: null,
    hydrating: false,
  };
  let cooldownTimer = null;
  let syncTimer = null;

  function setStatus(message, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = `account-status-msg${tone ? ` is-${tone}` : ''}`;
  }

  function updateConfigBanner() {
    if (!configBanner) return;
    if (!state.backendReachable) {
      configBanner.textContent = 'Running in static preview mode. Deploy on Vercel with Neon Postgres & Gmail SMTP to sign in and sync.';
      configBanner.className = 'account-banner is-warn';
      configBanner.hidden = false;
    } else if (!state.configured.db || !state.configured.email) {
      const missing = [];
      if (!state.configured.db) missing.push('Neon Postgres (`DATABASE_URL`)');
      if (!state.configured.email) missing.push('Gmail SMTP (`SMTP_USER` & `SMTP_PASS`)');
      configBanner.textContent = `Cloud sign-in needs ${missing.join(' + ')} configured on Vercel.`;
      configBanner.className = 'account-banner is-warn';
      configBanner.hidden = false;
    } else {
      configBanner.textContent = 'Enter your Gmail or email address to receive a one-time 6-digit verification code.';
      configBanner.className = 'account-banner';
      configBanner.hidden = false;
    }
  }

  function updateSummaryTiles() {
    const local = getLocalState();
    if (tileResumeEl) {
      tileResumeEl.textContent = local.resumeText?.trim() ? `${local.resumeText.length.toLocaleString()} chars` : 'Empty';
    }
    if (tilePipelineEl) {
      const count = Array.isArray(local.applications) ? local.applications.length : 0;
      tilePipelineEl.textContent = count === 1 ? '1 saved role' : `${count} saved roles`;
    }
    if (syncTimestampEl) {
      syncTimestampEl.textContent = state.syncState === 'syncing'
        ? 'Syncing…'
        : state.syncState === 'error'
          ? 'Sync retry pending'
          : state.lastSyncedAt
            ? `Synced · ${formatSyncTime(state.lastSyncedAt)}`
            : 'Cloud sync active';
    }
  }

  function updateControls() {
    const signedIn = Boolean(state.user);
    if (button) {
      button.classList.toggle('is-signed-in', signedIn);
      button.setAttribute('aria-label', signedIn ? `Account: ${state.user.displayName}` : 'Sign in with Gmail OTP');
    }
    if (buttonLabel) {
      if (!signedIn) {
        buttonLabel.textContent = 'Sign in';
      } else {
        const shortName = (state.user.displayName || state.user.email.split('@')[0]).slice(0, 16);
        buttonLabel.textContent = state.syncState === 'syncing' ? `${shortName} · …` : shortName;
      }
    }

    if (emailView) emailView.hidden = signedIn || Boolean(state.challengeId);
    if (otpView) otpView.hidden = signedIn || !state.challengeId;
    if (profileView) profileView.hidden = !signedIn;

    updateConfigBanner();

    if (signedIn) {
      const initials = (state.user.displayName || state.user.email || 'JR')
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || 'JR';
      if (avatarEl) avatarEl.textContent = initials;
      if (nameTitleEl) nameTitleEl.textContent = state.user.displayName || state.user.email.split('@')[0];
      if (emailSubEl) emailSubEl.textContent = state.user.email;
      if (displayNameInput && document.activeElement !== displayNameInput) {
        displayNameInput.value = state.user.displayName || '';
      }
      updateSummaryTiles();
    }

    onStatusChange?.({
      authenticated: signedIn,
      user: state.user,
      syncState: state.syncState,
      lastSyncedAt: state.lastSyncedAt,
    });
  }

  function startCooldown(seconds) {
    clearInterval(cooldownTimer);
    state.cooldownUntil = Date.now() + seconds * 1000;
    const tick = () => {
      const remaining = Math.ceil((state.cooldownUntil - Date.now()) / 1000);
      if (!resendBtn) return;
      if (remaining <= 0) {
        clearInterval(cooldownTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend code';
      } else {
        resendBtn.disabled = true;
        resendBtn.textContent = `Resend (${remaining}s)`;
      }
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  async function requestOtp(email) {
    setStatus('Sending 6-digit verification code…');
    if (sendOtpBtn) sendOtpBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-otp', email }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.ok) {
        setStatus(payload?.error || 'Unable to send OTP right now.', 'error');
        if (payload?.retryAfter) startCooldown(Number(payload.retryAfter));
        else if (resendBtn) resendBtn.disabled = false;
        return;
      }

      state.challengeId = payload.challengeId;
      state.pendingEmail = email;
      if (otpPrompt) {
        otpPrompt.textContent = `Sent a 6-digit code to ${payload.maskedEmail}. Expires in 10 minutes.`;
      }
      if (otpInput) otpInput.value = '';
      updateControls();
      startCooldown(Number(payload.cooldownSeconds || 45));
      setStatus('Check your Gmail inbox (and Spam folder) for the code.', 'success');
      otpInput?.focus();
    } catch {
      setStatus('Network error reaching sign-in service.', 'error');
      if (resendBtn) resendBtn.disabled = false;
    } finally {
      if (sendOtpBtn) sendOtpBtn.disabled = false;
    }
  }

  async function syncWorkspace(mode = 'replace') {
    if (!state.user || state.hydrating) return false;
    state.syncState = 'syncing';
    updateControls();

    try {
      const response = await fetch('/api/sync', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, state: getLocalState() }),
      });
      const payload = await readJsonSafe(response);
      if (response.status === 401) {
        state.user = null;
        state.syncState = 'guest';
        updateControls();
        return false;
      }
      if (!response.ok || !payload?.ok) {
        state.syncState = 'error';
        updateControls();
        return false;
      }

      state.syncState = 'synced';
      state.lastSyncedAt = payload.updatedAt || new Date().toISOString();
      if (mode === 'merge' && payload.state) {
        state.hydrating = true;
        try {
          applyCloudState(payload.state);
        } finally {
          state.hydrating = false;
        }
      }
      updateControls();
      return true;
    } catch {
      state.syncState = 'error';
      updateControls();
      return false;
    }
  }

  async function hydrateFromCloud() {
    if (!state.user) return;
    state.syncState = 'syncing';
    updateControls();
    try {
      const response = await fetch('/api/sync', { credentials: 'same-origin' });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.ok) {
        state.syncState = 'error';
        updateControls();
        return;
      }
      if (!payload.updatedAt) {
        await syncWorkspace('merge');
        return;
      }
      state.hydrating = true;
      try {
        applyCloudState(payload.state);
      } finally {
        state.hydrating = false;
      }
      state.syncState = 'synced';
      state.lastSyncedAt = payload.updatedAt;
      updateControls();
    } catch {
      state.syncState = 'error';
      updateControls();
    }
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/auth', { credentials: 'same-origin' });
      const payload = await readJsonSafe(response);
      if (!payload || !payload.ok) {
        state.backendReachable = false;
        updateControls();
        return;
      }
      state.backendReachable = true;
      state.configured = payload.configured || { db: false, email: false };
      state.user = payload.authenticated ? payload.user : null;
      state.syncState = state.user ? 'synced' : 'guest';
      updateControls();
      if (state.user) await hydrateFromCloud();
    } catch {
      state.backendReachable = false;
      updateControls();
    }
  }

  button?.addEventListener('click', () => {
    setStatus('');
    updateControls();
    dialog?.showModal();
    if (!state.user && !state.challengeId) emailInput?.focus();
    else if (state.challengeId && !state.user) otpInput?.focus();
  });

  closeBtn?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  emailForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = String(emailInput?.value || '').trim().toLowerCase();
    if (!email) return;
    await requestOtp(email);
  });

  otpForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const code = String(otpInput?.value || '').trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      setStatus('Please enter all 6 digits from your email.', 'error');
      otpInput?.focus();
      return;
    }

    setStatus('Verifying code…');
    if (verifyOtpBtn) verifyOtpBtn.disabled = true;
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-otp', challengeId: state.challengeId, code }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.ok) {
        setStatus(payload?.error || 'Could not verify code.', 'error');
        return;
      }

      clearInterval(cooldownTimer);
      state.challengeId = '';
      state.pendingEmail = '';
      state.user = payload.user;
      updateControls();
      setStatus('Signed in! Merging & syncing your workspace…', 'success');
      const ok = await syncWorkspace('merge');
      setStatus(ok ? 'Signed in and workspace synced to cloud.' : 'Signed in, but initial sync will retry automatically.', ok ? 'success' : 'error');
    } catch {
      setStatus('Network error during verification.', 'error');
    } finally {
      if (verifyOtpBtn) verifyOtpBtn.disabled = false;
    }
  });

  resendBtn?.addEventListener('click', async () => {
    if (!state.pendingEmail || resendBtn.disabled) return;
    await requestOtp(state.pendingEmail);
  });

  backEmailBtn?.addEventListener('click', () => {
    clearInterval(cooldownTimer);
    state.challengeId = '';
    setStatus('');
    updateControls();
    emailInput?.focus();
  });

  displayNameForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const displayName = String(displayNameInput?.value || '').trim();
    if (displayName.length < 2) {
      setStatus('Display name must be at least 2 characters.', 'error');
      return;
    }
    setStatus('Updating display name…');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-profile', displayName }),
      });
      const payload = await readJsonSafe(response);
      if (!response.ok || !payload?.ok) {
        setStatus(payload?.error || 'Unable to update name.', 'error');
        return;
      }
      state.user = payload.user;
      updateControls();
      setStatus('Display name saved.', 'success');
    } catch {
      setStatus('Network error updating profile.', 'error');
    }
  });

  syncNowBtn?.addEventListener('click', async () => {
    setStatus('Syncing workspace…');
    const ok = await syncWorkspace('replace');
    setStatus(ok ? 'Workspace synced to cloud.' : 'Sync failed. Your local changes are still safe in browser storage.', ok ? 'success' : 'error');
  });

  logoutBtn?.addEventListener('click', async () => {
    setStatus('Signing out…');
    try {
      await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {
      // Clear local client state even if logout network call fails.
    }
    clearTimeout(syncTimer);
    state.user = null;
    state.challengeId = '';
    state.syncState = 'guest';
    state.lastSyncedAt = null;
    updateControls();
    setStatus('Signed out. Local copy remains saved in this browser.');
  });

  updateControls();
  checkSession();

  return {
    scheduleSync() {
      if (!state.user || state.hydrating) return;
      clearTimeout(syncTimer);
      state.syncState = 'syncing';
      updateSummaryTiles();
      syncTimer = setTimeout(() => {
        syncWorkspace('replace');
      }, 750);
    },
    isSignedIn: () => Boolean(state.user),
    getUser: () => (state.user ? { ...state.user } : null),
  };
}
