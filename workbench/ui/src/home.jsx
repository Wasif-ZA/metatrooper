import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Chat, echoSend, useChat } from './chat.jsx';
import { createStore } from './store.js';
import { flushQueued, queuedText, setQueued } from './queue.js';
import { AutomationsPage } from './automations.jsx';
import { EngineMark, engineName, statusOf, STATUS_WORD, Branch, CommitIcon as Commit, ChangesIcon as Changes, PullRequestIcon as PullRequest, Workspace, OpenOnWall, StepOpenIcon as StepOpen, Done, ChevronRightIcon as ChevronRight, StopIcon as Stop, ProjectIcon, LaptopIcon, FolderIcon, PanelToggle } from './icons/index.js';
import { composer, atRefs } from './composer.jsx';
import { NOT_SENT, canStop, defaultEngine, workingCounts, workingLabel } from './words.js';
import { canMove, conceal, crossfade, reveal } from './motion.js';
import { ExternalLinkIcon, TerminalIcon } from './icons/screens.jsx';
import './home-ref.css';
import './frame-ref.css';

let firstRunFired = false;

function WallEmpty() {
  const empty = ui.view === 'wall' && project() && !(ui.snap?.sessions || []).some((x) => !ui.pendingHide.has(x.id) && (x.state !== 'exited' || x.id === ui.snap.selected)) && !shellRows().length;
  return empty ? <div id="wall-empty"><EmptyState title="No agents running" description="Start an agent in this project." actions={<Button label="Start an agent" data-action="launch-menu" />} /></div> : null;
}

export const homeStore = createStore({ tick: 0, open: [], selected: null });

const bumpHome = () => homeStore.set({ tick: homeStore.get().tick + 1 });
const sendFollowUp = async (x, t) => {
  try {
    const r = await rpc('session.send', { session_id: x.id, text: t }, true);
    if (!r || !r.result) { toast(`Not sent: ${r?.error?.message || 'the agent did not take it'}. The message was: ${t}`, true); return false; }
    echoSend(x.id, t);
    toast(`Sent the queued message to ${engineName(x.engine_id)}`);
    return true;
  } catch (err) { toast(String(err?.message || err), true); return false; }
  finally { bumpHome(); }
};
globalThis.flushQueued = (sessions) => flushQueued(sessions, sendFollowUp);

export const openNewTask = () => {
  ui.homeSel = '';
  homeStore.set({ tick: homeStore.get().tick + 1 });
  if (typeof homeView !== 'undefined' && !homeView.shown()) homeView.set('home');
  const focus = () => document.querySelector('#home .ou-hm-task textarea')?.focus();
  focus();
  setTimeout(focus, 50);
};

export function Drop({ open, className, children, ms, rows }) {
  const ref = useRef(null);
  const kept = useRef(children);
  const first = useRef(true);
  const [closing, setClosing] = useState(false);
  if (open) kept.current = children;
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el) return;
    if (open) { setClosing(false); reveal(el, rows, ms); } else { setClosing(true); conceal(el, () => setClosing(false)); }
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

const chev = <ChevronRight size={16} className="ou-hm-chev" />;
const branchIcon = <Branch size={16} />;
const commitIcon = <Commit size={16} />;
const filesIcon = <Changes size={16} />;
const prIcon = <PullRequest size={16} />;

const projectOf = (x) => (ui.snap?.projects || []).find((p) => p.id === (x?.project_id || ui.projectId)) || null;
const nameOf = (x) => (x.title && !/[\\/]/.test(x.title) ? x.title : '') || (x.prompt ? String(x.prompt).trim().split(/\r?\n/)[0].slice(0, 120) : '') || taskOf(x);

const hostIcon = <Workspace size={16} />;
const editorIcon = <OpenOnWall size={16} />;
const folderSmall = <FolderIcon size={16} />;
const laptopSmall = <LaptopIcon size={16} />;
const branchSmall = <Branch size={14} />;
const circle = <StepOpen size={14} className="ou-hm-cbox" />;
const circleDone = <Done size={14} className="ou-hm-cbox ou-hm-cdone" />;

