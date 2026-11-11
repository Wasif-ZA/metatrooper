import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Kbd } from '@astryxdesign/core/Kbd';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { SideNavItem } from '@astryxdesign/core/SideNav';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import * as Ic from './icons/index.js';
import * as Sc from './icons/screens.jsx';
import { Automations } from './automations.jsx';

export const settingsStore = createStore({ data: null, section: 'general' });

const NAV = [
  { title: 'App', ids: ['general'] },
  { title: 'Agents', ids: ['reliability', 'savings', 'safety', 'automations'] },
  { title: 'Extend', ids: ['addons', 'notify'] },
  { title: 'System', ids: ['advanced'] },
];

const SECTIONS = [
  { id: 'general', label: 'General', note: 'How agents ask, and how Ouros looks.', groups: [
    { rows: [
      { key: 'sessions.approval', label: 'Before each tool call', hint: 'Ask shows every command for a yes. Auto lets agents run inside their own Ouros worktree.', select: [['ask', 'Ask me'], ['contained', 'Auto in Ouros worktrees']] },
      { key: 'sessions.metarouter', label: 'Route shell commands through metarouter', hint: 'Shorter command output for agents.' },
      { key: 'ui.toast_ms', label: 'Keep a message on screen for', hint: 'The small notes at the corner of the window.', unit: 'ms', min: 1000, max: 60000, step: 500 },
      { key: 'ui.error_toast_ms', label: 'Keep an error message on screen for', hint: 'Error notes stay longer so you can read them.', unit: 'ms', min: 1000, max: 60000, step: 500 },
    ] },
    { title: 'Appearance', rows: [
      { theme: true, label: 'Theme' },
      { key: 'agent_cursor.show_caption', label: 'Caption beside the agent cursor', hint: 'Says what the agent is about to click.' },
      { key: 'agent_cursor.mode', label: 'Agent cursor movement', hint: 'How the agent cursor travels to its next click.', select: [['off', 'Off'], ['instant', 'Instant'], ['snappy', 'Snappy'], ['human', 'Human']] },
      { key: 'agent_cursor.idle_fade_ms', label: 'Fade the idle agent cursor after', unit: 'ms', min: 0, max: 60000, step: 500 },
      { key: 'agent_cursor.show_in_recordings', label: 'Show the agent cursor in recordings' },
    ] },
    { title: 'Terminal', rows: [
      { key: 'terminal.font_size', label: 'Font size', min: 8, max: 28 },
      { key: 'terminal.scrollback', label: 'Scrollback', hint: 'Lines kept per terminal.', min: 1000, max: 200000, step: 1000 },
    ] },
  ] },
  { id: 'reliability', label: 'Reliability', note: 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.', groups: [
    { title: 'Finishing', rows: [
      { key: 'reliability.done_needs_check', label: 'Say done only when a check passed', hint: 'A finished agent with no passing check reads "needs your review".' },
      { check: true, label: 'Check command for this project', hint: 'Runs where the agent worked, when it finishes. Empty: every finish needs your review.' },
      { soon: true, label: 'Fix failing checks, up to 3 tries', hint: 'Each try starts from clean files. Tests and check settings are protected from edits.' },
      { soon: true, label: 'Check after every edit', hint: 'Typecheck, lint and the nearest tests.' },
    ] },
    { title: 'Watching', rows: [
      { key: 'reliability.loop_alarm', label: 'Loop alarm', hint: 'Claude agents only. Watches for the same call giving the same result.' },
      { key: 'reliability.loop_nudge_at', label: 'Ask me after', unit: 'identical calls', min: 2, max: 20 },
      { key: 'reliability.loop_stop_at', label: 'Stop the agent after', unit: 'identical calls', min: 3, max: 50 },
      { read: (s) => String(s.reliability.false_alarms), label: 'False alarms so far', hint: 'Times you answered "Not a loop".' },
      { soon: true, label: 'Retry provider errors', hint: 'Backs off and retries. Asks before switching model.' },
      { soon: true, label: 'Ask when a request can mean two things', hint: 'Shows as one Needs you card.' },
      { soon: true, label: 'Keep runs going when Ouros closes', hint: 'Resumes from the last step. Sends and deploys always ask again.' },
    ] },
    { title: 'Budgets', rows: [
      { key: 'reliability.token_limit', label: 'Token limit per agent', hint: 'A log line at 80%. At 100% the agent is paused and you are asked. 0 turns it off.', unit: 'tokens', min: 0, max: 100000000, step: 10000 },
      { soon: true, label: 'Checkpoint every turn', hint: 'Undo takes the files back to any turn.' },
    ] },
  ] },
  { id: 'savings', label: 'Savings', note: 'Each one trades some detail for fewer tokens. All start off.', groups: [{ rows: [
    { key: 'savers.shrink_shell', label: 'Shrink shell output' },
    { key: 'savers.lean_handoffs', label: 'Lean handoffs between agents' },
    { key: 'savers.small_screenshots', label: 'Smaller screenshots' },
    { key: 'savers.cheap_model', label: 'Cheapest model that fits each step' },
  ] }] },
  { id: 'safety', label: 'Safety', note: 'What agents may touch on your computer and in the browser.', groups: [{ title: 'Computer use', rows: [
    { key: 'desktop.watch_pause', label: 'Pause the agent when I touch the desktop', hint: 'Computer use stops while your mouse or keyboard is busy.' },
    { read: (s) => s.desktop.takeover_key, label: 'Take-over key', hint: 'Stops computer use at once.', kbd: true },
  ] }, { title: 'Browser', rows: [
    { read: (s) => (s.browser.allow_origins.length ? s.browser.allow_origins.join(', ') : 'None'), label: 'Sites agents may open without asking' },
    { lent: true, label: 'Sites where agents may use my sign-in', hint: 'This project only. An agent on one of these sites acts as you. It is asked for per site in Needs you.' },
  ] }] },
  { id: 'automations', label: 'Automations', note: 'A check script runs on a timer in this project. An agent is started only when the script exits with code 1.', groups: [], body: Automations },
  { id: 'addons', label: 'Add-ons', note: 'Agents and plugins Ouros can start.', groups: [{ rows: [
    { run: () => { settingsView.close(); homeView.set('addons'); }, button: 'Open', label: 'Agents and plugins', hint: 'Which agents are ready, and what each plugin may do.' },
  ] }] },
  { id: 'notify', label: 'Notifications', note: 'Where Ouros tells you when an agent needs you.', groups: [{ rows: [
    { run: () => openSinks(), button: 'Manage', label: 'Slack, ntfy and webhooks', hint: 'Where "needs you" and "run failed" get sent.' },
  ] }] },
  { id: 'advanced', label: 'Advanced', note: 'Worktrees and logs.', groups: [{ title: 'Worktrees', rows: [
    { key: 'worktree.npm_ci', label: 'Install dependencies in each new worktree' },
    { key: 'worktree.stale_days', label: 'Remove unused worktrees after', unit: 'days', min: 1, max: 90 },
  ] }, { title: 'Diagnostics', rows: [
    { run: () => api.openLogs(), button: 'Open', label: 'Logs folder' },
  ] }] },
];

