import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Kbd } from '@astryxdesign/core/Kbd';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { createStore } from './store.js';

export const homeStore = createStore({ tick: 0 });

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const svg = (d) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const ICONS = {
  needs: 'M8 2.5a4 4 0 00-4 4v2.2L2.8 11h10.4L12 8.7V6.5a4 4 0 00-4-4zM6.6 13a1.5 1.5 0 002.8 0',
  working: 'M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M3.8 3.8l1.7 1.7M10.5 10.5l1.7 1.7M3.8 12.2l1.7-1.7M10.5 5.5l1.7-1.7',
  done: 'M3 8.5l3.2 3.2L13 4.8',
  files: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
};

// Tile anatomy follows Paperclip's metric tile: icon, big value, label, one-line breakdown.
function Tile({ icon, label, n, sub, hot }) {
  return (
    <div className={hot ? 'ou-tile ou-hot' : 'ou-tile'}>
      <span className="ou-tileicon">{svg(ICONS[icon])}</span>
      <b>{n}</b>
      <span className="ou-tilelabel">{label}</span>
      <span className="ou-tilesub">{sub}</span>
    </div>
  );
}

// The start box is the centred composer of OpenHands' home: text first, agent picker and Start in its footer.
function StartBox({ ready }) {
  const [task, setTask] = useState(ui.drafts['home-task'] || '');
  const [engine, setEngine] = useState(ui.drafts['home-engine'] || load('engine') || ready[0].id);
  const chosen = ready.some((e) => e.id === engine) ? engine : ready[0].id;
  const start = async () => {
    const text = task.trim();
    const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: chosen, ...(text ? { prompt: text } : {}) });
    if (!r.result) return;
    delete ui.drafts['home-task'];
    setTask('');
    save('engine', chosen);
    homeView.set('wall');
    await pick(r.result.session_id);
  };
  return (
    <div className="ou-composer" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } }}>
      <TextArea label="Task for a new agent" isLabelHidden rows={1} value={task} placeholder="What should an agent do? Leave it empty to just open one." onChange={(v) => { ui.drafts['home-task'] = v; setTask(v); }} />
      <div className="ou-composerfoot">
        <Selector label="Agent" isLabelHidden size="sm" variant="ghost" options={ready.map((e) => ({ value: e.id, label: e.id }))} value={chosen} onChange={(v) => { ui.drafts['home-engine'] = v; setEngine(v); }} />
        <span className="ou-composerhint"><Kbd keys="Ctrl+Enter" /></span>
        <Button variant="primary" size="sm" label="Start" onClick={start} />
      </div>
    </div>
  );
}

const tone = (state) => (state === 'waiting_for_you' ? 'ou-dot ou-dot-wait' : state === 'working' || state === 'starting' ? 'ou-dot ou-dot-work' : 'ou-dot');

// Agent cards follow Paperclip's live cards: identity row, the task, then what the agent last said in mono, with a quiet footer.
function AgentCard({ x }) {
  const files = changedFiles(x.id).length;
  return (
    <div className="ou-agent" data-action="pick" data-id={x.id} role="button" tabIndex={0}>
      <header><span className={tone(x.state)} /><b>{x.engine_id}</b><span className="ou-agentstate">{STATE_WORDS[x.state] || x.state}</span><span className="ou-agenttime">{ago(x.state_at)}</span></header>
      <p>{taskOf(x)}</p>
      <pre>{x.last_line || ' '}</pre>
      <footer><span>{files ? `${files} changed ${files === 1 ? 'file' : 'files'}` : 'No changes yet'}</span>{x.state === 'waiting_for_you' ? <Button size="sm" label="Answer" data-action="pick" data-id={x.id} /> : null}</footer>
    </div>
  );
}

export function Home() {
  homeStore.use();
  if (!homeView.shown()) return null;
  const s = ui.snap;
  const mine = s.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const waiting = waitingAll();
  const working = mine.filter((x) => x.state === 'working' || x.state === 'starting');
  const done = mine.filter((x) => x.state === 'done');
  const files = mine.reduce((n, x) => n + changedFiles(x.id).length, 0);
  const alerts = s.needs_you.filter((n) => !n.read_at && !isInfo(n));
  const recent = s.needs_you.filter((n) => n.kind === 'done' || n.kind === 'failed').slice(0, 6);
  const approvals = s.approvals || [];
  const away = (x) => (x.project_id === ui.projectId ? '' : `${(s.projects.find((p) => p.id === x.project_id) || {}).name || 'other project'} · `);
  const ready = s.engines.filter((e) => e.light !== 'red');
  const needs = waiting.length + approvals.length + alerts.length;
  const name = project().name;
  const asks = approvals.length + alerts.length > 0;
  return (
    <div className="ou-col ou-home">
      <header className="ou-pagehead ou-hero">
        <h1>{greeting()}</h1>
        <p>{mine.length ? `${mine.length} ${mine.length === 1 ? 'agent' : 'agents'} in ${name}` : `No agents running in ${name}`}</p>
      </header>
      {ready.length ? <StartBox ready={ready} /> : null}
      <div className="ou-tiles">
        <Tile icon="needs" label="Needs you" n={needs} sub={needs ? 'waiting on an answer' : 'nothing waiting'} hot={needs > 0} />
        <Tile icon="working" label="Working" n={working.length} sub={working.length ? 'running now' : 'none running'} />
        <Tile icon="done" label="Finished" n={done.length} sub={done.length ? 'ready to review' : 'nothing to review'} />
        <Tile icon="files" label="Changed files" n={files} sub={files ? 'not handed back yet' : 'no changes'} />
      </div>
      <h2>Agents</h2>
      {mine.length ? <div className="ou-cards">{mine.map((x) => <AgentCard key={x.id} x={x} />)}</div> : <EmptyState title="No agents yet" description="Start one with the box above." isCompact />}
      <div className={asks && recent.length ? 'ou-two' : undefined}>
        {asks ? (
          <section>
            <h2>Waiting on you</h2>
            <ul className="ou-list">
              {approvals.length ? (
                <li className="ou-irow ou-unread" data-action="sheet" role="button" tabIndex={0}>
                  <span className="ou-dot ou-dot-wait" /><span className="ou-ititle">{`${approvals.length} agent ${approvals.length === 1 ? 'action waits' : 'actions wait'} for a yes`}</span><span className="ou-imeta">Allow or refuse each one</span>
                  <span className="ou-actions"><Button size="sm" label="Review" data-action="sheet" /></span>
                </li>
              ) : null}
              {alerts.map((n) => (
                <li key={n.id} className="ou-irow ou-unread" data-action="inbox-open" data-id={n.id} role="button" tabIndex={0}>
                  <span className="ou-dot ou-dot-wait" /><span className="ou-ititle">{n.text}</span><span className="ou-imeta">{n.kind}</span>
                  <span className="ou-itime">{ago(n.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {recent.length ? (
          <section>
            <h2>Recent</h2>
            <ul className="ou-list">
              {recent.map((n) => (
                <li key={n.id} className="ou-irow" data-action="inbox-open" data-id={n.id} role="button" tabIndex={0}>
                  <span className={n.kind === 'failed' ? 'ou-dot ou-dot-bad' : 'ou-dot'} /><span className="ou-ititle">{n.text}</span>
                  <span className="ou-itime">{ago(n.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
