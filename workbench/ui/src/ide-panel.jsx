import { useEffect, useRef } from 'react';
import * as Ic from './icons/index.js';

const shells = new Map();
let listening = false;

function look() {
  const l = ui.settingsLook || { terminal: {}, theme: {} };
  const t = l.theme || {};
  return {
    fontFamily: t.font_mono, fontSize: l.terminal?.font_size || 13,
    theme: { background: t.term_bg, foreground: t.term_fg, cursor: t.accent, selectionBackground: t.accent ? `${t.accent}55` : undefined },
  };
}

function listen() {
  if (listening) return;
  listening = true;
  troop.onTerm((sid, m) => {
    const t = [...shells.values()].find((x) => x.id === sid);
    if (!t) return;
    if (m.op === 'snapshot') t.term.write(`\x1bc${m.data}`, () => void troop.termAck(sid, m.data.length));
    else if (m.op === 'output') t.term.write(m.data, () => void troop.termAck(sid, m.data.length));
    else if (m.op === 'exit') { t.gone = true; t.term.write(`\r\n[exited with code ${m.code}. Restart the terminal to get a new one]\r\n`); }
    else if ((m.op === 'closed' || m.op === 'error') && !t.gone) { t.gone = true; t.term.write('\r\n[disconnected from the core. Restart the terminal]\r\n'); }
  });
}

function make(pid) {
  const el = document.createElement('div');
  el.className = 'ou-ip-xterm';
  const { fontFamily, fontSize, theme } = look();
  const term = new window.Terminal({ cursorBlink: true, allowProposedApi: true, scrollback: 10000, fontFamily, fontSize, theme });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  const t = { pid, id: null, el, term, fit, cols: 0, rows: 0, opened: false, gone: false };
  term.onData((d) => { if (t.id && !t.gone) void troop.termInput(t.id, d); });
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
    const k = e.key.toLowerCase();
    if (k === 'c' && (e.shiftKey || term.hasSelection())) { void troop.copyText(term.getSelection()); term.clearSelection(); return false; }
    if (k === 'v' && !e.shiftKey) { e.preventDefault(); void troop.readText().then((s) => { if (s) term.paste(s); }); return false; }
    // false lets the chord bubble to the app's own shortcuts instead of reaching the shell
    return !(e.shiftKey ? 'pfgv'.includes(k) : 'pkgbsw,'.includes(k));
  });
  return t;
}

async function connect(t) {
  listen();
  if (!ui.shellKinds?.length) ui.shellKinds = (await rpc('shell.list', {}, true)).result?.shells || [];
  const kind = ui.shellKinds[0]?.kind;
  const r = kind ? await rpc('shell.open', { project_id: t.pid, kind }, true) : null;
  if (!r?.result) {
    t.gone = true;
    t.term.write(kind ? `Could not open a terminal: ${r?.error?.message || 'the core did not answer'}\r\n` : 'No shell found on this machine. Add one under terminal.shells in Settings.\r\n');
    return;
  }
  if (shells.get(t.pid) !== t) { void rpc('shell.close', { shell_id: r.result.shell_id }, true); return; }
  t.id = r.result.shell_id;
  try { t.fit.fit(); } catch {}
  t.cols = t.term.cols;
  t.rows = t.term.rows;
  const a = await troop.termAttach(t.id, t.cols, t.rows);
  if (a?.windows_build) t.term.options.windowsPty = { backend: 'conpty', buildNumber: a.windows_build };
}

globalThis.addEventListener?.('beforeunload', () => { for (const pid of [...shells.keys()]) closeShell(pid); });

function refit(t) {
  if (!t.el.isConnected || !t.el.offsetHeight) return;
  try { t.fit.fit(); } catch { return; }
  if (!t.id || (t.term.cols === t.cols && t.term.rows === t.rows)) return;
  t.cols = t.term.cols;
  t.rows = t.term.rows;
  void troop.termResize(t.id, t.cols, t.rows);
}

/** Closes the project's panel shell; the next time the Terminal tab shows, a new one opens. */
export function closeShell(pid) {
  const t = shells.get(pid);
  if (!t) return;
  shells.delete(pid);
  if (t.id) { void troop.termDetach(t.id); void rpc('shell.close', { shell_id: t.id }, true); }
  t.term.dispose();
  t.el.remove();
}

/** A real shell in the project folder, kept alive across tab switches and panel folds. */
export function Terminal({ pid }) {
  const host = useRef(null);
  useEffect(() => {
    let t = shells.get(pid);
    if (!t) { t = make(pid); shells.set(pid, t); }
    host.current.append(t.el);
    if (!t.opened) { t.opened = true; t.term.open(t.el); void connect(t); }
    Object.assign(t.term.options, look());
    const sizes = new ResizeObserver(() => refit(t));
    sizes.observe(host.current);
    return () => { sizes.disconnect(); t.el.remove(); };
  }, [pid]);
  return <div ref={host} className="ou-ip-term" />;
}

const RANK = { error: 0, warning: 1, info: 2 };
const sevIcon = (s) => (s === 'error' ? <Ic.Failed size={14} className="ou-ip-err" /> : <Ic.Urgent size={14} className={s === 'warning' ? 'ou-ip-warn' : 'ou-ip-info'} />);

export const countProblems = (problems) => ({
  errors: problems.filter((p) => p.severity === 'error').length,
  warnings: problems.filter((p) => p.severity === 'warning').length,
});

/** Markers grouped by file, errors first, then by line. */
export function Problems({ problems, open, FileIcon }) {
  if (!problems.length) return <div className="ou-ip-problems"><p className="ou-ip-empty">No problems in open files.</p></div>;
  const byFile = new Map();
  for (const p of problems) byFile.set(p.path, [...(byFile.get(p.path) || []), p]);
  return (
    <div className="ou-ip-problems" role="tree" aria-label="Problems">
      {[...byFile].map(([path, list]) => (
        <div key={path} role="group">
          <div className="ou-ip-pfile" role="treeitem" title={path}>
            <FileIcon path={path} />
            <span className="ou-ip-pname">{path.split('/').pop()}</span>
            <span className="ou-ip-pdir">{path.split('/').slice(0, -1).join('/')}</span>
            <span className="ou-ip-pcount">{list.length}</span>
          </div>
          {[...list].sort((a, b) => (RANK[a.severity] ?? 2) - (RANK[b.severity] ?? 2) || a.line - b.line || a.col - b.col).map((p, i) => (
            <button key={i} type="button" role="treeitem" className="ou-ip-prow" title={p.message} onClick={() => open(path, p.line)}>
              {sevIcon(p.severity)}
              <span className="ou-ip-pmsg">{p.message}</span>
              {p.source ? <span className="ou-ip-psrc">{p.source}</span> : null}
              <span className="ou-ip-ppos">[Ln {p.line}, Col {p.col}]</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