const reload = async () => settingsStore.set({ data: await api.settingsPage() });
const valueOf = (data, key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), data);

async function write(key, value) {
  const r = key === 'sessions.approval' ? await api.setApproval(value) : await api.setSetting(key, value);
  if (r && r.error) toast(r.error, true);
  else if (key.startsWith('terminal.') || key.startsWith('ui.')) { ui.settingsLook = { ...(await api.uiSettings()), firstRun: false }; applyLook(ui.settingsLook); render(); }
  await reload();
}

const NAV_ICON = {
  general: Ic.OptionsIcon,
  reliability: Ic.ApprovalIcon,
  savings: Sc.SavingsIcon,
  safety: Sc.LockIcon,
  addons: Ic.AddOnsIcon,
  notify: Sc.BellIcon,
  advanced: Sc.TerminalIcon,
  automations: Ic.ScheduleIcon,
};
const nav = (id, size = 16) => { const Nav = NAV_ICON[id]; return <Nav size={size} />; };

function CheckCommand({ row, data }) {
  const id = ui.projectId;
  const saved = (data.reliability.checks || {})[id] || '';
  const [text, setText] = useState(saved);
  const [seededFor, setSeededFor] = useState(id);
  if (seededFor !== id) { setSeededFor(id); setText(saved); }
  const save = async () => {
    if (text === saved) return;
    const r = await api.setCheck(id, text);
    if (r && r.error) toast(r.error, true);
    await reload();
  };
  return <span onBlur={save}><TextInput label={row.label} isLabelHidden value={text} onChange={setText} onEnter={save} placeholder="npm test" isDisabled={!id} width={220} /></span>;
}

