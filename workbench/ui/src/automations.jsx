import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { EngineMark, ListViewIcon as ListView, GridViewIcon as GridView, RunIcon as Run, Search, Filter, Project, ScheduleIcon as Schedule, ChevronRightIcon as ChevronRight, PlusIcon as Plus, SortIcon as Sort, EmojiIcon as Emoji, ProjectIcon, FolderIcon, LaptopIcon, Branch } from './icons/index.js';
import { canMove, stagger } from './motion.js';
import { composer, atRefs } from './composer.jsx';

const BLANK = { name: '', every_min: 30, runner: 'node', script: '', engine_id: '', prompt: '' };

function Field({ label, hint, children }) {
  return (
    <div className="ou-row">
      <div className="ou-rowtext"><span className="ou-rowtitle">{label}</span>{hint ? <span className="ou-rowhint">{hint}</span> : null}</div>
      {children}
    </div>
  );
}

export function Automations() {
  const pid = ui.projectId;
  const [list, setList] = useState(null);
  const [form, setForm] = useState(BLANK);
  const engines = ui.snap.engines.filter((e) => e.light !== 'red');
  const load = async () => {
    const r = await rpc('automation.list', pid ? { project_id: pid } : {}, true);
    setList(r.result ? r.result.automations : []);
  };
  useEffect(() => { void load(); }, [pid]);
  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const engine = form.engine_id || (engines[0] ? engines[0].id : '');
  const ready = Boolean(pid && form.name.trim() && form.runner.trim() && form.script.trim() && form.prompt.trim() && engine && Number.isInteger(form.every_min) && form.every_min >= 1);
  const add = async () => {
    if (!ready) return;
    const r = await rpc('automation.set', { project_id: pid, name: form.name.trim(), every_min: form.every_min, runner: form.runner.trim().split(/\s+/), script: form.script.trim(), engine_id: engine, prompt: form.prompt.trim() });
    if (r.result) { setForm(BLANK); await load(); }
  };
  const last = (a) => (a.runs[0] ? `last run ${ago(a.runs[0].at)}: ${a.runs[0].outcome}` : 'not run yet');
  return (
    <>
      <section className="ou-group">
        <h3>In this project</h3>
        <div className="ou-rows">
          {list === null ? <Field label="Loading." /> : null}
          {list && !list.length ? <Field label="No automations yet" hint="Add one below." /> : null}
          {(list || []).map((a) => (
            <Field key={a.id} label={a.name} hint={`Every ${a.every_min} min · ${a.runner.join(' ')} ${a.script} · starts ${a.engine_id} · ${last(a)}`}>
              <span className="ou-actions">
                <Switch size="sm" label={`${a.name} is on`} isLabelHidden value={a.enabled} onChange={async (on) => { await rpc('automation.enable', { id: a.id, enabled: on }); await load(); }} />
                <Button size="sm" label="Remove" onClick={async () => { await rpc('automation.delete', { id: a.id }); await load(); }} />
              </span>
            </Field>
          ))}
        </div>
      </section>
      <section className="ou-group">
        <h3>Add an automation</h3>
        <div className="ou-rows">
          <Field label="Name"><TextInput label="Name" isLabelHidden width={260} value={form.name} onChange={set('name')} placeholder="Nightly test run" /></Field>
          <Field label="Run the check every"><NumberInput label="Minutes between runs" isLabelHidden width={190} value={form.every_min} min={1} max={10080} step={1} units="minutes" isIntegerOnly onChange={set('every_min')} /></Field>
          <Field label="Check script" hint="A file inside this project. Exit code 1 starts the agent. Any other code does nothing."><TextInput label="Check script" isLabelHidden width={260} value={form.script} onChange={set('script')} placeholder="scripts/check.mjs" /></Field>
          <Field label="Run the script with" hint="The program and its arguments, split on spaces. No shell."><TextInput label="Runner" isLabelHidden width={260} value={form.runner} onChange={set('runner')} placeholder="node" /></Field>
          <Field label="Agent to start"><Selector label="Agent" isLabelHidden width={260} options={engines.map((e) => ({ value: e.id, label: e.id }))} value={engine} onChange={set('engine_id')} /></Field>
          <Field label="What to tell the agent"><TextInput label="Prompt" isLabelHidden width={260} value={form.prompt} onChange={set('prompt')} onEnter={add} placeholder="The check failed. Find out why and fix it." /></Field>
          <Field label="Save" hint={pid ? 'The script is pinned by its hash when you save. Edit the script, then save again.' : 'Open a project first.'}><Button label="Add automation" isDisabled={!ready} onClick={add} /></Field>
        </div>
      </section>
    </>
  );
}

