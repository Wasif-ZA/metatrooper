import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { createStore } from './store.js';
import { Drawn } from './kit/Draw.jsx';
import { Chat, useChat } from './chat.jsx';
import './workspace.css';

// The workspace an agent set with ouros_workspace (ouros-spec 6c); null current means your usual layout.
export const wsStore = createStore({ pid: null, ws: null, seenAt: null });
let lastAsk = 0;

/** Reads the open project's workspace from the core, at most once a second while the IDE shows. */
// ponytail: polls workspace.get each second; move it into the snapshot if the pipe gets busy.
export async function syncWorkspace(pid, force = false) {
  if (!pid || (!force && Date.now() - lastAsk < 1000 && wsStore.get().pid === pid)) return;
  lastAsk = Date.now();
  const out = await api.call('workspace.get', { project_id: pid });
  if (out.kind === 'reply' && out.reply.result) { countChange(pid, out.reply.result); wsStore.set({ pid, ws: out.reply.result }); }
}

// M8-35a: how many layout changes applied in this project since the window opened, for the status bar line.
const changes = new Map();
function countChange(pid, ws) {
  const at = ws && ws.last && ws.last.applied ? ws.last.at : null;
  const c = changes.get(pid) || { n: 0, at: null };
  if (at && at !== c.at) changes.set(pid, { n: c.n + 1, at });
}
/** The status bar's layout line: the layout's name, the changes counted and whether Ctrl+Z can undo the last; null while nothing changed and the usual layout shows. */
export function layoutLine(pid, ws) {
  const n = (changes.get(pid) || { n: 0 }).n;
  if (!ws || (!n && ws.usual)) return null;
  const name = ws.usual ? 'your usual' : (ws.current && ws.current.name) || 'agent layout';
  return { name, n, undo: Boolean(ws.last && ws.undo) };
}

async function act(method) {
  const pid = wsStore.get().pid;
  if (!pid) return;
  const out = await api.call(method, { project_id: pid });
  if (out.kind === 'reply' && out.reply.result) { countChange(pid, out.reply.result); wsStore.set({ ws: out.reply.result, seenAt: null }); }
}
export const undoLayout = () => act('workspace.undo');
export const usualLayout = () => act('workspace.usual');

const editable = (t) => Boolean(t?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor'));

/** Ctrl+Alt+0 goes back to your usual layout; Ctrl+Z undoes the last layout change while its banner shows and no text box has focus. */
export function workspaceKey(e) {
  const ws = wsStore.get().ws;
  if (!ws) return false;
  if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === '0' || e.code === 'Digit0')) { e.preventDefault(); void usualLayout(); return true; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && ws.last && ws.undo && !editable(e.target)) { e.preventDefault(); void undoLayout(); return true; }
  return false;
}

/** The line above the layout after a change: your words, who set it, and Undo / My usual; a refused layout says why and that nothing changed. */
export function WorkspaceBanner() {
  const { ws, seenAt } = wsStore.use();
  const last = ws?.last;
  if (!last || seenAt === last.at) return null;
  const asked = last.asked ? <span className="ou-ws-asked"><span className="ou-ws-who">you asked</span>{last.asked}</span> : <span className="ou-ws-who">layout change</span>;
  const claim = last.applied && ws.current?.by && !last.setter.startsWith(ws.current.by) ? <span className="ou-ws-claim">(file says "{ws.current.by}")</span> : null;
  return (
    <div className={last.applied ? 'ou-ws-banner' : 'ou-ws-banner ou-ws-bad'} role="status">
      {asked}
      <span className="ou-ws-sp" />
      {last.applied
        ? <><span className="ou-ws-by">{last.setter} set this layout {claim}</span>
          <Button size="sm" variant="secondary" label="Undo  Ctrl+Z" onClick={() => void undoLayout()} />
          <Button size="sm" variant="secondary" label="My usual  Ctrl+Alt+0" onClick={() => void usualLayout()} /></>
        : <span className="ou-ws-by" title={last.reasons.join('; ')}>That layout could not be built: {last.reasons.join('; ')}. Your IDE is unchanged.</span>}
      <Button size="sm" variant="ghost" label="Dismiss" onClick={() => wsStore.set({ seenAt: last.at })} />
    </div>
  );
}

function SurfacePane({ id }) {
  const [spec, setSpec] = useState(null);
  useEffect(() => {
    let live = true;
    void api.call('ui.get', { surface: id }).then((out) => { if (live) setSpec(out.kind === 'reply' && out.reply.result ? out.reply.result.spec : false); });
    return () => { live = false; };
  }, [id]);
  if (spec === false) return <EmptyState isCompact title={`No screen called "${id}"`} />;
  return spec ? <Drawn spec={spec} zone="panel" /> : null;
}

function AgentPane({ pid }) {
  const x = (ui.snap.sessions || []).filter((s) => s.project_id === pid && s.state !== 'exited').sort((a, b) => String(b.state_at).localeCompare(String(a.state_at)))[0];
  return x ? <AgentChat key={x.id} x={x} /> : <EmptyState isCompact title="No agent is running in this project." />;
}

function AgentChat({ x }) {
  const chat = useChat(x.id, x.state);
  return <div className="ou-hm-center ou-ws-agent"><Chat x={x} chat={chat} /></div>;
}

/** True when the layout shows the given built-in view somewhere. */
export const hasView = (node, view) => (node?.split ? node.children.some((c) => hasView(c, view)) : node?.view === view);

/** Draws one pane of a checked layout; built-in views come from the IDE, kit and surface panes are drawn from the catalogue only. */
export function Pane({ node, views, pid }) {
  if (node.split) {
    return (
      <div className={`ou-ws-split ou-ws-${node.split}`}>
        {node.children.map((c, i) => <div key={i} className="ou-ws-cell" style={{ flex: `${node.sizes[i]} 1 0` }}><Pane node={c} views={views} pid={pid} /></div>)}
      </div>
    );
  }
  const head = node.title ? <div className="ou-ws-head">{node.title}</div> : null;
  if (node.view === 'kit') return <div className="ou-ws-pane">{head}<div className="ou-ws-scroll"><Drawn spec={node.part} zone="panel" /></div></div>;
  if (node.view === 'surface') return <div className="ou-ws-pane">{head}<div className="ou-ws-scroll"><SurfacePane id={node.spec} /></div></div>;
  if (node.view === 'agent') return <div className="ou-ws-pane">{head}<AgentPane pid={pid} /></div>;
  return <div className="ou-ws-pane">{head}{views[node.view] ?? null}</div>;
}