function StartBox({ ready, strip }) {
  const [task, setTask] = useState(ui.drafts['home-task'] || '');
  const [engine, setEngine] = useState(defaultEngine(ready, ui.drafts['home-engine'] || load('engine')));
  const chosen = defaultEngine(ready, engine);
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState('');
  const [picked, setApproval] = useState('default');
  const can = ready.find((e) => e.id === chosen)?.approvals || ['ask', 'edits', 'contained'];
  const approval = picked === 'default' || can.includes(picked) ? picked : 'default';
  const [starting, setStarting] = useState(false);
  const [folderSheet, setFolderSheet] = useState(false);
  const proj = projectOf({ project_id: ui.projectId });
  const normalizedPath = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const worktrees = normalizedPath(ui.settingsLook?.worktreesRoot);
  const inWorktree = worktrees && normalizedPath(proj?.path).startsWith(`${worktrees}/`);
  const defaultApproval = branch.trim() || inWorktree ? 'contained' : ui.settingsLook?.approval || 'contained';
  const resolvedDefault = defaultApproval !== 'isolated' && can.includes(defaultApproval) ? defaultApproval : 'ask';
  const [models, setModels] = useState({});
  useEffect(() => {
    if (models[chosen] || typeof rpc !== 'function') return;
    void rpc('engines.models', { engine_id: chosen }, true).then((r) => { if (r && r.result) setModels((m) => ({ ...m, [chosen]: r.result.models })); });
  }, [chosen]);

  const start = async () => {
    if (starting) return;
    if (!ui.projectId) { setFolderSheet(true); return; }
    setStarting(true);
    try { await launch(ui.projectId); } catch (err) { toast(String(err?.message || err), true); } finally { setStarting(false); }
  };
  const launch = async (projectId) => {
    const text = task.trim();
    let target = projectId;
    if (branch.trim()) {
      const wt = await rpc('worktree.create', { project_id: projectId, branch: branch.trim() });
      if (!wt.result) return;
      const opened = await rpc('project.open', { path: wt.result.path });
      if (!opened.result) return;
      target = opened.result.project_id;
    }
    const r = await rpc('session.launch', { project_id: target, engine_id: chosen, ...(text ? { prompt: text } : {}), ...(model.trim() ? { model: model.trim() } : {}), ...(approval !== 'default' ? { approval } : {}) });
    if (!r.result) return;
    if (ui.snap?.has_sessions === false && !firstRunFired && globalThis.window?.dispatchEvent) {
      firstRunFired = true;
      globalThis.window.dispatchEvent(new CustomEvent('cc:first-run-done', { detail: { session_id: r.result.session_id, project_id: target } }));
    }
    delete ui.drafts['home-task'];
    setTask('');
    save('engine', chosen);
    setBranch('');
    ui.homeSel = r.result.session_id;
    homeStore.set({ tick: homeStore.get().tick + 1, selected: r.result.session_id });
    if (target !== ui.projectId) switchProject(target);
  };
  const chooseFolder = async (make) => {
    if (starting) return;
    setStarting(true);
    try {
      const path = make ? await api.makeTaskFolder(task) : await api.pickFolder();
      if (!path) return;
      const opened = await rpc('project.open', { path });
      if (!opened?.result) return;
      setFolderSheet(false);
      switchProject(opened.result.project_id);
      await launch(opened.result.project_id);
    } catch (err) { toast(String(err?.message || err), true); } finally { setStarting(false); }
  };
  const edit = (v) => { ui.drafts['home-task'] = v; setTask(v); };
  const gitBranch = ui.git && ui.git.project === ui.projectId ? ui.git.branch : null;
  const { working } = workingCounts(ui.snap);
  return <>{composer({
    className: 'ou-hm-composerwrap ou-hm-task',
    strip,
    filled: Boolean(task.trim()),
    onKeyDown: (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } },
    field: <TextArea label="Task for a new agent" isLabelHidden rows={2} value={task} placeholder={ui.projectId ? 'Ask an agent to do something. @ for files, / for commands' : 'Ask an agent to do something'} onChange={edit} />,
    opts: more ? (
      <div className="ou-composerfoot ou-hm-opts">
        <TextInput size="sm" width={240} label="Branch for a new worktree" isLabelHidden placeholder="Branch (agent gets its own worktree)" value={branch} onChange={setBranch} />
        <TextInput size="sm" width={180} label="Model" isLabelHidden placeholder="Model (agent default)" value={model} onChange={setModel} />
      </div>
    ) : null,
    plus: [
      { label: more ? 'Hide branch and model' : 'Branch and model', onClick: () => setMore(!more) },
    ],
    engine: { id: chosen, model: model.trim(), options: [
      { type: 'section', title: 'Agent', options: ready.map((e) => ({ value: e.id, label: engineName(e.id), icon: <EngineMark id={e.id} size={16} /> })) },
      { type: 'section', title: 'Model', options: [{ value: 'model:', label: 'Agent default' }, ...(models[chosen] || []).map((m) => ({ value: `model:${m}`, label: m })), { value: 'custom', label: 'Custom model...' }] },
    ], onChange: (v) => {
      if (v === 'custom') { setMore(true); return; }
      if (v.startsWith('model:')) { setModel(v.slice(6)); return; }
      ui.drafts['home-engine'] = v; setEngine(v); setModel('');
    } },
    send: { label: 'Start', tooltip: 'Start (Ctrl+Enter)', 'data-action': 'home-start', 'data-engine': chosen, isDisabled: starting, onClick: start },
    attach: (paths) => {
      edit(atRefs(task, paths, proj?.path));
      document.querySelector?.('#home .ou-hm-composerwrap textarea')?.focus();
    },
    status: { state: starting || working ? 'active' : 'idle', label: starting ? 'Starting' : workingLabel(workingCounts(ui.snap)) },
    context: [
      { key: 'project', plain: true, icon: folderSmall, node: !ui.projectId ? <span>No folder</span> : <Selector label="Project" isLabelHidden size="sm" variant="ghost" placement="above" value={ui.projectId || ''} onChange={(v) => { if (v && v !== ui.projectId) switchProject(v); }}
        options={(ui.snap?.projects || []).map((p) => ({ value: p.id, label: p.name }))} /> },
      { key: 'machine', icon: laptopSmall, text: 'Local', title: 'Agents run on this computer' },
      branch.trim() || gitBranch ? { key: 'branch', icon: branchSmall, text: branch.trim() ? `${branch.trim()} (new worktree)` : gitBranch } : null,
      { key: 'gap', gap: true },
      { key: 'access', accent: true, node: <Selector label="Approval" isLabelHidden size="sm" variant="ghost" placement="above" value={approval} onChange={setApproval}
        renderValue={() => ACCESS[approval === 'default' ? resolvedDefault : approval] || 'Ask first'} options={[
        { value: 'default', label: `${resolvedDefault === 'contained' ? 'Auto: cannot control your desktop or outside services' : resolvedDefault === 'ask' ? 'Ask first: can control your desktop and outside services' : ACCESS[resolvedDefault]} (default)` },
        ...[{ value: 'ask', label: 'Ask first: can control your desktop and outside services' }, { value: 'edits', label: 'Edits allowed' }, { value: 'contained', label: 'Auto: cannot control your desktop or outside services' }].filter((o) => can.includes(o.value) && o.value !== resolvedDefault),
      ]} /> },
    ],
  })}
    {!strip && !task.trim() ? <div className="ou-hm-starters">{STARTERS.map(([label, prompt]) => <Button key={label} size="sm" variant="ghost" label={label} onClick={() => { edit(prompt); document.querySelector('#home .ou-hm-task textarea')?.focus(); }} />)}</div> : null}
    {folderSheet ? <Dialog className="ou-hm-foldersheet" isOpen onOpenChange={(open) => { if (!starting) setFolderSheet(open); }} width={420} purpose="form" aria-label="Where should the agent work?">
      <Layout content={<LayoutContent><Heading level={2}>Where should the agent work?</Heading><p className="ou-hm-folderhint">A new folder is made in Documents\cc, named after your task.</p></LayoutContent>}
        footer={<LayoutFooter><div className="ou-hm-folderactions">
          <Button variant="ghost" label="Cancel" isDisabled={starting} onClick={() => setFolderSheet(false)} />
          <Button variant="secondary" label="Make a new folder" isDisabled={starting} onClick={() => void chooseFolder(true)} />
          <Button variant="primary" label="Choose a folder" data-autofocus isDisabled={starting} onClick={() => void chooseFolder(false)} />
        </div></LayoutFooter>} />
    </Dialog> : null}
  </>;
}

