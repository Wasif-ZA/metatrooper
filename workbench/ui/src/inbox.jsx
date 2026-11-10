import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Kbd } from '@astryxdesign/core/Kbd';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import { AgentHead } from './agenthead.jsx';

export const inboxStore = createStore({ tick: 0, filter: 'all', selectedId: null });

const FILTERS = [['all', 'All'], ['needs', 'Needs you'], ['done', 'Finished'], ['failed', 'Failed']];
const LOOP_CHOICES = [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']];

function Glyph({ kind }) {
  const p = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (kind === 'needs') return <svg {...p} className="ou-g ou-g-needs" aria-label="Needs you"><circle cx="7" cy="7" r="3.5" fill="currentColor" stroke="none" /></svg>;
  if (kind === 'done') return <svg {...p} className="ou-g" aria-label="Finished"><path d="M3 7.5l2.6 2.6L11 4.5" /></svg>;
  if (kind === 'failed') return <svg {...p} className="ou-g ou-g-bad" aria-label="Failed"><path d="M4 4l6 6M10 4l-6 6" /></svg>;
  return <svg {...p} className="ou-g" aria-label="For your information"><circle cx="7" cy="7" r="3" /></svg>;
}

function NoteActions({ n }) {
  const loop = loopOf(n);
  const lend = lendOf(n);
  return (
    <span className="ou-actions">
      {loop ? LOOP_CHOICES.map(([choice, label]) => <Button key={choice} size="sm" label={label} data-action="loop-choose" data-id={loop} data-choice={choice} />) : null}
      {lend ? <Button size="sm" variant="primary" label="Lend this site" data-action="lend-set" data-project={lend.project} data-origin={lend.origin} /> : null}
      {lend ? <Button size="sm" label="No" data-action="dismiss" data-id={n.id} /> : null}
      <span className="ou-hoveronly"><Button size="sm" variant="ghost" label={n.read_at ? 'Mark unread' : 'Mark read'} data-action={n.read_at ? 'inbox-unread' : 'inbox-read'} data-id={n.id} /></span>
    </span>
  );
}

function TerminalPreview({ sessionId, stamp }) {
  const [state, setState] = useState({ lines: null, error: false });

  useEffect(() => {
    let active = true;
    rpc('session.read', { session_id: sessionId, lines: 20 }, true)
      .then((res) => {
        if (!active) return;
        if (res && res.result && res.result.lines != null) {
          const text = Array.isArray(res.result.lines) ? res.result.lines.join('\n') : String(res.result.lines);
          if (text.length > 0) {
            setState({ lines: text, error: false });
          } else {
            setState({ lines: null, error: true });
          }
        } else {
          setState({ lines: null, error: true });
        }
      })
      .catch(() => {
        if (!active) return;
        setState({ lines: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [sessionId, stamp]);

  if (state.error || state.lines === null) {
    return <div className="ou-ipane-muted">No terminal text to show yet. Open it on the Wall.</div>;
  }

  return <pre className="ou-ipane-pre">{state.lines}</pre>;
}

function DetailAsk({ x }) {
  const [answer, setAnswer] = useState('');
  const here = !x.project_id || x.project_id === ui.projectId;
  const projectName = ui.snap?.projects?.find((p) => p.id === x.project_id)?.name || 'another project';

  const send = async () => {
    if (!here) return;
    const text = answer.trim();
    if (!text) return;
    try {
      await troop.termInput(x.id, text + '\r');
      setAnswer('');
      toast(`Sent to ${x.engine_id}`);
    } catch (err) {
      toast(String((err && err.message) || err), true);
    }
  };

  return (
    <>
      <AgentHead x={x}>
        <button
          type="button"
          className="ou-ipane-btn"
          data-action="pick"
          data-id={x.id}
          aria-label="Open on Wall"
          title="Open on Wall"
          onClick={(e) => {
            e.stopPropagation();
            openOnWall(x);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" />
            <path d="M5.5 1.5v11M1.5 5.5h4" />
          </svg>
        </button>
      </AgentHead>
      <div className="ou-ipane-question">
        <div className="ou-ipane-task">{taskOf(x)}</div>
        {x.last_line ? <div className="ou-ipane-lastline">{x.last_line}</div> : null}
      </div>
      <TerminalPreview key={x.id} sessionId={x.id} stamp={x.last_line} />
      <div className="ou-ipane-answer">
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
    </>
  );
}

function DetailNotice({ n, kindOf }) {
  const kind = kindOf(n);
  const time = ago(n.at);
  const meta = time ? `${n.kind} · ${time}` : n.kind;
  return (
    <div className="ou-ipane-notice">
      <div className="ou-ipane-noticehead">
        <Glyph kind={kind} />
        <span className="ou-ipane-noticetext">{n.text}</span>
      </div>
      <div className="ou-ipane-muted">{meta}</div>
      {((n.kind === 'done' || n.kind === 'failed') && n.ref) || n.kind === 'uncommitted' ? <Button size="sm" variant="ghost" label="Open" onClick={() => { openNotice(n); }} /> : null}
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

export function Inbox() {
  const { filter, selectedId } = inboxStore.use();
  if (ui.view !== 'inbox') return null;
  const s = ui.snap;
  const away = (pid) => (pid === ui.projectId ? '' : `${(s.projects.find((p) => p.id === pid) || {}).name || 'other project'} · `);
  const showAsks = filter === 'all' || filter === 'needs';
  const asks = showAsks ? waitingAll() : [];
  const approvals = showAsks ? s.approvals || [] : [];
  const kindOf = (n) => (n.kind === 'failed' ? 'failed' : n.kind === 'done' ? 'done' : isInfo(n) ? 'info' : 'needs');
  const rank = { needs: 0, failed: 1, done: 2, info: 3 };
  const notes = s.needs_you.filter((n) => (filter === 'all' ? true : filter === 'needs' ? kindOf(n) === 'needs' : n.kind === filter))
    .slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)) || (rank[kindOf(a)] - rank[kindOf(b)]));
  const count = {
    all: waitingAll().length + (s.approvals || []).length + s.needs_you.length,
    needs: needsCount(),
    done: s.needs_you.filter((n) => n.kind === 'done').length,
    failed: s.needs_you.filter((n) => n.kind === 'failed').length,
  };

  const allRows = [
    ...asks.map((x) => ({ type: 'ask', id: x.id, item: x })),
    ...notes.map((n) => ({ type: 'note', id: n.id, item: n })),
  ];
  const activeRow = allRows.find((r) => r.id === selectedId) || allRows[0] || null;
  const activeId = activeRow ? activeRow.id : null;

  return (
    <div className="ou-inbox">
      <div className="ou-inbox-list">
        <header className="ou-inbox-head">Needs you</header>
        <div className="ou-ifilters">
          {FILTERS.map(([id, label]) => {
            const isSelected = filter === id;
            return (
              <button
                key={id}
                type="button"
                className={isSelected ? 'ou-ifilters-chip ou-ifilters-selected' : count[id] === 0 ? 'ou-ifilters-chip ou-ifilters-zero' : 'ou-ifilters-chip'}
                onClick={() => inboxStore.set({ filter: id })}
              >
                {label}
              </button>
            );
          })}
        </div>
        {approvals.length ? (
          <>
            <h2>Agent actions waiting for a yes</h2>
            <div className="igates" dangerouslySetInnerHTML={{ __html: approvals.map(approvalCard).join('') }} />
          </>
        ) : null}
        {asks.length || notes.length ? (
          <ul className="ou-list">
            {asks.length ? <li className="ou-ihead">Needs your answer <i>{asks.length}</i></li> : null}
            {asks.map((x) => {
              const isSelected = activeId === x.id;
              return (
                <li
                  key={x.id}
                  className={isSelected ? 'ou-irow ou-irow-selected ou-unread' : 'ou-irow ou-unread'}
                  data-action="pick"
                  data-id={x.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.currentTarget.focus();
                    inboxStore.set({ selectedId: x.id });
                  }}
                  onFocus={() => {
                    if (inboxStore.get().selectedId !== x.id) {
                      inboxStore.set({ selectedId: x.id });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); openOnWall(x); }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-selected={isSelected}
                >
                  <AgentHead x={x}>
                    {away(x.project_id) ? <span className="ou-imeta">{away(x.project_id).replace(/ · $/, '')}</span> : null}
                  </AgentHead>
                </li>
              );
            })}
            {notes.length ? <li className="ou-ihead">Notices <i>{notes.length}</i></li> : null}
            {notes.map((n) => {
              const isSelected = activeId === n.id;
              return (
                <li
                  key={n.id}
                  className={isSelected ? (n.read_at ? 'ou-irow ou-irow-selected' : 'ou-irow ou-irow-selected ou-unread') : (n.read_at ? 'ou-irow' : 'ou-irow ou-unread')}
                  data-action="inbox-open"
                  data-id={n.id}
                  onClick={(e) => {
                    if (e.target.closest('button, .astryx-button')) return;
                    e.stopPropagation();
                    e.currentTarget.focus();
                    inboxStore.set({ selectedId: n.id });
                  }}
                  onFocus={() => {
                    if (inboxStore.get().selectedId !== n.id) {
                      inboxStore.set({ selectedId: n.id });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); openNotice(n); }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-selected={isSelected}
                >
                  <Glyph kind={kindOf(n)} />
                  <span className="ou-iwho" />
                  <span className="ou-ititle">{n.text}</span>
                  <span className="ou-imeta"><span className="ou-chip">{n.kind}</span></span>
                  <NoteActions n={n} />
                  <span className="ou-itime">{ago(n.at)}</span>
                </li>
              );
            })}
          </ul>
        ) : approvals.length ? null : (
          <EmptyState title="Nothing here." description="Agents that ask, finish or fail show up in this list." isCompact />
        )}
        <footer className="ou-keys ou-inbox-footer">
          <Kbd keys="J" /><Kbd keys="K" /> move <Kbd keys="Enter" /> open
        </footer>
      </div>
      <div className="ou-ipane">
        <div className="ou-inbox-detail-head">
          {!activeRow ? 'Details' : activeRow.type === 'ask' ? 'Agent' : 'Notice'}
        </div>
        {!activeRow ? (
          <div className="ou-ipane-empty ou-inbox-detail-empty"><EmptyState title="Nothing is waiting on you." description="Questions from agents and finished work show up here." isCompact /></div>
        ) : activeRow.type === 'ask' ? (
          <DetailAsk key={activeRow.item.id} x={activeRow.item} />
        ) : (
          <DetailNotice n={activeRow.item} kindOf={kindOf} />
        )}
      </div>
    </div>
  );
}
