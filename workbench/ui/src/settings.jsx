import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { SideNav, SideNavHeading, SideNavItem } from '@astryxdesign/core/SideNav';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';

export const settingsStore = createStore({ data: null, section: 'general' });

const SECTIONS = [
  { id: 'general', label: 'General', rows: [
    { key: 'sessions.approval', label: 'Before each tool call', hint: 'Ask shows every command for a yes. Auto lets agents run inside their own Ouros worktree.', select: [['ask', 'Ask me'], ['contained', 'Auto in Ouros worktrees']] },
    { key: 'sessions.metarouter', label: 'Route shell commands through metarouter', hint: 'Shorter command output for agents.' },
  ] },
  { id: 'look', label: 'Appearance', rows: [
    { theme: true, label: 'Theme' },
    { key: 'terminal.font_size', label: 'Terminal font size', min: 8, max: 28 },
    { key: 'terminal.scrollback', label: 'Terminal scrollback', hint: 'Lines kept per terminal.', min: 1000, max: 200000, step: 1000 },
    { key: 'agent_cursor.show_caption', label: 'Caption beside the agent cursor', hint: 'Says what the agent is about to click.' },
  ] },
  { id: 'reliability', label: 'Reliability', note: 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.', rows: [
    { key: 'reliability.done_needs_check', label: 'Say done only when a check passed', hint: 'A finished agent with no passing check reads "needs your review".' },
    { check: true, label: 'Check command for this project', hint: 'Runs in the folder the agent worked in when it finishes. Empty means every finish needs your review.' },
    { soon: true, label: 'Fix failing checks, up to 3 tries', hint: 'Each try starts from clean files. Tests and check settings are protected from edits.' },
    { key: 'reliability.loop_alarm', label: 'Loop alarm', hint: 'Claude agents only. Watches for the same call giving the same result.' },
    { key: 'reliability.loop_nudge_at', label: 'Ask me after', unit: 'identical calls', min: 2, max: 20 },
    { key: 'reliability.loop_stop_at', label: 'Stop the agent after', unit: 'identical calls', min: 3, max: 50 },
    { read: (s) => String(s.reliability.false_alarms), label: 'False alarms so far', hint: 'Times you answered "Not a loop".' },
    { key: 'reliability.token_limit', label: 'Token limit per agent', hint: 'A log line at 80%. At 100% the agent is paused and you are asked. 0 turns it off.', unit: 'tokens', min: 0, max: 100000000, step: 10000 },
    { soon: true, label: 'Retry provider errors', hint: 'Backs off and retries. Asks before switching model.' },
    { soon: true, label: 'Check after every edit', hint: 'Typecheck, lint and the nearest tests.' },
    { soon: true, label: 'Ask when a request can mean two things', hint: 'Shows as one Needs you card.' },
    { soon: true, label: 'Keep runs going when Ouros closes', hint: 'Resumes from the last step. Sends and deploys always ask again.' },
    { soon: true, label: 'Checkpoint every turn', hint: 'Undo takes the files back to any turn.' },
  ] },
  { id: 'savings', label: 'Savings', note: 'Each one trades some detail for fewer tokens. All start off.', rows: [
    { key: 'savers.shrink_shell', label: 'Shrink shell output' },
    { key: 'savers.lean_handoffs', label: 'Lean handoffs between agents' },
    { key: 'savers.small_screenshots', label: 'Smaller screenshots' },
    { key: 'savers.cheap_model', label: 'Cheapest model that fits each step' },
  ] },
  { id: 'safety', label: 'Safety', rows: [
    { key: 'desktop.watch_pause', label: 'Pause the agent when I touch the desktop', hint: 'Computer use stops while your mouse or keyboard is busy.' },
    { read: (s) => s.desktop.takeover_key, label: 'Take-over key', hint: 'Stops computer use at once.' },
    { read: (s) => (s.browser.allow_origins.length ? s.browser.allow_origins.join(', ') : 'None'), label: 'Sites agents may open without asking' },
    { lent: true, label: 'Sites where agents may use my sign-in', hint: 'This project only. An agent on one of these sites acts as you. It is asked for per site in Needs you.' },
  ] },
  { id: 'addons', label: 'Add-ons', rows: [
    { run: () => { settingsView.close(); homeView.set('addons'); }, button: 'Open', label: 'Agents and plugins', hint: 'Which agents are ready, and what each plugin may do.' },
  ] },
  { id: 'notify', label: 'Notifications', rows: [
    { run: () => openSinks(), button: 'Manage', label: 'Slack, ntfy and webhooks', hint: 'Where "needs you" and "run failed" get sent.' },
  ] },
  { id: 'advanced', label: 'Advanced', rows: [
    { key: 'worktree.npm_ci', label: 'Install dependencies in each new worktree' },
    { key: 'worktree.stale_days', label: 'Remove unused worktrees after', unit: 'days', min: 1, max: 90 },
    { run: () => api.openLogs(), button: 'Open', label: 'Logs folder' },
  ] },
];

