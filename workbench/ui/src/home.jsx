import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import { AutomationsPage } from './automations.jsx';
import { EngineMark } from './icons/index.js';
import { canMove, conceal, crossfade, reveal } from './motion.js';

export const homeStore = createStore({ tick: 0, open: [], selected: null });

export const openNewTask = () => {
  ui.homeSel = '';
  homeStore.set({ tick: homeStore.get().tick + 1 });
  if (typeof homeView !== 'undefined' && !homeView.shown()) homeView.set('home');
  const focus = () => document.querySelector('#home .ou-hm-task textarea')?.focus();
  focus();
  setTimeout(focus, 50);
};

function Drop({ open, className, children }) {
  const ref = useRef(null);
  const kept = useRef(children);
  const first = useRef(true);
  const [closing, setClosing] = useState(false);
  if (open) kept.current = children;
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el) return;
    if (open) { setClosing(false); reveal(el); } else { setClosing(true); conceal(el, () => setClosing(false)); }
  }, [open]);
  const shown = open ? children : closing ? kept.current : null;
  return <div ref={ref} className={className} hidden={!shown}>{shown}</div>;
}

function Swap({ k, children }) {
  const ref = useRef(null);
  const prev = useRef(k);
  const ghost = useRef(null);
  if (ref.current && prev.current !== k && canMove(ref.current)) ghost.current = ref.current.cloneNode(true);
  useLayoutEffect(() => {
    if (prev.current === k) return;
    prev.current = k;
    if (ref.current) crossfade(ref.current, ghost.current);
    ghost.current = null;
  }, [k]);
  return <div className="ou-hm-swap"><div ref={ref}>{children}</div></div>;
}

const chev = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ou-hm-chev"><path d="M5 3.5L8.5 7 5 10.5" /></svg>;
const tick = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 7.2l2.3 2.3 4.7-5" /></svg>;
const branchIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="4" cy="3" r="1.5" /><circle cx="4" cy="11" r="1.5" /><circle cx="10" cy="5" r="1.5" /><path d="M4 4.5v5M10 6.5c0 2-6 1.5-6 3" /></svg>;
const commitIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="2.2" /><path d="M1 7h3.8M9.2 7H13" /></svg>;
const filesIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 1.5h4.5l2.5 2.5v8.5h-7zM5.5 7h3M7 5.5v3M5.5 10h3" /></svg>;
const prIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="3.5" cy="3" r="1.5" /><circle cx="3.5" cy="11" r="1.5" /><circle cx="10.5" cy="11" r="1.5" /><path d="M3.5 4.5v5M10.5 9.5V5.5a1.5 1.5 0 0 0-1.5-1.5H7M8.5 2.5L7 4l1.5 1.5" /></svg>;

const nameOf = (x) => x.title || (x.prompt ? String(x.prompt).trim().split(/\r?\n/)[0].slice(0, 120) : '') || taskOf(x);
const STATE_WORD = { waiting_for_you: 'waiting', working: 'running', starting: 'starting', done: 'done', idle: 'idle', exited: 'exited', unknown: 'unknown' };
const DONE_STATES = ['done', 'exited', 'idle'];

const ic = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
const attachIcon = <svg {...ic}><path d="M11.5 6.5l-4.6 4.6a2.5 2.5 0 0 1-3.5-3.5l5-5a1.6 1.6 0 0 1 2.3 2.3L5.9 9.7a.7.7 0 0 1-1-1l4.3-4.3" /></svg>;
const slidersIcon = <svg {...ic}><path d="M2 4h6M10.5 4H12M2 10h1.5M6 10h6" /><circle cx="9" cy="4" r="1.4" /><circle cx="4.5" cy="10" r="1.4" /></svg>;
const sendIcon = <svg {...ic}><path d="M7 11.5v-9M3.5 6L7 2.5 10.5 6" /></svg>;
const hostIcon = <svg {...ic}><rect x="1.5" y="2" width="11" height="7.5" rx="1.2" /><path d="M5 12h4M7 9.5V12" /></svg>;
const editorIcon = <svg {...ic}><path d="M6 2.5H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8M8 2.5h3.5v3.5M6.5 7.5L11.5 2.5" /></svg>;
const folderSmall = <svg {...ic}><path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /></svg>;
const shieldSmall = <svg {...ic}><path d="M7 1.5l4.5 1.8v3.4c0 2.7-2 4.6-4.5 5.3-2.5-.7-4.5-2.6-4.5-5.3V3.3z" /></svg>;
const circle = <svg {...ic} className="ou-hm-cbox"><circle cx="7" cy="7" r="5" /></svg>;
const circleDone = <svg {...ic} className="ou-hm-cbox ou-hm-cdone"><circle cx="7" cy="7" r="5" /><path d="M4.8 7.2l1.6 1.6 2.8-3.1" /></svg>;

