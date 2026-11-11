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
const spin = <svg {...ic} className="ou-hm-spin"><circle cx="7" cy="7" r="5" strokeDasharray="2 2.2" /></svg>;

const TILE_COLOURS = ['#e5484d', '#3e63dd', '#f76b15', '#30a46c', '#8e4ec6', '#12a594', '#d6409f', '#ffc53d'];
const tileOf = (name) => {
  const n = String(name || '?');
  const h = [...n].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const parts = n.split(/[-_\s.]+/).filter(Boolean);
  const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : n.slice(0, 2)).toUpperCase();
  return { letters, colour: TILE_COLOURS[h % TILE_COLOURS.length] };
};
function ProjectChip({ name }) {
  const t = tileOf(name);
  return <span className="ou-hm-proj"><span className="ou-hm-tile" style={{ color: t.colour, background: `color-mix(in srgb, ${t.colour} 18%, transparent)` }}>{t.letters}</span><span>{name}</span></span>;
}

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

function Marks({ list, size = 22 }) {
  return (
    <span className="ou-hm-marks">
      {list.slice(0, 3).map((k) => <span key={k.id} className="ou-hm-mk" style={{ width: size, height: size }}><EngineMark id={k.engine_id} size={size - 6} title={k.engine_id} /></span>)}
      {list.length > 3 ? <span className="ou-hm-mk ou-hm-more" style={{ width: size, height: size }}>+{list.length - 3}</span> : null}
    </span>
  );
}

export const progressOf = (k) => (k.state === 'waiting_for_you' ? 'waiting'
  : isWorking(k) ? 'working'
    : k.state === 'failed' || /fail/.test(String(k.outcome || '')) ? 'failed'
      : DONE_STATES.includes(k.state) ? 'done' : 'working');
const PROGRESS_WORD = { done: 'Done', working: 'Working', failed: 'Failed', waiting: 'Waiting' };

function Dot({ k }) {
  const p = progressOf(k);
  return <span className={`ou-hm-dot ou-hm-dot-${p}`} role="img" aria-label={PROGRESS_WORD[p]} title={PROGRESS_WORD[p]} />;
}

function LineageRow({ k, lead }) {
  const p = progressOf(k);
  return (
    <li className={lead ? 'ou-hm-lead' : 'ou-hm-kid'} data-id={k.id} data-progress={p}>
      <EngineMark id={k.engine_id} size={16} title={k.engine_id} />
      <span className="ou-hm-name">{nameOf(k)}</span>
      {lead ? <span className="ou-hm-role">orchestrator</span> : null}
      <span className={`ou-hm-pword ou-hm-pw-${p}`}><Dot k={k} />{PROGRESS_WORD[p]}</span>
      <span className="ou-hm-age">{ago(k.state_at || k.started_at) || ''}</span>
    </li>
  );
}

function SubAgents({ x, kids, open, toggle }) {
  const working = kids.filter(isWorking).length;
  const newest = kids.map((k) => k.state_at || k.started_at || '').sort().pop();
  const key = `sub:${x.id}`;
  return (
    <div className="ou-hm-subs">
      <div className="ou-hm-subrow" role="button" tabIndex={0} aria-expanded={open} aria-label={`${kids.length} sub-agents, ${working} working`}
        onClick={(e) => { e.stopPropagation(); toggle(key); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(key); } }}>
        <Marks list={kids} />
        <span className="ou-hm-subtext"><b>{kids.length} sub-{kids.length === 1 ? 'agent' : 'agents'}</b><span className={working ? 'ou-hm-think' : ''}>{working ? `${working} working` : 'all settled'}</span></span>
        <span className="ou-hm-age">{ago(newest) || ''}</span>
        <span className="ou-hm-chevbox" data-open={open ? 'true' : 'false'}>{chev}</span>
      </div>
      <Drop open={open} className="ou-hm-drop">
        <ul className="ou-hm-lineage ou-hm-tree">
          <LineageRow k={x} lead />
          {kids.map((k) => <LineageRow key={k.id} k={k} />)}
        </ul>
      </Drop>
    </div>
  );
}