const pad = (n) => String(n).padStart(2, '0');

const nextWords = (iso) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `next in ${mins} min`;
  if (mins < 1440) return `next in ${Math.round(mins / 60)} h`;
  return `next in ${Math.round(mins / 1440)} d`;
};

const listIcon = <ListView size={14} />;
const boxIcon = <GridView size={14} />;
const playIcon = <Run size={16} />;
const searchIcon = <Search size={14} />;
const folderIcon = <Project size={14} />;
const clockIcon = <Schedule size={14} />;
const chevSmall = <ChevronRight size={16} />;
const plusIcon = <Plus size={16} />;
const filterIcon = <Filter size={14} />;

const PRESETS = [['hourly', 'Hourly'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['custom', 'Custom']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMOJI = ['⚙️', '\u{1F319}', '\u{1F9EA}', '\u{1F4DA}', '\u{1F50D}', '\u{1F41B}', '\u{1F9F9}', '\u{1F4E6}', '\u{1F512}', '\u{1F680}', '\u{1F4CA}', '\u{1F4DD}', '\u{1F514}', '\u{1F9ED}', '\u{1F527}', '✅'];

export function presetOf(cron) {
  const p = String(cron || '').trim().split(/\s+/);
  const num = (v) => /^\d+$/.test(v);
  if (p.length === 5 && num(p[0]) && p[1] === '*' && p.slice(2).every((v) => v === '*')) return { preset: 'hourly', minute: Number(p[0]), time: '09:00', day: 1 };
  if (p.length === 5 && num(p[0]) && num(p[1]) && p[2] === '*' && p[3] === '*') {
    const time = `${pad(p[1])}:${pad(p[0])}`;
    if (p[4] === '*') return { preset: 'daily', minute: 0, time, day: 1 };
    if (p[4] === '1-5') return { preset: 'weekdays', minute: 0, time, day: 1 };
    if (/^[0-6]$/.test(p[4])) return { preset: 'weekly', minute: 0, time, day: Number(p[4]) };
  }
  return { preset: cron ? 'custom' : 'weekdays', minute: 0, time: '09:00', day: 1 };
}

export function cronOf({ preset, minute, time, day, custom }) {
  const [hh, mm] = String(time || '09:00').split(':').map(Number);
  if (preset === 'hourly') return `${Number(minute) || 0} * * * *`;
  if (preset === 'daily') return `${mm} ${hh} * * *`;
  if (preset === 'weekdays') return `${mm} ${hh} * * 1-5`;
  if (preset === 'weekly') return `${mm} ${hh} * * ${day}`;
  return String(custom || '').trim();
}

const runWords = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function AutomationEditor({ initial, labelNames, colours = {}, onClose, onSaved }) {
  const s = ui.snap || {};
  const engines = (s.engines || []).filter((e) => e.light !== 'red');
  const start = presetOf(initial?.cron);
  const [form, setForm] = useState({
    icon: initial?.icon || '', name: initial?.name || '', project_id: initial?.project_id || ui.projectId || (s.projects || [])[0]?.id || '',
    prompt: initial?.prompt || '', approval: initial?.approval || 'ask', engine_id: initial?.engine_id || engines[0]?.id || '', labels: (initial?.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    ...start, custom: initial?.cron || '0 9 * * 1-5', runner: (initial?.runner || []).join(' '), script: initial?.script || '',
  });
  const [picking, setPicking] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(initial?.script));
  const [newLabel, setNewLabel] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const cron = cronOf(form);
  const [preview, setPreview] = useState(null);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let live = true;
    setSaveError('');
    rpc('cron.next', { cron, n: 3 }, true).then((r) => { if (live) setPreview(r && r.result ? r.result : { ok: false, error: (r && r.error && r.error.message) || 'Could not read the schedule' }); });
    return () => { live = false; };
  }, [cron]);
  const valid = Boolean(preview && preview.ok);
  const runs = valid ? preview.runs || [] : [];
  const ready = valid && form.name.trim() && form.prompt.trim() && form.engine_id && form.project_id && (!form.script.trim() || form.runner.trim());
  const toggleLabel = (name) => set('labels')(form.labels.includes(name) ? form.labels.filter((l) => l !== name) : [...form.labels, name]);
  const save = async () => {
    if (!ready) return;
    const r = await rpc('automation.set', {
      ...(initial?.id ? { id: initial.id } : {}), project_id: form.project_id, name: form.name.trim(), ...(form.icon ? { icon: form.icon } : {}), cron, every_min: 1440,
      labels: form.labels, engine_id: form.engine_id, prompt: form.prompt.trim(), approval: form.approval,
      runner: form.script.trim() ? form.runner.trim().split(/\s+/) : [], script: form.script.trim(),
    });
    if (r && r.result) { toast(initial?.id ? 'Automation saved' : 'Automation created'); onSaved(); return; }
    const why = String((r && r.error && (r.error.message || r.error)) || 'Could not save the automation');
    setSaveError(why);
    toast(why, true);
  };
  return (
    <section className="ou-ae-page" aria-label={initial?.id ? 'Edit automation' : 'New automation'}>
      <header className="ou-ae-top">
        <button type="button" className="ou-ae-crumb" onClick={onClose}>Automations</button>
        <span className="ou-ae-sep">/</span>
        <h1 className="ou-ae-heading">{initial?.id ? 'Edit automation' : 'New automation'}</h1>
        <span className="ou-ap-gap" />
        <Button variant="ghost" size="sm" label="Cancel" onClick={onClose} />
        <Button variant="primary" size="sm" label={initial?.id ? 'Save' : 'Create automation'} isDisabled={!ready} onClick={save} />
      </header>
      <div className="ou-ae">
        <div className="ou-ae-row">
          <span className="ou-ae-emoji">
            <button type="button" className="ou-ae-emojibtn" aria-label="Pick an emoji" aria-expanded={picking} onClick={() => setPicking(!picking)}>{form.icon || <Emoji size={16} />}</button>
            {picking ? <span className="ou-ae-emojis" role="listbox" aria-label="Emoji">{EMOJI.map((e) => <button key={e} type="button" role="option" aria-selected={e === form.icon} onClick={() => { set('icon')(e); setPicking(false); }}>{e}</button>)}</span> : null}
          </span>
          <TextInput hasAutoFocus label="Name" isLabelHidden placeholder="Name" value={form.name} onChange={set('name')} width="100%" />
        </div>
        <label className="ou-ae-label">Prompt</label>
        {composer({
          className: 'ou-ae-prompt',
          filled: Boolean(form.prompt.trim()),
          onKeyDown: (e) => { if (e.key === 'Enter' && e.ctrlKey && ready) { e.preventDefault(); void save(); } },
          field: <TextArea label="Prompt" isLabelHidden rows={4} value={form.prompt} placeholder="What work do you want to automate?" onChange={set('prompt')} />,
          attach: (paths) => set('prompt')(atRefs(form.prompt, paths, (s.projects || []).find((p) => p.id === form.project_id)?.path)),
          engine: { id: form.engine_id, options: engines.map((e) => ({ value: e.id, label: e.id })), onChange: set('engine_id') },
          send: { label: initial?.id ? 'Save' : 'Create automation', tooltip: `${initial?.id ? 'Save' : 'Create automation'} (Ctrl+Enter)`, isDisabled: !ready, onClick: save },
          context: [{ key: 'project', plain: true, icon: <FolderIcon size={16} />, node: <Selector size="sm" variant="ghost" placement="above" label="Project" isLabelHidden value={form.project_id} onChange={set('project_id')} options={(s.projects || []).map((p) => ({ value: p.id, label: p.name }))} /> },
            { key: 'machine', icon: <LaptopIcon size={16} />, text: 'Local', title: 'Agents run on this computer' },
            form.project_id === ui.projectId && ui.git && ui.git.project === ui.projectId && ui.git.branch ? { key: 'branch', icon: <Branch size={14} />, text: ui.git.branch } : null,
            { key: 'gap', gap: true },
            { key: 'access', accent: true, node: <Selector size="sm" variant="ghost" placement="above" label="Approval for each run" isLabelHidden value={form.approval} onChange={set('approval')}
              options={[{ value: 'ask', label: 'Ask first' }, { value: 'edits', label: 'Edits allowed' }, { value: 'contained', label: 'Auto' }]} /> },
          ],
        })}
        <label className="ou-ae-label">Labels</label>
        <div className="ou-hm-chips">
          {[...new Set([...labelNames, ...form.labels])].map((l) => {
            const c = colours[l];
            const on = form.labels.includes(l);
            return <button key={l} type="button" className={`ou-ap-chip ou-ap-label ou-ae-lab${on ? ' ou-on' : ''}`} aria-pressed={on} onClick={() => toggleLabel(l)}
              ><span className="ou-ap-ldot" style={c ? { background: c } : undefined} />{l}</button>;
          })}
          <TextInput size="sm" label="New label" isLabelHidden placeholder="New label, Enter adds" value={newLabel} onChange={setNewLabel} width={170}
            onEnter={() => { const v = newLabel.trim().slice(0, 32); if (v && !form.labels.includes(v)) set('labels')([...form.labels, v]); setNewLabel(''); }} />
        </div>
        <div className="ou-ae-row ou-ae-freq">
          <label className="ou-ae-label">Frequency</label>
          <span className="ou-ae-seg" role="radiogroup" aria-label="Frequency">
            {PRESETS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={form.preset === k} onClick={() => setForm((f) => ({ ...f, preset: k, custom: k === 'custom' ? cronOf(f) || f.custom : f.custom }))}>{label}</button>)}
          </span>
        </div>
        <div className="ou-ae-row ou-ae-when">
          {form.preset === 'hourly' ? <><span className="ou-ae-label">At minute</span><NumberInput label="Minute" isLabelHidden width={110} value={form.minute} min={0} max={59} step={1} isIntegerOnly onChange={set('minute')} /></> : null}
          {form.preset === 'weekly' ? <><span className="ou-ae-label">On</span><Selector size="sm" label="Day" isLabelHidden value={String(form.day)} onChange={(v) => set('day')(Number(v))} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} /></> : null}
          {['daily', 'weekdays', 'weekly'].includes(form.preset) ? <><span className="ou-ae-label">At</span><TextInput size="sm" label="Time" isLabelHidden width={84} placeholder="09:00" value={form.time} onChange={(v) => set('time')(v.replace(/[^\d:]/g, '').slice(0, 5))} /></> : null}
          {form.preset === 'custom' ? <><span className="ou-ae-label">Custom</span><TextInput label="Cron" isLabelHidden width={200} value={form.custom} onChange={set('custom')} placeholder="0 9 * * 1-5" /></> : null}
        </div>
        <div className="ou-ae-preview" data-valid={valid && !saveError ? 'true' : 'false'}>
          {preview === null ? <span>Reading the schedule.</span> : valid ? <><b>{preview.words}</b><span className="ou-ae-cron">{cron}</span><span>Next: {runs.map(runWords).join(' · ') || 'no run found'}</span></> : <b>{preview.error || 'Not a valid schedule. Five fields: minute hour day month weekday.'}</b>}
          {saveError ? <b className="ou-ae-error" role="alert">{saveError}</b> : null}
          <span className="ou-hm-muted">Local time. Runs while cc is open.</span>
        </div>
        <button type="button" className="ou-hm-fold" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><span className="ou-hm-chevbox" data-open={advanced ? 'true' : 'false'}>{chevSmall}</span><span>Advanced: check script</span></button>
        {advanced ? (
          <div className="ou-ae-adv">
            <p className="ou-hm-muted">Optional. When set, the script runs on schedule and exit code 1 starts the agent. Empty means the agent starts on every run.</p>
            <div className="ou-ae-row">
              <TextInput size="sm" label="Check script" isLabelHidden placeholder="scripts/check.mjs" value={form.script} onChange={set('script')} width="100%" />
              <TextInput size="sm" label="Runner" isLabelHidden placeholder="node" value={form.runner} onChange={set('runner')} width={160} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const TEMPLATES = [
  { icon: '\u{1F9EA}', name: 'Nightly test sweep', prompt: 'Run the full test suite each night. Fix what fails, one cause per branch.', cron: '0 2 * * *' },
  { icon: '\u{1F50D}', name: 'Morning issue triage', prompt: 'Read new GitHub issues, label them, and draft a fix for anything marked easy.', cron: '30 8 * * 1-5' },
  { icon: '\u{1F4E6}', name: 'Dependency check', prompt: 'Look for outdated or vulnerable packages and open a branch with safe upgrades.', cron: '0 9 * * 1' },
  { icon: '\u{1F4DD}', name: 'Changelog draft', prompt: 'Summarise today’s commits into a short changelog entry for review.', cron: '0 17 * * 1-5' },
  { icon: '\u{1F9F9}', name: 'Friday tidy-up', prompt: 'Remove dead code and stale TODOs. Keep each change small and explained.', cron: '0 16 * * 5' },
];

const sortIcon = <Sort size={14} />;
const clockBig = <Schedule size={28} />;
const labelName = (l) => (typeof l === 'string' ? l : l?.name || '');
const labelColour = (l, colours) => (typeof l === 'string' ? colours[l] : l?.colour) || null;

function TemplateCards({ onPick }) {
  return (
    <ul className="ou-ap-templates">
      {TEMPLATES.map((t) => (
        <li key={t.name}>
          <button type="button" className="ou-ap-template" onClick={() => onPick(t)}>
            <span className="ou-ap-emoji" aria-hidden="true">{t.icon}</span>
            <span className="ou-ap-ttext"><b>{t.name}</b><span>{t.prompt}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AutomationsPage() {
  const [list, setList] = useState(null);
  const [view, setView] = useState(() => { try { return load('auto-view') || 'box'; } catch { return 'box'; } });
  const [tab, setTab] = useState('mine');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [colours, setColours] = useState({});
  const [editing, setEditing] = useState(null);
  const box = useRef(null);
  const shownView = useRef(view);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (canMove(box.current)) stagger(box.current.querySelectorAll('.ou-ap-items > li'), 8);
  }, [view]);
  const refresh = async () => {
    const [r, l] = await Promise.all([rpc('automation.list', {}, true), rpc('label.list', {}, true)]);
    setList(r && r.result ? r.result.automations : []);
    setColours(Object.fromEntries(((l && l.result && l.result.labels) || []).map((x) => [x.name, x.colour])));
  };
  useEffect(() => { void refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, []);
  const s = ui.snap || {};
  const projName = (pid) => (s.projects || []).find((p) => p.id === pid)?.name || pid;
  const projIcon = (pid) => (s.projects || []).find((p) => p.id === pid)?.icon || null;
  const q = query.trim().toLowerCase();
  const order = {
    newest: (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    next: (a, b) => String(a.next_due || '9').localeCompare(String(b.next_due || '9')),
  }[sort];
  const shown = (list || []).filter((a) => (filter === 'all' || (filter === 'active') === Boolean(a.enabled))
    && (!q || [a.name, a.prompt, projName(a.project_id), ...(a.labels || []).map(labelName)].some((v) => String(v || '').toLowerCase().includes(q)))).slice().sort(order);
  const pickView = (v) => { setView(v); try { save('auto-view', v); } catch {} };
  const runNow = async (a) => {
    const r = await rpc('automation.run', { id: a.id });
    if (r && r.result) { toast(`Ran ${a.name}`); void refresh(); } else toast((r && r.error && (r.error.message || r.error)) || 'Could not run it', true);
  };
  const flip = async (a) => { await rpc('automation.enable', { id: a.id, enabled: !a.enabled }); void refresh(); };
  const fresh = (a) => { const t = Date.parse(a.runs?.[0]?.at || ''); return !Number.isNaN(t) && Date.now() - t < 86400000; };

  if (editing) {
    return (
      <div className="ou-ap">
        <AutomationEditor initial={editing} labelNames={Object.keys(colours)} colours={colours} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
      </div>
    );
  }
  const card = (a) => (
    <li key={a.id} data-id={a.id}>
      <div className="ou-ap-item" role="button" tabIndex={0} title="Edit" onClick={(e) => { if (!e.target.closest('button, .astryx-button')) setEditing(a); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(a); }}>
        <span className="ou-ap-itop">
          <span className="ou-ap-emoji" aria-hidden="true">{a.icon || <Schedule size={16} />}</span>
          <span className="ou-ap-name">{a.name}</span>
          {fresh(a) ? <span className="ou-ap-unread" role="img" aria-label="New run" title="Ran in the last day" /> : null}
          <span className="ou-ap-gap" />
          <Button size="sm" variant="ghost" icon={playIcon} label="Run now" onClick={() => runNow(a)} />
        </span>
        {a.prompt ? <span className="ou-ap-prompt">{a.prompt}</span> : null}
        <span className="ou-ap-chips">
          <span className="ou-ap-chip">{projIcon(a.project_id) ? <ProjectIcon icon={projIcon(a.project_id)} size={14} /> : folderIcon}{projName(a.project_id)}</span>
          <span className="ou-ap-chip">{clockIcon}{a.words || (a.every_min ? `Every ${a.every_min} min` : 'On demand')}{a.enabled && nextWords(a.next_due) ? ` · ${nextWords(a.next_due)}` : ''}</span>
          <span className="ou-ap-chip"><EngineMark id={a.engine_id} size={14} title={a.engine_id} />{a.engine_id || 'agent'}</span>
          {(a.labels || []).map((l) => {
            const c = labelColour(l, colours);
            return <span key={labelName(l)} className="ou-ap-chip ou-ap-label"><span className="ou-ap-ldot" style={c ? { background: c } : undefined} />{labelName(l)}</span>;
          })}
          <button type="button" className={`ou-ap-chip ou-ap-state${a.enabled ? ' ou-on' : ''}`} title={a.enabled ? 'Pause' : 'Resume'} onClick={() => flip(a)}>{a.enabled ? 'Active' : 'Paused'}</button>
        </span>
      </div>
    </li>
  );
  const groups = [['Active', shown.filter((a) => a.enabled)], ['Paused', shown.filter((a) => !a.enabled)]].filter(([, rows]) => rows.length);
  return (
    <div className="ou-ap" ref={box}>
      <div className="ou-ap-titlerow">
        <h1 className="ou-ap-title">Automations</h1>
        <span className="ou-ap-gap" />
        <Button size="sm" variant="secondary" icon={plusIcon} label="New automation" onClick={() => setEditing({})} />
      </div>
      <div className="ou-ap-bar">
        <span className="ou-ap-tabs" role="tablist" aria-label="Automations">
          {[['mine', 'Mine'], ['ideas', 'Ideas']].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
        </span>
        <span className="ou-ap-search">{searchIcon}<TextInput size="sm" label="Search automations" isLabelHidden placeholder="Search" value={query} onChange={setQuery} width={160}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} /></span>
        <span className="ou-ap-sel" title="Filter">{filterIcon}<Selector size="sm" variant="ghost" label="Filter automations" isLabelHidden value={filter} onChange={(v) => setFilter(v || 'all')} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]} /></span>
        <span className="ou-ap-sel" title="Sort">{sortIcon}<Selector size="sm" variant="ghost" label="Sort automations" isLabelHidden value={sort} onChange={(v) => setSort(v || 'newest')} options={[{ value: 'newest', label: 'Newest' }, { value: 'name', label: 'Name' }, { value: 'next', label: 'Next run' }]} /></span>
        <span className="ou-ap-gap" />
        <span className="ou-hm-seg" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === 'list'} title="List" onClick={() => pickView('list')}>{listIcon}</button>
          <button type="button" aria-pressed={view === 'box'} title="Boxes" onClick={() => pickView('box')}>{boxIcon}</button>
        </span>
      </div>
      <p className="ou-ap-note">Runs while cc is open.</p>
      {tab === 'ideas' ? <TemplateCards onPick={(t) => setEditing(t)} /> : list === null ? <p className="ou-ap-note">Loading.</p> : !(list || []).length ? (
        <div className="ou-ap-empty">
          <span className="ou-ap-emptyicon">{clockBig}</span>
          <h2>Schedule a task</h2>
          <p>An agent starts on its own at the times you set. Pick one to begin, or write your own.</p>
          <TemplateCards onPick={(t) => setEditing(t)} />
        </div>
      ) : !shown.length ? <p className="ou-ap-note">No automation matches.</p> : groups.map(([title, rows]) => (
        <section key={title} className="ou-ap-group" aria-label={title}>
          <h2 className="ou-ap-gtitle">{title}<span className="ou-ap-gcount">{rows.length}</span></h2>
          <ul className={`ou-ap-items ou-ap-${view}`}>{rows.map(card)}</ul>
        </section>
      ))}
    </div>
  );
}