function StartBox({ ready }) {
  const [task, setTask] = useState(ui.drafts['home-task'] || '');
  const [engine, setEngine] = useState(ui.drafts['home-engine'] || load('engine') || ready[0].id);
  const chosen = ready.some((e) => e.id === engine) ? engine : ready[0].id;
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState('');
  const [approval, setApproval] = useState('default');
  const ref = useRef(null);

  const start = async () => {
    const text = task.trim();
    let target = ui.projectId;
    if (branch.trim()) {
      const wt = await rpc('worktree.create', { project_id: ui.projectId, branch: branch.trim() });
      if (!wt.result) return;
      const opened = await rpc('project.open', { path: wt.result.path });
      if (!opened.result) return;
      target = opened.result.project_id;
    }
    const r = await rpc('session.launch', { project_id: target, engine_id: chosen, ...(text ? { prompt: text } : {}), ...(model.trim() ? { model: model.trim() } : {}), ...(approval !== 'default' ? { approval } : {}) });
    if (!r.result) return;
    delete ui.drafts['home-task'];
    setTask('');
    save('engine', chosen);
    homeView.set('wall');
    setBranch('');
    if (target !== ui.projectId) { ui.pendingPick = r.result.session_id; switchProject(target); return; }
    await pick(r.result.session_id);
  };
  const edit = (v) => { ui.drafts['home-task'] = v; setTask(v); };
  return (
    <div className="ou-hm-composerwrap">
    <div ref={ref} className="ou-composer ou-hm-task" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } }}>
      <TextArea label="Task for a new agent" isLabelHidden rows={2} value={task} placeholder="Describe the task. @ files, / commands" onChange={edit} />
      {more ? (
        <div className="ou-composerfoot ou-hm-opts">
          <TextInput size="sm" width={240} label="Branch for a new worktree" isLabelHidden placeholder="Branch (agent gets its own worktree)" value={branch} onChange={setBranch} />
          <TextInput size="sm" width={180} label="Model" isLabelHidden placeholder="Model (agent default)" value={model} onChange={setModel} />
        </div>
      ) : null}
      <div className="ou-hm-cbar">
        <IconButton size="sm" variant="ghost" icon={attachIcon} label="Mention a file (@)" onClick={() => { edit(task + (task && !task.endsWith(' ') ? ' @' : '@')); ref.current?.querySelector('textarea')?.focus(); }} />
        <IconButton size="sm" variant="ghost" icon={slidersIcon} label={more ? 'Fewer options' : 'Options'} aria-expanded={more} aria-pressed={more} onClick={() => setMore(!more)} />
        <span className="ou-hm-cgap" />
        <span className="ou-hm-engine"><EngineMark id={chosen} size={16} title={chosen} />
          <Selector label="Agent" isLabelHidden size="sm" variant="ghost" options={ready.map((e) => ({ value: e.id, label: e.id }))} value={chosen} onChange={(v) => { ui.drafts['home-engine'] = v; setEngine(v); }} />
        </span>
        <IconButton size="sm" variant="primary" icon={sendIcon} label="Start" tooltip="Start (Ctrl+Enter)" className="ou-hm-send" data-action="home-start" data-engine={chosen} onClick={start} />
      </div>
    </div>
    <div className="ou-hm-chips">
      <span className="ou-hm-chip">{folderSmall}<Selector label="Project" isLabelHidden size="sm" variant="ghost" value={ui.projectId || ''} onChange={(v) => { if (v && v !== ui.projectId) switchProject(v); }}
        options={(ui.snap?.projects || []).map((p) => ({ value: p.id, label: p.name }))} /></span>
      <span className="ou-hm-chip">{shieldSmall}<Selector label="Approval" isLabelHidden size="sm" variant="ghost" value={approval} onChange={setApproval} options={[
        { value: 'default', label: 'Approval as in Settings' },
        { value: 'ask', label: 'Ask first' },
        { value: 'edits', label: 'Edits allowed' },
        { value: 'contained', label: 'Auto' },
      ]} /></span>
    </div>
    </div>
  );
}

