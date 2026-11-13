import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import { AutomationsPage } from './automations.jsx';
import { EngineMark, engineName, statusOf, STATUS_WORD, Branch, CommitIcon as Commit, ChangesIcon as Changes, PullRequestIcon as PullRequest, Workspace, OpenOnWall, StepOpenIcon as StepOpen, Done, Project, ApprovalIcon as Approval, ChevronRightIcon as ChevronRight, FolderAddIcon as FolderAdd, ScheduleIcon as Schedule, WallIcon as Wall, LearnIcon as Learn, StopIcon as Stop, CalendarIcon as Calendar, ProjectIcon, LaptopIcon, FolderIcon } from './icons/index.js';
import { composer, atRefs } from './composer.jsx';
import { canMove, conceal, crossfade, reveal } from './motion.js';
import { ExternalLinkIcon } from './icons/screens.jsx';
import { PanelToggle } from './icons/index.js';
import './home-ref.css';
import './frame-ref.css';

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
  const [engine, setEngine] = useState(ui.drafts['home-engine'] || load('engine') || ready[0].id);
  const chosen = ready.some((e) => e.id === engine) ? engine : ready[0].id;
  const [more, setMore] = useState(false);
  const [branch, setBranch] = useState('');
  const [model, setModel] = useState('');
  const [approval, setApproval] = useState('default');
  const [starting, setStarting] = useState(false);
  const [models, setModels] = useState({});
  useEffect(() => {
    if (models[chosen] || typeof rpc !== 'function') return;
    void rpc('engines.models', { engine_id: chosen }, true).then((r) => { if (r && r.result) setModels((m) => ({ ...m, [chosen]: r.result.models })); });
  }, [chosen]);

  const start = async () => {
    setStarting(true);
    try { await launch(); } finally { setStarting(false); }
  };
  const launch = async () => {
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
  const proj = projectOf({ project_id: ui.projectId });
  const gitBranch = ui.git && ui.git.project === ui.projectId ? ui.git.branch : null;
  const active = new Map([...(ui.snap?.sessions || []), ...(ui.snap?.live || [])].map((x) => [x.id, x])).values().filter((x) => x.project_id === ui.projectId && ACTIVE_STATES.has(x.state)).toArray().length;
  return composer({
    className: 'ou-hm-composerwrap ou-hm-task',
    strip,
    filled: Boolean(task.trim()),
    onKeyDown: (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void start(); } },
    field: <TextArea label="Task for a new agent" isLabelHidden rows={2} value={task} placeholder="Ask an agent to do something. @ to mention files, / for commands" onChange={edit} />,
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
    send: { label: 'Start', tooltip: 'Start (Ctrl+Enter)', 'data-action': 'home-start', 'data-engine': chosen, onClick: start },
    attach: (paths) => {
      edit(atRefs(task, paths, proj?.path));
      document.querySelector?.('#home .ou-hm-composerwrap textarea')?.focus();
    },
    status: { state: starting || active ? 'active' : 'idle', label: starting ? 'Starting' : active ? `${active} agent${active === 1 ? '' : 's'} running` : 'No agent running' },
    context: [
      { key: 'project', plain: true, icon: folderSmall, node: <Selector label="Project" isLabelHidden size="sm" variant="ghost" placement="above" value={ui.projectId || ''} onChange={(v) => { if (v && v !== ui.projectId) switchProject(v); }}
        options={(ui.snap?.projects || []).map((p) => ({ value: p.id, label: p.name }))} /> },
      { key: 'machine', icon: laptopSmall, text: 'Local', title: 'Agents run on this computer' },
      branch.trim() || gitBranch ? { key: 'branch', icon: branchSmall, text: branch.trim() ? `${branch.trim()} (new worktree)` : gitBranch } : null,
      { key: 'gap', gap: true },
      { key: 'access', accent: true, node: <Selector label="Approval" isLabelHidden size="sm" variant="ghost" placement="above" value={approval} onChange={setApproval}
        renderValue={() => ACCESS[approval === 'default' ? ui.settingsLook?.approval || 'ask' : approval] || 'Ask first'} options={[
        { value: 'default', label: `${ACCESS[ui.settingsLook?.approval] || 'Ask first'} (from Settings)` },
        { value: 'ask', label: 'Ask first' },
        { value: 'edits', label: 'Edits allowed' },
        { value: 'contained', label: 'Auto' },
      ]} /> },
    ],
  });
}

const stepsOf = (x) => (x.steps && x.steps.total ? { done: x.steps.done, total: x.steps.total, items: x.steps.items || [] } : null);
const ACCESS = { ask: 'Ask first', edits: 'Edits allowed', contained: 'Auto', isolated: 'Full access' };
const ACTIVE_STATES = new Set(['waiting_for_you', 'working', 'starting', 'unknown']);
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