function AgentRow({ x, kids, openList, selected, toggle, select }) {
  const st = stepsOf(x);
  const open = openList.includes(x.id);
  const g = ui.snap?.git?.[x.id] || {};
  const branch = g.branch || x.branch || null;
  const proj = (ui.snap?.projects || []).find((p) => p.id === (x.project_id || ui.projectId))?.name || 'No project';
  const waiting = x.state === 'waiting_for_you';
  return (
    <li className={`ou-hm-agent${selected ? ' ou-hm-sel' : ''}`} data-id={x.id} data-state={x.state}>
      <div className="ou-hm-arow" role="button" tabIndex={0} aria-expanded={open}
        onClick={() => { select(x.id); toggle(x.id); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(x.id); toggle(x.id); } }}>
        <div className="ou-hm-l1">
          <ProjectChip name={proj} />
          <span className="ou-hm-gap" />
          {waiting ? <span className="ou-hm-wait">{spin}Waiting</span> : null}
          <span className="ou-hm-age">{ago(x.state_at || x.started_at) || ''}</span>
        </div>
        <div className="ou-hm-l2"><span className="ou-hm-title">{nameOf(x)}</span></div>
        <div className="ou-hm-l3">
          <span className="ou-hm-mono ou-hm-branch">{branch || STATE_WORD[x.state] || x.state}</span>
          <span className="ou-hm-gap" />
          {st ? <span className="ou-hm-steps">{st.done}/{st.total}</span> : null}
          <EngineMark id={x.engine_id} size={16} title={x.engine_id} />
        </div>
      </div>
      <Drop open={open} className="ou-hm-drop">
        {st && st.items.length ? (
          <ol className="ou-hm-check">
            {st.items.map((it, i) => <li key={i} data-done={it.done ? 'true' : 'false'}>{it.done ? circleDone : circle}<span className="ou-hm-ctext">{it.text}</span></li>)}
          </ol>
        ) : <p className="ou-hm-muted">{kids.length ? 'No steps reported. Sub-agents are listed below.' : 'No steps reported yet.'}</p>}
        {x.last_line ? <pre className="ou-hm-last">{x.last_line}</pre> : null}
        <div className="ou-hm-dropacts"><Button size="sm" variant="ghost" label="Open on Wall" data-action="pick" data-id={x.id} /></div>
      </Drop>
      {kids.length ? <SubAgents x={x} kids={kids} open={openList.includes(`sub:${x.id}`)} toggle={toggle} /> : null}
    </li>
  );
}

