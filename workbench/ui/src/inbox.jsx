import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { createStore } from './store.js';
import { composer, atRefs } from './composer.jsx';
import * as Ic from './icons/index.js';
import * as Sc from './icons/screens.jsx';
import './needsyou-ref.css';
import { PROJECT_COLOURS } from './icons/shapes.js';

export const inboxStore = createStore({ tick: 0, filter: 'all', collapsed: [], selectedId: null, props: true });

const LOOP_CHOICES = [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']];
const PRIORITIES = [['none', 'No priority'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];
const RANK = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
const DONE_STATES = ['done', 'exited', 'idle'];
const NOTICE_WORD = { done: 'Finished', failed: 'Failed', handoff: 'Handed back', uncommitted: 'Uncommitted changes', question: 'Question' };

let gsap = null;
let Flip = null;
let calm = true;
// gsap reads document on import, so it loads only where a real DOM exists
if (typeof Document === 'function' && typeof document !== 'undefined' && document instanceof Document && typeof window.matchMedia === 'function') {
  Promise.all([import('gsap'), import('gsap/Flip')]).then(([core, flip]) => {
    core.gsap.registerPlugin(flip.Flip);
    core.gsap.matchMedia().add({ calm: '(prefers-reduced-motion: reduce)', move: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
      calm = Boolean(ctx.conditions.calm);
    });
    [gsap, Flip] = [core.gsap, flip.Flip];
  });
}
export const motionOn = () => Boolean(gsap) && !calm;

const rowEl = (id) => (typeof document === 'undefined' ? null : document.querySelector(`.ou-inbox .ou-irow[data-id="${CSS.escape(id)}"]`));

export function leaveRow(id, then) {
  const el = rowEl(id);
  if (!motionOn() || !el) return then();
  gsap.to(el, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.2, ease: 'power2.in', overwrite: true, onComplete: then });
}

function ListMotion({ order, counts, children }) {
  const ref = useRef(null);
  const last = useRef({ order: null, counts: null, state: null });
  if (ref.current && last.current.order !== null && last.current.order !== order && motionOn()) {
    last.current.state = Flip.getState(ref.current.querySelectorAll('.ou-irow'));
  }
  useLayoutEffect(() => {
    const root = ref.current;
    const prev = last.current;
    if (prev.order === null) {
      if (motionOn()) gsap.from([...root.querySelectorAll('.ou-irow')].slice(0, 12), { opacity: 0, y: 4, duration: 0.2, stagger: 0.02, ease: 'power2.out', clearProps: 'opacity,transform' });
    } else if (prev.state) {
      Flip.from(prev.state, {
        targets: root.querySelectorAll('.ou-irow'),
        duration: 0.35,
        ease: 'power3.inOut',
        nested: true,
        onEnter: (els) => gsap.from(els, { opacity: 0, height: 0, duration: 0.25, ease: 'power2.out', clearProps: 'all' }),
      });
    }
    if (prev.counts && motionOn()) {
      root.querySelectorAll('.ou-ny-gcount').forEach((el) => {
        const from = prev.counts[el.dataset.group];
        const to = Number(el.dataset.n);
        if (from == null || from === to) return;
        const box = { n: from };
        gsap.to(box, { n: to, duration: 0.35, ease: 'power3.inOut', snap: { n: 1 }, onUpdate: () => { el.textContent = String(box.n); } });
      });
    }
    last.current = { order, counts, state: null };
  }, [order]);
  return <div className="ou-ny-groups" ref={ref}>{children}</div>;
}

function Fold({ open, head, children }) {
  const ref = useRef(null);
  const kept = useRef(children);
  const [closing, setClosing] = useState(false);
  const first = useRef(true);
  if (open) kept.current = children;
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const body = ref.current?.querySelector('.ou-ny-gbody');
    const chev = ref.current?.querySelector('.ou-ny-gchev');
    if (!motionOn()) { setClosing(false); return; }
    if (chev) gsap.to(chev, { rotation: open ? 90 : 0, duration: 0.2, ease: 'power2.out', overwrite: true });
    if (!body) return;
    if (open) {
      gsap.fromTo(body, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.2, ease: 'power2.out', overwrite: true, clearProps: 'height,opacity' });
    } else {
      setClosing(true);
      gsap.to(body, { height: 0, opacity: 0, duration: 0.2, ease: 'power2.in', overwrite: true, onComplete: () => setClosing(false) });
    }
  }, [open]);
  const shown = open ? children : closing ? kept.current : null;
  return (
    <section className="ou-ny-group" ref={ref} data-open={open ? 'true' : 'false'}>
      {head}
      {shown ? <ul className="ou-list ou-ny-gbody">{shown}</ul> : null}
    </section>
  );
}

function Swap({ k, children }) {
  const ref = useRef(null);
  const prevKey = useRef(k);
  const ghost = useRef(null);
  if (ref.current && prevKey.current !== k && motionOn()) ghost.current = ref.current.cloneNode(true);
  useLayoutEffect(() => {
    if (prevKey.current === k) return;
    prevKey.current = k;
    const el = ref.current;
    const old = ghost.current;
    ghost.current = null;
    if (!el || !old || !motionOn()) return;
    old.classList.add('ou-ny-ghost');
    old.setAttribute('aria-hidden', 'true');
    el.parentNode.insertBefore(old, el);
    gsap.to(old, { opacity: 0, x: -4, duration: 0.16, ease: 'power2.out', onComplete: () => old.remove() });
    gsap.fromTo(el, { opacity: 0, x: 6 }, { opacity: 1, x: 0, duration: 0.22, delay: 0.06, ease: 'power2.out', overwrite: true, clearProps: 'opacity,transform' });
  }, [k]);
  return <div className="ou-ny-doc" ref={ref}>{children}</div>;
}

function Slide({ open, children }) {
  const ref = useRef(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el || !motionOn()) return;
    gsap.fromTo(el, { width: open ? 0 : 280 }, { width: open ? 280 : 0, duration: 0.25, ease: open ? 'power2.out' : 'power2.inOut', overwrite: true, clearProps: 'width' });
    if (open) gsap.fromTo(el.children, { opacity: 0 }, { opacity: 1, duration: 0.15, delay: 0.1, overwrite: true, clearProps: 'opacity' });
  }, [open]);
  return <aside className="ou-ny-props" ref={ref} data-open={open ? 'true' : 'false'} inert={!open}>{children}</aside>;
}

function Bar({ done, total }) {
  const [shown, setShown] = useState(done);
  const box = useRef({ n: done });
  useEffect(() => {
    if (!motionOn()) { box.current.n = done; setShown(done); return; }
    const t = gsap.to(box.current, { n: done, duration: 0.4, ease: 'power2.out', onUpdate: () => setShown(box.current.n) });
    return () => t.kill();
  }, [done]);
  return <ProgressBar label="Sub-tasks done" isLabelHidden value={shown} max={Math.max(total, 1)} variant="success" className="ou-ny-progress" />;
}