const press = (fn) => ({
  role: 'button', tabIndex: 0,
  onClick: (e) => { e.stopPropagation(); fn(); },
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } },
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
          <span className="ou-hm-slimname">{nameOf(k)}{lead ? <span className="ou-hm-role">orchestrator</span> : null}{st && lead ? <span className="ou-hm-slimsteps">{st.done}/{st.total}</span> : null}</span>
          <span className="ou-hm-slimsub"><Status k={k} /><Engine id={k.engine_id} />{k.model ? <span className="ou-hm-model">{k.model}</span> : null}{doing ? <span className={statusOf(k) === 'failed' ? 'ou-hm-bad' : ''}>{doing}</span> : null}</span>
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
      <span className="ou-hm-ttext">
        <span className="ou-hm-tline"><span className="ou-hm-tlabel">{label}</span><span className="ou-hm-engs">{kids.slice(0, 3).map((k) => <EngineMark key={k.id} id={k.engine_id} size={14} />)}{kids.length > 3 ? <span className="ou-hm-more">+{kids.length - 3}</span> : null}</span></span>
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
    try { await troop.termInput(x.id, t + '\r'); setAnswer(''); toast(`Sent to ${engineName(x.engine_id)}`); } catch (err) { toast(String(err?.message || err), true); }
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
    try { await troop.termInput(x.id, '\u001b'); toast(`Asked ${engineName(x.engine_id)} to stop`); } catch (err) { toast(String(err?.message || err), true); }
  };
  return (
    <article className="ou-hm-taskview" data-id={x.id} data-state={x.state} aria-label={`${proj}${branch ? ` on ${branch}` : ''}: ${nameOf(x)}`}>
      {x.prompt ? <div className="ou-hm-user"><p>{String(x.prompt).trim()}</p></div> : null}
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
        {x.last_line || x.reason ? <p className="ou-hm-latest">{x.last_line || x.reason}</p> : null}
        {s === 'waiting' ? (
          <div className="ou-hm-ask"><TextInput size="sm" label="Answer" isLabelHidden placeholder={here ? `Answer ${nameOf(x)}, Enter sends` : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} width="100%" isDisabled={!here} /></div>
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

const startIcons = { folder: <FolderAdd size={18} />, clock: <Calendar size={18} />, wall: <Wall size={18} />, book: <Learn size={18} /> };

function StartState({ composer }) {
  const items = [
    ['folder', 'Import projects', 'Add a folder from this computer', null, 'open-folder'],
    ['clock', 'Automations', 'Agents that start on a schedule', () => homeView.set('automations')],
    ['wall', 'Open the Wall', 'Every agent terminal side by side', () => homeView.set('wall')],
    ['book', 'Learn cc', 'Shortcuts and commands', () => globalThis.paletteView?.open?.()],
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

const openInEditor = (x) => {
  if (x.project_id && x.project_id !== ui.projectId) switchProject(x.project_id);
  homeView.set('ide');
};

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
                  {String(pr.state).toUpperCase() === 'OPEN' ? <Button size="sm" variant="ghost" label="Merge" onClick={(e) => { e?.stopPropagation?.(); setMerging(true); }} /> : null}
                </PanelRow>
              ) : null}
            </PanelSection>
          ) : null}
          {kids.length ? (
            <PanelSection title={lineageTitle(kids)} heading>
              <ul className="ou-hm-members ou-hm-lin">
                {kids.map((k) => (
                  <li key={k.id} className="ou-hm-prow ou-hm-pclick ou-hm-linrow" data-status={statusOf(k)} title={tipOf(k)} {...press(() => openOnWall(k))}>
                    <span className="ou-hm-lintext"><span className="ou-hm-plabel">{nameOf(k)}</span><span className="ou-hm-linmeta"><Status k={k} /><Engine id={k.engine_id} /></span></span>
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
          description={`This merges ${branch || 'the branch'} on GitHub. It cannot be undone from cc.`} actionLabel="Merge"
          onAction={async () => {
            setMerging(false);
            const r = await api.prMerge(sel.id);
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
    {createPortal(<button type="button" className="ou-hm-paneltog" aria-pressed={details} aria-label={label} title={label} onClick={toggleDetails}><PanelToggle size={16} /></button>, hosts.acts)}
  </>;
}

export function Home() {
  const { open = [], details = true } = homeStore.use();
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
  if (!task && selected !== '') ui.homeSel = '';
  const ready = (s.engines || []).filter((e) => e.light !== 'red');
  const composer = ready.length ? <StartBox ready={ready} strip={Boolean(task)} /> : <EmptyState title="No agent is ready. Check Add-ons." isCompact />;
  return (
    <div className={`ou-home ou-hm${task && details ? '' : ' ou-hm-solo'}`}>
      <div className="ou-hm-main">
        {task ? (
          <>
            <HeadTitle x={task} details={details} toggleDetails={() => homeStore.set({ details: !details })} />
            <div className="ou-hm-center"><Swap k={task.id}><TaskView x={task} kids={kidsOf(task.id)} openList={openList} toggle={toggle} /></Swap></div>
            <div className="ou-hm-dock">{composer}</div>
          </>
        ) : <StartState composer={composer} />}
      </div>
      {task && details ? <aside className="ou-hm-rail"><RailCard sel={task} kids={kidsOf(task.id)} /></aside> : null}
    </div>
  );
}
