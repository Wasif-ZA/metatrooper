import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { createStore } from './store.js';

export const inboxStore = createStore({ tick: 0, filter: 'all' });

const FILTERS = [['all', 'All'], ['needs', 'Needs you'], ['done', 'Finished'], ['failed', 'Failed']];
const LOOP_CHOICES = [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']];

function NoteActions({ n }) {
  const loop = loopOf(n);
  const lend = lendOf(n);
  return (
    <span className="ou-actions">
      <Text color="secondary" size="sm">{ago(n.at)}</Text>
      {loop ? LOOP_CHOICES.map(([choice, label]) => <Button key={choice} size="sm" label={label} data-action="loop-choose" data-id={loop} data-choice={choice} />) : null}
      {lend ? <Button size="sm" variant="primary" label="Lend this site" data-action="lend-set" data-project={lend.project} data-origin={lend.origin} /> : null}
      {lend ? <Button size="sm" label="No" data-action="dismiss" data-id={n.id} /> : null}
      <Button size="sm" variant="ghost" label={n.read_at ? 'Mark unread' : 'Mark read'} data-action={n.read_at ? 'inbox-unread' : 'inbox-read'} data-id={n.id} />
    </span>
  );
}

export function Inbox() {
  const { filter } = inboxStore.use();
  if (ui.view !== 'inbox') return null;
  const s = ui.snap;
  const away = (pid) => (pid === ui.projectId ? '' : `${(s.projects.find((p) => p.id === pid) || {}).name || 'other project'} · `);
  const showAsks = filter === 'all' || filter === 'needs';
  const asks = showAsks ? waitingAll() : [];
  const approvals = showAsks ? s.approvals || [] : [];
  const notes = s.needs_you.filter((n) => (filter === 'all' ? true : filter === 'needs' ? !isInfo(n) : n.kind === filter));
  const count = { all: waitingAll().length + (s.approvals || []).length + s.needs_you.length, needs: needsCount(), done: s.needs_you.filter((n) => n.kind === 'done').length, failed: s.needs_you.filter((n) => n.kind === 'failed').length };
  const open = () => homeView.set('wall');
  return (
    <div className="ou-col">
      <header>
        <Heading level={1}>Needs you</Heading>
        <Text as="p" color="secondary">{count.needs ? `${count.needs} waiting on you` : 'Nothing is waiting on you'}</Text>
      </header>
      <SegmentedControl label="Filter" value={filter} onChange={(v) => inboxStore.set({ filter: v })}>
        {FILTERS.map(([id, label]) => <SegmentedControlItem key={id} value={id} label={`${label} ${count[id]}`} />)}
      </SegmentedControl>
      {approvals.length ? <><Heading level={2}>Agent actions waiting for a yes</Heading><div className="igates" dangerouslySetInnerHTML={{ __html: approvals.map(approvalCard).join('') }} /></> : null}
      {asks.length || notes.length ? (
        <List hasDividers>
          {asks.map((x) => (
            <ListItem key={x.id} label={taskOf(x)} description={`${away(x.project_id)}${x.engine_id} is asking${x.last_line ? ` · ${x.last_line}` : ''}`}
              startContent={<StatusDot variant="warning" label="Waiting for you" />}
              endContent={<Button size="sm" variant="primary" label="Answer" data-action="pick" data-id={x.id} onClick={open} />} />
          ))}
          {notes.map((n) => (
            <ListItem key={n.id} label={n.text} description={n.kind}
              startContent={<StatusDot variant={n.kind === 'failed' ? 'error' : n.read_at || isInfo(n) ? 'neutral' : 'warning'} label={n.kind === 'failed' ? 'Failed' : n.read_at || isInfo(n) ? 'For your information' : 'Needs you'} />}
              endContent={<NoteActions n={n} />} />
          ))}
        </List>
      ) : approvals.length ? null : <EmptyState title="Nothing here." isCompact />}
    </div>
  );
}
