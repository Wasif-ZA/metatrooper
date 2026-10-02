// The attached session's terminal: xterm.js fed from the core's terminal pipe through the main process.
const termView = (() => {
  const troop = window.troop;
  const host = document.getElementById('term-host');
  const screen = document.getElementById('term-screen');
  const title = document.getElementById('term-title');
  let current = null;
  let term = null;
  let fit = null;
  let attachAt = 0;
  let attachMs = null;
  let look = null;
  troop.termSettings().then((s) => { look = s; apply(); });

  function apply() {
    if (!look) return;
    host.style.setProperty('--term-bg', look.background);
    host.style.setProperty('--term-border', look.border);
    if (!term) return;
    term.options.fontFamily = look.font_family;
    term.options.fontSize = look.font_size;
    term.options.scrollback = look.scrollback;
    term.options.theme = { background: look.background, foreground: look.foreground };
  }

  function open() {
    term = new window.Terminal({ cursorBlink: true, allowProposedApi: true });
    apply();
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(screen);
    term.onData((data) => { if (current) troop.termInput(current, data); });
    new ResizeObserver(() => {
      if (!current || host.hidden) return;
      try { fit.fit(); } catch { return; }
      troop.termResize(current, term.cols, term.rows);
    }).observe(screen);
  }

  troop.onTerm((sessionId, m) => {
    if (sessionId !== current || !term) return;
    if (m.op === 'snapshot') { term.reset(); term.write(m.data, () => { attachMs = Math.round(performance.now() - attachAt); }); }
    else if (m.op === 'output') term.write(m.data);
    else if (m.op === 'exit') term.write(`\r\n[exited with code ${m.code}]\r\n`);
    else if (m.op === 'error' && m.code === 'slow-viewer') attach(sessionId);
    else if (m.op === 'error' && m.code === 'no-session') term.write('\r\n[this session is not running]\r\n');
  });

  function attach(sessionId) {
    if (!term) open();
    try { fit.fit(); } catch {}
    attachAt = performance.now();
    attachMs = null;
    void troop.termAttach(sessionId, term.cols, term.rows);
  }

  /** Shows the given session's terminal, or hides the view when null. */
  function follow(sessionId, label) {
    if (sessionId === current) { if (label) title.textContent = label; return; }
    if (current) void troop.termDetach(current);
    current = sessionId;
    host.hidden = !sessionId;
    if (!sessionId) return;
    title.textContent = label || sessionId;
    attach(sessionId);
    term.focus();
  }

  /** Session, attach time and the last non-empty rows, for the test probe. */
  function state() {
    if (!term || !current) return null;
    const b = term.buffer.active;
    const rows = [];
    for (let i = b.length - 1; i >= 0 && rows.length < 5; i--) {
      const line = b.getLine(i)?.translateToString(true) ?? '';
      if (line.trim()) rows.unshift(line);
    }
    return { session: current, attach_ms: attachMs, tail: rows };
  }

  return { follow, state };
})();
