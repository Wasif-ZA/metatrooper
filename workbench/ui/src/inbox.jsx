import { useEffect, useState, Fragment } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';

export const inboxStore = createStore({ tick: 0, filter: 'all', collapsed: [], selectedId: null });

const LOOP_CHOICES = [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']];

function StatusRing({ status, size = 14 }) {
  const p = { width: size, height: size, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
  if (status === 'needs') {
    return (
      <svg {...p} className={`ou-ny-ring ou-ny-ring-needs ${size === 12 ? 'ou-ny-ring-12' : ''}`} aria-label="Needs you">
        <circle cx="7" cy="7" r="5.25" />
      </svg>
    );
  }
  if (status === 'working') {
    return (
      <svg {...p} className={`ou-ny-ring ou-ny-ring-working ${size === 12 ? 'ou-ny-ring-12' : ''}`} aria-label="Working">
        <circle cx="7" cy="7" r="5.25" strokeOpacity="0.25" />
        <path d="M7 1.75 A5.25 5.25 0 0 1 12.25 7" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'review') {
    return (
      <svg {...p} className={`ou-ny-ring ou-ny-ring-review ${size === 12 ? 'ou-ny-ring-12' : ''}`} aria-label="In review">
        <circle cx="7" cy="7" r="5.25" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg {...p} strokeLinecap="round" strokeLinejoin="round" className={`ou-ny-ring ou-ny-ring-failed ${size === 12 ? 'ou-ny-ring-12' : ''}`} aria-label="Failed">
        <circle cx="7" cy="7" r="5.25" />
        <path d="M5 5l4 4M9 5l-4 4" />
      </svg>
    );
  }
  return (
    <svg {...p} strokeLinecap="round" strokeLinejoin="round" className={`ou-ny-ring ou-ny-ring-done ${size === 12 ? 'ou-ny-ring-12' : ''}`} aria-label="Finished">
      <circle cx="7" cy="7" r="5.25" />
      <path d="M4.5 7.2l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

function NoteActions({ n }) {
  const loop = loopOf(n);
  const lend = lendOf(n);
  return (
    <span className="ou-actions">
      {loop ? LOOP_CHOICES.map(([choice, label]) => <Button key={choice} size="sm" label={label} data-action="loop-choose" data-id={loop} data-choice={choice} />) : null}
      {lend ? <Button size="sm" variant="primary" label="Lend this site" data-action="lend-set" data-project={lend.project} data-origin={lend.origin} /> : null}
      {lend ? <Button size="sm" label="No" data-action="dismiss" data-id={n.id} /> : null}
      <Button
        size="sm"
        variant="ghost"
        label={n.read_at ? 'Mark unread' : 'Mark read'}
        data-action={n.read_at ? 'inbox-unread' : 'inbox-read'}
        data-id={n.id}
      />
    </span>
  );
}

function useSessionText(sessionId, stamp) {
  const [state, setState] = useState({ text: null, error: false });

  useEffect(() => {
    if (!sessionId) {
      setState({ text: null, error: false });
      return;
    }
    let active = true;
    rpc('session.read', { session_id: sessionId, lines: 200 }, true)
      .then((res) => {
        if (!active) return;
        if (res && res.result && res.result.lines != null) {
          const text = Array.isArray(res.result.lines) ? res.result.lines.join('\n') : String(res.result.lines);
          if (text.length > 0) {
            setState({ text, error: false });
          } else {
            setState({ text: null, error: true });
          }
        } else {
          setState({ text: null, error: true });
        }
      })
      .catch(() => {
        if (!active) return;
        setState({ text: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [sessionId, stamp]);

  return state;
}

function findServiceUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s'"<>)]*/);
  if (!match) return null;
  return match[0].replace('0.0.0.0', 'localhost');
}

function TerminalPreview({ text, error, sessionId, stamp }) {
  const fetched = useSessionText(text === undefined ? sessionId : null, stamp);
  const actualText = text !== undefined ? text : fetched.text;
  const actualError = error !== undefined ? error : fetched.error;
  const lines20 = actualText ? actualText.split('\n').slice(-20).join('\n') : null;

  return (
    <div className="ou-ny-terminal-block">
      <div className="ou-ny-section-label">Last output</div>
      {actualError || !lines20 ? (
        <div className="ou-ipane-muted">No terminal text to show yet. Open it on the Wall.</div>
      ) : (
        <pre className="ou-ipane-pre">{lines20}</pre>
      )}
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
  if (val === 0 && unpriced > 0) {
    return 'not priced';
  }
  const formatted = '$' + val.toFixed(2);
  return usdEstimated ? '~' + formatted : formatted;
}

function RunLedger({ sessionId }) {
  const [state, setState] = useState({ loading: Boolean(sessionId), data: null, error: false });

  useEffect(() => {
    if (!sessionId) {
      setState({ loading: false, data: null, error: false });
      return;
    }
    let active = true;
    setState({ loading: true, data: null, error: false });
    rpc('usage.session', { session_id: sessionId }, true)
      .then((res) => {
        if (!active) return;
        if (res && res.result) {
          setState({ loading: false, data: res.result, error: false });
        } else {
          setState({ loading: false, data: null, error: true });
        }
      })
      .catch(() => {
        if (!active) return;
        setState({ loading: false, data: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="ou-ny-slot" data-slot="run-ledger">
        <div className="ou-ny-slot-title">Run ledger</div>
        <div className="ou-ny-slot-body">No usage recorded for this session yet.</div>
      </div>
    );
  }

  if (state.loading) {
    return (
      <div className="ou-ny-slot" data-slot="run-ledger">
        <div className="ou-ny-slot-title">Run ledger</div>
        <div className="ou-ny-slot-body">Loading usage.</div>
      </div>
    );
  }

  const data = state.data;
  const totalTokens = data ? ((Number(data.tokens_in) || 0) + (Number(data.tokens_out) || 0)) : 0;

  if (state.error || !data || totalTokens === 0) {
    return (
      <div className="ou-ny-slot" data-slot="run-ledger">
        <div className="ou-ny-slot-title">Run ledger</div>
        <div className="ou-ny-slot-body">No usage recorded for this session yet.</div>
      </div>
    );
  }

  return (
    <div className="ou-ny-slot ou-ny-ledger" data-slot="run-ledger">
      <div className="ou-ny-ledger-head">
        <div className="ou-ny-slot-title">Run ledger</div>
        <div className="ou-ny-ledger-cost">{formatCost(data.usd, data.usd_estimated, data.unpriced)}</div>
      </div>
      <div className="ou-ny-ledger-summary">
        {formatTokens(data.tokens_in)} in {'\u00B7'} {formatTokens(data.tokens_out)} out
      </div>
      <table className="ou-ny-ledger-table">
        <thead>
          <tr>
            <th className="ou-ny-ledger-model">MODEL</th>
            <th className="ou-ny-ledger-th-in">IN</th>
            <th className="ou-ny-ledger-th-out">OUT</th>
            <th className="ou-ny-ledger-th-cost">COST</th>
          </tr>
        </thead>
        <tbody>
          {(data.by_model || []).map((row, idx) => (
            <tr key={row.model || idx}>
              <td className="ou-ny-ledger-model" title={row.model}>{row.model}</td>
              <td>{formatTokens(row.tokens_in)}</td>
              <td>{formatTokens(row.tokens_out)}</td>
              <td>{formatCost(row.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailAsk({ x, text, error }) {
  const [answer, setAnswer] = useState('');
  const here = !x.project_id || x.project_id === ui.projectId;
  const projectName = ui.snap?.projects?.find((p) => p.id === x.project_id)?.name || 'another project';

  const send = async () => {
    if (!here) return;
    const textToSend = answer.trim();
    if (!textToSend) return;
    try {
      await troop.termInput(x.id, textToSend + '\r');
      setAnswer('');
      toast(`Sent to ${x.engine_id}`);
    } catch (err) {
      toast(String((err && err.message) || err), true);
    }
  };

  return (
    <div className="ou-ny-ask">
      <div className="ou-ipane-question">
        <div className="ou-ny-section-label">Question</div>
        <div className="ou-ipane-task">{taskOf(x)}</div>
        {x.last_line ? <div className="ou-ipane-lastline">{x.last_line}</div> : null}
      </div>
      <TerminalPreview text={text} error={error} sessionId={x.id} stamp={x.last_line} />
      <div className="ou-ipane-answer">
        <div className="ou-ny-section-label">Answer</div>
        <TextInput
          label="Answer"
          placeholder="Type your answer, Enter sends"
          value={answer}
          onChange={setAnswer}
          onEnter={send}
          width="100%"
          isDisabled={!here}
        />
        <div className="ou-ipane-answer-row">
          <Button
            variant="primary"
            label="Send"
            isDisabled={!here || !answer.trim()}
            onClick={send}
          />
        </div>
        {!here ? <div className="ou-ipane-muted">{`In ${projectName}. Open it on the Wall to answer.`}</div> : null}
      </div>
    </div>
  );
}

function DetailNotice({ n, kindOf }) {
  const time = ago(n.at);
  const meta = time ? `${n.kind} \u00B7 ${time}` : n.kind;
  return (
    <div className="ou-ipane-notice">
      <div className="ou-ipane-noticetext">{n.text}</div>
      <div className="ou-ipane-muted">{meta}</div>
      {((n.kind === 'done' || n.kind === 'failed') && n.ref) || n.kind === 'uncommitted' ? (
        <Button size="sm" variant="ghost" label="Open" onClick={() => { openNotice(n); }} />
      ) : null}
      <NoteActions n={n} />
    </div>
  );
}

const openNotice = (n) => {
  const s = [...(ui.snap.live || []), ...(ui.snap.sessions || [])].find((x) => x.id === n.ref);
  homeView.set('wall');
  if (s && s.project_id && s.project_id !== ui.projectId) { ui.pendingNeedsYou = n.id; switchProject(s.project_id); return; }
  void openNeedsYou(n.id);
};

const openOnWall = (x) => {
  if (x.project_id && x.project_id !== ui.projectId) {
    homeView.set('wall');
    ui.pendingPick = x.id;
    switchProject(x.project_id);
    return;
  }
  homeView.set('wall');
  void pick(x.id);
};

function statusInfo(item, isSession, kindOf) {
  if (isSession) {
    if (item.state === 'waiting_for_you') {
      return { status: 'needs', word: 'Waiting for answer' };
    }
    if (item.state === 'working') {
      return { status: 'working', word: 'Working' };
    }
    return { status: item.state || 'needs', word: item.state || 'Waiting' };
  }
  const k = kindOf ? kindOf(item) : 'info';
  if (k === 'needs') return { status: 'needs', word: 'Needs answer' };
  if (item.kind === 'failed') return { status: 'failed', word: 'Failed' };
  if (item.kind === 'done') return { status: 'done', word: 'Done' };
  if (item.kind === 'uncommitted' || item.kind === 'handoff') return { status: 'review', word: 'In review' };
  return { status: 'done', word: item.kind || 'Info' };
}

function autoKindOf(status) {
  if (status === 'needs') return 'question';
  return status;
}

export function Inbox() {
  const { collapsed = [], selectedId } = inboxStore.use();
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [handoverTarget, setHandoverTarget] = useState(null);

  useEffect(() => {
    setAddingLabel(false);
    setNewLabel('');
    setHandoverTarget(null);
  }, [selectedId]);

  const s = ui.snap || {};
  const live = s.live || [];
  const sessions = s.sessions || [];
  const needsYou = s.needs_you || [];
  const approvals = s.approvals || [];

  const selectedNotice = selectedId ? needsYou.find((n) => n.id === selectedId) : null;
  const targetSessionId = selectedNotice ? selectedNotice.ref : selectedId;
  const targetSession = targetSessionId ? [...live, ...sessions].find((x) => x.id === targetSessionId) : null;
  const terminalStamp = targetSession?.last_line || null;

  const { text: sessionText, error: sessionTextError } = useSessionText(ui.view === 'inbox' ? targetSessionId : null, terminalStamp);

  if (ui.view !== 'inbox') return null;

  const branchOf = (x) => (x ? x.branch || sessions.find((y) => y.id === x.id)?.branch || null : null);
  const kindOf = (n) => (n.kind === 'failed' ? 'failed' : n.kind === 'done' ? 'done' : isInfo(n) ? 'info' : 'needs');

  const waitingSessions = waitingAll();
  const needsNotices = needsYou.filter((n) => kindOf(n) === 'needs').slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)));
  const workingSessions = live.filter((x) => x.state === 'working');
  const inReviewNotices = needsYou.filter((n) => n.kind === 'uncommitted' || n.kind === 'handoff').slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)));
  const failedNotices = needsYou.filter((n) => n.kind === 'failed').slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)));
  const doneNotices = needsYou.filter((n) => n.kind !== 'failed' && n.kind !== 'uncommitted' && n.kind !== 'handoff' && kindOf(n) !== 'needs').slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)));

  const waitingCount = waitingSessions.length;
  const workingCount = workingSessions.length;
  const noticesCount = needsYou.length;

  const groups = [
    {
      key: 'needs',
      title: 'NEEDS YOUR ANSWER',
      count: waitingSessions.length + approvals.length + needsNotices.length,
      items: [
        ...waitingSessions.map((x) => ({ item: x, isSession: true })),
        ...needsNotices.map((n) => ({ item: n, isSession: false })),
      ],
    },
    {
      key: 'working',
      title: 'WORKING',
      count: workingSessions.length,
      items: workingSessions.map((x) => ({ item: x, isSession: true })),
    },
    {
      key: 'in_review',
      title: 'IN REVIEW',
      count: inReviewNotices.length,
      items: inReviewNotices.map((n) => ({ item: n, isSession: false })),
    },
    {
      key: 'failed',
      title: 'FAILED',
      count: failedNotices.length,
      items: failedNotices.map((n) => ({ item: n, isSession: false })),
    },
    {
      key: 'done',
      title: 'DONE',
      count: doneNotices.length,
      items: doneNotices.map((n) => ({ item: n, isSession: false })),
    },
  ];

  const totalItems = groups.reduce((acc, g) => acc + g.count, 0);

  const allRows = [
    ...waitingSessions.map((x) => ({ type: 'ask', id: x.id, item: x })),
    ...needsNotices.map((n) => ({ type: 'note', id: n.id, item: n })),
    ...workingSessions.map((x) => ({ type: 'working', id: x.id, item: x })),
    ...inReviewNotices.map((n) => ({ type: 'note', id: n.id, item: n })),
    ...failedNotices.map((n) => ({ type: 'note', id: n.id, item: n })),
    ...doneNotices.map((n) => ({ type: 'note', id: n.id, item: n })),
  ];

  const activeRow = selectedId ? allRows.find((r) => r.id === selectedId) || null : null;
  const activeId = activeRow ? activeRow.id : null;

  const toggleGroup = (key) => {
    const cur = inboxStore.get().collapsed || [];
    if (cur.includes(key)) {
      inboxStore.set({ collapsed: cur.filter((k) => k !== key) });
    } else {
      inboxStore.set({ collapsed: [...cur, key] });
    }
  };

  const collapseGroup = (key) => {
    const cur = inboxStore.get().collapsed || [];
    if (!cur.includes(key)) inboxStore.set({ collapsed: [...cur, key] });
  };

  const expandGroup = (key) => {
    const cur = inboxStore.get().collapsed || [];
    if (cur.includes(key)) inboxStore.set({ collapsed: cur.filter((k) => k !== key) });
  };

  let activeStatus = null;
  let activeTitle = '';
  let activeIsSession = false;
  let activeItem = null;
  let propEngine = null;
  let propProject = null;
  let propBranch = null;
  let propFolder = null;
  let propStarted = null;
  let propUpdated = null;
  let ledgerSessionId = null;
  let refSession = null;
  let sessionObj = null;

  if (activeRow) {
    activeIsSession = activeRow.type === 'ask' || activeRow.type === 'working';
    activeItem = activeRow.item;
    const isSession = activeIsSession;
    const item = activeItem;
    activeStatus = statusInfo(item, isSession, kindOf);
    activeTitle = isSession ? taskOf(item) : item.text;

    refSession = isSession ? item : [...live, ...sessions].find((x) => x.id === item.ref);
    sessionObj = isSession ? item : refSession;
    ledgerSessionId = isSession
      ? activeRow.id
      : (item.ref && [...live, ...sessions].some((x) => x.id === item.ref) ? item.ref : null);
    propEngine = refSession?.engine_id || null;
    const propProjectId = refSession?.project_id || (!isSession ? item.project_id : null);
    propProject = propProjectId ? (s.projects || []).find((p) => p.id === propProjectId)?.name || propProjectId : null;
    propBranch = branchOf(refSession);
    propFolder = refSession?.cwd || null;
    propStarted = isSession
      ? (item.started_at ? ago(item.started_at) : (item.state_at ? ago(item.state_at) : null))
      : (refSession?.started_at ? ago(refSession.started_at) : null);
    propUpdated = isSession ? ago(item.state_at || item.started_at) : ago(item.at);
  }

  const serviceUrl = findServiceUrl(sessionText);
  const hasLabelsArray = Boolean(sessionObj && Array.isArray(sessionObj.labels));
  const userLabels = hasLabelsArray ? sessionObj.labels : [];
  const autoKind = activeStatus ? autoKindOf(activeStatus.status) : null;
  const autoLabels = [propEngine, autoKind].filter(Boolean);

  const handleAddLabel = async () => {
    const val = newLabel.trim();
    if (!val) {
      setAddingLabel(false);
      setNewLabel('');
      return;
    }
    const trimmed = val.slice(0, 32);
    const current = Array.isArray(sessionObj?.labels) ? sessionObj.labels : [];
    if (current.length >= 8 || current.includes(trimmed)) {
      setAddingLabel(false);
      setNewLabel('');
      return;
    }
    const updated = [...current, trimmed];
    if (sessionObj) sessionObj.labels = updated;
    setAddingLabel(false);
    setNewLabel('');
    inboxStore.set({ tick: inboxStore.get().tick + 1 });
    if (sessionObj?.id) {
      await rpc('session.labels-set', { session_id: sessionObj.id, labels: updated });
    }
  };

  const handleRemoveLabel = async (lbl) => {
    const current = Array.isArray(sessionObj?.labels) ? sessionObj.labels : [];
    const updated = current.filter((l) => l !== lbl);
    if (sessionObj) sessionObj.labels = updated;
    inboxStore.set({ tick: inboxStore.get().tick + 1 });
    if (sessionObj?.id) {
      await rpc('session.labels-set', { session_id: sessionObj.id, labels: updated });
    }
  };

  const handEngines = (s.engines || []).filter((e) => e.light !== 'red' && e.id !== propEngine);
  const handOptions = [
    { value: '', label: 'Hand to...' },
    ...handEngines.map((e) => ({ value: e.id, label: e.id })),
  ];

  const renderRow = (item, isSession, groupKey) => {
    const isSelected = activeId === item.id;
    const isUnread = isSession ? (item.state === 'waiting_for_you') : !item.read_at;
    const status = isSession
      ? (item.state === 'waiting_for_you' ? 'needs' : item.state === 'working' ? 'working' : 'done')
      : (groupKey === 'needs' ? 'needs' : groupKey === 'in_review' ? 'review' : groupKey === 'failed' ? 'failed' : 'done');
    const titleText = isSession ? taskOf(item) : item.text;
    const refSession = isSession ? item : [...live, ...sessions].find((x) => x.id === item.ref);
    const engineId = refSession?.engine_id || null;
    const folder = refSession?.cwd ? (refSession.cwd.split(/[/\\]/).filter(Boolean).pop() || '') : '';
    const branchOrFolder = branchOf(refSession) || folder;
    const proj = (s.projects || []).find((p) => p.id === (refSession?.project_id || item.project_id))?.name || '';
    const workspaceText = proj && branchOrFolder && branchOrFolder !== proj ? `${proj} / ${branchOrFolder}` : proj || branchOrFolder || '-';
    const timeText = isSession ? ago(item.state_at || item.started_at) : ago(item.at);
    const rowLabels = Array.isArray(item.labels) ? item.labels : (Array.isArray(refSession?.labels) ? refSession.labels : []);
    const userRowLabels = rowLabels.slice(0, 2);

    return (
      <li
        key={item.id}
        className={`ou-irow ${isUnread ? 'ou-unread' : ''} ${isSelected ? 'ou-irow-selected' : ''}`}
        tabIndex={0}
        role="button"
        aria-selected={isSelected}
        data-action={isSession ? 'pick' : 'inbox-open'}
        data-id={item.id}
        onClick={(e) => {
          if (e.target.closest('button, .astryx-button')) return;
          e.stopPropagation();
          e.currentTarget.focus();
          inboxStore.set({ selectedId: item.id });
        }}
        onFocus={() => {
          if (inboxStore.get().selectedId !== item.id) {
            inboxStore.set({ selectedId: item.id });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            collapseGroup(groupKey);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            expandGroup(groupKey);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (isSession) openOnWall(item);
            else openNotice(item);
          } else if (e.key === 'r' || e.key === 'R') {
            if (!isSession) {
              e.preventDefault();
              e.stopPropagation();
              rpc(item.read_at ? 'needs_you.mark-unread' : 'needs_you.mark-read', { id: item.id }, true);
            }
          } else if (e.key === 'a' || e.key === 'A') {
            if (!isSession) {
              e.preventDefault();
              e.stopPropagation();
              rpc('needs.dismiss', { id: item.id });
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            inboxStore.set({ selectedId: null });
          }
        }}
      >
        <div className="ou-ny-cell-item">
          <StatusRing status={status} />
          <span className="ou-ititle">{titleText}</span>
          {userRowLabels.map((lbl) => (
            <span key={lbl} className="ou-ny-list-chip" title={lbl}>
              {lbl}
            </span>
          ))}
        </div>
        <div className="ou-ny-cell-agent">
          {engineId ? (
            <>
              <span className="ou-ny-avatar">{engineId[0].toUpperCase()}</span>
              <span className="ou-ny-agent-name">{engineId}</span>
            </>
          ) : (
            <span className="ou-ny-none">-</span>
          )}
        </div>
        <div className="ou-ny-cell-space" title={workspaceText}>
          {workspaceText}
        </div>
        <div className="ou-ny-cell-time">
          {timeText || '-'}
        </div>
        <div className="ou-ny-actions" onClick={(e) => e.stopPropagation()}>
          {!isSession ? (
            <>
              <button
                type="button"
                className="ou-ny-act"
                aria-label={item.read_at ? 'Mark unread (r)' : 'Mark read (r)'}
                title={item.read_at ? 'Mark unread (r)' : 'Mark read (r)'}
                data-action={item.read_at ? 'inbox-unread' : 'inbox-read'}
                data-id={item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  rpc(item.read_at ? 'needs_you.mark-unread' : 'needs_you.mark-read', { id: item.id }, true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
                  <path d="M1.5 4.5l5.5 3.5 5.5-3.5" />
                </svg>
              </button>
              <button
                type="button"
                className="ou-ny-act"
                aria-label="Archive (a)"
                title="Archive (a)"
                data-action="dismiss"
                data-id={item.id}
                onClick={(e) => {
                  e.stopPropagation();
                  rpc('needs.dismiss', { id: item.id });
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2.5 3.5h9M5 7h4M2 3.5l1 8h8l1-8" />
                </svg>
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ou-ny-act"
            aria-label="Open (Enter)"
            title="Open (Enter)"
            data-action={isSession ? 'pick' : 'inbox-open'}
            data-id={item.id}
            onClick={(e) => {
              e.stopPropagation();
              if (isSession) openOnWall(item);
              else openNotice(item);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2.5H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8M8 2.5h3.5v3.5M6.5 7.5L11.5 2.5" />
            </svg>
          </button>
        </div>
      </li>
    );
  };

  return (
    <div
      className="ou-inbox"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          inboxStore.set({ selectedId: null });
        }
      }}
    >
      <div className="ou-inbox-list">
        <header className="ou-inbox-head">
          <h1 className="ou-ny-title">Needs you</h1>
          <div className="ou-ny-counts">
            {waitingCount} waiting {'\u00B7'} {workingCount} working {'\u00B7'} {noticesCount} notices
          </div>
        </header>
        {totalItems === 0 ? (
          <div className="ou-ny-empty">
            <EmptyState
              title="Nothing is waiting on you."
              description="Questions from agents and finished work show up here."
              isCompact
            />
          </div>
        ) : (
          <>
            <div className="ou-ny-cols">
              <div className="ou-ny-col-item">ITEM</div>
              <div className="ou-ny-col-agent">AGENT</div>
              <div className="ou-ny-col-space">WORKSPACE</div>
              <div className="ou-ny-col-time">UPDATED</div>
            </div>
            <ul className="ou-list">
              {groups.map((group) => {
                const isCollapsed = (collapsed || []).includes(group.key) || group.count === 0;
                return (
                  <Fragment key={group.key}>
                    <li
                      className={`ou-ihead ou-ny-ghead ${group.count === 0 ? 'ou-ny-gdim' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleGroup(group.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          e.stopPropagation();
                          collapseGroup(group.key);
                        } else if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          expandGroup(group.key);
                        } else if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleGroup(group.key);
                        }
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="ou-ny-gchev">
                        {isCollapsed ? <path d="M4.5 3l3 3-3 3" /> : <path d="M3 4.5l3 3 3-3" />}
                      </svg>
                      <span className="ou-ny-gtitle">{group.title}</span>
                      <span className="ou-ny-gcount">{group.count}</span>
                    </li>
                    {!isCollapsed && (
                      <>
                        {group.key === 'needs' && approvals.length ? (
                          <li className="ou-ny-igates">
                            <div className="igates" dangerouslySetInnerHTML={{ __html: approvals.map(approvalCard).join('') }} />
                          </li>
                        ) : null}
                        {group.items.map((rowItem) => renderRow(rowItem.item, rowItem.isSession, group.key))}
                      </>
                    )}
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}
      </div>
      {activeRow ? (
        <div className="ou-ipane">
          <div className="ou-ny-side-head">
            <div className="ou-ny-side-head-status">
              <StatusRing status={activeStatus.status} />
              <span>{activeStatus.word}</span>
            </div>
            <div className="ou-ny-side-head-actions">
              {activeIsSession || activeItem.ref ? <button
                type="button"
                className="ou-ny-close"
                aria-label="Open on Wall"
                title="Open on Wall"
                data-action="pick"
                data-id={activeIsSession ? activeItem.id : (activeItem.ref || activeItem.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeIsSession) openOnWall(activeItem);
                  else if (activeItem.ref) openNotice(activeItem);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
                  <path d="M5.5 1.5v11M1.5 5.5h4" />
                </svg>
              </button> : null}
              <button
                type="button"
                className="ou-ny-close"
                aria-label="Close details"
                title="Close details"
                onClick={() => inboxStore.set({ selectedId: null })}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          </div>
          <div className="ou-ny-side-body">
            <div className="ou-ny-top-chips">
              <div className={`ou-ny-top-chip ou-ny-top-chip-status ou-ny-top-chip-${activeStatus.status}`}>
                <StatusRing status={activeStatus.status} size={12} />
                <span>{activeStatus.word}</span>
              </div>
              <div className="ou-ny-top-chip">
                <span className="ou-ny-dot-sq" />
                <span>{propProject || '-'}</span>
              </div>
              <div className="ou-ny-top-chip">
                {propEngine ? (
                  <>
                    <span className="ou-ny-avatar ou-ny-avatar-16">{propEngine[0].toUpperCase()}</span>
                    <span>{propEngine}</span>
                  </>
                ) : (
                  <span>Unassigned</span>
                )}
              </div>
            </div>
            <div className="ou-ny-side-title">{activeTitle}</div>
            <div className="ou-ny-grid">
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Status</div>
                <div className="ou-ny-grid-val">{activeStatus.word}</div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Labels</div>
                <div className="ou-ny-grid-val ou-ny-prop-labels">
                  {userLabels.map((lbl) => (
                    <span key={lbl} className="ou-ny-chip">
                      <span>{lbl}</span>
                      <button
                        type="button"
                        className="ou-ny-chip-remove"
                        aria-label={`Remove label ${lbl}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveLabel(lbl);
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M2 2l10 10M12 2L2 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {autoLabels.map((lbl) => (
                    <span key={`auto-${lbl}`} className="ou-ny-chip ou-ny-chip-muted">
                      {lbl}
                    </span>
                  ))}
                  {addingLabel ? (
                    <TextInput
                      size="sm"
                      placeholder="Label, Enter adds"
                      value={newLabel}
                      onChange={setNewLabel}
                      onEnter={handleAddLabel}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setAddingLabel(false);
                          setNewLabel('');
                        }
                      }}
                      hasAutoFocus
                      width={140}
                    />
                  ) : (
                    <button
                      type="button"
                      className="ou-ny-label-add"
                      aria-label="Add label"
                      disabled={!hasLabelsArray}
                      title={!hasLabelsArray ? 'Labels need a core update' : undefined}
                      onClick={() => setAddingLabel(true)}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Assignee</div>
                <div className="ou-ny-grid-val ou-ny-prop-assignee">
                  {sessionObj ? (
                    <>
                      {propEngine ? (
                        <span className="ou-ny-prop-agent">
                          <span className="ou-ny-avatar ou-ny-avatar-16">{propEngine[0].toUpperCase()}</span>
                          <span>{propEngine}</span>
                        </span>
                      ) : (
                        <span className="ou-ny-none">Unassigned</span>
                      )}
                      <Selector
                        size="sm"
                        variant="ghost"
                        label="Hand to another agent"
                        isLabelHidden
                        options={handOptions}
                        value=""
                        onChange={(val) => {
                          if (val) setHandoverTarget(val);
                        }}
                      />
                    </>
                  ) : (
                    propEngine || '-'
                  )}
                </div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Project</div>
                <div className="ou-ny-grid-val ou-ny-prop-project">
                  <span className="ou-ny-dot-sq" />
                  <span>{propProject || '-'}</span>
                </div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Service</div>
                <div className="ou-ny-grid-val">
                  {serviceUrl ? (
                    <button
                      type="button"
                      className="ou-ny-service-link"
                      onClick={() => openTermLink(serviceUrl)}
                    >
                      <span>{serviceUrl}</span>
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2.5H3a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V8M8 2.5h3.5v3.5M6.5 7.5L11.5 2.5" />
                      </svg>
                    </button>
                  ) : (
                    '-'
                  )}
                </div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Branch</div>
                <div className="ou-ny-grid-val ou-ny-prop-branch">{propBranch || '-'}</div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Folder</div>
                <div className="ou-ny-grid-val ou-ny-prop-folder">{propFolder || '-'}</div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Started</div>
                <div className="ou-ny-grid-val">{propStarted || '-'}</div>
              </div>
              <div className="ou-ny-grid-row">
                <div className="ou-ny-grid-label">Updated</div>
                <div className="ou-ny-grid-val">{propUpdated || '-'}</div>
              </div>
            </div>
            {activeRow.type === 'ask' ? (
              <DetailAsk key={`ask-${activeRow.item.id}`} x={activeRow.item} text={sessionText} error={sessionTextError} />
            ) : activeRow.type === 'working' ? (
              <div className="ou-ny-ask">
                <TerminalPreview text={sessionText} error={sessionTextError} />
              </div>
            ) : (
              <DetailNotice key={`notice-${activeRow.item.id}`} n={activeRow.item} kindOf={kindOf} />
            )}
            <RunLedger key={`ledger-${ledgerSessionId || activeRow.id}`} sessionId={ledgerSessionId} />
            <div className="ou-ny-slot" data-slot="handoff">
              <div className="ou-ny-slot-title">Handoff</div>
              <div className="ou-ny-slot-body">The handoff note shows here once the core records it.</div>
            </div>
          </div>
          {handoverTarget && sessionObj ? (
            <AlertDialog
              isOpen={Boolean(handoverTarget)}
              onOpenChange={(open) => {
                if (!open) setHandoverTarget(null);
              }}
              title={`Hand this task to ${handoverTarget}?`}
              description={`A new ${handoverTarget} agent starts in ${propProject || sessionObj.project_id || ui.projectId || ''} with the same task. The current agent keeps running until you stop it.`}
              actionLabel="Hand over"
              onAction={async () => {
                const chosen = handoverTarget;
                setHandoverTarget(null);
                const r = await rpc('session.launch', {
                  project_id: sessionObj.project_id || ui.projectId,
                  engine_id: chosen,
                  prompt: taskOf(sessionObj),
                });
                if (r && r.result) {
                  toast(`Handed to ${chosen}`);
                  inboxStore.set({ selectedId: r.result.session_id });
                } else {
                  const errText = (r && r.error && (r.error.message || r.error)) || 'Failed to hand over';
                  toast(errText, true);
                }
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
