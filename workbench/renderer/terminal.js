// Live terminals: one xterm.js instance per shown session, fed from the core's terminal pipe through the main process.
const termView = (() => {
  const troop = window.troop;
  const centre = document.getElementById('centre');
  const terms = new Map();
  let look = { terminal: { scrollback: 10000, font_size: 13 }, theme: {} };
  let mode = 'single';
  let selected = null;
  let onPick = () => {};
  let onExit = () => {};

  function xtermTheme() {
    const t = look.theme;
    return { background: t.term_bg, foreground: t.term_fg, cursor: t.accent, selectionBackground: `${t.accent}55` };
  }

  function create(sessionId) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = '<div class="tile-head"><span class="dot"></span><b class="tile-engine"></b><span class="tile-task"></span><span class="tile-state"></span></div><div class="tile-body"></div>';
    el.querySelector('.tile-head').addEventListener('click', () => onPick(sessionId));
    const body = el.querySelector('.tile-body');
    const term = new window.Terminal({ cursorBlink: true, allowProposedApi: true, scrollback: look.terminal.scrollback, fontSize: look.terminal.font_size, fontFamily: look.theme.font_mono, theme: xtermTheme() });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(body);
    const t = { id: sessionId, el, term, fit, attachAt: 0, attachMs: null, cols: 0, rows: 0 };
    term.onData((data) => troop.termInput(sessionId, data));
    new ResizeObserver(() => resize(t)).observe(body);
    terms.set(sessionId, t);
    attach(t);
    return t;
  }

  function resize(t) {
    if (!t.el.isConnected || !t.el.offsetWidth) return;
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
    else if (m.op === 'output') t.term.write(m.data);
    else if (m.op === 'exit') { t.term.write(`\r\n[exited with code ${m.code}]\r\n`); onExit(sessionId); }
    else if (m.op === 'error' && m.code === 'slow-viewer') attach(t);
    else if (m.op === 'error' && m.code === 'no-session') t.term.write('\r\n[this session is not running]\r\n');
  });

  function label(t, x) {
    t.el.querySelector('.dot').className = `dot ${x.state}${x.unseen ? ' unseen' : ''}`;
    t.el.querySelector('.tile-engine').textContent = x.engine_id;
    t.el.querySelector('.tile-task').textContent = x.task;
    t.el.querySelector('.tile-state').textContent = x.words;
    t.el.classList.toggle('asking', x.state === 'waiting_for_you');
    t.el.classList.toggle('on', x.id === selected);
  }

  /** Single mode shows the selected session; grid mode shows every given session as a tile; the rest are detached. */
  function show(next) {
    mode = next.mode;
    selected = next.selected;
    onPick = next.onPick || onPick;
    onExit = next.onExit || onExit;
    const want = mode === 'grid' ? next.sessions : next.sessions.filter((x) => x.id === selected);
    const keep = new Set(want.map((x) => x.id));
    for (const id of [...terms.keys()]) if (!keep.has(id)) drop(id);
    centre.classList.toggle('grid', mode === 'grid');
    centre.dataset.count = String(want.length);
    for (const x of want) {
      const t = terms.get(x.id) || create(x.id);
      label(t, x);
      if (t.el.parentNode !== centre) centre.append(t.el);
    }
    for (const t of terms.values()) resize(t);
    if (next.focus) terms.get(selected)?.term.focus();
  }

  function setLook(next) {
    look = next;
    for (const t of terms.values()) {
      t.term.options.fontFamily = look.theme.font_mono;
      t.term.options.fontSize = look.terminal.font_size;
      t.term.options.scrollback = look.terminal.scrollback;
      t.term.options.theme = xtermTheme();
    }
  }

  /** Types text into the selected session without Enter, for drag and drop. */
  function type(text) {
    if (selected && terms.has(selected)) troop.termInput(selected, text);
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

  return { show, setLook, type, state, timeEcho };
})();