const STARTERS = [
  ['Explain this project', 'Explain how my project is laid out and what each part does.'],
  ['Fix a bug', 'Help me find and fix a bug in my project.'],
  ['Build a page', 'Build a web page. Help me decide what it should include.'],
];

const stepsOf = (x) => (x.steps && x.steps.total ? { done: x.steps.done, total: x.steps.total, items: x.steps.items || [] } : null);
const ACCESS = { ask: 'Ask first', edits: 'Edits allowed', contained: 'Auto', isolated: 'Full access' };
const isWorking = (k) => k.state === 'working' || k.state === 'starting';

const settled = (k) => ['done', 'failed', 'stopped'].includes(statusOf(k));
const Engine = ({ id }) => <span className="ou-hm-eng"><EngineMark id={id} size={14} />{engineName(id)}</span>;
const Status = ({ k }) => <span className={`ou-st ou-st-${statusOf(k)}`}>{STATUS_WORD[statusOf(k)]}</span>;

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

export function countSubagentStatuses(statuses) {
  return Object.keys(STATUS_WORD).map((key) => [key, statuses.filter((s) => s === key).length]).filter(([, n]) => n > 0);
}
export const summarizeSubagentStatuses = (statuses) => countSubagentStatuses(statuses).map(([key, n]) => `${n} ${STATUS_WORD[key].toLowerCase()}`).join(' · ');