const I = {
  up: <Sc.ChevronUpIcon size={14} />,
  down: <Ic.ChevronDownIcon size={14} />,
  close: <Sc.CloseIcon size={14} />,
  wall: <Ic.OpenOnWall size={14} />,
  panel: <Ic.PanelToggle size={14} />,
  read: <Sc.MailIcon size={14} />,
  archive: <Sc.ArchiveIcon size={14} />,
  open: <Sc.ExternalLinkIcon size={14} />,
  plus: <Ic.NewSubTask size={14} />,
  chev: <Ic.ChevronRightIcon size={12} className="ou-ny-gchev" />,
  branch: <Ic.Branch size={12} />,
  arrow: <Sc.ExternalLinkIcon size={12} />,
  folder: <Ic.Workspace size={12} />,
  search: <Ic.Search size={14} />,
  label: <Ic.Label size={14} />,
};

const sid = (id) => String(id || '').slice(0, 8);
const nameOf = (x) => ((x.title && !/[\\/]/.test(x.title) ? x.title : '') || (x.prompt || '').replace(/\s+/g, ' ').trim() || taskOf(x));
const TONES = ['run', 'ok', 'wait', 'bad', 'review'];
const toneOf = (text) => TONES[[...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
const labelColour = (text, colour) => (colour === PROJECT_COLOURS.gray || (!colour && toneOf(text) === 'review') ? 'var(--hairline-strong)' : colour || null);
const labelPill = (text, onRemove, colour) => (
    <span key={text} className={`ou-ny-label${labelColour(text, colour) ? '' : ` ou-ny-tone-${toneOf(text)}`}`} style={labelColour(text, colour) ? { '--lc': labelColour(text, colour) } : undefined}>
      <span>{text}</span>
      {onRemove ? <button type="button" className="ou-ny-chip-remove" aria-label={`Remove label ${text}`} onClick={(e) => { e?.stopPropagation?.(); onRemove(); }}>{I.close}</button> : null}
    </span>
);

const RING = { needs: [Ic.NeedsYou, 'Needs you'], working: [Ic.Working, 'Working'], review: [Ic.InReview, 'In review'], blocked: [Ic.Blocked, 'Blocked'], failed: [Ic.Failed, 'Failed'] };
function StatusRing({ status, size = 14 }) {
  const [Ring, label] = RING[status] || [Ic.Done, 'Finished'];
  return <Ring size={size} className={`ou-ny-ring ou-ny-ring-${status}`} title={label} />;
}

const PRI = { none: Ic.None, low: Ic.Low, medium: Ic.Medium, high: Ic.High, urgent: Ic.Urgent };
function PriorityIcon({ level }) {
  const Pri = PRI[level] || Ic.None;
  return <Pri size={14} className={`ou-ny-pri ou-ny-pri-${level || 'none'}`} title={PRIORITIES.find(([v]) => v === (level || 'none'))[1]} />;
}

function Avatar({ name, big }) {
  return <span className={`ou-ny-avatar${big ? ' ou-ny-avatar-big' : ''}`} aria-hidden="true">{(name || '?').slice(0, big ? 2 : 1).toUpperCase()}</span>;
}

function NoteActions({ n }) {
  const loop = loopOf(n);
  const lend = lendOf(n);
  return (
    <span className="ou-actions">
      {loop ? LOOP_CHOICES.map(([choice, label]) => <Button key={choice} size="sm" label={label} data-action="loop-choose" data-id={loop} data-choice={choice} />) : null}
      {lend ? <Button size="sm" variant="primary" label="Lend this site" data-action="lend-set" data-project={lend.project} data-origin={lend.origin} /> : null}
      {lend ? <Button size="sm" label="No" data-action="dismiss" data-id={n.id} /> : null}
      <Button size="sm" variant="ghost" label={n.read_at ? 'Mark unread' : 'Mark read'} data-action={n.read_at ? 'inbox-unread' : 'inbox-read'} data-id={n.id} />
    </span>
  );
}

function useRpcResult(method, params, key, pick) {
  const [state, setState] = useState({ value: null, error: false });
  useEffect(() => {
    if (!key) {
      setState({ value: null, error: false });
      return;
    }
    let active = true;
    rpc(method, params, true)
      .then((res) => { if (active) setState(pick(res)); })
      .catch(() => { if (active) setState({ value: null, error: true }); });
    return () => { active = false; };
  }, [key]);
  return state;
}

function useSessionText(sessionId, stamp) {
  const { value, error } = useRpcResult('session.read', { session_id: sessionId, lines: 200 }, sessionId ? `${sessionId}\u0000${stamp}` : null, (res) => {
    const lines = res && res.result ? res.result.lines : null;
    const text = lines == null ? '' : Array.isArray(lines) ? lines.join('\n') : String(lines);
    return text ? { value: text, error: false } : { value: null, error: true };
  });
  return { text: value, error };
}

export function findServiceUrl(text) {
  if (!text) return null;
  const urls = (text.match(/https?:\/\/[^\s'"<>)]+/g) || []).filter((raw) => {
    try {
      const u = new URL(raw);
      return ['localhost', '127.0.0.1', '0.0.0.0'].includes(u.hostname) && !u.username && !u.password;
    } catch {
      return false;
    }
  });
  if (!urls.length) return null;
  const u = new URL(urls[urls.length - 1]);
  if (u.hostname === '0.0.0.0') u.hostname = 'localhost';
  return u.href;
}

function TerminalPreview({ text, error }) {
  const lines20 = text ? text.split('\n').slice(-20).join('\n') : null;
  return (
    <div className="ou-ny-entry ou-ny-terminal-block">
      <div className="ou-ny-entry-head"><span className="ou-ny-entry-who">Last output</span></div>
      {error || !lines20 ? <div className="ou-ipane-muted">No terminal text to show yet. Open it on the Wall.</div> : <pre className="ou-ipane-pre">{lines20}</pre>}
    </div>
  );
}

function formatTokens(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return String(num);
}

function formatCost(usd, usdEstimated, unpriced) {
  const val = Number(usd) || 0;
  if (val === 0 && unpriced > 0) return 'not priced';
  const formatted = '$' + val.toFixed(2);
  return usdEstimated ? '~' + formatted : formatted;
}

function RunLedger({ sessionId }) {
  const { value: data, error } = useRpcResult('usage.session', { session_id: sessionId }, sessionId, (res) => (res && res.result ? { value: res.result, error: false } : { value: null, error: true }));
  const total = data ? (Number(data.tokens_in) || 0) + (Number(data.tokens_out) || 0) : 0;
  if (!sessionId || error || !data || total === 0) return <span className="ou-ny-muted" data-slot="run-ledger">{sessionId && !data && !error ? 'Loading usage.' : 'No usage yet'}</span>;
  return (
    <div className="ou-ny-ledger" data-slot="run-ledger">
      <div className="ou-ny-ledger-head">
        <span>{formatTokens(data.tokens_in)} in {'·'} {formatTokens(data.tokens_out)} out</span>
        <span className="ou-ny-ledger-cost">{formatCost(data.usd, data.usd_estimated, data.unpriced)}</span>
      </div>
      {(data.by_model || []).length === 1 ? <div className="ou-ny-ledger-model ou-ny-ledger-one" title={data.by_model[0].model}>{data.by_model[0].model}</div> : (data.by_model || []).map((row, idx) => (
        <div className="ou-ny-ledger-row" key={row.model || idx}>
          <span className="ou-ny-ledger-model" title={row.model}>{row.model}</span>
          <span>{formatTokens(row.tokens_in)}</span>
          <span>{formatTokens(row.tokens_out)}</span>
          <span>{formatCost(row.usd)}</span>
        </div>
      ))}
    </div>
  );
}

const AnswerArea = ({ onEnter, ...props }) => <TextArea {...props} />;

function DetailAsk({ x }) {
  const [answer, setAnswer] = useState('');
  const here = !x.project_id || x.project_id === ui.projectId;
  const projectName = ui.snap?.projects?.find((p) => p.id === x.project_id)?.name || 'another project';
  const branch = ui.snap?.git?.[x.id]?.branch || x.branch || null;
  const send = async () => {
    if (!here) return;
    const textToSend = answer.trim();
    if (!textToSend) return;
    try {
      await troop.termInput(x.id, textToSend + '\r');
      setAnswer('');
      toast(`Sent to ${Ic.engineName(x.engine_id)}`);
    } catch (err) {
      toast(String((err && err.message) || err), true);
    }
  };
  return (
    <div className="ou-ny-composer ou-ipane-answer">
      {composer({
        filled: Boolean(here && answer.trim()),
        onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing && e.target?.tagName === 'TEXTAREA') { e.preventDefault(); void send(); } },
        field: <AnswerArea label="Answer" isLabelHidden rows={2} placeholder={here ? `Answer ${x.engine_id ? Ic.engineName(x.engine_id) : 'the agent'}, Enter sends` : 'Answer from its own project'} value={answer} onChange={setAnswer} onEnter={send} isDisabled={!here} />,
        engine: x.engine_id ? { id: x.engine_id, readOnly: true } : undefined,
        strip: true,
        status: { state: Ic.statusOf(x), label: Ic.statusWord(x) },
        attach: here ? (paths) => setAnswer(atRefs(answer, paths, ui.snap?.projects?.find((p) => p.id === (x.project_id || ui.projectId))?.path)) : undefined,
        send: { size: 'sm', label: 'Send', tooltip: 'Send (Enter)', isDisabled: !here || !answer.trim(), onClick: send },
        context: [
          { key: 'project', icon: <Ic.FolderIcon size={16} />, text: here ? ui.snap?.projects?.find((p) => p.id === ui.projectId)?.name || 'This project' : projectName },
          { key: 'machine', icon: <Ic.LaptopIcon size={16} />, text: 'Local', title: 'Agents run on this computer' },
          branch ? { key: 'branch', icon: <Ic.Branch size={14} />, text: branch } : null,
          { key: 'gap', gap: true },
        ],
      })}
      {!here ? <span className="ou-ipane-muted">{`In ${projectName}. Open it on the Wall to answer.`}</span> : null}
    </div>
  );
}

function DetailNotice({ n }) {
  const time = ago(n.at);
  return (
    <div className="ou-ny-entry ou-ipane-notice">
      <div className="ou-ny-entry-head"><span className="ou-ny-entry-who">{NOTICE_WORD[n.kind] || 'Notice'}</span>{time ? <span className="ou-ny-muted">{time}</span> : null}</div>
      <div className="ou-ny-entry-body ou-ipane-noticetext">{n.text}</div>
      <div className="ou-ny-entry-acts">
        {((n.kind === 'done' || n.kind === 'failed') && n.ref) || n.kind === 'uncommitted' ? <Button size="sm" variant="ghost" label="Open" onClick={() => openNotice(n)} /> : null}
        <NoteActions n={n} />
      </div>
    </div>
  );
}

const openNotice = (n) => {
  const s = [...(ui.snap.live || []), ...(ui.snap.sessions || [])].find((x) => x.id === n.ref);
  homeView.set('wall');
  if (s && s.project_id && s.project_id !== ui.projectId) { ui.pendingNeedsYou = n.id; switchProject(s.project_id); return; }
  void openNeedsYou(n.id);
};

const openWorkspace = async (x) => {
  const res = await api.openFolder(x.id);
  if (!res || res.error) toast((res && res.error) || 'Could not open the folder', true);
};

const openProjectHome = (projectId) => {
  homeView.set('home');
  if (projectId && projectId !== ui.projectId) switchProject(projectId);
};

const openOnWall = (x) => {
  homeView.set('wall');
  if (x.project_id && x.project_id !== ui.projectId) {
    ui.pendingPick = x.id;
    switchProject(x.project_id);
    return;
  }
  void pick(x.id);
};

const WHAT = { needs: 'asked a question', working: 'working', review: 'waiting for review', failed: 'failed', done: 'finished', blocked: 'blocked' };
const WORD = { needs: 'Needs you', working: 'Working', review: 'In review', failed: 'Failed', done: 'Done', blocked: 'Blocked' };

async function write(method, params, apply, undo, failText) {
  apply();
  inboxStore.set({ tick: inboxStore.get().tick + 1 });
  const r = await rpc(method, params);
  if (!r || r.error) {
    undo();
    inboxStore.set({ tick: inboxStore.get().tick + 1 });
    toast((r && r.error && r.error.message) || failText, true);
    return false;
  }
  return true;
}

export function Inbox() {
  const { collapsed = [], selectedId, props: propsOpen = true } = inboxStore.use();
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [handoverTarget, setHandoverTarget] = useState(null);
  const [subQuery, setSubQuery] = useState('');
  const [subDraft, setSubDraft] = useState(null);

  useEffect(() => {
    setAddingLabel(false);
    setNewLabel('');
    setHandoverTarget(null);
    setSubQuery('');
    setSubDraft(null);
  }, [selectedId]);

  const s = ui.snap || {};
  const live = s.live || [];
  const sessions = s.sessions || [];
  const needsYou = s.needs_you || [];
  const approvals = s.approvals || [];
  const everyone = [...live, ...sessions.filter((x) => !live.some((l) => l.id === x.id))];
  const byId = (id) => everyone.find((x) => x.id === id) || null;

  const selectedNotice = selectedId ? needsYou.find((n) => n.id === selectedId) : null;
  const targetSessionId = selectedNotice ? selectedNotice.ref : selectedId;
  const targetSession = targetSessionId ? byId(targetSessionId) : null;
  const { text: sessionText, error: sessionTextError } = useSessionText(ui.view === 'inbox' ? targetSession?.id : null, targetSession?.last_line || null);
  const handoff = useRpcResult('session.handoff', { session_id: targetSession?.id }, ui.view === 'inbox' ? targetSession?.id : null, (res) => ({ value: res && res.result ? res.result.handoff || null : null, error: false })).value;

  const autoProject = targetSession?.project_id || null;
  const listedAutos = useRpcResult('automation.list', { project_id: autoProject }, ui.view === 'inbox' && autoProject ? autoProject : null, (res) => ({ value: res && res.result ? res.result.automations || null : null, error: false })).value;
  const automations = listedAutos || s.automations || [];

  if (ui.view !== 'inbox') return null;

  const kindOf = (n) => (n.kind === 'failed' ? 'failed' : n.kind === 'done' ? 'done' : isInfo(n) ? 'info' : 'needs');
  const priorityOf = (x) => (x && RANK[x.priority] != null ? x.priority : 'none');
  const sessionOf = (item, isSession) => (isSession ? item : byId(item.ref));
  const blockedNow = (x) => Boolean(x && Array.isArray(x.blocked_by) && x.blocked_by.some((id) => !DONE_STATES.includes(byId(id)?.state)));
  const byPriority = (isSession) => (a, b) => RANK[priorityOf(sessionOf(b, isSession))] - RANK[priorityOf(sessionOf(a, isSession))] || (isSession ? 0 : Boolean(a.read_at) - Boolean(b.read_at));

  const waitingSessions = waitingAll().slice().sort(byPriority(true));
  const workingSessions = live.filter((x) => x.state === 'working').sort(byPriority(true));
  const needsNotices = needsYou.filter((n) => kindOf(n) === 'needs').sort(byPriority(false));
  const inReviewNotices = needsYou.filter((n) => n.kind === 'uncommitted' || n.kind === 'handoff').sort(byPriority(false));
  const failedNotices = needsYou.filter((n) => n.kind === 'failed').sort(byPriority(false));
  const doneNotices = needsYou.filter((n) => n.kind !== 'failed' && n.kind !== 'uncommitted' && n.kind !== 'handoff' && kindOf(n) !== 'needs').sort(byPriority(false));

  const groups = [
    { key: 'needs', title: 'Needs your answer', status: 'needs', count: waitingSessions.length + approvals.length + needsNotices.length, items: [...waitingSessions.map((x) => [x, true]), ...needsNotices.map((n) => [n, false])] },
    { key: 'working', title: 'Working', status: 'working', count: workingSessions.length, items: workingSessions.map((x) => [x, true]) },
    { key: 'in_review', title: 'In review', status: 'review', count: inReviewNotices.length, items: inReviewNotices.map((n) => [n, false]) },
    { key: 'failed', title: 'Failed', status: 'failed', count: failedNotices.length, items: failedNotices.map((n) => [n, false]) },
    { key: 'done', title: 'Done', status: 'done', count: doneNotices.length, items: doneNotices.map((n) => [n, false]) },
  ];
  const totalItems = groups.reduce((acc, g) => acc + g.count, 0);
  const allRows = groups.flatMap((g) => g.items.map(([item, isSession]) => ({ id: item.id, item, isSession, group: g })));
  const visibleRows = allRows.filter((r) => !collapsed.includes(r.group.key));
  const activeRow = selectedId ? allRows.find((r) => r.id === selectedId) || null : null;
  const activeId = activeRow ? activeRow.id : null;
  const order = allRows.map((r) => r.group.key + ':' + r.id).join('|');
  const counts = Object.fromEntries(groups.map((g) => [g.key, g.count]));

  const setCollapsed = (key, fold) => {
    const cur = inboxStore.get().collapsed || [];
    if (fold && !cur.includes(key)) inboxStore.set({ collapsed: [...cur, key] });
    if (!fold && cur.includes(key)) inboxStore.set({ collapsed: cur.filter((k) => k !== key) });
  };
  const toggleGroup = (key) => setCollapsed(key, !(inboxStore.get().collapsed || []).includes(key));
  const select = (id) => inboxStore.set({ selectedId: id });
  const step = (by) => {
    const at = visibleRows.findIndex((r) => r.id === activeId);
    const next = visibleRows[at + by];
    if (next) select(next.id);
  };
  const dismiss = (id) => leaveRow(id, () => rpc('needs.dismiss', { id }));
  const toggleRead = (n) => rpc(n.read_at ? 'needs_you.mark-unread' : 'needs_you.mark-read', { id: n.id }, true);
  const statusOf = (item, isSession, groupStatus) => (blockedNow(sessionOf(item, isSession)) ? 'blocked' : groupStatus);

  let status = null;
  let item = null;
  let sessionObj = null;
  let engine = null;
  let projectName = null;
  let branch = null;
  let projectColour = null;
  if (activeRow) {
    item = activeRow.item;
    sessionObj = sessionOf(item, activeRow.isSession);
    status = statusOf(item, activeRow.isSession, activeRow.group.status);
    engine = sessionObj?.engine_id || null;
    const pid = sessionObj?.project_id || (!activeRow.isSession ? item.project_id : null);
    const projectRow = pid ? (s.projects || []).find((p) => p.id === pid) : null;
    projectName = pid ? projectRow?.name || pid : null;
    projectColour = PROJECT_COLOURS[projectRow?.icon?.colour] || null;
    branch = sessionObj ? sessionObj.branch || sessions.find((y) => y.id === sessionObj.id)?.branch || null : null;
  }
  const title = activeRow ? (activeRow.isSession ? taskOf(item) : item.text) : '';
  const serviceUrl = findServiceUrl(sessionText);
  const hasLabelsArray = Boolean(sessionObj && Array.isArray(sessionObj.labels));
  const userLabels = hasLabelsArray ? sessionObj.labels : [];
  const priority = priorityOf(sessionObj);
  const blockedBy = Array.isArray(sessionObj?.blocked_by) ? sessionObj.blocked_by : [];
  const blocking = Array.isArray(sessionObj?.blocking) ? sessionObj.blocking : [];
  const reviews = Array.isArray(sessionObj?.reviews) ? sessionObj.reviews : [];
  const reviewers = reviews.filter((r) => r.kind === 'reviewer');
  const approvers = reviews.filter((r) => r.kind === 'approver');
  const monitor = sessionObj?.monitor || null;
  const children = sessionObj ? everyone.filter((x) => x.parent_id === sessionObj.id) : [];
  const parent = sessionObj?.parent_id ? byId(sessionObj.parent_id) : null;
  const subDone = children.filter((x) => DONE_STATES.includes(x.state)).length;
  const subBlocked = children.filter((x) => blockedNow(x)).length;
  const subActive = children.filter((x) => !DONE_STATES.includes(x.state) && !blockedNow(x)).length;
  const subShown = children.filter((x) => !subQuery.trim() || nameOf(x).toLowerCase().includes(subQuery.trim().toLowerCase()));
  const peers = sessionObj ? everyone.filter((x) => x.id !== sessionObj.id && (!sessionObj.project_id || x.project_id === sessionObj.project_id)) : [];
  const handEngines = (s.engines || []).filter((e) => e.light !== 'red' && e.id !== engine);
  const handOptions = [{ value: '', label: 'Hand over' }, ...handEngines.map((e) => ({ value: e.id, label: e.id }))];

  const saveLabels = async (updated) => {
    if (!sessionObj) return;
    const before = sessionObj.labels;
    if (!sessionObj.id) { sessionObj.labels = updated; inboxStore.set({ tick: inboxStore.get().tick + 1 }); return; }
    await write('session.labels-set', { session_id: sessionObj.id, labels: updated }, () => { sessionObj.labels = updated; }, () => { sessionObj.labels = before; }, 'Could not save labels');
  };
  const handleAddLabel = async () => {
    const val = newLabel.trim().slice(0, 32);
    const current = Array.isArray(sessionObj?.labels) ? sessionObj.labels : [];
    setAddingLabel(false);
    setNewLabel('');
    if (!val || current.length >= 8 || current.includes(val)) return;
    await saveLabels([...current, val]);
  };
  const handleRemoveLabel = (lbl) => saveLabels((Array.isArray(sessionObj?.labels) ? sessionObj.labels : []).filter((l) => l !== lbl));
  const setPriority = (value) => {
    const before = sessionObj.priority;
    return write('session.priority-set', { session_id: sessionObj.id, priority: value }, () => { sessionObj.priority = value; }, () => { sessionObj.priority = before; }, 'Could not set priority');
  };
  const setBlockers = (ids) => {
    const before = sessionObj.blocked_by;
    return ids.length
      ? write('session.block-set', { session_id: sessionObj.id, blocker_ids: ids }, () => { sessionObj.blocked_by = ids; }, () => { sessionObj.blocked_by = before; }, 'Could not set blockers')
      : write('session.block-clear', { session_id: sessionObj.id }, () => { sessionObj.blocked_by = []; }, () => { sessionObj.blocked_by = before; }, 'Could not clear blockers');
  };
  const setReviews = (nextReviewers, nextApprovers) => {
    const before = sessionObj.reviews;
    const keep = (kind, who) => reviews.find((r) => r.kind === kind && r.who === who) || { kind, who, state: 'pending', note: null, review_session_id: null };
    const next = [...nextReviewers.map((w) => keep('reviewer', w)), ...nextApprovers.map((w) => keep('approver', w))];
    return write('session.reviewers-set', { session_id: sessionObj.id, reviewers: nextReviewers, approvers: nextApprovers }, () => { sessionObj.reviews = next; }, () => { sessionObj.reviews = before; }, 'Could not set reviewers');
  };
  const decide = (ok) => {
    const before = sessionObj.reviews;
    const next = reviews.map((r) => (r.kind === 'approver' && r.who === 'you' ? { ...r, state: ok ? 'passed' : 'failed' } : r));
    return write(ok ? 'session.approve' : 'session.reject', ok ? { session_id: sessionObj.id } : { session_id: sessionObj.id, note: 'Rejected from Needs you' }, () => { sessionObj.reviews = next; }, () => { sessionObj.reviews = before; }, ok ? 'Could not approve' : 'Could not reject');
  };
  const setMonitor = (automationId) => {
    const before = sessionObj.monitor;
    const a = automations.find((x) => x.id === automationId);
    return write('session.monitor-set', { session_id: sessionObj.id, automation_id: automationId || null }, () => { sessionObj.monitor = automationId ? { automation_id: automationId, name: a?.name || automationId, last_outcome: null } : null; }, () => { sessionObj.monitor = before; }, 'Could not set monitor');
  };
  const launchSub = async () => {
    const prompt = (subDraft || '').trim();
    if (!prompt || !sessionObj) return;
    setSubDraft(null);
    const r = await rpc('session.launch', { project_id: sessionObj.project_id || ui.projectId, engine_id: engine || (s.engines || [])[0]?.id, prompt, parent_id: sessionObj.id });
    if (r && r.result) toast('Sub-task started');
    else toast((r && r.error && (r.error.message || r.error)) || 'Could not start the sub-task', true);
  };

  const chip = (key, content, extra = '') => <span key={key} className={`ou-ny-chip ${extra}`}>{content}</span>;
  const sessionChip = (id, onRemove) => {
    const x = byId(id);
    const st = !x ? 'done' : DONE_STATES.includes(x.state) ? 'done' : x.state === 'waiting_for_you' ? 'needs' : 'working';
    return (
      <span key={id} className="ou-ny-chip ou-ny-pill" title={x ? nameOf(x) : id}>
        <StatusRing status={st} size={12} />
        <button type="button" className="ou-ny-chip-link ou-ny-mono" onClick={() => allRows.some((r) => r.id === id) ? select(id) : x && openOnWall(x)}>{sid(id)}</button>
        {onRemove ? <button type="button" className="ou-ny-chip-remove" aria-label={`Remove ${x ? taskOf(x) : id}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>{I.close}</button> : null}
      </span>
    );
  };
  const dropReview = (r) => setReviews(reviewers.filter((x) => !(r.kind === 'reviewer' && x.who === r.who)).map((x) => x.who), approvers.filter((x) => !(r.kind === 'approver' && x.who === r.who)).map((x) => x.who));
  const reviewChip = (r) => chip(r.kind + r.who, <><StatusRing status={r.state === 'passed' ? 'done' : r.state === 'failed' ? 'failed' : 'review'} size={12} /><span>{r.who}</span>
    <button type="button" className="ou-ny-chip-remove" aria-label={`Remove ${r.kind} ${r.who}`} title={`Remove ${r.kind} ${r.who}`} onClick={(e) => { e.stopPropagation(); dropReview(r); }}>{I.close}</button></>, 'ou-ny-pill');
  const addPicker = (label, options, onPick) => options.length ? (
    <span className="ou-ny-addpick"><Selector size="sm" variant="ghost" label={label} isLabelHidden options={[{ value: '', label: '+ ' + label }, ...options]} value="" onChange={(v) => { if (v) onPick(v); }} /></span>
  ) : null;
  const prop = (label, value) => (
    <div className="ou-ny-prop" key={label}>
      <div className="ou-ny-prop-label">{label}</div>
      <div className="ou-ny-prop-val">{value}</div>
    </div>
  );
  const none = (text = 'None') => <span className="ou-ny-muted">{text}</span>;

  const renderRow = ([row, isSession], group) => {
    const isSelected = activeId === row.id;
    const isUnread = isSession ? row.state === 'waiting_for_you' : !row.read_at;
    const ref = sessionOf(row, isSession);
    const st = statusOf(row, isSession, group.status);
    const who = ref?.engine_id || null;
    const timeText = isSession ? ago(row.state_at || row.started_at) : ago(row.at);
    const pri = priorityOf(ref);
    return (
      <li
        key={row.id}
        className={`ou-irow ${isUnread ? 'ou-unread' : ''} ${isSelected ? 'ou-irow-selected' : ''}`}
        tabIndex={0}
        role="button"
        aria-selected={isSelected}
        data-action={isSession ? 'pick' : 'inbox-open'}
        data-id={row.id}
        onClick={(e) => {
          if (e.target.closest('button, .astryx-button')) return;
          e.stopPropagation();
          e.currentTarget.focus();
          select(row.id);
        }}
        onFocus={() => { if (inboxStore.get().selectedId !== row.id) select(row.id); }}
        onKeyDown={(e) => {
          const take = () => { e.preventDefault(); e.stopPropagation(); };
          if (e.key === 'ArrowLeft') { take(); setCollapsed(group.key, true); }
          else if (e.key === 'ArrowRight') { take(); setCollapsed(group.key, false); }
          else if (e.key === 'Enter') { take(); if (isSession) openOnWall(row); else openNotice(row); }
          else if ((e.key === 'r' || e.key === 'R') && !isSession) { take(); toggleRead(row); }
          else if ((e.key === 'a' || e.key === 'A') && !isSession) { take(); dismiss(row.id); }
          else if (e.key === 'Escape') { take(); select(null); }
        }}
      >
        <div className="ou-ny-row-main">
          <span className="ou-ititle"><span className="ou-ny-clip">{isSession ? taskOf(row) : row.text}</span></span>
          <span className="ou-ny-row-sub">{who ? <Avatar name={who} /> : <span className="ou-ny-avatar-gap"><StatusRing status={st} size={14} /></span>}<span>{who ? `${Ic.engineName(who)} ${WHAT[st]}` : WHAT[st][0].toUpperCase() + WHAT[st].slice(1)}</span></span>
        </div>
        <div className="ou-ny-row-side">
          <StatusRing status={st} />
          <span className="ou-ny-row-age">{timeText || ''}</span>
        </div>
        <div className="ou-ny-actions" onClick={(e) => e.stopPropagation()}>
          {!isSession ? <IconButton size="sm" variant="ghost" icon={I.read} label={row.read_at ? 'Mark unread (r)' : 'Mark read (r)'} data-action={row.read_at ? 'inbox-unread' : 'inbox-read'} data-id={row.id} onClick={() => toggleRead(row)} /> : null}
          {!isSession ? <IconButton size="sm" variant="ghost" icon={I.archive} label="Archive (a)" data-action="dismiss" data-id={row.id} onClick={() => dismiss(row.id)} /> : null}
          <IconButton size="sm" variant="ghost" icon={I.open} label="Open (Enter)" data-action={isSession ? 'pick' : 'inbox-open'} data-id={row.id} onClick={() => (isSession ? openOnWall(row) : openNotice(row))} />
        </div>
      </li>
    );
  };

  const groupHead = (group, isFolded) => (
    <div
      className={`ou-ihead ou-ny-ghead ${group.count === 0 ? 'ou-ny-gdim' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={!isFolded}
      data-group={group.key}
      data-open={isFolded ? 'false' : 'true'}
      onClick={() => toggleGroup(group.key)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'ArrowLeft') setCollapsed(group.key, true);
          else if (e.key === 'ArrowRight') setCollapsed(group.key, false);
          else toggleGroup(group.key);
        }
      }}
    >
      {I.chev}
      <span className="ou-ny-gtitle">{group.title}</span>
      <span className="ou-ny-gcount" data-group={group.key} data-n={group.count}>{group.count}</span>
    </div>
  );

  const subtasks = () => (
    <section className="ou-ny-subtasks">
      <div className="ou-ny-h">Sub-tasks</div>
      <div className="ou-ny-sub-card">
        <div className="ou-ny-sub-left">
          <div className="ou-ny-sub-summary">
            <b>{subDone}/{children.length} done</b>
            <span>{subActive} in progress</span>
            <span>{subBlocked} blocked</span>
          </div>
          <Bar key={sessionObj.id} done={subDone} total={children.length} />
        </div>
        <div className="ou-ny-sub-state">{!children.length ? 'No sub-tasks yet' : subDone === children.length ? 'All sub-tasks done' : `${children.length - subDone} sub-task${children.length - subDone === 1 ? '' : 's'} open`}</div>
      </div>
      <div className="ou-ny-sub-tools">
        <Button size="sm" icon={I.plus} label="New sub-task" isDisabled={!sessionObj} onClick={() => setSubDraft('')} />
        <span className="ou-ny-search">{I.search}<TextInput size="sm" label="Search sub-tasks" isLabelHidden placeholder="Search tasks..." value={subQuery} onChange={setSubQuery} width="100%" /></span>
      </div>
      {subDraft !== null ? (
        <TextInput size="sm" label="New sub-task" isLabelHidden placeholder={`Task for a new ${engine || 'agent'} sub-task, Enter starts it`} value={subDraft} onChange={setSubDraft} onEnter={launchSub} hasAutoFocus width="100%"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSubDraft(null); } }} />
      ) : null}
      {subShown.length ? (
        <ul className="ou-ny-sub-list">
          {subShown.map((x, i) => (
            <li key={x.id} className="ou-ny-sub-row" data-id={x.id}>
              <StatusRing status={DONE_STATES.includes(x.state) ? 'done' : blockedNow(x) ? 'blocked' : x.state === 'waiting_for_you' ? 'needs' : 'working'} />
              <span className="ou-ny-sub-n">{i + 1}.</span>
              <span className="ou-ny-mono ou-ny-sub-id">{sid(x.id)}</span>
              <button type="button" className="ou-ny-sub-title" onClick={() => (allRows.some((r) => r.id === x.id) ? select(x.id) : openOnWall(x))}>{nameOf(x)}</button>
              <span className="ou-ny-muted">{Ic.engineName(x.engine_id)}</span>
              <span className="ou-ny-row-age">{ago(x.state_at || x.started_at) || ''}</span>
            </li>
          ))}
        </ul>
      ) : <div className="ou-ny-muted">{children.length ? 'No sub-task matches.' : 'No sub-tasks yet.'}</div>}
    </section>
  );

  const activity = () => (
    <section className="ou-ny-activity">
      <div className="ou-ny-h">Activity</div>
      <ol className="ou-ny-thread">
        {sessionObj ? (
          <li className="ou-ny-event"><Avatar name={engine} /><span><b>{engine ? Ic.engineName(engine) : 'An agent'}</b> started this</span><span className="ou-ny-muted">{ago(sessionObj.started_at || sessionObj.state_at) || ''}</span></li>
        ) : null}
        {activeRow.isSession && item.state === 'waiting_for_you' ? (
          <li className="ou-ny-entry ou-ipane-question">
            <div className="ou-ny-entry-head"><Avatar name={engine} /><span className="ou-ny-entry-who">{Ic.engineName(engine)} asked</span><span className="ou-ny-muted">{ago(item.state_at) || ''}</span></div>
            <div className="ou-ny-entry-body ou-ipane-lastline ou-ny-question">{item.last_line || taskOf(item)}</div>
          </li>
        ) : null}
        {!activeRow.isSession ? <li><DetailNotice key={`notice-${item.id}`} n={item} /></li> : null}
        {sessionObj ? <li><TerminalPreview text={sessionText} error={sessionTextError} /></li> : null}
        {handoff ? (
          <li className="ou-ny-entry" data-slot="handoff">
            <div className="ou-ny-entry-head"><span className="ou-ny-entry-who">Hand-off notes</span><span className="ou-ny-muted">{ago(handoff.at) || ''}</span></div>
            <div className="ou-ny-entry-body">{handoff.summary || 'No summary recorded.'}</div>
            {(handoff.files || []).length ? <div className="ou-ny-muted">{handoff.files.map((f) => `${f.path}${f.committed ? '' : ' (uncommitted)'}`).join(', ')}</div> : null}
          </li>
        ) : null}
        {reviews.filter((r) => r.state !== 'pending').map((r) => (
          <li key={`rv-${r.kind}-${r.who}`} className="ou-ny-event">
            <StatusRing status={r.state === 'passed' ? 'done' : 'failed'} size={12} />
            <span><b>{r.who}</b> {r.state === 'passed' ? (r.kind === 'approver' ? 'approved' : 'passed the review') : (r.kind === 'approver' ? 'rejected' : 'failed the review')}{r.note ? `: ${r.note}` : ''}</span>
          </li>
        ))}
      </ol>
      {activeRow.isSession && item.state === 'waiting_for_you' ? <div className="ou-ny-answer-pin"><DetailAsk key={item.id} x={item} /></div> : null}
    </section>
  );

  const properties = () => (
    <>
      <div className="ou-ny-props-head">
        <span>Properties</span>
        <IconButton size="sm" variant="ghost" icon={I.close} label="Hide properties" title="Hide properties" onClick={() => inboxStore.set({ props: false })} />
      </div>
      <div className="ou-ny-props-body">
        {prop('Status', <span className="ou-ny-inline"><StatusRing status={status} size={12} /><span>{WORD[status]}</span></span>)}
        {prop('Priority', sessionObj?.id ? (
          <span className="ou-ny-inline ou-ny-prisel"><PriorityIcon level={priority} /><Selector size="sm" variant="ghost" label="Priority" isLabelHidden options={PRIORITIES.map(([value, label]) => ({ value, label }))} value={priority} onChange={(v) => v && v !== priority && setPriority(v)} /></span>
        ) : none('No priority'))}
        {prop('Labels', (
          <div className="ou-ny-chips-wrap ou-ny-prop-labels">
            {projectName ? labelPill(projectName, null, projectColour) : null}
            {engine && engine !== projectName ? labelPill(engine) : null}
            {userLabels.map((lbl) => labelPill(lbl, () => handleRemoveLabel(lbl)))}
            {addingLabel ? (
              <TextInput size="sm" label="New label" isLabelHidden placeholder="Label, Enter adds" value={newLabel} onChange={setNewLabel} onEnter={handleAddLabel} hasAutoFocus width={140}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAddingLabel(false); setNewLabel(''); } }} />
            ) : (
              <button type="button" className="ou-ny-addpill" aria-label="Add label" disabled={!hasLabelsArray} title={!hasLabelsArray ? 'Labels need a core update' : undefined} onClick={() => setAddingLabel(true)}>
                + Add label
              </button>
            )}
          </div>
        ))}
        {prop('Assignee', engine ? (
          <span className="ou-ny-inline"><Avatar name={engine} big /><span>{Ic.engineName(engine)}</span>
            {sessionObj?.id ? <button type="button" className="ou-ny-arrow" aria-label={`Open ${engine} on the Wall`} title={`Open ${engine} on the Wall`} onClick={() => openOnWall(sessionObj)}>{I.arrow}</button> : null}
          </span>
        ) : none('Unassigned'))}
        {prop('Project', projectName ? (
          <span className="ou-ny-inline"><span className="ou-ny-dot" style={projectColour ? { background: projectColour } : undefined} /><span>{projectName}</span>
            <button type="button" className="ou-ny-arrow" aria-label={`Open ${projectName} Home`} title={`Open ${projectName} Home`} onClick={() => openProjectHome(sessionObj?.project_id || item.project_id)}>{I.arrow}</button>
          </span>
        ) : none())}
        {prop('Parent', parent ? (
          <button type="button" className="ou-ny-parent" title={taskOf(parent)} onClick={() => (allRows.some((r) => r.id === parent.id) ? select(parent.id) : openOnWall(parent))}>
            <span className="ou-ny-mono">{sid(parent.id)}</span> {taskOf(parent)} {I.arrow}
          </button>
        ) : none())}
        {prop('Blocked by', sessionObj?.id ? (
          <div className="ou-ny-chips-wrap">
            {blockedBy.map((id) => sessionChip(id, () => setBlockers(blockedBy.filter((b) => b !== id))))}
            {addPicker('Add blocker', peers.filter((x) => !blockedBy.includes(x.id)).map((x) => ({ value: x.id, label: taskOf(x) })), (id) => setBlockers([...blockedBy, id]))}
          </div>
        ) : none())}
        {prop('Blocking', blocking.length ? <div className="ou-ny-chips-wrap">{blocking.map((id) => sessionChip(id))}</div> : none())}
        {prop('Sub-tasks', sessionObj?.id ? (
          <div className="ou-ny-chips-wrap">
            {children.map((x) => sessionChip(x.id))}
            <button type="button" className="ou-ny-addpill" onClick={() => setSubDraft('')}>+ Add sub-task</button>
          </div>
        ) : none())}
        {prop('Reviewers', sessionObj?.id ? (
          <div className="ou-ny-chips-wrap">
            {reviewers.map(reviewChip)}
            {!reviewers.length ? none() : null}
            {addPicker('Add reviewer', (s.engines || []).filter((e) => e.light !== 'red' && !reviewers.some((r) => r.who === e.id)).map((e) => ({ value: e.id, label: e.id })), (id) => setReviews([...reviewers.map((r) => r.who), id], approvers.map((r) => r.who)))}
          </div>
        ) : none())}
        {prop('Approvers', sessionObj?.id ? (
          <div className="ou-ny-chips-wrap">
            {approvers.map(reviewChip)}
            {approvers.some((r) => r.who === 'you' && r.state === 'pending') ? (
              <span className="ou-ny-inline">
                <Button size="sm" variant="primary" label="Approve" onClick={() => decide(true)} />
                <Button size="sm" label="Reject" onClick={() => decide(false)} />
              </span>
            ) : null}
            {!approvers.length ? (
              <button type="button" className="ou-ny-ghost-btn" onClick={() => setReviews(reviewers.map((r) => r.who), ['you'])}>None, add me</button>
            ) : null}
          </div>
        ) : none())}
        {prop('Monitor', sessionObj?.id ? (
          automations.length ? (
            <Selector size="sm" variant="ghost" label="Monitor" isLabelHidden options={[{ value: '', label: 'Not watched' }, ...automations.map((a) => ({ value: a.id, label: a.name || a.id }))]} value={monitor?.automation_id || ''} onChange={(v) => (v || null) !== (monitor?.automation_id || null) && setMonitor(v)} />
          ) : monitor ? <span>{monitor.name}{monitor.last_outcome ? ` (${monitor.last_outcome})` : ''}</span> : none('No automations in this project')
        ) : none('Not watched'))}
        <div className="ou-ny-props-rule" />
        {prop('Service', serviceUrl ? (
          <button type="button" className="ou-ny-link" title={serviceUrl} onClick={() => openTermLink(serviceUrl)}><span>{serviceUrl}</span>{I.open}</button>
        ) : none())}
        {prop('Workspace', sessionObj?.cwd && sessionObj?.id ? (
          <button type="button" className="ou-ny-link ou-ny-wslink" title={sessionObj.cwd} onClick={() => openWorkspace(sessionObj)}><span>View workspace</span>{I.open}</button>
        ) : none())}
        {prop('Branch', branch ? <span className="ou-ny-wrapval ou-ny-mono">{I.branch}<span>{branch}</span></span> : none())}
        {prop('Run ledger', <RunLedger key={`ledger-${sessionObj?.id || 'none'}`} sessionId={sessionObj?.id || null} />)}
      </div>
    </>
  );

  return (
    <div
      className="ou-inbox"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.target.closest?.('dialog, [role="dialog"], [role="alertdialog"], input, textarea, select, [contenteditable]')) {
          e.preventDefault();
          inboxStore.set({ selectedId: null });
        }
      }}
    >
      <div className="ou-inbox-list">
        <header className="ou-inbox-head">
          <h1 className="ou-ny-title">Needs you</h1>
          <span className="ou-ny-counts">{waitingAll().length} waiting {'·'} {workingSessions.length} working {'·'} {needsYou.length} notices</span>
        </header>
        {totalItems === 0 ? (
          <div className="ou-ny-empty"><EmptyState title="Nothing is waiting on you." description="Questions from agents and finished work show up here." isCompact /></div>
        ) : (
          <ListMotion order={order} counts={counts}>
            {groups.map((group) => {
              const isFolded = collapsed.includes(group.key) || group.count === 0;
              return (
                <Fold key={group.key} open={!isFolded} head={groupHead(group, isFolded)}>
                  {isFolded ? null : [
                    group.key === 'needs' && approvals.length ? <li key="igates" className="ou-ny-igates"><div className="igates" dangerouslySetInnerHTML={{ __html: approvals.map(approvalCard).join('') }} /></li> : null,
                    ...group.items.map((entry) => renderRow(entry, group)),
                  ]}
                </Fold>
              );
            })}
          </ListMotion>
        )}
      </div>
      <div className="ou-ipane" data-state={activeRow ? 'open' : 'empty'}>
        {activeRow ? (
          <>
            <div className="ou-ny-bar">
              <IconButton size="sm" variant="ghost" icon={I.up} label="Previous item" title="Previous item (k)" isDisabled={visibleRows[0]?.id === activeId} onClick={() => step(-1)} />
              <IconButton size="sm" variant="ghost" icon={I.down} label="Next item" title="Next item (j)" isDisabled={visibleRows[visibleRows.length - 1]?.id === activeId} onClick={() => step(1)} />
              <span className="ou-ny-bar-gap" />
              {activeRow.isSession && item.state === 'waiting_for_you' ? (
                <Button size="sm" icon={<Ic.Answer size={14} />} label="Answer" onClick={() => document.querySelector('.ou-ny-composer input, .ou-ny-composer textarea')?.focus()} />
              ) : null}
              {sessionObj ? (
                <Selector size="sm" variant="ghost" label="Hand to another agent" isLabelHidden options={handOptions} value="" isDisabled={!sessionObj.prompt}
                  disabledMessage={sessionObj.prompt ? undefined : 'The original task was not recorded, so it cannot be handed over'} onChange={(val) => { if (val) setHandoverTarget(val); }} />
              ) : null}
              {!activeRow.isSession ? <Button size="sm" label="Dismiss" data-action="dismiss" data-id={item.id} onClick={() => dismiss(item.id)} /> : null}
              {activeRow.isSession || item.ref ? (
                <IconButton size="sm" variant="ghost" icon={I.wall} label="Open on Wall" title="Open on Wall" data-action="pick" data-id={activeRow.isSession ? item.id : item.ref}
                  onClick={() => (activeRow.isSession ? openOnWall(item) : openNotice(item))} />
              ) : null}
              <IconButton size="sm" variant="ghost" icon={I.panel} label={propsOpen ? 'Hide properties' : 'Show properties'} title={propsOpen ? 'Hide properties' : 'Show properties'} aria-pressed={propsOpen} onClick={() => inboxStore.set({ props: !propsOpen })} />
              <IconButton size="sm" variant="ghost" icon={I.close} label="Close details" title="Close details" onClick={() => select(null)} />
            </div>
            <div className="ou-ny-body">
              <Swap k={activeId}>
                <div className="ou-ny-crumb">
                  <span>{projectName || 'No project'}</span>
                  <span className="ou-ny-crumb-sep">{'›'}</span><span className="ou-ny-mono">{sid(sessionObj?.id || item.id)}</span>
                </div>
                <div className="ou-ny-chips ou-ny-top-chips ou-ny-meta">
                  {chip('status', <><StatusRing status={status} size={12} /><span>{WORD[status]}</span></>, `ou-ny-chip-${status}`)}
                  {chip('assignee', engine ? <><Avatar name={engine} /><span>{Ic.engineName(engine)}</span></> : <span>Unassigned</span>, engine ? '' : 'ou-ny-chip-quiet')}
                  {chip('priority', <><PriorityIcon level={priority} /><span>{priority === 'none' ? 'No priority' : PRIORITIES.find(([v]) => v === priority)[1]}</span></>, priority === 'none' ? 'ou-ny-chip-quiet' : '')}
                  {projectName ? chip('project', <><span className="ou-ny-dot" style={projectColour ? { background: projectColour } : undefined} /><span>{projectName}</span></>) : null}
                  {userLabels.length ? userLabels.map((lbl) => chip('l-' + lbl, <><span className={`ou-ny-dot${labelColour(lbl) ? '' : ` ou-ny-tone-${toneOf(lbl)}`}`} style={labelColour(lbl) ? { background: labelColour(lbl) === 'var(--hairline-strong)' ? 'var(--mute)' : labelColour(lbl) } : undefined} /><span>{lbl}</span></>)) : chip('labels', <>{I.label}<span>No label</span></>, 'ou-ny-chip-quiet')}
                </div>
                <h2 className="ou-ny-doc-title ou-ipane-task">{title}</h2>
                {sessionObj?.prompt && sessionObj.prompt !== title ? <p className="ou-ny-doc-task">{sessionObj.prompt}</p> : null}
                {sessionObj ? subtasks() : null}
                {activity()}
              </Swap>
            </div>
          </>
        ) : (
          <div className="ou-ny-pane-empty">Pick an item on the left to open it here.</div>
        )}
        {handoverTarget && sessionObj?.prompt ? (
          <AlertDialog
            isOpen={Boolean(handoverTarget)}
            onOpenChange={(open) => { if (!open) setHandoverTarget(null); }}
            title={`Hand this task to ${handoverTarget}?`}
            description={`A new ${handoverTarget} agent starts in ${projectName || sessionObj.project_id || ui.projectId || ''} with the same task. The current agent keeps running until you stop it.`}
            actionLabel="Hand over"
            onAction={async () => {
              const chosen = handoverTarget;
              setHandoverTarget(null);
              const r = await rpc('session.launch', { project_id: sessionObj.project_id || ui.projectId, engine_id: chosen, prompt: sessionObj.prompt });
              if (r && r.result) toast(`Handed to ${chosen}`);
              else toast((r && r.error && (r.error.message || r.error)) || 'Failed to hand over', true);
            }}
          />
        ) : null}
      </div>
      {activeRow ? <Slide open={propsOpen}>{properties()}</Slide> : null}
    </div>
  );
}
