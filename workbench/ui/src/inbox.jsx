import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Kbd } from '@astryxdesign/core/Kbd';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { createStore } from './store.js';

export const inboxStore = createStore({ tick: 0, filter: 'all' });

const FILTERS = [['all', 'All'], ['needs', 'Needs you'], ['done', 'Finished'], ['failed', 'Failed']];
const LOOP_CHOICES = [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']];

// Shape carries the state, as in Herdr: filled dot needs you, check finished, cross failed, hollow dot for information.
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

// Row anatomy follows Paperclip's inbox: 44px rows, state glyph, title whose weight says unread, quiet meta, a fixed time column.
export function Inbox() {
  const { filter } = inboxStore.use();
  if (ui.view !== 'inbox') return null;
  const s = ui.snap;
  const away = (pid) => (pid === ui.projectId ? '' : `${(s.projects.find((p) => p.id === pid) || {}).name || 'other project'} · `);
  const showAsks = filter === 'all' || filter === 'needs';
  const asks = showAsks ? waitingAll() : [];
  const approvals = showAsks ? s.approvals || [] : [];
  const kindOf = (n) => (n.kind === 'failed' ? 'failed' : n.kind === 'done' ? 'done' : isInfo(n) ? 'info' : 'needs');
  const rank = { needs: 0, failed: 1, done: 2, info: 3 };
  const notes = s.needs_you.filter((n) => (filter === 'all' ? true : filter === 'needs' ? !isInfo(n) : n.kind === filter))
    .slice().sort((a, b) => (Boolean(a.read_at) - Boolean(b.read_at)) || (rank[kindOf(a)] - rank[kindOf(b)]));
  const count = { all: waitingAll().length + (s.approvals || []).length + s.needs_you.length, needs: needsCount(), done: s.needs_you.filter((n) => n.kind === 'done').length, failed: s.needs_you.filter((n) => n.kind === 'failed').length };
  const open = () => homeView.set('wall');
  return (
    <div className="ou-col ou-inbox">
      <header className="ou-split ou-pagehead">
        <div>
          <h1>Needs you</h1>
          <p>{count.needs ? `${count.needs} waiting on you` : 'Nothing is waiting on you'}</p>
        </div>
        <SegmentedControl label="Filter" size="sm" value={filter} onChange={(v) => inboxStore.set({ filter: v })}>
          {FILTERS.map(([id, label]) => <SegmentedControlItem key={id} value={id} label={`${label} · ${count[id]}`} />)}
        </SegmentedControl>
      </header>
      {approvals.length ? <><h2>Agent actions waiting for a yes</h2><div className="igates" dangerouslySetInnerHTML={{ __html: approvals.map(approvalCard).join('') }} /></> : null}
      {asks.length || notes.length ? (
        <ul className="ou-list">
          {asks.length ? <li className="ou-ihead">Needs your answer<i>{asks.length}</i></li> : null}
          {asks.map((x) => (
            <li key={x.id} className="ou-irow ou-unread" data-action="pick" data-id={x.id} onClick={open} tabIndex={0} role="button">
              <Glyph kind="needs" />
              <span className="ou-iwho">{x.engine_id}</span>
              <span className="ou-ititle">{taskOf(x)}</span>
              <span className="ou-imeta">{away(x.project_id)}{x.last_line ? <span className="ou-chip">{x.last_line}</span> : null}</span>
              <span className="ou-actions"><Button size="sm" label="Answer" data-action="pick" data-id={x.id} onClick={open} /></span>
              <span className="ou-itime">{ago(x.state_at)}</span>
            </li>
          ))}
          {notes.length ? <li className="ou-ihead">Notices<i>{notes.length}</i></li> : null}
          {notes.map((n) => (
            <li key={n.id} className={n.read_at ? 'ou-irow' : 'ou-irow ou-unread'} data-action="inbox-open" data-id={n.id} onClick={open} tabIndex={0} role="button">
              <Glyph kind={kindOf(n)} />
              <span className="ou-iwho" />
              <span className="ou-ititle">{n.text}</span>
              <span className="ou-imeta"><span className="ou-chip">{n.kind}</span></span>
              <NoteActions n={n} />
              <span className="ou-itime">{ago(n.at)}</span>
            </li>
          ))}
        </ul>
      ) : approvals.length ? null : <EmptyState title="Nothing here." description="Agents that ask, finish or fail show up in this list." isCompact />}
      <footer className="ou-keys"><Kbd keys="J" /><Kbd keys="K" /> move <Kbd keys="Enter" /> open</footer>
    </div>
  );
}
