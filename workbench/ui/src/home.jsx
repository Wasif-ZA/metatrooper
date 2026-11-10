import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { createStore } from './store.js';

export const homeStore = createStore({ tick: 0 });

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Tile({ label, n, sub, hot }) {
  return (
    <Card padding={4} variant={hot ? 'orange' : 'default'}>
      <div className="ou-tile">
        <Text color="secondary" size="sm">{label}</Text>
        <Text size="2xl" weight="bold">{String(n)}</Text>
        <Text color="secondary" size="sm">{sub}</Text>
      </div>
    </Card>
  );
}

function StartBox({ ready }) {
  const [task, setTask] = useState(ui.drafts['home-task'] || '');
  const [engine, setEngine] = useState(ui.drafts['home-engine'] || load('engine') || ready[0].id);
  const start = async () => {
    const text = task.trim();
    const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: engine, ...(text ? { prompt: text } : {}) });
    if (!r.result) return;
    delete ui.drafts['home-task'];
    setTask('');
    save('engine', engine);
    homeView.set('wall');
    await pick(r.result.session_id);
  };
  return (
    <Card padding={3}>
      <TextArea label="Task for a new agent" isLabelHidden rows={2} value={task} placeholder="What should an agent do? Leave it empty to just open one." onChange={(v) => { ui.drafts['home-task'] = v; setTask(v); }} />
      <div className="ou-startrow">
        <Selector label="Agent" isLabelHidden size="sm" options={ready.map((e) => ({ value: e.id, label: e.id }))} value={ready.some((e) => e.id === engine) ? engine : ready[0].id} onChange={(v) => { ui.drafts['home-engine'] = v; setEngine(v); }} />
        <Button variant="primary" label="Start" onClick={start} />
      </div>
    </Card>
  );
}

const dot = (state) => (state === 'waiting_for_you' ? 'warning' : state === 'working' || state === 'starting' ? 'success' : 'neutral');

export function Home() {
  homeStore.use();
  if (!homeView.shown()) return null;
  const s = ui.snap;
  const mine = s.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const waiting = waitingAll();
  const working = mine.filter((x) => x.state === 'working' || x.state === 'starting');
  const done = mine.filter((x) => x.state === 'done');
  const files = mine.reduce((n, x) => n + changedFiles(x.id).length, 0);
  const alerts = s.needs_you.filter((n) => !n.read_at && !isInfo(n));
  const recent = s.needs_you.filter((n) => n.kind === 'done' || n.kind === 'failed').slice(0, 6);
  const approvals = s.approvals || [];
  const away = (x) => (x.project_id === ui.projectId ? '' : `${(s.projects.find((p) => p.id === x.project_id) || {}).name || 'other project'} · `);
  const ready = s.engines.filter((e) => e.light !== 'red');
  const needs = waiting.length + approvals.length + alerts.length;
  const name = project().name;
  return (
    <div className="ou-col ou-home">
      <header>
        <Heading level={1}>{greeting()}</Heading>
        <Text as="p" color="secondary">{mine.length ? `${mine.length} ${mine.length === 1 ? 'agent' : 'agents'} in ${name}` : `No agents running in ${name}`}</Text>
      </header>
      {ready.length ? <StartBox ready={ready} /> : null}
      <div className="ou-tiles">
        <Tile label="Needs you" n={needs} sub={needs ? 'waiting on an answer' : 'nothing waiting'} hot={needs > 0} />
        <Tile label="Working" n={working.length} sub={working.length ? 'running now' : 'none running'} />
        <Tile label="Finished" n={done.length} sub={done.length ? 'ready to review' : 'nothing to review'} />
        <Tile label="Changed files" n={files} sub={files ? 'not handed back yet' : 'no changes'} />
      </div>
      {waiting.length || approvals.length || alerts.length ? (
        <>
          <Heading level={2}>Waiting on you</Heading>
          <List hasDividers>
            {waiting.map((x) => (
              <ListItem key={x.id} label={taskOf(x)} description={`${away(x)}${x.engine_id}${x.last_line ? ` · ${x.last_line}` : ''}`}
                startContent={<StatusDot variant="warning" label="Needs you" />}
                endContent={<span className="ou-actions"><Badge variant="orange" label="Needs you" /><Button size="sm" variant="primary" label="Answer" data-action="pick" data-id={x.id} /></span>} />
            ))}
            {approvals.length ? (
              <ListItem label={`${approvals.length} agent ${approvals.length === 1 ? 'action waits' : 'actions wait'} for a yes`} description="Allow or refuse each one"
                startContent={<StatusDot variant="warning" label="Needs you" />}
                endContent={<Button size="sm" variant="primary" label="Review" data-action="sheet" />} />
            ) : null}
            {alerts.map((n) => (
              <ListItem key={n.id} label={n.text} description={`${n.kind} · ${ago(n.at)}`}
                startContent={<StatusDot variant="warning" label="Needs you" />}
                endContent={<Button size="sm" label="Open" data-action="inbox-open" data-id={n.id} />} />
            ))}
          </List>
        </>
      ) : null}
      <Heading level={2}>Agents</Heading>
      {mine.length ? (
        <div className="ou-cards">
          {mine.map((x) => (
            <div key={x.id} data-action="pick" data-id={x.id} role="button" tabIndex={0}>
              <Card padding={4}>
                <div className="ou-split"><span className="ou-actions"><StatusDot variant={dot(x.state)} label={STATE_WORDS[x.state] || x.state} /><Text weight="bold">{x.engine_id}</Text></span><Text color="secondary" size="sm">{STATE_WORDS[x.state] || x.state}</Text></div>
                <Text as="p">{taskOf(x)}</Text>
                <div className="ou-split"><Text color="secondary" size="sm" maxLines={1}>{x.last_line || ''}</Text>{changedFiles(x.id).length ? <Badge label={`${changedFiles(x.id).length} files`} /> : null}</div>
              </Card>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Start one with the box above." isCompact />}
      {recent.length ? (
        <>
          <Heading level={2}>Recent</Heading>
          <List hasDividers>
            {recent.map((n) => (
              <ListItem key={n.id} label={n.text} startContent={<StatusDot variant={n.kind === 'failed' ? 'error' : 'neutral'} label={n.kind === 'failed' ? 'Failed' : 'Finished'} />}
                endContent={<span className="ou-actions"><Text color="secondary" size="sm">{ago(n.at)}</Text><Button size="sm" variant="ghost" label="Open" data-action="inbox-open" data-id={n.id} /></span>} />
            ))}
          </List>
        </>
      ) : null}
    </div>
  );
}
