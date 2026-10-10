// Live terminals: one xterm.js instance per shown session, fed from the core's terminal pipe through the main process.
const TILE_HTML = `<span class="edge"></span><div class="tile-head ph"><div class="r1">
  <span class="dot"></span><b class="tile-engine eng"></b><span class="tile-task task"></span>
  <span class="tile-state badge"></span>
  <span class="act"><button class="btn" data-action="open-panel" data-tab="diff" title="What this agent changed">Diff</button><button class="btn" data-action="open-panel" data-tab="handback" title="The command to commit these changes">Hand back</button></span>
  <button class="pb" data-action="pair" title="Pair beside the big pane (Shift+click in the list)">Pair</button><button class="ub" data-action="unpair" title="Unpair">Unpair</button>
  <button class="btn rs" data-action="resume-tile" title="Start this agent again">Resume</button>
  <button class="tx" data-action="hide" title="Hide this tile"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.4"/></svg></button></div>
  <div class="r2"><span class="tile-last fl"></span><svg class="spk" width="30" height="12" viewBox="0 0 30 12" aria-hidden="true"></svg><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="tile-meta meta"></span></div>
  <span class="shim"><i></i></span></div><div class="tile-body"></div>`;

const termView = (() => {
  const troop = window.troop;
  const centre = document.getElementById('centre');
  const terms = new Map();
  let look = { terminal: { scrollback: 10000, font_size: 13 }, theme: {} };
  let mode = 'single';
  let selected = null;
  let onPick = () => {};
  let onExit = () => {};
  let onOutput = () => {};

  function xtermTheme() {
    const t = look.theme;
    return { background: t.term_bg, foreground: t.term_fg, cursor: t.accent, selectionBackground: `${t.accent}55` };
  }

  function create(sessionId) {
    const el = document.createElement('div');
    el.className = 'tile pane';
    el.dataset.id = sessionId;
    el.innerHTML = TILE_HTML;
    el.querySelector('.tile-head').addEventListener('click', (e) => { if (!e.target.closest('button')) onPick(sessionId, e); });
    const body = el.querySelector('.tile-body');
    const term = new window.Terminal({ cursorBlink: true, allowProposedApi: true, scrollback: look.terminal.scrollback, fontSize: look.terminal.font_size, fontFamily: look.theme.font_mono, theme: xtermTheme() });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(body);
    const t = { id: sessionId, el, term, fit, attachAt: 0, attachMs: null, cols: 0, rows: 0 };
    term.onData((data) => { if (!t.closed && !t.outside) troop.termInput(sessionId, data); });
    const copy = () => { const s = term.getSelection(); if (!s) return false; void troop.copyText(s); term.clearSelection(); return true; };
    const paste = () => troop.readText().then((s) => { if (s) term.paste(s); });
    const copyOnRelease = () => { const s = term.getSelection(); if (s) void troop.copyText(s); };
    body.addEventListener('mousedown', (e) => { if (e.button === 0) window.addEventListener('mouseup', copyOnRelease, { once: true }); });
    // The right button never reaches the program: Claude Code would paste it a second, slower time.
    for (const type of ['mousedown', 'mouseup']) body.addEventListener(type, (e) => { if (e.button === 2) e.stopPropagation(); }, true);
    body.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); void paste(); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && (e.shiftKey || term.hasSelection())) { copy(); e.preventDefault(); return false; }
      if (k === 'v') { void paste(); e.preventDefault(); return false; }
      return true;
    });
    new ResizeObserver(() => { clearTimeout(t.fitTimer); if (!t.attached) resize(t); else t.fitTimer = setTimeout(() => resize(t), 150); }).observe(body);
    terms.set(sessionId, t);
    return t;
  }

  /** Attaches once the wall has given the tile its real size, so the PTY is not resized right after attach. */
  function resize(t) {
    if (!t.el.isConnected || !t.el.offsetWidth || t.el.classList.contains('fold')) return;
    const cell = t.term.element && t.term.element.querySelector('.xterm-rows > div');
    if (t.el.querySelector('.tile-body').clientHeight < (cell ? cell.offsetHeight * 2 : 30)) return;
    if (t.outside) return;
    if (!t.attached) { t.attached = true; attach(t); t.cols = t.term.cols; t.rows = t.term.rows; return; }
    try { t.fit.fit(); } catch { return; }
    if (t.term.cols === t.cols && t.term.rows === t.rows) return;
    t.cols = t.term.cols;
    t.rows = t.term.rows;
    troop.termResize(t.id, t.cols, t.rows);
  }

  function attach(t) {
    try { t.fit.fit(); } catch {}
    t.attachAt = performance.now();
    t.attachMs = null;
    t.closed = false;
    t.el.classList.remove('closed');
    void troop.termAttach(t.id, t.term.cols, t.term.rows);
  }

  function drop(sessionId) {
    const t = terms.get(sessionId);
    if (!t) return;
    void troop.termDetach(sessionId);
    t.term.dispose();
    t.el.remove();
    terms.delete(sessionId);
  }

  troop.onTerm((sessionId, m) => {
    const t = terms.get(sessionId);
    if (!t) return;
    if (m.op === 'snapshot') { t.term.write('\x1bc' + m.data, () => { t.attachMs = Math.round(performance.now() - t.attachAt); }); }
    else if (m.op === 'output') { t.term.write(m.data); onOutput(sessionId, m.data.length); }
    else if (m.op === 'exit') { t.term.write(`\r\n[exited with code ${m.code}]\r\n`); onExit(sessionId); }
    else if (m.op === 'error' && m.code === 'slow-viewer') attach(t);
    else if (m.op === 'error' && m.code === 'no-session') t.term.write('\r\n[this session is not running]\r\n');
    else if (m.op === 'closed' && !t.closed) { t.closed = true; t.el.classList.add('closed'); t.term.write('\r\n[disconnected from the core]\r\n'); }
  });

  function label(t, x) {
    const set = (sel, text) => { const e = t.el.querySelector(sel); if (e.textContent !== text) e.textContent = text; };
    t.el.querySelector('.dot').className = `dot ${x.state}${x.unseen ? ' unseen' : ''}`;
    set('.tile-engine', x.engine_id);
    set('.tile-task', x.task);
    set('.tile-last', x.last || '');
    set('.tile-state', x.words);
    set('.tile-meta', x.meta || '');
    t.el.dataset.state = x.state;
    t.el.classList.toggle('shell', Boolean(x.shell));
    const tx = t.el.querySelector('.tx');
    tx.dataset.action = x.shell ? 'shell-close' : 'hide';
    tx.title = x.shell ? 'Close this shell' : 'Hide this tile';
    if (x.outside && !t.outside) {
      t.outside = true;
      t.el.classList.add('outside');
      t.term.options.disableStdin = true;
      t.term.write('Opened outside MetaTrooper. Type in its own terminal; this tile follows its hooks only.\r\n');
    }
    t.el.classList.toggle('asking', x.state === 'waiting_for_you');
    t.el.classList.toggle('on', x.id === selected);
  }

  /** Shows every given session as a tile on the wall and detaches the rest; the wall places them. */
  function show(next) {
    mode = next.mode;
    selected = next.selected;
    onPick = next.onPick || onPick;
    onExit = next.onExit || onExit;
    onOutput = next.onOutput || onOutput;
    const keep = new Set(next.sessions.map((x) => x.id));
    for (const id of [...terms.keys()]) if (!keep.has(id)) drop(id);
    centre.classList.toggle('grid', mode === 'grid');
    centre.dataset.count = String(next.sessions.length);
    for (const x of next.sessions) {
      const t = terms.get(x.id) || create(x.id);
      label(t, x);
      if (t.el.parentNode !== centre) { t.el.dataset.fresh = '1'; centre.append(t.el); }
    }
    if (next.focus) terms.get(selected)?.term.focus();
  }

  function tile(id) {
    const t = terms.get(id);
    return t ? t.el : null;
  }

  function refit(id) {
    const t = terms.get(id);
    if (t) resize(t);
  }

  function setLook(next) {
    look = next;
    for (const t of terms.values()) {
      t.term.options.fontFamily = look.theme.font_mono;
      t.term.options.fontSize = look.terminal.font_size;
      t.term.options.scrollback = look.terminal.scrollback;
      t.term.options.theme = xtermTheme();
      resize(t);
    }
  }

  /** Types text into the selected session without Enter, for drag and drop. */
  function type(text, id = selected) {
    if (id && terms.has(id)) troop.termInput(id, text);
  }

  /** Selected session, its attach time and its last `n` non-empty rows, for the test probe. */
  function state(n = 5) {
    const t = terms.get(selected);
    if (!t) return null;
    const b = t.term.buffer.active;
    const rows = [];
    for (let i = b.length - 1; i >= 0 && rows.length < n; i--) {
      const line = b.getLine(i)?.translateToString(true) ?? '';
      if (line.trim()) rows.unshift(line);
    }
    return { session: selected, attach_ms: t.attachMs, tail: rows, mode, tiles: terms.size };
  }

  /** Sends `input` to a shown session and resolves with the ms until `expect` appears in its parsed output. */
  function timeEcho(sessionId, input, expect, timeoutMs = 5000) {
    const t = terms.get(sessionId);
    if (!t) return Promise.resolve(null);
    return new Promise((resolve) => {
      const start = performance.now();
      let seen = '';
      const sub = t.term.onWriteParsed(() => {
        const b = t.term.buffer.active;
        seen = '';
        for (let i = Math.max(0, b.length - t.term.rows - 5); i < b.length; i++) seen += b.getLine(i)?.translateToString(true) ?? '';
        if (seen.includes(expect)) { sub.dispose(); clearTimeout(timer); resolve(performance.now() - start); }
      });
      const timer = setTimeout(() => { sub.dispose(); resolve(null); }, timeoutMs);
      troop.termInput(sessionId, input);
    });
  }

  return { show, setLook, type, state, timeEcho, tile, refit, ids: () => [...terms.keys()] };
})();
