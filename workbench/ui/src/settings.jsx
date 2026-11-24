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
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { marked } from 'marked';

export const settingsStore = createStore({ data: null, section: 'general' });

const NAV = [
  { title: 'App', ids: ['general', 'learning'] },
  { title: 'Agents', ids: ['reliability', 'savings', 'safety', 'automations'] },
  { title: 'Extend', ids: ['addons', 'notify'] },
  { title: 'System', ids: ['advanced', 'licences'] },
];

const vscodeRecord = () => { try { return JSON.parse(localStorage.getItem('cc.vscodeImport') || 'null'); } catch { return null; } };

const SECTIONS = [
  { id: 'general', label: 'General', note: 'How agents ask, and how cc looks.', groups: [
    { rows: [
      { key: 'sessions.approval', label: 'Before each tool call', hint: 'Ask shows every command for a yes. Auto lets agents run inside their own cc worktree.', select: [['ask', 'Ask me'], ['contained', 'Auto in cc worktrees']] },
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
  ] }], body: Logins },
  { id: 'automations', label: 'Automations', note: 'A check script runs on a timer in this project. An agent is started only when the script exits with code 1.', groups: [], body: Automations },
  { id: 'addons', label: 'Add-ons', note: 'Agents and plugins cc can start.', groups: [{ rows: [
    { run: () => { settingsView.close(); homeView.set('addons'); }, button: 'Open', label: 'Agents and plugins', hint: 'Which agents are ready, and what each plugin may do.' },
  ] }] },
  { id: 'notify', label: 'Notifications', note: 'Where cc tells you when an agent needs you.', groups: [{ rows: [
    { run: () => openSinks(), button: 'Manage', label: 'Slack, ntfy and webhooks', hint: 'Where "needs you" and "run failed" get sent. Each one sends the alert through that outside service.' },
    { key: 'notify.quiet_at_night', label: 'Never at night', hint: 'Phone alerts (ntfy) send nothing from 22:00 to 07:00. Slack, Discord, Teams, webhooks and commands still send. Needs you still shows every item, and anything still waiting goes out after 07:00.' },
  ] }] },
  { id: 'advanced', label: 'Advanced', note: 'Worktrees and logs.', groups: [{ title: 'Worktrees', rows: [
    { key: 'worktree.npm_ci', label: 'Install dependencies in each new worktree' },
    { key: 'worktree.stale_days', label: 'Remove unused worktrees after', unit: 'days', min: 1, max: 90 },
  ] }, { title: 'Diagnostics', rows: [
    { run: () => api.openLogs(), button: 'Open', label: 'Logs folder' },
  ] }] },
  { id: 'licences', label: 'Licences and trademarks', note: 'Third-party software in cc, and the trademarks of the engines it runs.', groups: [], body: Notices },
  { id: 'learning', label: 'Learning', note: 'What cc took from your old editor. Each import can be undone.', groups: [{ title: 'From VS Code', rows: [
    { label: 'Applied', read: () => { const r = vscodeRecord(); return !r ? 'Not checked yet' : r.none ? 'No VS Code settings found' : r.undone ? 'Undone' : (r.applied || []).join('; ') || 'Nothing'; } },
    { label: 'Skipped', read: () => { const r = vscodeRecord(); return r && !r.none && (r.skipped || []).length ? r.skipped.join('; ') : 'Nothing'; } },
    { run: () => { void undoVscodeImport().then(() => settingsView.close()); }, button: 'Undo', label: 'Undo the VS Code import', hint: 'Puts your theme back as it was before the import.' },
  ] }] },
];

