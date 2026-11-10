import { useEffect, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
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

export const settingsStore = createStore({ data: null, section: 'general' });

// Nav groups and the page anatomy follow T3 Code's settings: grouped nav with search, 48px header, titled row groups.
const NAV = [
  { ids: ['general', 'look'] },
  { title: 'Agents', ids: ['reliability', 'savings', 'safety'] },
  { title: 'Extend', ids: ['addons', 'notify'] },
  { ids: ['advanced'] },
];

const SECTIONS = [
  { id: 'general', label: 'General', groups: [{ rows: [
    { key: 'sessions.approval', label: 'Before each tool call', hint: 'Ask shows every command for a yes. Auto lets agents run inside their own Ouros worktree.', select: [['ask', 'Ask me'], ['contained', 'Auto in Ouros worktrees']] },
    { key: 'sessions.metarouter', label: 'Route shell commands through metarouter', hint: 'Shorter command output for agents.' },
  ] }] },
  { id: 'look', label: 'Appearance', groups: [{ rows: [
    { theme: true, label: 'Theme' },
    { key: 'agent_cursor.show_caption', label: 'Caption beside the agent cursor', hint: 'Says what the agent is about to click.' },
  ] }, { title: 'Terminal', rows: [
    { key: 'terminal.font_size', label: 'Font size', min: 8, max: 28 },
    { key: 'terminal.scrollback', label: 'Scrollback', hint: 'Lines kept per terminal.', min: 1000, max: 200000, step: 1000 },
  ] }] },
  { id: 'reliability', label: 'Reliability', note: 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.', groups: [
    { title: 'Finishing', rows: [
      { key: 'reliability.done_needs_check', label: 'Say done only when a check passed', hint: 'A finished agent with no passing check reads "needs your review".' },
      { check: true, label: 'Check command for this project', hint: 'Runs where the agent worked, when it finishes. Empty: every finish needs your review.' },
    ] },
    { title: 'Watching', rows: [
      { key: 'reliability.loop_alarm', label: 'Loop alarm', hint: 'Claude agents only. Watches for the same call giving the same result.' },
      { key: 'reliability.loop_nudge_at', label: 'Ask me after', unit: 'identical calls', min: 2, max: 20 },
      { key: 'reliability.loop_stop_at', label: 'Stop the agent after', unit: 'identical calls', min: 3, max: 50 },
      { read: (s) => String(s.reliability.false_alarms), label: 'False alarms so far', hint: 'Times you answered "Not a loop".' },
    ] },
    { title: 'Budgets', rows: [
      { key: 'reliability.token_limit', label: 'Token limit per agent', hint: 'A log line at 80%. At 100% the agent is paused and you are asked. 0 turns it off.', unit: 'tokens', min: 0, max: 100000000, step: 10000 },
    ] },
    { title: 'Not built yet', rows: [
      { soon: true, label: 'Fix failing checks, up to 3 tries', hint: 'Each try starts from clean files. Tests and check settings are protected from edits.' },
      { soon: true, label: 'Retry provider errors', hint: 'Backs off and retries. Asks before switching model.' },
      { soon: true, label: 'Check after every edit', hint: 'Typecheck, lint and the nearest tests.' },
      { soon: true, label: 'Ask when a request can mean two things', hint: 'Shows as one Needs you card.' },
      { soon: true, label: 'Keep runs going when Ouros closes', hint: 'Resumes from the last step. Sends and deploys always ask again.' },
      { soon: true, label: 'Checkpoint every turn', hint: 'Undo takes the files back to any turn.' },
    ] },
  ] },
  { id: 'savings', label: 'Savings', note: 'Each one trades some detail for fewer tokens. All start off.', groups: [{ rows: [
    { key: 'savers.shrink_shell', label: 'Shrink shell output' },
    { key: 'savers.lean_handoffs', label: 'Lean handoffs between agents' },
    { key: 'savers.small_screenshots', label: 'Smaller screenshots' },
    { key: 'savers.cheap_model', label: 'Cheapest model that fits each step' },
  ] }] },
  { id: 'safety', label: 'Safety', groups: [{ title: 'Computer use', rows: [
    { key: 'desktop.watch_pause', label: 'Pause the agent when I touch the desktop', hint: 'Computer use stops while your mouse or keyboard is busy.' },
    { read: (s) => s.desktop.takeover_key, label: 'Take-over key', hint: 'Stops computer use at once.', kbd: true },
  ] }, { title: 'Browser', rows: [
    { read: (s) => (s.browser.allow_origins.length ? s.browser.allow_origins.join(', ') : 'None'), label: 'Sites agents may open without asking' },
    { lent: true, label: 'Sites where agents may use my sign-in', hint: 'This project only. An agent on one of these sites acts as you. It is asked for per site in Needs you.' },
  ] }] },
  { id: 'addons', label: 'Add-ons', groups: [{ rows: [
    { run: () => { settingsView.close(); homeView.set('addons'); }, button: 'Open', label: 'Agents and plugins', hint: 'Which agents are ready, and what each plugin may do.' },
  ] }] },
  { id: 'notify', label: 'Notifications', groups: [{ rows: [
    { run: () => openSinks(), button: 'Manage', label: 'Slack, ntfy and webhooks', hint: 'Where "needs you" and "run failed" get sent.' },
  ] }] },
  { id: 'advanced', label: 'Advanced', groups: [{ title: 'Worktrees', rows: [
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
  else if (key.startsWith('terminal.')) { ui.settingsLook = { ...(await api.uiSettings()), firstRun: false }; applyLook(ui.settingsLook); render(); }
  await reload();
}

const icon = (d) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const CLOSE = 'M3 3l8 8M11 3l-8 8';
const UNDO = 'M3.5 5.5h5a2.5 2.5 0 010 5H5M3.5 5.5L5.7 3.3M3.5 5.5l2.2 2.2';

function CheckCommand({ row, data }) {
  const saved = (data.reliability.checks || {})[ui.projectId] || '';
  const [text, setText] = useState(saved);
  const save = async () => {
    if (text === saved) return;
    const r = await api.setCheck(ui.projectId, text);
    if (r && r.error) toast(r.error, true);
    await reload();
  };
  return <span onBlur={save}><TextInput label={row.label} isLabelHidden value={text} onChange={setText} onEnter={save} placeholder="npm test" isDisabled={!ui.projectId} width={220} /></span>;
}

function Control({ row, data }) {
  if (row.soon) return <Badge label="Not built yet" />;
  if (row.check) return <CheckCommand row={row} data={data} />;
  if (row.lent) {
    const sites = (data.browser.lent || {})[ui.projectId] || [];
    if (!sites.length) return <span className="ou-value">None</span>;
    return <span className="ou-lent">{sites.map((o) => <span key={o}><span className="ou-value">{o}</span><Button label="Remove" size="sm" onClick={async () => { await rpc('lend.set', { project_id: ui.projectId, origin: o, on: false }); await reload(); }} /></span>)}</span>;
  }
  if (row.read) return row.kbd ? <Kbd keys={row.read(data)} /> : <span className="ou-value">{row.read(data)}</span>;
  if (row.button) return <Button label={row.button} onClick={row.run} />;
  if (row.theme) {
    const themes = (ui.settingsLook && ui.settingsLook.themes) || [];
    return <Selector label={row.label} isLabelHidden width={200} options={themes.map((t) => ({ value: t.id, label: t.label }))} value={ui.look && ui.look.theme.name} onChange={async (v) => { await setLook(v); await reload(); }} />;
  }
  const v = valueOf(data, row.key);
  if (row.select) return <Selector label={row.label} isLabelHidden width={220} options={row.select.map(([value, label]) => ({ value, label }))} value={v} onChange={(x) => write(row.key, x)} />;
  if (typeof v === 'boolean') return <Switch label={row.label} isLabelHidden value={v} onChange={(x) => write(row.key, x)} />;
  return <NumberInput label={row.label} isLabelHidden value={v} min={row.min} max={row.max} step={row.step || 1} units={row.unit} isIntegerOnly width={row.unit ? 190 : 110} onChange={(n) => { if (Number.isInteger(n) && n >= row.min && n <= row.max && n !== v) write(row.key, n); }} />;
}

function Row({ row, data }) {
  const def = row.key && data.defaults ? data.defaults[row.key] : undefined;
  const changed = def !== undefined && valueOf(data, row.key) !== def;
  return (
    <div className={row.soon ? 'ou-row ou-soon' : 'ou-row'}>
      <div className="ou-rowtext">
        <span className="ou-rowtitle">{row.label}{changed ? <IconButton size="sm" variant="ghost" label="Reset to default" tooltip={`Reset to ${def === true ? 'on' : def === false ? 'off' : def}`} icon={icon(UNDO)} onClick={() => write(row.key, def)} /> : null}</span>
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
        <div className="ou-search"><TextInput ref={search} type="search" size="md" label="Search settings" isLabelHidden value={query} onChange={setQuery} placeholder="Search settings" hasClear /><Kbd keys="/" /></div>
        {NAV.map((g, i) => (
          <div key={i} className="ou-navgroup">
            {g.title ? <span className="ou-navhead">{g.title}</span> : null}
            {g.ids.map((id) => { const s = SECTIONS.find((x) => x.id === id); return <SideNavItem key={id} label={s.label} isSelected={!q && id === sec.id} onClick={() => { setQuery(''); settingsStore.set({ section: id }); }} />; })}
          </div>
        ))}
      </nav>
      <div className="ou-smain">
        <header className="ou-shead">
          <span className="ou-crumb">Settings<i>/</i><b>{hits ? 'Search' : sec.label}</b></span>
          <IconButton label="Close settings" tooltip="Close (Esc)" variant="ghost" onClick={() => settingsView.close()} icon={icon(CLOSE)} />
        </header>
        <div className="ou-sbody">
          <div className="ou-scol">
            {hits ? (hits.length ? hits.map((g) => <Group key={g.title} group={g} data={data} />) : <Text color="secondary">No setting matches "{query}".</Text>) : (
              <>
                {sec.note ? <p className="ou-note">{sec.note}</p> : null}
                {sec.groups.map((g, i) => <Group key={g.title || i} group={g} data={data} />)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