const stepsOf = (x) => (x.steps && x.steps.total ? { done: x.steps.done, total: x.steps.total, items: x.steps.items || [] } : null);
const isWorking = (k) => k.state === 'working' || k.state === 'starting';

const statusOf = (k) => (k.state === 'waiting_for_you' ? 'waiting'
  : isWorking(k) ? 'running'
    : k.state === 'failed' || /fail/.test(String(k.outcome || '')) ? 'failed'
      : k.state === 'exited' && /cancel/.test(String(k.outcome || '')) ? 'stopped'
        : DONE_STATES.includes(k.state) ? 'completed' : 'running');
const STATUS_WORD = { running: 'Running', waiting: 'Waiting', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' };
export const progressOf = (k) => ({ running: 'working', waiting: 'waiting', completed: 'done', failed: 'failed', stopped: 'done' })[statusOf(k)];
const settled = (k) => ['completed', 'failed', 'stopped'].includes(statusOf(k));

// From t3code (MIT), apps/web/src/components/chat/AgentElapsed.tsx
function formatElapsedSeconds(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const elapsedOf = (list) => {
  const starts = list.map((k) => Date.parse(k.started_at || '')).filter((t) => !Number.isNaN(t));
  if (!starts.length) return '';
  const ends = list.every(settled) ? list.map((k) => Date.parse(k.state_at || '')).filter((t) => !Number.isNaN(t)) : [];
  return formatElapsedSeconds(((ends.length ? Math.max(...ends) : Date.now()) - Math.min(...starts)) / 1000);
};

// From t3code (MIT), packages/client-runtime/src/state/subagentDisplay.ts (waiting counted on its own)
export function countSubagentStatuses(statuses) {
  const counts = { working: 0, waiting: 0, done: 0, failed: 0, stopped: 0 };
  for (const status of statuses) {
    if (status === 'running') counts.working += 1;
    else if (status === 'waiting') counts.waiting += 1;
    else if (status === 'completed') counts.done += 1;
    else if (status === 'failed') counts.failed += 1;
    else counts.stopped += 1;
  }
  return Object.keys(counts).filter((key) => counts[key] > 0).map((key) => [key, counts[key]]);
}
export const summarizeSubagentStatuses = (statuses) => countSubagentStatuses(statuses).map(([key, n]) => `${n} ${key}`).join(' · ');

function StatusCounts({ statuses }) {
  const parts = countSubagentStatuses(statuses);
  return <span className="ou-hm-tsum">{parts.map(([key, n], i) => <span key={key}>{i ? ' · ' : ''}<span className={`ou-hm-c-${key}`}>{n} {key}</span></span>)}</span>;
}

const detailOf = (k) => String((settled(k) ? k.reason || k.last_line : k.last_line || k.reason) || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const tipOf = (k) => [nameOf(k), [k.model || k.engine_id, STATUS_WORD[statusOf(k)], elapsedOf([k])].filter(Boolean).join(' · '), detailOf(k)].filter(Boolean).join('\n');

const press = (fn) => ({
  role: 'button', tabIndex: 0,
  onClick: (e) => { e.stopPropagation(); fn(); },
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } },
});

function Avatar({ k, status = true }) {
  return (
    <span className="ou-hm-av" aria-hidden="true">
      <EngineMark id={k.engine_id} size={14} title={k.engine_id} />
      {status ? <span className={`ou-hm-avdot ou-hm-st-${statusOf(k)}`} /> : null}
    </span>
  );
}

function Dot({ k }) {
  const s = statusOf(k);
  return <span className={`ou-hm-dot ou-hm-st-${s}`} role="img" aria-label={STATUS_WORD[s]} title={STATUS_WORD[s]} />;
}

function Steps({ st }) {
  return (
    <ol className="ou-hm-check">
      {st.items.map((it, i) => <li key={i} data-done={it.done ? 'true' : 'false'}>{it.done ? circleDone : circle}<span className="ou-hm-ctext">{it.text}</span></li>)}
    </ol>
  );
}

function SlimRow({ k, lead, openList, toggle }) {
  const st = stepsOf(k);
  const key = `steps:${k.id}`;
  const open = Boolean(st) && openList.includes(key);
  const doing = detailOf(k);
  return (
    <li className={`ou-hm-slim${lead ? ' ou-hm-lead' : ''}`} data-id={k.id} data-progress={progressOf(k)}>
      <div className="ou-hm-slimrow" title={tipOf(k)} aria-expanded={st ? open : undefined} {...(st ? press(() => toggle(key)) : {})}>
        <Avatar k={k} />
        <span className="ou-hm-slimtext">
          <span className="ou-hm-slimname">{nameOf(k)}{lead ? <span className="ou-hm-role">orchestrator</span> : null}{st ? <span className="ou-hm-slimsteps">{st.done}/{st.total}</span> : null}</span>
          <span className="ou-hm-slimsub">{k.model ? <span className="ou-hm-model">{k.model}</span> : null}{doing ? <span className={statusOf(k) === 'failed' ? 'ou-hm-bad' : ''}>{doing}</span> : null}</span>
        </span>
      </div>
      {st ? <Drop open={open} className="ou-hm-drop ou-hm-slimsteps-list"><Steps st={st} /></Drop> : null}
    </li>
  );
}

function Trigger({ x, kids, open, toggle }) {
  const statuses = kids.map(statusOf);
  const working = statuses.filter((s) => s === 'running' || s === 'waiting').length;
  const label = `${kids.length} ${kids.length === 1 ? 'subagent' : 'subagents'}`;
  const summary = summarizeSubagentStatuses(statuses);
  return (
    <div className="ou-hm-trigger" data-active={working || open ? 'true' : 'false'} aria-expanded={open} aria-label={label} aria-description={summary} {...press(() => toggle(x.id))}>
      <span className="ou-hm-stack" aria-hidden="true">
        {kids.slice(0, 3).map((k) => <Avatar key={k.id} k={k} status={false} />)}
        {kids.length > 3 ? <span className="ou-hm-av ou-hm-more">+{kids.length - 3}</span> : null}
      </span>
      <span className="ou-hm-ttext">
        <span className="ou-hm-tlabel">{label}</span>
        <StatusCounts statuses={statuses} />
      </span>
      <span className="ou-hm-elapsed">{elapsedOf(kids)}</span>
      <span className="ou-hm-chevdown" data-open={open ? 'true' : 'false'}>{chev}</span>
    </div>
  );
}

function TaskView({ x, kids, openList, toggle }) {
  const [answer, setAnswer] = useState('');
  const here = !x.project_id || x.project_id === ui.projectId;
  const send = async () => {
    const t = answer.trim();
    if (!t || !here) return;
    try { await troop.termInput(x.id, t + '\r'); setAnswer(''); toast(`Sent to ${x.engine_id}`); } catch (err) { toast(String(err?.message || err), true); }
  };
  const open = openList.includes(x.id);
  const st = stepsOf(x);
  const workKey = `work:${x.id}`;
  const workOpen = openList.includes(workKey);
  const pending = kids.filter((k) => !settled(k));
  const proj = (ui.snap?.projects || []).find((p) => p.id === (x.project_id || ui.projectId))?.name || 'No project';
  const branch = ui.snap?.git?.[x.id]?.branch || x.branch || null;
  const s = statusOf(x);
  const stop = async () => {
    try { await troop.termInput(x.id, '\u001b'); toast(`Asked ${x.engine_id} to stop`); } catch (err) { toast(String(err?.message || err), true); }
  };
  return (
    <article className="ou-hm-taskview" data-id={x.id} data-state={x.state}>
      <nav className="ou-hm-crumb" aria-label="Task">
        <span className="ou-hm-crumbproj">{proj}</span>
        <span className="ou-hm-crumbsep">/</span>
        <span className="ou-hm-crumbtitle">{nameOf(x)}</span>
        {branch ? <span className="ou-hm-crumbbranch">{branchIcon}{branch}</span> : null}
      </nav>
      <div className="ou-hm-thread">
        <div className="ou-hm-worked" aria-expanded={st ? workOpen : undefined} {...(st ? press(() => toggle(workKey)) : {})}>
          <span className={`ou-hm-dot ou-hm-st-${s}`} />
          <span>{settled(x) ? 'Worked for' : s === 'waiting' ? 'Waiting for you after' : 'Working for'} {elapsedOf([x])}</span>
          {st ? <span className="ou-hm-chevbox" data-open={workOpen ? 'true' : 'false'}>{chev}</span> : null}
        </div>
        {st ? <Drop open={workOpen} className="ou-hm-drop ou-hm-worklist"><Steps st={st} /></Drop> : null}
        {kids.length ? (
          <div className="ou-hm-subs">
            <Trigger x={x} kids={kids} open={open} toggle={toggle} />
            <Drop open={open} className="ou-hm-drop">
              <ul className="ou-hm-slimlist">
                <SlimRow k={x} lead openList={openList} toggle={toggle} />
                {kids.map((k) => <SlimRow key={k.id} k={k} openList={openList} toggle={toggle} />)}
              </ul>
            </Drop>
          </div>
        ) : null}
        {x.last_line || x.reason ? <p className="ou-hm-latest">{x.last_line || x.reason}</p> : null}
        {s === 'waiting' ? (
          <div className="ou-hm-ask"><TextInput size="sm" label="Answer" isLabelHidden placeholder={here ? `Answer ${nameOf(x)}, Enter sends` : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} width="100%" isDisabled={!here} /></div>
        ) : null}
        {pending.length ? (
          <div className="ou-hm-waiton">
            <span className="ou-hm-waitspin" aria-hidden="true" />
            <span className="ou-hm-waitlabel">Waiting on {pending.length} {pending.length === 1 ? 'subagent' : 'subagents'}</span>
            <span className="ou-hm-waitnames">{pending.map(nameOf).join(', ')}</span>
            {isWorking(x) || pending.some(isWorking) ? <button type="button" className="ou-hm-stop" title="Interrupt the orchestrator (sends Esc)" onClick={stop}>Stop</button> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

const startIcons = {
  folder: <svg {...ic}><path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M7 6.5v3M5.5 8h3" /></svg>,
  wall: <svg {...ic}><rect x="1.5" y="1.5" width="11" height="11" rx="2" /><path d="M7 1.5v11M1.5 7h11" /></svg>,
  clock: <svg {...ic}><circle cx="7" cy="7" r="5.25" /><path d="M7 4.2V7l1.8 1.2" /></svg>,
  book: <svg {...ic}><path d="M2.5 2h6.5a2 2 0 0 1 2 2v8H4.5a2 2 0 0 1-2-2zM2.5 10a2 2 0 0 1 2-2H11M5 4.5h3.5" /></svg>,
};

function StartState({ composer }) {
  const items = [
    ['folder', 'Import projects', 'Add a folder from this computer', null, 'open-folder'],
    ['clock', 'Automations', 'Agents that start on a schedule', () => homeView.set('automations')],
    ['wall', 'Open the Wall', 'Every agent terminal side by side', () => homeView.set('wall')],
    ['book', 'Learn Ouros', 'Shortcuts and commands', () => globalThis.paletteView?.open?.()],
  ];
  return (
    <div className="ou-hm-start">
      <h1 className="ou-hm-hello">Pick up where your agents left off</h1>
      <ul className="ou-hm-startlist">
        {items.map(([icon, title, sub, run, action]) => (
          <li key={title}>
            <button type="button" className="ou-hm-startitem" data-action={action} onClick={run || undefined}>
              <span className="ou-hm-starticon">{startIcons[icon]}</span>
              <span className="ou-hm-starttext"><b>{title}</b><span>{sub}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {composer}
    </div>
  );
}

const openOnWall = (x) => {
  homeView.set('wall');
  if (x.project_id && x.project_id !== ui.projectId) { ui.pendingPick = x.id; switchProject(x.project_id); return; }
  void pick(x.id);
};

function PanelSection({ title, heading = false, children }) {
  return (
    <section className="ou-hm-psec" aria-label={title}>
      {heading ? <h3 className="ou-hm-psech">{title}</h3> : null}
      <div className="ou-hm-prows">{children}</div>
    </section>
  );
}

function PanelRow({ icon, label, value, onClick, chevron = false, mono = false, children }) {
  return (
    <div className={`ou-hm-prow${onClick ? ' ou-hm-pclick' : ''}`} {...(onClick ? press(onClick) : {})}>
      <span className="ou-hm-picon">{icon}</span>
      <span className={`ou-hm-plabel${mono ? ' ou-hm-mono' : ''}`}>{label}</span>
      {value != null ? <span className="ou-hm-pvalue">{value}</span> : null}
      {children}
      {chevron ? <span className="ou-hm-picon">{chev}</span> : null}
    </div>
  );
}

function RailCard({ sel, kids }) {
  const [merging, setMerging] = useState(false);
  const g = (sel && ui.snap?.git?.[sel.id]) || {};
  const branch = sel ? g.branch || sel.branch || null : null;
  const pr = g.pr || null;
  const host = sel ? ((g.root || sel.cwd) ? (g.root || sel.cwd).split(/[/\\]/).filter(Boolean).pop() : (ui.snap?.projects || []).find((p) => p.id === sel.project_id)?.name || 'This computer') : '';
  return (
    <div className="ou-hm-card">
      {sel ? (
        <Swap k={sel.id}>
          <PanelSection title="Workspace">
            <PanelRow icon={hostIcon} label={host} />
            <PanelRow icon={editorIcon} label="Open on Wall" chevron onClick={() => openOnWall(sel)} />
          </PanelSection>
          {branch ? (
            <PanelSection title="Version control">
              <PanelRow icon={branchIcon} label={branch} mono />
              {g.commit ? <PanelRow icon={commitIcon} label="Commit" value={<span className="ou-hm-mono">{g.commit}</span>} /> : null}
              <PanelRow icon={filesIcon} label="Changes" value={<span className="ou-hm-mono"><b className="ou-hm-add">+{g.added || 0}</b> <b className="ou-hm-del">-{g.deleted || 0}</b></span>} />
              {pr ? (
                <PanelRow icon={prIcon} label={`PR #${pr.number}`} onClick={pr.url && typeof openTermLink === 'function' ? () => openTermLink(pr.url) : undefined}
                  value={<span className={`ou-hm-checks ou-hm-ck-${pr.checks || 'none'}`}>{[pr.checks ? `checks ${pr.checks}` : null, String(pr.state || '').toLowerCase()].filter(Boolean).join(' · ')}</span>}>
                  {String(pr.state).toUpperCase() === 'OPEN' ? <Button size="sm" variant="ghost" label="Merge" onClick={(e) => { e?.stopPropagation?.(); setMerging(true); }} /> : null}
                </PanelRow>
              ) : null}
            </PanelSection>
          ) : null}
          {kids.length ? (
            <PanelSection title={`Lineage · ${kids.length} ${kids.length === 1 ? 'agent' : 'agents'}`} heading>
              <ul className="ou-hm-members ou-hm-lin">
                {kids.map((k) => (
                  <li key={k.id} className="ou-hm-prow ou-hm-pclick" data-progress={progressOf(k)} title={tipOf(k)} {...press(() => openOnWall(k))}>
                    <span className="ou-hm-bare"><EngineMark id={k.engine_id} size={16} title={k.engine_id} /><span className={`ou-hm-avdot ou-hm-st-${statusOf(k)}`} /></span>
                    <span className="ou-hm-plabel">{nameOf(k)}</span>
                    <span className="ou-hm-pvalue ou-hm-small">{elapsedOf([k])}</span>
                  </li>
                ))}
              </ul>
            </PanelSection>
          ) : null}
        </Swap>
      ) : null}
      {merging && pr ? (
        <AlertDialog isOpen onOpenChange={(o) => { if (!o) setMerging(false); }} title={`Merge PR #${pr.number}?`}
          description={`This merges ${branch || 'the branch'} on GitHub. It cannot be undone from Ouros.`} actionLabel="Merge"
          onAction={async () => {
            setMerging(false);
            const r = await rpc('gh.merge', { session_id: sel.id });
            if (r && r.result) toast(`Merged PR #${pr.number}`); else toast((r && r.error && (r.error.message || r.error)) || 'Could not merge', true);
          }} />
      ) : null}
    </div>
  );
}

export function Home() {
  const { open = [] } = homeStore.use();
  const selected = ui.homeSel;
  useEffect(() => { if (homeView.shown()) homeStore.set({ open: [] }); }, [homeView.shown()]);
  if (ui.view === 'automations' && project()) return <AutomationsPage />;
  if (!homeView.shown()) return null;
  const s = ui.snap || {};
  const live = s.live || [];
  const tree = s.tree_rows || {};
  const known = [...live, ...(s.sessions || []).filter((x) => !live.some((l) => l.id === x.id))];
  const all = [...known.map((x) => (tree[x.id] ? { ...tree[x.id], ...Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)) } : x)),
    ...Object.values(tree).filter((r) => !known.some((x) => x.id === r.id))].filter((x) => !ui.pendingHide?.has(x.id));
  const byId = new Map(all.map((x) => [x.id, x]));
  const kidsOf = (id) => all.filter((y) => y.parent_id === id);
  const newest = (a, b) => String(b.state_at || b.started_at || '').localeCompare(String(a.state_at || a.started_at || ''));
  const waiting = waitingAll().slice().sort((a, b) => String(a.state_at || '').localeCompare(String(b.state_at || '')));
  const working = all.filter((x) => x.state !== 'exited' && isWorking(x)).sort(newest);
  const fallback = selected === '' ? null : waiting[0]?.id || working[0]?.id || null;
  const picked = (selected && byId.get(selected)) || (fallback && (byId.get(fallback) || waiting.find((w) => w.id === fallback))) || null;
  const task = picked?.parent_id && byId.get(picked.parent_id) ? byId.get(picked.parent_id) : picked;
  const openList = task && picked && task !== picked ? [...open, task.id] : open;
  const toggle = (id) => {
    const cur = homeStore.get().open || [];
    homeStore.set({ open: cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id] });
  };
  if (task && !selected) ui.homeSel = task.id;
  const ready = (s.engines || []).filter((e) => e.light !== 'red');
  const composer = ready.length ? <StartBox ready={ready} /> : <EmptyState title="No agent is ready. Check Add-ons." isCompact />;
  return (
    <div className={`ou-home ou-hm${task ? '' : ' ou-hm-solo'}`}>
      <div className="ou-hm-main">
        {task ? (
          <>
            <div className="ou-hm-center"><Swap k={task.id}><TaskView x={task} kids={kidsOf(task.id)} openList={openList} toggle={toggle} /></Swap></div>
            <div className="ou-hm-dock">{composer}</div>
          </>
        ) : <StartState composer={composer} />}
      </div>
      {task ? <aside className="ou-hm-rail"><RailCard sel={task} kids={kidsOf(task.id)} /></aside> : null}
    </div>
  );
}