/** M8-50: logins from a password file you exported from your browser. The file stays in the main process; this screen sees origins and usernames only. */
export function Logins() {
  const [saved, setSaved] = useState(null);
  const [pick, setPick] = useState(null);
  const [ticks, setTicks] = useState({});
  const [said, setSaid] = useState('');
  const load = async () => { const out = await api.call('browser.logins.list', {}); setSaved(out.kind === 'reply' && out.reply.result ? out.reply.result.logins : []); };
  useEffect(() => { void load(); }, []);
  const choose = async () => {
    setSaid('');
    const r = await api.loginsPick();
    if (!r) return;
    if (r.error) { setSaid(r.error); return; }
    setPick(r);
    const usable = r.rows.filter((x) => !x.skip);
    setTicks(Object.fromEntries(usable.map((x) => [x.i, usable.length <= 20 && !x.exists])));
  };
  const run = async () => {
    const picks = Object.entries(ticks).filter(([, on]) => on).map(([i]) => ({ i: Number(i), replace: true }));
    const r = await api.loginsImport(pick.token, picks);
    setPick(null);
    setSaid(r.error ? `${r.error}${r.deleted ? ' The exported file was deleted.' : ''}` : `Saved ${r.imported} login${r.imported === 1 ? '' : 's'}${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}.${r.deleted ? ' The exported file was deleted.' : ' The exported file was kept; delete it yourself.'}`);
    await load();
  };
  const cancel = async () => {
    const r = await api.loginsCancel(pick.token);
    setPick(null);
    setSaid(r?.deleted ? 'Nothing saved. The exported file was deleted.' : 'Nothing saved. The exported file was kept; delete it yourself.');
  };
  const remove = async (names) => { for (const name of names) await api.call('browser.logins.remove', { name }); await load(); };
  const skipped = pick ? pick.rows.filter((x) => x.skip).length : 0;
  return (
    <section className="ou-sgroup ou-logins">
      <h2>Imported logins</h2>
      <p className="ou-note">Export your saved passwords from your browser to a CSV file, then pick it here. cc keeps each login for its own site. An agent can type it there but never read it. cc never opens your browser's own password store.</p>
      {pick ? (
        <div className="ou-logins-pick">
          <Text>{pick.file}: {pick.rows.length - skipped} usable{skipped ? `, ${skipped} skipped (not https, or too short)` : ''}. Tick what to save.</Text>
          <div className="ou-logins-rows">
            {pick.rows.filter((x) => !x.skip).map((x) => (
              <CheckboxInput key={x.i} size="sm" label={`${x.origin}  ${x.username || '(no username)'}${x.exists ? '  (replaces the saved one)' : ''}`} value={Boolean(ticks[x.i])} onChange={(on) => setTicks({ ...ticks, [x.i]: on })} />
            ))}
          </div>
          <span className="ou-logins-acts"><Button size="sm" variant="primary" label="Save ticked logins" onClick={() => void run()} /><Button size="sm" variant="secondary" label="Cancel" onClick={() => void cancel()} /></span>
        </div>
      ) : <Button size="sm" variant="secondary" label="Import from a password file" onClick={() => void choose()} />}
      {said ? <Text color="secondary">{said}</Text> : null}
      {saved && saved.length ? (
        <div className="ou-logins-saved">
          {saved.map((x) => <div key={x.name} className="ou-logins-row"><Text>{x.origin}</Text><Text color="secondary">{x.user ? 'with username' : 'password only'}</Text><Button size="sm" variant="ghost" label="Remove" onClick={() => void remove([x.name])} /></div>)}
          <Button size="sm" variant="secondary" label="Remove all" onClick={() => void remove(saved.map((x) => x.name))} />
        </div>
      ) : saved ? <Text color="secondary">No imported logins.</Text> : null}
    </section>
  );
}

export function Notices() {
  const [text, setText] = useState(undefined);
  useEffect(() => { api.notices().then(setText, () => setText('')); }, []);
  if (text === undefined) return <Text color="secondary">Loading.</Text>;
  if (!text) return <Text color="secondary">THIRD_PARTY_NOTICES.md was not found next to the app.</Text>;
  const open = (e) => { const a = e.target.closest?.('a[href^="http"]'); if (a) { e.preventDefault(); void api.openLink(a.href); } };
  return <article className="ou-notices" onClick={open} dangerouslySetInnerHTML={{ __html: marked.parse(text) }} />;
}

const reload = async () => settingsStore.set({ data: await api.settingsPage() });
const valueOf = (data, key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), data);

async function write(key, value) {
  const r = key === 'sessions.approval' ? await api.setApproval(value) : await api.setSetting(key, value);
  if (r && r.error) toast(r.error, true);
  else if (key === 'sessions.approval') { if (ui.settingsLook) ui.settingsLook.approval = value; }
  else if (key.startsWith('terminal.') || key.startsWith('ui.')) { ui.settingsLook = await api.uiSettings(); applyLook(ui.settingsLook); render(); }
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
  licences: Ic.LearnIcon,
  learning: Sc.ArchiveIcon,
};
const navIcon = (id, size = 16) => { const Icon = NAV_ICON[id]; return <Icon size={size} />; };

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
  return <NumberRow row={row} v={v} />;
}

function NumberRow({ row, v }) {
  const [bad, setBad] = useState(false);
  const onChange = (n) => {
    const ok = Number.isInteger(n) && n >= row.min && n <= row.max;
    setBad(!ok);
    if (ok && n !== v) write(row.key, n);
  };
  return <NumberInput label={row.label} isLabelHidden value={v} min={row.min} max={row.max} step={row.step || 1} units={row.unit} isIntegerOnly width={row.unit ? 190 : 110}
    status={bad ? { type: 'error', message: `Use a whole number from ${row.min} to ${row.max}; not saved.` } : undefined} onChange={onChange} />;
}

function Row({ row, data }) {
  const def = row.key && data.defaults ? data.defaults[row.key] : undefined;
  const changed = def !== undefined && valueOf(data, row.key) !== def;
  return (
    <div className="ou-row">
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
            {g.ids.map((id) => { const s = SECTIONS.find((x) => x.id === id); return <SideNavItem key={id} icon={navIcon(id)} label={s.label} isSelected={!q && id === sec.id} onClick={() => { setQuery(''); settingsStore.set({ section: id }); }} />; })}
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
                <div className="ou-stitle"><h1>{navIcon(sec.id, 20)}{sec.label}</h1>{sec.note ? <p className="ou-note">{sec.note}</p> : null}</div>
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