function StatusCounts({ statuses }) {
  const parts = countSubagentStatuses(statuses);
  return <span className="ou-hm-tsum">{parts.map(([key, n], i) => <span key={key}>{i ? ' · ' : ''}<span className={`ou-st-${key}`}>{n} {STATUS_WORD[key].toLowerCase()}</span></span>)}</span>;
}

const detailOf = (k) => String((settled(k) ? k.reason || k.last_line : k.last_line || k.reason) || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
const tipOf = (k) => [nameOf(k), [engineName(k.engine_id), k.model, STATUS_WORD[statusOf(k)], elapsedOf([k])].filter(Boolean).join(' · '), detailOf(k)].filter(Boolean).join('\n');

export const press = (fn) => ({
  role: 'button', tabIndex: 0,
  onClick: (e) => { e.stopPropagation(); fn(); },
  onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); fn(); } },
});

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
    <li className={`ou-hm-slim${lead ? ' ou-hm-lead' : ''}`} data-id={k.id} data-status={statusOf(k)}>
      <div className="ou-hm-slimrow" title={tipOf(k)} aria-expanded={st ? open : undefined} {...(st ? press(() => toggle(key)) : {})}>
        <span className="ou-hm-slimtext">
          <span className="ou-hm-slimname"><span className="ou-hm-slimlabel">{nameOf(k)}</span>{lead ? <span className="ou-hm-role">orchestrator</span> : null}{st && lead ? <span className="ou-hm-slimsteps">{st.done}/{st.total}</span> : null}</span>
          <span className="ou-hm-slimsub"><Status k={k} /><Engine id={k.engine_id} />{k.model ? <span className="ou-hm-model">{k.model}</span> : null}{doing ? <span className={statusOf(k) === 'failed' ? 'ou-hm-bad' : ''}>{doing}</span> : null}</span>
        </span>
      </div>
      {st ? <Drop open={open} className="ou-hm-drop ou-hm-slimsteps-list"><Steps st={st} /></Drop> : null}
    </li>
  );
}

function Trigger({ x, kids, open, toggle }) {
  const statuses = kids.map(statusOf);
  const working = statuses.filter((s) => s === 'running' || s === 'waiting' || s === 'unknown').length;
  const label = `${kids.length} ${kids.length === 1 ? 'subagent' : 'subagents'}`;
  const summary = summarizeSubagentStatuses(statuses);
  return (
    <div className="ou-hm-trigger" data-active={working || open ? 'true' : 'false'} aria-expanded={open} aria-label={label} aria-description={summary} {...press(() => toggle(x.id))}>
      <span className="ou-hm-ttext">
        <span className="ou-hm-tline"><span className="ou-hm-tlabel">{label}</span><span className="ou-hm-engs">{kids.slice(0, 3).map((k) => <EngineMark key={k.id} id={k.engine_id} size={14} />)}{kids.length > 3 ? <span className="ou-hm-more">+{kids.length - 3}</span> : null}</span></span>
        <StatusCounts statuses={statuses} />
      </span>
      <span className="ou-hm-elapsed">{elapsedOf(kids)}</span>
      <span className="ou-hm-chevdown" data-open={open ? 'true' : 'false'}>{chev}</span>
    </div>
  );
}