const reload = async () => settingsStore.set({ data: await api.settingsPage() });

async function write(key, value) {
  const r = key === 'sessions.approval' ? await api.setApproval(value) : await api.setSetting(key, value);
  if (r && r.error) toast(r.error, true);
  else if (key.startsWith('terminal.')) { ui.settingsLook = { ...(await api.uiSettings()), firstRun: false }; applyLook(ui.settingsLook); render(); }
  await reload();
}

function CheckCommand({ row, data }) {
  const saved = (data.reliability.checks || {})[ui.projectId] || '';
  const [text, setText] = useState(saved);
  const save = async () => {
    if (text === saved) return;
    const r = await api.setCheck(ui.projectId, text);
    if (r && r.error) toast(r.error, true);
    await reload();
  };
  return <span onBlur={save}><TextInput label={row.label} isLabelHidden value={text} onChange={setText} onEnter={save} placeholder="npm test" isDisabled={!ui.projectId} width={240} /></span>;
}

function Control({ row, data }) {
  if (row.soon) return <Badge label="Not built yet" />;
  if (row.check) return <CheckCommand row={row} data={data} />;
  if (row.lent) {
    const sites = (data.browser.lent || {})[ui.projectId] || [];
    if (!sites.length) return <Text>None</Text>;
    return <span className="ou-lent">{sites.map((o) => <span key={o}><Text>{o}</Text><Button label="Remove" size="sm" onClick={async () => { await rpc('lend.set', { project_id: ui.projectId, origin: o, on: false }); await reload(); }} /></span>)}</span>;
  }
  if (row.read) return <Text>{row.read(data)}</Text>;
  if (row.button) return <Button label={row.button} onClick={row.run} />;
  if (row.theme) {
    const themes = (ui.settingsLook && ui.settingsLook.themes) || [];
    return <Selector label={row.label} isLabelHidden options={themes.map((t) => ({ value: t.id, label: t.label }))} value={ui.look && ui.look.theme.name} onChange={async (v) => { await setLook(v); await reload(); }} />;
  }
  const v = row.key.split('.').reduce((o, k) => (o ? o[k] : undefined), data);
  if (row.select) return <Selector label={row.label} isLabelHidden options={row.select.map(([value, label]) => ({ value, label }))} value={v} onChange={(x) => write(row.key, x)} />;
  if (typeof v === 'boolean') return <Switch label={row.label} isLabelHidden value={v} onChange={(x) => write(row.key, x)} />;
  return <NumberInput label={row.label} isLabelHidden value={v} min={row.min} max={row.max} step={row.step || 1} units={row.unit} isIntegerOnly width={row.unit ? 190 : 110} onChange={(n) => { if (Number.isInteger(n) && n >= row.min && n <= row.max && n !== v) write(row.key, n); }} />;
}

export function Settings() {
  const { data, section } = settingsStore.use();
  if (!data) return null;
  const sec = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  return (
    <div className="ou-settings">
      <SideNav header={<SideNavHeading heading="Settings" />}>
        {SECTIONS.map((s) => <SideNavItem key={s.id} label={s.label} isSelected={s.id === sec.id} onClick={() => settingsStore.set({ section: s.id })} />)}
      </SideNav>
      <div className="ou-settings-body">
        <div className="ou-settings-col">
          <header>
            <Heading level={1}>{sec.label}</Heading>
            <IconButton label="Close settings" tooltip="Close (Esc)" variant="ghost" onClick={() => settingsView.close()} icon={<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 3l8 8M11 3l-8 8" /></svg>} />
          </header>
          {sec.note ? <Text as="p" color="secondary">{sec.note}</Text> : null}
          <List hasDividers>
            {sec.rows.map((row) => <Item key={row.label} as="li" label={row.label} description={row.hint} endContent={<Control row={row} data={data} />} />)}
          </List>
        </div>
      </div>
    </div>
  );
}