function RailAgent({ x, kids }) {
  const [answer, setAnswer] = useState('');
  const [merging, setMerging] = useState(false);
  const g = ui.snap?.git?.[x.id] || {};
  const branch = g.branch || x.branch || null;
  const pr = g.pr || null;
  const here = !x.project_id || x.project_id === ui.projectId;
  const host = (g.root || x.cwd) ? (g.root || x.cwd).split(/[/\\]/).filter(Boolean).pop() : (ui.snap?.projects || []).find((p) => p.id === x.project_id)?.name || 'This computer';
  const send = async () => {
    const t = answer.trim();
    if (!t || !here) return;
    try { await troop.termInput(x.id, t + '\r'); setAnswer(''); toast(`Sent to ${x.engine_id}`); } catch (err) { toast(String(err?.message || err), true); }
  };
  const running = kids.filter(isWorking).length;
  return (
    <div className="ou-hm-panel">
      {x.state === 'waiting_for_you' ? (
        <div className="ou-hm-ask">
          <p><b>{x.engine_id}</b> {x.reason || x.last_line || 'is waiting for you'}</p>
          <TextInput size="sm" label="Answer" isLabelHidden placeholder={here ? 'Answer, Enter sends' : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} width="100%" isDisabled={!here} />
        </div>
      ) : null}
      <ul className="ou-hm-props">
        <li>{hostIcon}<span className="ou-hm-name">{host}</span></li>
        <li role="button" tabIndex={0} className="ou-hm-click" data-action="pick" data-id={x.id}>{editorIcon}<span className="ou-hm-name">Open on Wall</span>{chev}</li>
      </ul>
      {branch ? (
        <ul className="ou-hm-props">
          <li>{branchIcon}<span className="ou-hm-name ou-hm-mono">{branch}</span></li>
          {g.commit ? <li>{commitIcon}<span className="ou-hm-name">Commit</span><span className="ou-hm-mono">{g.commit}</span></li> : null}
          <li>{filesIcon}<span className="ou-hm-name">Changes</span><span className="ou-hm-mono"><b className="ou-hm-add">+{g.added || 0}</b> <b className="ou-hm-del">-{g.deleted || 0}</b></span></li>
          {pr ? (
            <li>{prIcon}{pr.url && typeof openTermLink === 'function' ? <button type="button" className="ou-hm-name ou-hm-link" onClick={() => openTermLink(pr.url)}>PR #{pr.number}</button> : <span className="ou-hm-name">PR #{pr.number}</span>}{pr.checks ? <span className={`ou-hm-checks ou-hm-ck-${pr.checks}`} title={`Checks ${pr.checks}`}>checks {pr.checks}</span> : null}<span className="ou-hm-prstate">{String(pr.state || '').toLowerCase()}</span>
              {String(pr.state).toUpperCase() === 'OPEN' ? <Button size="sm" label="Merge" onClick={() => setMerging(true)} /> : null}
            </li>
          ) : null}
        </ul>
      ) : null}
      {kids.length ? (
        <div className="ou-hm-props">
          <div className="ou-hm-rtitle">Lineage {'·'} {running} running</div>
          <ul className="ou-hm-lineage">
            {kids.map((k) => <li key={k.id} data-progress={progressOf(k)}><EngineMark id={k.engine_id} size={14} title={k.engine_id} /><span className="ou-hm-name">{nameOf(k)}</span><Dot k={k} /><span className="ou-hm-age">{ago(k.state_at || k.started_at) || ''}</span></li>)}
          </ul>
        </div>
      ) : null}
      {merging && pr ? (
        <AlertDialog isOpen onOpenChange={(o) => { if (!o) setMerging(false); }} title={`Merge PR #${pr.number}?`}
          description={`This merges ${branch || 'the branch'} on GitHub. It cannot be undone from Ouros.`} actionLabel="Merge"
          onAction={async () => {
            setMerging(false);
            const r = await rpc('gh.merge', { session_id: x.id });
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
        <section className="ou-hm-rq">
          {needsCount + approvals.length ? <div className="ou-hm-rtitle">Needs you <span className="ou-hm-hot">{needsCount + approvals.length}</span></div> : null}
          {waiting.length || approvals.length || alerts.length ? (
            <ul className="ou-hm-queue">
              {waiting.map((x) => (
                <li key={x.id} className={x.id === selId ? 'ou-hm-sel' : ''} role="button" tabIndex={0} data-id={x.id}
                  onClick={() => select(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(x.id); }}>
                  <EngineMark id={x.engine_id} size={14} title={x.engine_id} />
                  <span className="ou-hm-qtext"><b>{nameOf(x)}</b><span>{x.reason || x.last_line || 'asked a question'}</span></span>
                </li>
              ))}
              {approvals.length ? <li role="button" tabIndex={0} data-action="sheet"><span className="ou-hm-qtext"><b>{approvals.length} {approvals.length === 1 ? 'action waits' : 'actions wait'} for a yes</b><span>Review</span></span></li> : null}
              {alerts.map((n) => <li key={n.id} role="button" tabIndex={0} data-action="inbox-open" data-id={n.id}><span className="ou-hm-qtext"><b>{n.text}</b><span>{n.kind} {'·'} {ago(n.at)}</span></span></li>)}
            </ul>
          ) : <p className="ou-hm-muted">Nothing needs you.</p>}
        </section>
        {sel ? <Swap k={sel.id}><RailAgent key={sel.id} x={sel} kids={kidsOf(sel.id)} /></Swap> : null}
      </aside>
    </div>
  );
}