const REVIEW_WORD = { pending: 'Reviewing', passed: 'Passed', failed: 'Failed' };

/** A reviewer's run, nested under the turn it checked and folded until opened (M8-F17c). */
function ReviewRun({ r, child, openList, toggle }) {
  const key = `review:${child.id}`;
  const open = openList.includes(key);
  return (
    <div className="ou-hm-review" data-review={r.who} data-state={r.state}>
      <div className="ou-hm-reviewhead" aria-expanded={open} {...press(() => toggle(key))}>
        <span className="ou-hm-reviewtitle">Review by {engineName(r.who)} · {REVIEW_WORD[r.state] || r.state}</span>
        <span className="ou-hm-chevbox" data-open={open ? 'true' : 'false'}>{chev}</span>
      </div>
      <Drop open={open} className="ou-hm-drop">
        <ul className="ou-hm-slimlist"><SlimRow k={child} openList={openList} toggle={toggle} /></ul>
        {r.note ? <p className="ou-hm-reviewnote">{r.note}</p> : null}
      </Drop>
    </div>
  );
}

function TaskView({ x, kids: allKids, openList, toggle, picked }) {
  const reviewIds = new Set((x.reviews || []).filter((r) => r.kind === 'reviewer' && r.review_session_id).map((r) => r.review_session_id));
  const kids = allKids.filter((k) => !reviewIds.has(k.id));
  const reviewRuns = (x.reviews || []).filter((r) => r.kind === 'reviewer' && r.review_session_id).map((r) => [r, allKids.find((k) => k.id === r.review_session_id)]).filter(([, c]) => c);
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState('');
  const chat = useChat(x.id, x.state);
  const ask = picked && picked !== x && statusOf(picked) === 'waiting' ? picked : statusOf(x) === 'waiting' ? x : null;
  const here = !ask?.project_id || ask.project_id === ui.projectId;
  const send = async () => {
    const t = answer.trim();
    if (!t || !here || !ask) return;
    try { if (!(await troop.termInput(ask.id, t + '\r'))) return toast(NOT_SENT, true); echoSend(ask.id, t); setAnswer(''); toast(`Sent to ${engineName(ask.engine_id)}`); } catch (err) { toast(String(err?.message || err), true); }
  };
  const queue = !ask && (!x.project_id || x.project_id === ui.projectId) && isWorking(x);
  const waitingText = queuedText(x.id);
  const working = isWorking(x);
  const enqueue = () => { if (!draft.trim()) return; setQueued(x.id, draft); setDraft(''); bumpHome(); };
  const sendNow = async () => { if (!isWorking(x)) return; const t = queuedText(x.id); setQueued(x.id, ''); if (t && !(await sendFollowUp(x, t))) { setQueued(x.id, t); bumpHome(); } };
  const editQueued = () => { if (!isWorking(x)) return; setDraft(queuedText(x.id)); setQueued(x.id, ''); bumpHome(); };
  const clearQueued = () => { setQueued(x.id, ''); bumpHome(); };
  const open = openList.includes(x.id);
  const st = stepsOf(x);
  const workKey = `work:${x.id}`;
  const workOpen = openList.includes(workKey);
  const pending = kids.filter((k) => !settled(k));
  const proj = projectOf(x)?.name || 'No project';
  const branch = ui.snap?.git?.[x.id]?.branch || x.branch || null;
  const stop = async () => {
    try { if (!(await troop.termInput(x.id, '\u001b'))) return toast(NOT_SENT, true); toast(`Asked ${engineName(x.engine_id)} to stop`); } catch (err) { toast(String(err?.message || err), true); }
  };
  return (
    <article className="ou-hm-taskview" data-id={x.id} data-state={x.state} aria-label={`${proj}${branch ? ` on ${branch}` : ''}: ${nameOf(x)}`}>
      {x.prompt && !chat?.items?.some((item) => item.kind === 'user') ? <div className="ou-hm-user"><p>{String(x.prompt).trim()}</p></div> : null}
      {x.resumed_from ? <div className="ou-hm-resumed" data-resumed-from={x.resumed_from}>resumed after close</div> : null}
      <div className="ou-hm-thread">
        <div className="ou-hm-worked" aria-expanded={st ? workOpen : undefined} {...(st ? press(() => toggle(workKey)) : {})}>
          <Status k={x} />
          <span className="ou-hm-worktime">{settled(x) ? 'after' : 'for'} {elapsedOf([x])}</span>
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
        <Chat x={x} chat={chat} openInEditor={openInEditor} />
        {reviewRuns.map(([r, child]) => <ReviewRun key={child.id} r={r} child={child} openList={openList} toggle={toggle} />)}
        {ask && !chat?.waiting ? (
          <div className="ou-hm-ask"><TextInput size="sm" label="Answer" isLabelHidden placeholder={here ? `Answer ${nameOf(ask)}, Enter sends` : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} width="100%" isDisabled={!here} /></div>
        ) : null}
        {waitingText ? (
          <div className="ou-hm-ask ou-hm-queued" data-queued="1">
            <p><b>1 queued</b>, sent when {nameOf(x)} finishes this turn: {waitingText}</p>
            <span className="ou-hm-chatactions">
              <Button size="sm" variant="primary" label="Send now" isDisabled={!working} onClick={() => void sendNow()} />
              <Button size="sm" variant="ghost" label="Edit" isDisabled={!working} onClick={editQueued} />
              <Button size="sm" variant="ghost" label="Clear" onClick={clearQueued} />
            </span>
          </div>
        ) : queue ? (
          <div className="ou-hm-ask"><TextInput size="sm" label="Queue a follow-up" isLabelHidden placeholder={`Next message for ${nameOf(x)}: Enter queues it, Tab redirects now`} value={draft} onChange={setDraft} onEnter={enqueue} onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey && draft.trim()) { e.preventDefault(); const t = draft.trim(); setDraft(''); void sendFollowUp(x, t).then((ok) => { if (!ok) setDraft(t); }); } }} width="100%" /></div>
        ) : null}
        {pending.length ? (
          <div className="ou-hm-waiton">
            <span className="ou-hm-waitlabel">Waiting on {pending.length} {pending.length === 1 ? 'subagent' : 'subagents'}</span>
            <span className="ou-hm-waitnames">{pending.map(nameOf).join(', ')}</span>
            {isWorking(x) || pending.some(isWorking) ? <button type="button" className="ou-hm-stop" title="Interrupt the orchestrator (sends Esc)" onClick={stop}><Stop size={12} />Stop</button> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const NEW_USER_HEADING = 'What do you want done?';

function StartState({ composer }) {
  return (
    <div className="ou-hm-start">
      <h1 className="ou-hm-hello">{ui.snap?.has_sessions === false ? NEW_USER_HEADING : 'Pick up where your agents left off'}</h1>
      {composer}
    </div>
  );
}

const openOnWall = (x) => {
  homeView.set('wall');
  if (x.project_id && x.project_id !== ui.projectId) { ui.pendingPick = x.id; switchProject(x.project_id); return; }
  void pick(x.id);
};

const openInEditor = async (x) => {
  const root = ui.snap?.git?.[x.id]?.root;
  const proj = (ui.snap?.projects || []).find((p) => p.id === x.project_id);
  let target = x.project_id;
  if (root && proj && root.toLowerCase() !== String(proj.path).toLowerCase()) {
    const r = await rpc('project.open', { path: root });
    if (r && r.result) target = r.result.project_id;
  }
  if (target && target !== ui.projectId) switchProject(target);
  homeView.set('ide');
};

function HomeTerminal({ id }) {
  const host = useRef(null);
  useLayoutEffect(() => {
    termView.lend(id, host.current);
    return () => termView.lend(null);
  }, [id]);
  return <div ref={host} className="ou-hm-term" aria-label="Agent terminal" />;
}

function TaskPanel({ task, kids }) {
  const [tab, setTab] = useState('terminal');
  return <>
    <SegmentedControl label="Task panel" size="sm" value={tab} onChange={setTab}>
      <SegmentedControlItem value="terminal" label="Terminal" icon={<TerminalIcon size={14} />} />
      <SegmentedControlItem value="details" label="Details" icon={<PanelToggle size={14} />} />
    </SegmentedControl>
    <div id="home-panel-body" className="ou-hm-panelbody" role="tabpanel" aria-label={tab === 'terminal' ? 'Agent terminal' : 'Task details'}>
      {tab === 'terminal' ? <HomeTerminal id={task.id} /> : <RailCard sel={task} kids={kids} />}
    </div>
  </>;
}

const openChanges = async (x) => {
  openOnWall(x);
  if (typeof openTab === 'function') await openTab('diff');
};

const openFolder = async (x) => {
  const r = await api.openFolder(x.id);
  if (!r || r.error) toast((r && r.error) || 'Could not open the folder', true);
};

export const lineageTitle = (kids) => `Lineage · ${summarizeSubagentStatuses(kids.map(statusOf))}`;

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
  const [busy, setBusy] = useState(false);
  const g = (sel && ui.snap?.git?.[sel.id]) || {};
  const branch = sel ? g.branch || sel.branch || null : null;
  const pr = g.pr || null;
  const host = sel ? ((g.root || sel.cwd) ? (g.root || sel.cwd).split(/[/\\]/).filter(Boolean).pop() : (ui.snap?.projects || []).find((p) => p.id === sel.project_id)?.name || 'This computer') : '';
  return (
    <div className="ou-hm-card">
      {sel ? (
        <Swap k={sel.id}>
          <PanelSection title="Workspace">
            <PanelRow icon={projectOf(sel)?.icon ? <ProjectIcon icon={projectOf(sel).icon} size={16} /> : hostIcon} label={host}>
              <button type="button" className="ou-hm-pact" aria-label={`Open ${host} folder`} title="Open the folder" onClick={() => void openFolder(sel)}>{folderSmall}</button>
            </PanelRow>
            <PanelRow icon={<ExternalLinkIcon size={16} />} label="Open in editor" chevron onClick={() => openInEditor(sel)} />
            <PanelRow icon={editorIcon} label="Open on Wall" chevron onClick={() => openOnWall(sel)} />
          </PanelSection>
          {branch ? (
            <PanelSection title="Version control">
              <PanelRow icon={branchIcon} label={branch} mono />
              {g.commit ? <PanelRow icon={commitIcon} label="Commit" value={<span className="ou-hm-mono">{g.commit}</span>} /> : null}
              <PanelRow icon={filesIcon} label="Changes" chevron onClick={() => void openChanges(sel)} value={<span className="ou-hm-mono"><b className="ou-hm-add">+{g.added || 0}</b> <b className="ou-hm-del">-{g.deleted || 0}</b></span>} />
              {pr ? (
                <PanelRow icon={prIcon} label={`PR #${pr.number}`} onClick={pr.url && typeof openTermLink === 'function' ? () => openTermLink(pr.url) : undefined}
                  value={<span className={`ou-hm-checks ou-hm-ck-${pr.checks || 'none'}`}>{[pr.checks ? `checks ${pr.checks}` : null, String(pr.state || '').toLowerCase()].filter(Boolean).join(' · ')}</span>}>
                  {String(pr.state).toUpperCase() === 'OPEN' ? <Button size="sm" variant="ghost" label="Merge" isLoading={busy} onClick={(e) => { e?.stopPropagation?.(); setMerging(true); }} /> : null}
                </PanelRow>
              ) : null}
            </PanelSection>
          ) : null}
          {kids.length ? (
            <PanelSection title={lineageTitle(kids)} heading>
              <ul className="ou-hm-members ou-hm-lin">
                {kids.map((k) => (
                  <li key={k.id}>
                    <button type="button" className="ou-hm-prow ou-hm-pclick ou-hm-linrow" style={{ width: 'calc(100% + 2 * var(--sp-2))', textAlign: 'left' }} data-status={statusOf(k)} title={tipOf(k)} onClick={(e) => { e.stopPropagation(); openOnWall(k); }}>
                      <span className="ou-hm-lintext"><span className="ou-hm-plabel">{nameOf(k)}</span><span className="ou-hm-linmeta"><Status k={k} /><Engine id={k.engine_id} /></span></span>
                      <span className="ou-hm-pvalue ou-hm-small">{elapsedOf([k])}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </PanelSection>
          ) : null}
        </Swap>
      ) : null}
      {merging && pr ? (
        <AlertDialog isOpen onOpenChange={(o) => { if (!o) setMerging(false); }} title={`Merge PR #${pr.number}?`}
          description={`This merges ${branch || 'the branch'} on GitHub. It cannot be undone from cc.`} actionLabel="Merge"
          onAction={async () => {
            setMerging(false);
            setBusy(true);
            let r;
            try { r = await api.prMerge(sel.id); } catch (err) { r = { error: String(err?.message || err) }; } finally { setBusy(false); }
            if (r && r.ok) toast(`Merged PR #${pr.number}`); else toast((r && r.error) || 'Could not merge', true);
          }} />
      ) : null}
    </div>
  );
}

function HeadTitle({ x, details, toggleDetails }) {
  const [hosts, setHosts] = useState(null);
  useLayoutEffect(() => {
    const bar = globalThis.document?.querySelector?.('header.title');
    const crumb = bar?.querySelector('.crumb');
    if (!crumb) return undefined;
    const title = document.createElement('span');
    title.className = 'ou-hm-head';
    crumb.after(title);
    const acts = document.createElement('span');
    acts.className = 'ou-hm-headacts';
    bar.append(acts);
    setHosts({ title, acts });
    return () => { title.remove(); acts.remove(); };
  }, []);
  if (!hosts) return null;
  const label = details ? 'Hide details' : 'Show details';
  return <>
    {createPortal(<><span className="ou-hm-headsep" aria-hidden="true">/</span><h2 className="ou-hm-headtitle" title={nameOf(x)}>{nameOf(x)}</h2></>, hosts.title)}
    {createPortal(<>
      {canStop(x) ? <button type="button" className="ou-hm-paneltog" aria-label="Stop this agent" title="Stop this agent (Ctrl+C, then end it)" onClick={() => void stopAgent(x.id)}><Stop size={14} /></button> : null}
      <button type="button" className="ou-hm-paneltog" aria-pressed={details} aria-label={label} title={label} onClick={toggleDetails}><PanelToggle size={16} /></button>
    </>, hosts.acts)}
  </>;
}

export function Home() {
  const { open = [], details = true, selected: launched } = homeStore.use();
  const selected = ui.homeSel;
  useEffect(() => { if (homeView.shown()) homeStore.set({ open: [] }); }, [homeView.shown()]);
  useEffect(() => {
    if (launched && [...(ui.snap?.sessions || []), ...(ui.snap?.live || [])].some((x) => x.id === launched)) homeStore.set({ selected: null });
  }, [launched, ui.snap]);
  if (ui.view === 'automations' && project()) return <AutomationsPage />;
  if (ui.view === 'wall') { const centre = document.getElementById('centre'); return centre?.nodeType === 1 ? createPortal(<WallEmpty />, centre) : null; }
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
  if (!task && selected !== '' && selected !== launched) ui.homeSel = '';
  const ready = (s.engines || []).filter((e) => e.light !== 'red');
  const composer = ready.length ? <StartBox ready={ready} strip={Boolean(task)} /> : <EmptyState title="No agent is ready. Check Add-ons." isCompact actions={<div className="ou-hm-starters"><Button size="sm" variant="secondary" label="Check again" onClick={() => void rpc('engines.check', {})} /><Button size="sm" variant="ghost" label="Add-ons" onClick={() => homeView.set('addons')} /></div>} />;
  return (
    <div className={`ou-home ou-hm${task && details ? '' : ' ou-hm-solo'}`}>
      <div className="ou-hm-main">
        {task ? (
          <>
            <HeadTitle x={task} details={details} toggleDetails={() => homeStore.set({ details: !details })} />
            <div className="ou-hm-center"><Swap k={task.id}><TaskView key={task.id} x={task} picked={picked} kids={kidsOf(task.id)} openList={openList} toggle={toggle} /></Swap></div>
            <div className="ou-hm-dock">{composer}</div>
          </>
        ) : <StartState composer={composer} />}
      </div>
      {task && details ? <aside className="ou-hm-rail"><TaskPanel task={task} kids={kidsOf(task.id)} /></aside> : null}
    </div>
  );
}
