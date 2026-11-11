import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import { Usage } from './usage.jsx';
import { Audit } from './audit.jsx';
import { HomeAutomations } from './automations.jsx';
import { EngineMark } from './icons/index.js';
import { canMove, conceal, crossfade, reveal } from './motion.js';

export const homeStore = createStore({ tick: 0, open: [], selected: null, usage: false });

export const openNewTask = () => {
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

const warnIcon = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="ou-dash-usagewarn-icon">
    <path d="M8 2.5l6 11H2zM8 6.5v3.5M8 12v.5" />
  </svg>
);

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`.replace('.0M', 'M');
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`.replace('.0k', 'k');
  return String(v);
}

function formatDay(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
  return String(iso);
}

function formatUntil(resets_at) {
  if (!resets_at) return '';
  const diffMs = new Date(resets_at).getTime() - Date.now();
  if (isNaN(diffMs) || diffMs <= 0) return 'in 0m';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

const nameOf = (x) => x.title || (x.prompt ? String(x.prompt).trim().split(/\r?\n/)[0].slice(0, 120) : '') || taskOf(x);
const STATE_WORD = { waiting_for_you: 'waiting', working: 'running', starting: 'starting', done: 'done', idle: 'idle', exited: 'exited', unknown: 'unknown' };
const DONE_STATES = ['done', 'exited', 'idle'];

function UsageWarn({ limit }) {
  if (!limit) return null;
  const rel = formatUntil(limit.resets_at);
  const text = `${limit.provider} has used ${Math.round(limit.used_pct)}% of its ${limit.window} window${rel ? `, resets ${rel}` : ''}`;
  return <div className="ou-dash-usagewarn">{warnIcon}<span>{text}</span></div>;
}

const ic = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
const attachIcon = <svg {...ic}><path d="M11.5 6.5l-4.6 4.6a2.5 2.5 0 0 1-3.5-3.5l5-5a1.6 1.6 0 0 1 2.3 2.3L5.9 9.7a.7.7 0 0 1-1-1l4.3-4.3" /></svg>;
const slidersIcon = <svg {...ic}><path d="M2 4h6M10.5 4H12M2 10h1.5M6 10h6" /><circle cx="9" cy="4" r="1.4" /><circle cx="4.5" cy="10" r="1.4" /></svg>;
const sendIcon = <svg {...ic}><path d="M7 11.5v-9M3.5 6L7 2.5 10.5 6" /></svg>;
const hostIcon = <svg {...ic}><rect x="1.5" y="2" width="11" height="7.5" rx="1.2" /><path d="M5 12h4M7 9.5V12" /></svg>;
const editorIcon = <svg {...ic}><path d="M6 2.5H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8M8 2.5h3.5v3.5M6.5 7.5L11.5 2.5" /></svg>;
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
    <div ref={ref} className="ou-composer ou-hm-task" onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } }}>
      <TextArea label="Task for a new agent" isLabelHidden rows={2} value={task} placeholder="Ask anything. @ files, / commands" onChange={edit} />
      {more ? (
        <div className="ou-composerfoot ou-hm-opts">
          <TextInput size="sm" width={240} label="Branch for a new worktree" isLabelHidden placeholder="Branch (agent gets its own worktree)" value={branch} onChange={setBranch} />
          <TextInput size="sm" width={180} label="Model" isLabelHidden placeholder="Model (agent default)" value={model} onChange={setModel} />
          <Selector label="Approval" isLabelHidden size="sm" variant="ghost" value={approval} onChange={setApproval} options={[
            { value: 'default', label: 'Approval: as in Settings' },
            { value: 'ask', label: 'Approval: ask before each tool call' },
            { value: 'edits', label: 'Approval: file edits allowed' },
            { value: 'contained', label: 'Approval: auto' },
          ]} />
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

// From t3code (MIT), packages/client-runtime/src/state/subagentDisplay.ts
export function summarizeSubagentStatuses(statuses) {
  const counts = { working: 0, done: 0, failed: 0, stopped: 0 };
  for (const status of statuses) {
    if (status === 'running' || status === 'waiting') counts.working += 1;
    else if (status === 'completed') counts.done += 1;
    else if (status === 'failed') counts.failed += 1;
    else counts.stopped += 1;
  }
  return Object.keys(counts).filter((key) => counts[key] > 0).map((key) => `${counts[key]} ${key}`).join(' · ');
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

function MemberRow({ k, openList, toggle }) {
  const st = stepsOf(k);
  const key = `steps:${k.id}`;
  const open = Boolean(st) && openList.includes(key);
  const s = statusOf(k);
  const detail = st && !settled(k) ? `${st.done}/${st.total} steps${detailOf(k) ? ` · ${detailOf(k)}` : ''}` : detailOf(k);
  return (
    <li className="ou-hm-member" data-id={k.id} data-progress={progressOf(k)}>
      <div className="ou-hm-mrow" title={tipOf(k)} aria-label={st ? `${open ? 'Hide' : 'Show'} steps for ${nameOf(k)}` : `Open ${nameOf(k)}`} aria-description={STATUS_WORD[s]}
        aria-expanded={st ? open : undefined} {...press(() => (st ? toggle(key) : openOnWall(k)))}>
        <Avatar k={k} />
        <span className="ou-hm-mtext">
          <span className="ou-hm-mtitle">{nameOf(k)}</span>
          {detail ? <span className={`ou-hm-mdetail${s === 'failed' ? ' ou-hm-bad' : ''}`}>{detail}</span> : null}
        </span>
        {k.model ? <span className="ou-hm-model">{k.model}</span> : null}
        <span className="ou-hm-elapsed">{elapsedOf([k])}</span>
        <span className="ou-hm-chevbox" data-open={open ? 'true' : 'false'}>{chev}</span>
      </div>
      {st ? <Drop open={open} className="ou-hm-drop ou-hm-msteps"><Steps st={st} /></Drop> : null}
    </li>
  );
}

const workflowIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="4" height="4" rx="1" /><rect x="8.5" y="8.5" width="4" height="4" rx="1" /><path d="M3.5 5.5v2a2 2 0 0 0 2 2h3" /></svg>;

function AgentRow({ x, kids, openList, selected, toggle, select }) {
  const open = openList.includes(x.id);
  const st = stepsOf(x);
  const group = kids.length ? kids : [x];
  const statuses = group.map(statusOf);
  const active = statuses.some((s) => s === 'running' || s === 'waiting');
  const failed = statuses.includes('failed');
  const label = kids.length ? `${kids.length} ${kids.length === 1 ? 'subagent' : 'subagents'}` : STATUS_WORD[statusOf(x)];
  const summary = kids.length ? summarizeSubagentStatuses(statuses) : st ? `${st.done}/${st.total} steps` : (x.model || x.engine_id);
  const all = [x, ...kids];
  const agents = `${all.length} ${all.length === 1 ? 'agent' : 'agents'} · ${summarizeSubagentStatuses(all.map(statusOf))}`;
  const flip = () => { select(x.id); toggle(x.id); };
  return (
    <li className={`ou-hm-agent${selected ? ' ou-hm-sel' : ''}`} data-id={x.id} data-state={x.state}>
      <div className="ou-hm-title">{nameOf(x)}</div>
      <div className="ou-hm-trigger" data-active={active || open ? 'true' : 'false'} aria-expanded={open} aria-label={label} aria-description={summary} {...press(flip)}>
        <span className="ou-hm-stack" aria-hidden="true">
          {group.slice(0, 3).map((k) => <Avatar key={k.id} k={k} status={group.length === 1} />)}
          {group.length > 3 ? <span className="ou-hm-av ou-hm-more">+{group.length - 3}</span> : null}
        </span>
        <span className="ou-hm-ttext">
          <span className={`ou-hm-tlabel${statusOf(x) === 'waiting' && !kids.length ? ' ou-hm-st-waiting-text' : ''}`}>{label}</span>
          <span className={`ou-hm-tsum${active ? ' ou-hm-info' : failed ? ' ou-hm-bad' : ''}`}>{summary}</span>
        </span>
        <span className="ou-hm-elapsed">{elapsedOf(group)}</span>
        <span className="ou-hm-chevdown" data-open={open ? 'true' : 'false'}>{chev}</span>
      </div>
      <Drop open={open} className="ou-hm-drop">
        <div className="ou-hm-panelbox">
          <section className="ou-hm-opening" aria-label={`Orchestrator: ${nameOf(x)}`}>
            <header className="ou-hm-ohead">
              <span className="ou-hm-oicon">{workflowIcon}</span>
              <span className="ou-hm-ohtext">
                <span className="ou-hm-olabel">Orchestrator</span>
                <span className="ou-hm-otitle">{nameOf(x)}</span>
                <span className="ou-hm-odesc"><Avatar k={x} />{x.model ? <span className="ou-hm-model">{x.model}</span> : null}{detailOf(x) ? <span>{detailOf(x)}</span> : null}</span>
              </span>
              <span className="ou-hm-oagents">{agents}</span>
            </header>
            {st ? (
              <section aria-label="Orchestrator steps">
                <h4 className="ou-hm-phase"><span>Steps</span><span>{st.done}/{st.total}</span></h4>
                <Steps st={st} />
              </section>
            ) : null}
            {kids.length ? (
              <section aria-label="Subagents">
                <h4 className="ou-hm-phase"><span>Subagents</span><span>{kids.filter(settled).length}/{kids.length}</span></h4>
                <ul className="ou-hm-members">{kids.map((k) => <MemberRow key={k.id} k={k} openList={openList} toggle={toggle} />)}</ul>
              </section>
            ) : null}
          </section>
        </div>
      </Drop>
    </li>
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

function RailCard({ waiting, approvals, alerts, sel, kids, select, selId }) {
  const [answer, setAnswer] = useState('');
  const [merging, setMerging] = useState(false);
  const g = (sel && ui.snap?.git?.[sel.id]) || {};
  const branch = sel ? g.branch || sel.branch || null : null;
  const pr = g.pr || null;
  const here = sel && (!sel.project_id || sel.project_id === ui.projectId);
  const host = sel ? ((g.root || sel.cwd) ? (g.root || sel.cwd).split(/[/\\]/).filter(Boolean).pop() : (ui.snap?.projects || []).find((p) => p.id === sel.project_id)?.name || 'This computer') : '';
  const send = async () => {
    const t = answer.trim();
    if (!t || !here) return;
    try { await troop.termInput(sel.id, t + '\r'); setAnswer(''); toast(`Sent to ${sel.engine_id}`); } catch (err) { toast(String(err?.message || err), true); }
  };
  const need = waiting.length + approvals.length + alerts.length;
  const running = kids.filter((k) => !settled(k)).length;
  return (
    <div className="ou-hm-card">
      {need ? (
        <PanelSection title={`Needs you · ${need}`} heading>
          {waiting.map((w) => (
            <div key={w.id} className={`ou-hm-prow ou-hm-pclick ou-hm-need${w.id === selId ? ' ou-hm-on' : ''}`} data-id={w.id} title={tipOf(w)} {...press(() => select(w.id))}>
              <Avatar k={w} />
              <span className="ou-hm-mtext"><span className="ou-hm-mtitle">{nameOf(w)}</span><span className="ou-hm-mdetail">{w.reason || w.last_line || 'asked a question'}</span></span>
            </div>
          ))}
          {approvals.length ? <div className="ou-hm-prow ou-hm-pclick" data-action="sheet" role="button" tabIndex={0}><span className="ou-hm-plabel">{approvals.length} {approvals.length === 1 ? 'action waits' : 'actions wait'} for a yes</span><span className="ou-hm-picon">{chev}</span></div> : null}
          {alerts.map((n) => <div key={n.id} className="ou-hm-prow ou-hm-pclick" data-action="inbox-open" data-id={n.id} role="button" tabIndex={0}><span className="ou-hm-plabel">{n.text}</span><span className="ou-hm-pvalue">{ago(n.at)}</span></div>)}
          {sel && sel.state === 'waiting_for_you' ? (
            <div className="ou-hm-ask"><TextInput size="sm" label="Answer" isLabelHidden placeholder={here ? `Answer ${nameOf(sel)}, Enter sends` : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} width="100%" isDisabled={!here} /></div>
          ) : null}
        </PanelSection>
      ) : null}
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
            <PanelSection title={`Lineage · ${running} running`} heading>
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
      {!need && !sel ? <PanelSection title="Quiet"><div className="ou-hm-prow"><span className="ou-hm-plabel ou-hm-mutedtext">Nothing needs you.</span></div></PanelSection> : null}
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

function ChartBox({ title, sub, children }) {
  return (
    <div className="ou-dash-chart-box">
      <div className="ou-dash-chart-head">
        <span className="ou-dash-chart-title">{title}</span>
        <span className="ou-dash-chart-sub">{sub}</span>
      </div>
      <div className="ou-dash-chart-body">
        {children}
      </div>
    </div>
  );
}

function ChartDates({ days }) {
  if (!days || !days.length) return <div className="ou-dash-chart-dates" aria-hidden="true"><span>&nbsp;</span></div>;
  const first = days[0]?.day;
  const mid = days[Math.floor(days.length / 2)]?.day;
  const last = days[days.length - 1]?.day;
  return (
    <div className="ou-dash-chart-dates">
      <span>{formatDay(first)}</span>
      <span>{formatDay(mid)}</span>
      <span>{formatDay(last)}</span>
    </div>
  );
}

function ChartRuns({ data, loading, error }) {
  if (loading) return <ChartBox title="Runs by outcome" sub="Last 14 days"><div className="ou-dash-chart-empty">Loading.</div></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Runs by outcome" sub="Last 14 days"><div className="ou-dash-chart-empty">No data yet.</div></ChartBox>;
  const days = data.days;
  const max = Math.max(1, ...days.map((d) => (d.succeeded || 0) + (d.failed || 0) + (d.unchecked || 0)));
  return (
    <ChartBox title="Runs by outcome" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {days.map((d, i) => {
          const s = d.succeeded || 0;
          const f = d.failed || 0;
          const u = d.unchecked || 0;
          const total = s + f + u;
          const heightPct = Math.round((total / max) * 100);
          if (total === 0) {
            return (
              <div key={d.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const uPct = (u / total) * 100;
          const fPct = (f / total) * 100;
          const sPct = (s / total) * 100;
          return (
            <div key={d.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                {u > 0 ? <rect x="0" y="0" width="10" height={uPct} fill="var(--st-other)" /> : null}
                {f > 0 ? <rect x="0" y={uPct} width="10" height={fPct} fill="var(--st-bad)" /> : null}
                {s > 0 ? <rect x="0" y={uPct + fPct} width="10" height={sPct} fill="var(--st-ok)" /> : null}
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-ok)' }} />Succeeded</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-bad)' }} />Failed</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-other)' }} />Unchecked</span>
      </div>
    </ChartBox>
  );
}

const ENGINE_COLORS = ['var(--st-run)', 'var(--st-ok)', 'var(--st-wait)', 'var(--st-other)'];

function ChartTokens({ data, loading, error }) {
  if (loading) return <ChartBox title="Tokens and cost by engine" sub="This week"><div className="ou-dash-chart-empty">Loading.</div></ChartBox>;
  if (error || !data) return <ChartBox title="Tokens and cost by engine" sub="This week"><div className="ou-dash-chart-empty">No data yet.</div></ChartBox>;
  const raw = data.by_agent || [];
  const map = new Map();
  for (const r of raw) {
    const cur = map.get(r.engine_id) || { engine_id: r.engine_id, tokens: 0, usd: 0 };
    cur.tokens += Number(r.tokens) || 0;
    cur.usd += Number(r.usd) || 0;
    map.set(r.engine_id, cur);
  }
  const engines = Array.from(map.values());
  if (!engines.length) return <ChartBox title="Tokens and cost by engine" sub="This week"><div className="ou-dash-chart-empty">No data yet.</div></ChartBox>;
  const max = Math.max(1, ...engines.map((e) => e.tokens));
  return (
    <ChartBox title="Tokens and cost by engine" sub="This week">
      <div className="ou-dash-chart-bars">
        {engines.map((e, idx) => {
          const heightPct = e.tokens > 0 ? Math.max(4, Math.round((e.tokens / max) * 100)) : 0;
          const color = ENGINE_COLORS[idx % ENGINE_COLORS.length];
          return (
            <div key={e.engine_id} className="ou-dash-chart-col" style={{ alignItems: 'center' }}>
              <div className="ou-dash-engine-val">
                <span>{formatTokens(e.tokens)}</span>
                <span>${(e.usd || 0).toFixed(2)}</span>
              </div>
              <div style={{ width: '100%', height: '56px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                {e.tokens === 0 ? (
                  <div className="ou-dash-bar-tick" />
                ) : (
                  <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                    <rect x="0" y="0" width="10" height="100" fill={color} />
                  </svg>
                )}
              </div>
              <span className="ou-dash-engine-label" title={e.engine_id}>{e.engine_id}</span>
            </div>
          );
        })}
      </div>
      <div className="ou-dash-chart-dates" aria-hidden="true"><span>&nbsp;</span></div>
      <div className="ou-dash-legend" aria-hidden="true"><span>&nbsp;</span></div>
    </ChartBox>
  );
}

function ChartSessions({ data, loading, error }) {
  if (loading) return <ChartBox title="Sessions by state" sub="Last 14 days"><div className="ou-dash-chart-empty">Loading.</div></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Sessions by state" sub="Last 14 days"><div className="ou-dash-chart-empty">No data yet.</div></ChartBox>;
  const days = data.days;
  const parsed = days.map((d) => {
    const st = d.started || {};
    const w = st.working || 0;
    const wait = st.waiting_for_you || 0;
    const done = st.done || 0;
    const other = Object.entries(st).reduce((n, [k, v]) => (['working', 'waiting_for_you', 'done'].includes(k) ? n : n + (v || 0)), 0);
    const total = w + wait + done + other;
    return { day: d.day, w, wait, done, other, total };
  });
  const max = Math.max(1, ...parsed.map((p) => p.total));
  return (
    <ChartBox title="Sessions by state" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {parsed.map((p, i) => {
          const heightPct = Math.round((p.total / max) * 100);
          if (p.total === 0) {
            return (
              <div key={p.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const otherPct = (p.other / p.total) * 100;
          const donePct = (p.done / p.total) * 100;
          const waitPct = (p.wait / p.total) * 100;
          const wPct = (p.w / p.total) * 100;
          return (
            <div key={p.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                {p.other > 0 ? <rect x="0" y="0" width="10" height={otherPct} fill="var(--st-other)" /> : null}
                {p.done > 0 ? <rect x="0" y={otherPct} width="10" height={donePct} fill="var(--st-ok)" /> : null}
                {p.wait > 0 ? <rect x="0" y={otherPct + donePct} width="10" height={waitPct} fill="var(--st-wait)" /> : null}
                {p.w > 0 ? <rect x="0" y={otherPct + donePct + waitPct} width="10" height={wPct} fill="var(--st-run)" /> : null}
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-run)' }} />Working</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-wait)' }} />Waiting</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-ok)' }} />Done</span>
        <span className="ou-dash-legend-item"><span className="ou-dash-legend-sq" style={{ background: 'var(--st-other)' }} />Other</span>
      </div>
    </ChartBox>
  );
}

function ChartChecks({ data, loading, error }) {
  if (loading) return <ChartBox title="Done-check pass rate" sub="Last 14 days"><div className="ou-dash-chart-empty">Loading.</div></ChartBox>;
  if (error || !data || !data.days) return <ChartBox title="Done-check pass rate" sub="Last 14 days"><div className="ou-dash-chart-empty">No data yet.</div></ChartBox>;
  const days = data.days;
  const totalPassed = days.reduce((n, d) => n + (d.passed || 0), 0);
  const totalRuns = days.reduce((n, d) => n + (d.runs || 0), 0);
  return (
    <ChartBox title="Done-check pass rate" sub="Last 14 days">
      <div className="ou-dash-chart-bars">
        {days.map((d, i) => {
          if (d.rate == null || !d.runs) {
            return (
              <div key={d.day || i} className="ou-dash-chart-col">
                <div className="ou-dash-bar-tick" />
              </div>
            );
          }
          const heightPct = Math.max(2, Math.round(d.rate * 100));
          return (
            <div key={d.day || i} className="ou-dash-chart-col">
              <svg viewBox="0 0 10 100" preserveAspectRatio="none" className="ou-dash-bar-svg" style={{ height: `${heightPct}%` }}>
                <rect x="0" y="0" width="10" height="100" fill="var(--st-ok)" />
              </svg>
            </div>
          );
        })}
      </div>
      <ChartDates days={days} />
      <div className="ou-dash-legend">
        <span className="ou-dash-legend-item">
          <span className="ou-dash-legend-sq" style={{ background: 'var(--st-ok)' }} />
          {`${totalPassed} of ${totalRuns} passed`}
        </span>
      </div>
    </ChartBox>
  );
}

export function Home() {
  const { open = [], selected, usage: usageOpen } = homeStore.use();
  const [statsSessions, setStatsSessions] = useState(null);
  const [statsChecks, setStatsChecks] = useState(null);
  const [usageWeek, setUsageWeek] = useState(null);
  const [usageToday, setUsageToday] = useState(null);
  const [recentHidden, setRecentHidden] = useState(() => { try { return localStorage.getItem('ouros.home.recentHidden') === '1'; } catch { return false; } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { if (homeView.shown()) homeStore.set({ open: [] }); }, [homeView.shown()]);

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      if (!homeView.shown()) return;
      try {
        const [sessRes, checksRes, weekRes, todayRes] = await Promise.all([
          rpc('stats.sessions', { project_id: ui.projectId, days: 14 }, true),
          rpc('stats.checks', { project_id: ui.projectId, days: 14 }, true),
          rpc('usage.summary', { window: 'week' }, true),
          rpc('usage.summary', { window: 'today' }, true),
        ]);
        if (!active) return;
        setStatsSessions(sessRes?.result || null);
        setStatsChecks(checksRes?.result || null);
        setUsageWeek(weekRes?.result || null);
        setUsageToday(todayRes?.result || null);
        setLoading(false);
      } catch {
        if (!active) return;
        setError(true);
        setLoading(false);
      }
    };
    setLoading(true);
    setError(false);
    void fetchAll();
    const iv = setInterval(() => { void fetchAll(); }, 60000);
    return () => { active = false; clearInterval(iv); };
  }, [ui.projectId, homeView.shown()]);

  if (!homeView.shown()) return null;
  const s = ui.snap || {};
  const live = s.live || [];
  const tree = s.tree_rows || {};
  const known = [...live, ...(s.sessions || []).filter((x) => !live.some((l) => l.id === x.id))];
  const all = [...known.map((x) => (tree[x.id] ? { ...tree[x.id], ...Object.fromEntries(Object.entries(x).filter(([, v]) => v != null)) } : x)),
    ...Object.values(tree).filter((r) => !known.some((x) => x.id === r.id))].filter((x) => !ui.pendingHide?.has(x.id));
  const everyone = all.filter((x) => x.state !== 'exited');
  const byId = new Map(everyone.map((x) => [x.id, x]));
  const kidsOf = (id) => all.filter((y) => y.parent_id === id);
  const tops = everyone.filter((x) => !x.parent_id || !byId.has(x.parent_id))
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));

  const newest = (a, b) => String(b.state_at || b.started_at || '').localeCompare(String(a.state_at || a.started_at || ''));
  const active = tops.filter((x) => !DONE_STATES.includes(x.state) && !isWorking(x));
  const busy = tops.filter(isWorking).sort(newest);
  const settledAll = [...tops.filter((x) => DONE_STATES.includes(x.state)), ...all.filter((x) => x.state === 'exited' && !x.parent_id)].sort(newest);
  const settled = settledAll.slice(0, 20);

  const waiting = waitingAll().slice().sort((a, b) => String(a.state_at || '').localeCompare(String(b.state_at || '')));
  const working = everyone.filter((x) => x.state === 'working' || x.state === 'starting');
  const alerts = (s.needs_you || []).filter((n) => !n.read_at && !isInfo(n));
  const approvals = s.approvals || [];
  const needsCount = waiting.length + alerts.length;
  const fallback = waiting[0]?.id || working.slice().sort((a, b) => String(b.state_at || '').localeCompare(String(a.state_at || '')))[0]?.id || null;
  const selId = selected && (byId.has(selected) || waiting.some((w) => w.id === selected)) ? selected : fallback;
  const sel = selId ? byId.get(selId) || waiting.find((w) => w.id === selId) : null;

  const toggle = (id) => {
    const cur = homeStore.get().open || [];
    homeStore.set({ open: cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id] });
  };
  const select = (id) => homeStore.set({ selected: id });
  const row = (x) => <AgentRow key={x.id} x={x} kids={kidsOf(x.id)} openList={open} selected={x.id === selId} toggle={toggle} select={select} />;

  const limits = s.limits || [];
  const hot = limits.filter((l) => l.status === 'ok' && l.used_pct >= 80);
  const highestLimit = hot.length ? hot.slice().sort((a, b) => (b.used_pct || 0) - (a.used_pct || 0))[0] : null;
  const usdVal = Number(usageToday?.usd) || 0;
  const usdEst = Boolean(usageToday?.usd_estimated);
  const ready = (s.engines || []).filter((e) => e.light !== 'red');

  const recentWork = all.slice().sort(newest).slice(0, 6);
  const flipRecent = () => { const v = !recentHidden; setRecentHidden(v); try { localStorage.setItem('ouros.home.recentHidden', v ? '1' : '0'); } catch {} };

  return (
    <div className="ou-home ou-hm">
      <div className="ou-hm-main">
        {ready.length ? <StartBox ready={ready} /> : <EmptyState title="No agent is ready. Check Add-ons." isCompact />}
        <p className="ou-hm-summary">
          <span className={needsCount ? 'ou-hm-hot' : ''}>{needsCount} need you</span>{' · '}
          <span>{working.length} working</span>{' · '}
          <span className={approvals.length ? 'ou-hm-hot' : ''}>{approvals.length} {approvals.length === 1 ? 'approval' : 'approvals'}</span>{' · '}
          <span>{usdEst ? '~' : ''}${usdVal.toFixed(2)} today</span>
        </p>
        <UsageWarn limit={highestLimit} />

        {tops.length || settled.length ? (
          <section className="ou-hm-group">
            {active.length ? <ul className="ou-hm-agents">{active.map(row)}</ul> : null}
            {[['working', 'Working', busy, true], ['settled', 'Settled', settled, false]].map(([key, title, rows, byDefault]) => {
              const isOpen = rows.length > 0 && (open.includes(`fold:${key}`) !== byDefault);
              return (
                <div key={key} className="ou-hm-fgroup">
                  <button type="button" className="ou-hm-foot" aria-expanded={isOpen} disabled={!rows.length} onClick={() => toggle(`fold:${key}`)}>
                    <span>{title}</span><span className="ou-hm-count">{key === 'settled' ? settledAll.length : rows.length}</span>
                    <span className="ou-hm-chevbox" data-open={isOpen ? 'true' : 'false'}>{chev}</span>
                  </button>
                  <Drop open={isOpen} className="ou-hm-fbody"><ul className="ou-hm-agents">{rows.map(row)}</ul></Drop>
                </div>
              );
            })}
          </section>
        ) : <EmptyState title="No agents yet" description="Start one with the task box above (Ctrl+N)." isCompact />}

        <HomeAutomations />

        <section className="ou-hm-recent">
          <div className="ou-hm-recenthead">
            <h2 className="ou-hm-h">Recent work</h2>
            <button type="button" className="ou-hm-fold ou-hm-hide" aria-expanded={!recentHidden} onClick={flipRecent}>{recentHidden ? 'Show' : 'Hide'}</button>
          </div>
          {recentHidden ? null : recentWork.length ? (
            <ul className="ou-hm-pills">
              {recentWork.map((x) => (
                <li key={x.id} className="ou-hm-pill" data-action="pick" data-id={x.id} role="button" tabIndex={0} title={`${nameOf(x)}: ${x.last_line || x.reason || STATE_WORD[x.state] || x.state}`}>
                  <EngineMark id={x.engine_id} size={14} title={x.engine_id} />
                  <span className="ou-hm-pilltext"><b>{nameOf(x)}</b><span>{x.last_line || x.reason || STATE_WORD[x.state] || x.state}</span></span>
                  <Dot k={x} />
                  <span className="ou-hm-age">{ago(x.state_at || x.started_at) || ''}</span>
                </li>
              ))}
            </ul>
          ) : <p className="ou-hm-muted">Nothing yet.</p>}
        </section>

        <section className="ou-hm-usage">
          <button type="button" className="ou-hm-fold" aria-expanded={Boolean(usageOpen)} onClick={() => homeStore.set({ usage: !usageOpen })}>
            <span className="ou-hm-chevbox" data-open={usageOpen ? 'true' : 'false'}>{chev}</span><span>Usage and trends</span>
          </button>
          <Drop open={Boolean(usageOpen)} className="ou-hm-drop">
            <div className="ou-dash-charts">
              <ChartRuns data={statsSessions} loading={loading} error={error} />
              <ChartTokens data={usageWeek} loading={loading} error={error} />
              <ChartSessions data={statsSessions} loading={loading} error={error} />
              <ChartChecks data={statsChecks} loading={loading} error={error} />
            </div>
            <Usage />
            <Audit />
          </Drop>
        </section>
      </div>

      <aside className="ou-hm-rail">
        <RailCard waiting={waiting} approvals={approvals} alerts={alerts} sel={sel} kids={sel ? kidsOf(sel.id) : []} select={select} selId={selId} />
      </aside>
    </div>
  );
}
