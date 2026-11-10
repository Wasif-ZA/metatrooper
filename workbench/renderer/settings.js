/* The Settings screen. Entries with a `key` read and write settings.json through the core; `soon` entries are background features that have no switch yet. */
globalThis.settingsView = (() => {
  const SECTIONS = [
    { id: 'general', label: 'General', rows: [
      { key: 'sessions.approval', label: 'Before each tool call', hint: 'Ask shows every command for a yes. Auto lets agents run inside their own Ouros worktree.', select: [['ask', 'Ask me'], ['contained', 'Auto in Ouros worktrees']] },
      { key: 'sessions.metarouter', label: 'Route shell commands through metarouter', hint: 'Shorter command output for agents.' },
    ] },
    { id: 'look', label: 'Appearance', rows: [
      { theme: true, label: 'Theme' },
      { key: 'terminal.font_size', label: 'Terminal font size', min: 8, max: 28 },
      { key: 'terminal.scrollback', label: 'Terminal scrollback', hint: 'Lines kept per terminal.', min: 1000, max: 200000, step: 1000 },
      { key: 'agent_cursor.show_caption', label: 'Caption beside the agent cursor', hint: 'Says what the agent is about to click.' },
    ] },
    { id: 'reliability', label: 'Reliability', note: 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.', rows: [
      { soon: true, label: 'Say done only when a check passed', hint: 'A run with no passing check ends as "Needs your review".' },
      { soon: true, label: 'Fix failing checks, up to 3 tries', hint: 'Each try starts from clean files. Tests and check settings are protected from edits.' },
      { soon: true, label: 'Loop alarm', hint: 'A nudge after 3 identical calls, a stop after 5.' },
      { soon: true, label: 'Run budget', hint: 'A log line at 80% of the limit. At 100% it asks you.' },
      { soon: true, label: 'Retry provider errors', hint: 'Backs off and retries. Asks before switching model.' },
      { soon: true, label: 'Check after every edit', hint: 'Typecheck, lint and the nearest tests.' },
      { soon: true, label: 'Ask when a request can mean two things', hint: 'Shows as one Needs you card.' },
      { soon: true, label: 'Keep runs going when Ouros closes', hint: 'Resumes from the last step. Sends and deploys always ask again.' },
      { soon: true, label: 'Checkpoint every turn', hint: 'Undo takes the files back to any turn.' },
    ] },
    { id: 'savings', label: 'Savings', note: 'Each one trades some detail for fewer tokens. All start off.', rows: [
      { key: 'savers.shrink_shell', label: 'Shrink shell output' },
      { key: 'savers.lean_handoffs', label: 'Lean handoffs between agents' },
      { key: 'savers.small_screenshots', label: 'Smaller screenshots' },
      { key: 'savers.cheap_model', label: 'Cheapest model that fits each step' },
    ] },
    { id: 'safety', label: 'Safety', rows: [
      { key: 'desktop.watch_pause', label: 'Pause the agent when I touch the desktop', hint: 'Computer use stops while your mouse or keyboard is busy.' },
      { read: (s) => s.desktop.takeover_key, label: 'Take-over key', hint: 'Stops computer use at once.' },
      { read: (s) => (s.browser.allow_origins.length ? s.browser.allow_origins.join(', ') : 'None'), label: 'Sites agents may open without asking' },
    ] },
    { id: 'notify', label: 'Notifications', rows: [
      { run: () => openSinks(), button: 'Manage', label: 'Slack, ntfy and webhooks', hint: 'Where "needs you" and "run failed" get sent.' },
    ] },
    { id: 'advanced', label: 'Advanced', rows: [
      { key: 'worktree.npm_ci', label: 'Install dependencies in each new worktree' },
      { key: 'worktree.stale_days', label: 'Remove unused worktrees after', unit: 'days', min: 1, max: 90 },
      { run: () => api.openLogs(), button: 'Open', label: 'Logs folder' },
    ] },
  ];

  let data = null;
  let section = 'general';
  const el = () => document.getElementById('settings');
  const get = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), data);

  function control(row, i) {
    if (row.soon) return '<span class="stag">Not built yet</span>';
    if (row.read) return `<span class="sval">${esc(row.read(data))}</span>`;
    if (row.button) return `<button class="btn" data-run="${i}">${esc(row.button)}</button>`;
    if (row.theme) {
      const themes = (ui.settingsLook && ui.settingsLook.themes) || [];
      return `<select data-theme>${themes.map((t) => `<option value="${esc(t.id)}"${ui.look && ui.look.theme.name === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`;
    }
    const v = get(row.key);
    if (row.select) return `<select data-key="${row.key}">${row.select.map(([id, label]) => `<option value="${id}"${id === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    if (typeof v === 'boolean') return `<button class="sw" role="switch" aria-checked="${v}" aria-label="${esc(row.label)}" data-key="${row.key}"><i></i></button>`;
    return `<span class="snum"><input type="number" data-key="${row.key}" value="${esc(v)}" min="${row.min}" max="${row.max}" step="${row.step || 1}" aria-label="${esc(row.label)}">${row.unit ? `<span>${esc(row.unit)}</span>` : ''}</span>`;
  }

  function draw() {
    const sec = SECTIONS.find((s) => s.id === section);
    el().innerHTML = `<nav class="snav" aria-label="Settings sections"><h2>Settings</h2>${SECTIONS.map((s) => `<button data-sec="${s.id}"${s.id === section ? ' aria-current="page"' : ''}>${esc(s.label)}</button>`).join('')}</nav>
      <div class="sbody"><div class="scol"><header><h1>${esc(sec.label)}</h1><button class="ib" data-close title="Close (Esc)" aria-label="Close settings"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 3l8 8M11 3l-8 8"/></svg></button></header>
      ${sec.note ? `<p class="snote">${esc(sec.note)}</p>` : ''}
      <div class="srows">${sec.rows.map((r, i) => `<div class="srw${r.soon ? ' soon' : ''}"><div class="st"><b>${esc(r.label)}</b>${r.hint ? `<span>${esc(r.hint)}</span>` : ''}</div>${control(r, i)}</div>`).join('')}</div></div></div>`;
  }

  async function write(key, value) {
    const r = key === 'sessions.approval' ? await api.setApproval(value) : await api.setSetting(key, value);
    if (r && r.error) toast(r.error, true);
    data = await api.settingsPage();
    draw();
  }

  async function open(id) {
    data = await api.settingsPage();
    if (id) section = id;
    el().hidden = false;
    draw();
    el().focus();
    render();
  }

  function close() {
    if (el().hidden) return false;
    el().hidden = true;
    render();
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    el().addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.sec) { section = t.dataset.sec; draw(); }
      else if ('close' in t.dataset) close();
      else if (t.dataset.run) SECTIONS.find((s) => s.id === section).rows[Number(t.dataset.run)].run();
      else if (t.getAttribute('role') === 'switch') void write(t.dataset.key, t.getAttribute('aria-checked') !== 'true');
    });
    el().addEventListener('change', (e) => {
      const t = e.target;
      if ('theme' in t.dataset) void setLook(t.value);
      else if (t.type === 'number') { const n = Number(t.value); if (Number.isInteger(n) && n >= Number(t.min) && n <= Number(t.max)) void write(t.dataset.key, n); else draw(); }
      else if (t.dataset.key) void write(t.dataset.key, t.value);
    });
  });

  return { open, close, isOpen: () => !el().hidden };
})();