function Control({ row, data }) {
  if (row.soon) return <span className="ou-soontag">Not built yet</span>;
  if (row.check) return <CheckCommand key={ui.projectId || ''} row={row} data={data} />;
  if (row.lent) {
    const sites = (data.browser.lent || {})[ui.projectId] || [];
    if (!sites.length) return <span className="ou-value">None</span>;
    return <span className="ou-lent">{sites.map((o) => <span key={o}><span className="ou-value">{o}</span><Button label="Remove" size="sm" variant="ghost" onClick={async () => { await rpc('lend.set', { project_id: ui.projectId, origin: o, on: false }); await reload(); }} /></span>)}</span>;
  }
  if (row.read) return row.kbd ? <Kbd keys={row.read(data)} /> : <span className="ou-value">{row.read(data)}</span>;
  if (row.button) return <Button label={row.button} variant="ghost" onClick={row.run} />;
  if (row.theme) {
    const themes = (ui.settingsLook && ui.settingsLook.themes) || [];
    return <Selector label={row.label} isLabelHidden width={200} options={themes.map((t) => ({ value: t.id, label: t.label }))} value={ui.look && ui.look.theme.name} onChange={async (v) => { await setLook(v); await reload(); }} />;
  }
  const v = valueOf(data, row.key);
  if (row.select) return <Selector label={row.label} isLabelHidden width={220} options={row.select.map(([value, label]) => ({ value, label }))} value={v} onChange={(x) => write(row.key, x)} />;
  if (typeof v === 'boolean') return <Switch size="sm" label={row.label} isLabelHidden value={v} onChange={(x) => write(row.key, x)} />;
  return <NumberInput label={row.label} isLabelHidden value={v} min={row.min} max={row.max} step={row.step || 1} units={row.unit} isIntegerOnly width={row.unit ? 190 : 110} onChange={(n) => { if (Number.isInteger(n) && n >= row.min && n <= row.max && n !== v) write(row.key, n); }} />;
}

function Row({ row, data }) {
  const def = row.key && data.defaults ? data.defaults[row.key] : undefined;
  const changed = def !== undefined && valueOf(data, row.key) !== def;
  return (
    <div className={row.soon ? 'ou-row ou-soon' : 'ou-row'}>
      <div className="ou-rowtext">
        <span className="ou-rowtitle">{row.label}{changed ? <IconButton size="sm" variant="ghost" label="Reset to default" tooltip={`Reset to ${def === true ? 'on' : def === false ? 'off' : def}`} icon={<Sc.UndoIcon size={14} />} onClick={() => write(row.key, def)} /> : null}</span>
        {row.hint ? <span className="ou-rowhint">{row.hint}</span> : null}
      </div>
      <Control row={row} data={data} />
    </div>
  );
}

function Group({ group, data }) {
  return (
    <section className="ou-group">
      {group.title ? <h3>{group.title}</h3> : null}
      <div className="ou-rows">{group.rows.map((row) => <Row key={row.label} row={row} data={data} />)}</div>
    </section>
  );
}

export function Settings() {
  const { data, section } = settingsStore.use();
  const [query, setQuery] = useState('');
  const search = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || !settingsView.isOpen() || e.target.closest?.('input, textarea, select')) return;
      e.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  if (!data) return null;
  const sec = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  const q = query.trim().toLowerCase();
  const hits = q ? SECTIONS.map((s) => ({ title: s.label, rows: s.groups.flatMap((g) => g.rows).filter((r) => `${r.label} ${r.hint || ''}`.toLowerCase().includes(q)) })).filter((g) => g.rows.length) : null;
  return (
    <div className="ou-settings">
      <nav className="ou-snav" aria-label="Settings sections">
        <div className="ou-snav-head">
          <button type="button" className="ou-snav-back" onClick={() => settingsView.close()}>‹ Back</button>
          <div className="ou-snav-title">Settings</div>
        </div>
        <div className="ou-search"><TextInput ref={search} type="search" size="md" label="Search settings" isLabelHidden value={query} onChange={setQuery} placeholder="Search settings" hasClear /><Kbd keys="/" /></div>
        {NAV.map((g, i) => (
          <div key={i} className="ou-navgroup">
            {g.title ? <span className="ou-navhead">{g.title}</span> : null}
            {g.ids.map((id) => { const s = SECTIONS.find((x) => x.id === id); return <SideNavItem key={id} icon={nav(id)} label={s.label} isSelected={!q && id === sec.id} onClick={() => { setQuery(''); settingsStore.set({ section: id }); }} />; })}
          </div>
        ))}
      </nav>
      <div className="ou-smain">
        <header className="ou-shead">
          <span className="ou-crumb">Settings<i>›</i><b>{hits ? 'Search' : sec.label}</b></span>
          <IconButton label="Close settings" tooltip="Close (Esc)" variant="ghost" onClick={() => settingsView.close()} icon={<Sc.CloseIcon size={14} />} />
        </header>
        <div className="ou-sbody">
          <div className="ou-scol">
            {hits ? (hits.length ? hits.map((g) => <Group key={g.title} group={g} data={data} />) : <Text color="secondary">No setting matches "{query}".</Text>) : (
              <>
                <div className="ou-stitle"><h1>{nav(sec.id, 20)}{sec.label}</h1>{sec.note ? <p className="ou-note">{sec.note}</p> : null}</div>
                {sec.groups.map((g, i) => <Group key={g.title || i} group={g} data={data} />)}
                {sec.body ? <sec.body /> : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
