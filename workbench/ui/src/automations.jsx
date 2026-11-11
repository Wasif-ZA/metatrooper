import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { EngineMark } from './icons/index.js';

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

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const pad = (n) => String(n).padStart(2, '0');

export function scheduleWords(a) {
  const c = String(a.cron || '').trim().split(/\s+/);
  if (c.length === 5) {
    const [mi, h, dom, mon, dow] = c;
    const at = /^\d+$/.test(mi) && /^\d+$/.test(h) ? `${pad(h)}:${pad(mi)}` : null;
    if (at && dom === '*' && mon === '*') {
      if (dow === '*') return `Daily at ${at}`;
      if (dow === '1-5') return `Weekdays at ${at}`;
      if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`;
      if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${at}`;
    }
    const every = /^\*\/(\d+)$/.exec(mi);
    if (every && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${every[1]} min`;
    if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Hourly at :${pad(mi)}`;
    const list = (v, names) => v.split(',').map((p) => p.replace(/^(\d+)-(\d+)$/, (_, a, b) => `${names ? names[a] : a} to ${names ? names[b] : b}`).replace(/^\d+$/, (n) => (names ? names[n] : n))).join(', ');
    const parts = [at ? `At ${at}` : every ? `Every ${every[1]} min` : `At minute ${mi} of hour ${h}`];
    if (dom !== '*') parts.push(`on day ${list(dom)} of the month`);
    if (dow !== '*') parts.push(`on ${list(dow, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])}`);
    if (mon !== '*') parts.push(`in ${list(mon, ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}`);
    return parts.join(' ');
  }
  const m = Number(a.every_min) || 0;
  if (!m) return 'On demand';
  if (m % 1440 === 0) return m === 1440 ? 'Daily' : `Every ${m / 1440} days`;
  if (m % 60 === 0) return m === 60 ? 'Hourly' : `Every ${m / 60} h`;
  return `Every ${m} min`;
}

const nextWords = (iso) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `next in ${mins} min`;
  if (mins < 1440) return `next in ${Math.round(mins / 60)} h`;
  return `next in ${Math.round(mins / 1440)} d`;
};

const listIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3.5h10M2 7h10M2 10.5h10" /></svg>;
const boxIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" /><rect x="8" y="1.5" width="4.5" height="4.5" rx="1" /><rect x="1.5" y="8" width="4.5" height="4.5" rx="1" /><rect x="8" y="8" width="4.5" height="4.5" rx="1" /></svg>;
const playIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor"><path d="M4 2.5v9l7.5-4.5z" /></svg>;
const searchIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4" /><path d="M9 9l3 3" /></svg>;
const folderIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /></svg>;
const clockIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5.25" /><path d="M7 4.2V7l1.8 1.2" /></svg>;
const chevSmall = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5L8.5 7 5 10.5" /></svg>;
const plusIcon = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 3v8M3 7h8" /></svg>;
const filterIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3.5h10M4 7h6M6 10.5h2" /></svg>;

const FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(text, [lo, hi]) {
  const out = new Set();
  for (const part of String(text).split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const a = m[1] === '*' ? lo : Number(m[2]);
    const b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    const step = m[4] ? Number(m[4]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(cron) {
  const parts = String(cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (sets.some((x) => !x)) return null;
  if (sets[4].has(7)) sets[4].add(0);
  return { sets, anyDom: parts[2] === '*', anyDow: parts[4] === '*' };
}

// ponytail: minute-by-minute scan capped at a year; jump by day when the date cannot match if this is ever slow.
export function nextRuns(cron, from = new Date(), count = 3) {
  const c = parseCron(cron);
  if (!c) return [];
  const [mi, h, dom, mon, dow] = c.sets;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1);
  const out = [];
  for (let i = 0; i < 527040 && out.length < count; i++, d.setMinutes(d.getMinutes() + 1)) {
    const dayOk = c.anyDom || c.anyDow ? dom.has(d.getDate()) && dow.has(d.getDay()) : dom.has(d.getDate()) || dow.has(d.getDay());
    if (mi.has(d.getMinutes()) && h.has(d.getHours()) && mon.has(d.getMonth() + 1) && dayOk) out.push(new Date(d));
  }
  return out;
}

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

const runWords = (d) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AutomationEditor({ initial, labelNames, onClose, onSaved }) {
  const s = ui.snap || {};
  const engines = (s.engines || []).filter((e) => e.light !== 'red');
  const start = presetOf(initial?.cron);
  const [form, setForm] = useState({
    icon: initial?.icon || EMOJI[0], name: initial?.name || '', project_id: initial?.project_id || ui.projectId || (s.projects || [])[0]?.id || '',
    prompt: initial?.prompt || '', engine_id: initial?.engine_id || engines[0]?.id || '', labels: initial?.labels || [],
    ...start, custom: initial?.cron || '0 9 * * 1-5', runner: (initial?.runner || []).join(' '), script: initial?.script || '',
  });
  const [picking, setPicking] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(initial?.script));
  const [newLabel, setNewLabel] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const cron = cronOf(form);
  const valid = Boolean(parseCron(cron));
  const runs = valid ? nextRuns(cron) : [];
  const ready = valid && form.name.trim() && form.prompt.trim() && form.engine_id && form.project_id && (!form.script.trim() || form.runner.trim());
  const toggleLabel = (name) => set('labels')(form.labels.includes(name) ? form.labels.filter((l) => l !== name) : [...form.labels, name]);
  const save = async () => {
    if (!ready) return;
    const r = await rpc('automation.set', {
      ...(initial?.id ? { id: initial.id } : {}), project_id: form.project_id, name: form.name.trim(), icon: form.icon, cron, every_min: 1440,
      labels: form.labels, engine_id: form.engine_id, prompt: form.prompt.trim(),
      runner: form.script.trim() ? form.runner.trim().split(/\s+/) : [], script: form.script.trim(),
    });
    if (r && r.result) { toast(initial?.id ? 'Automation saved' : 'Automation created'); onSaved(); } else toast((r && r.error && (r.error.message || r.error)) || 'Could not save the automation', true);
  };
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} aria-label={initial?.id ? 'Edit automation' : 'New automation'} width={720}>
      <DialogHeader title={initial?.id ? 'Edit automation' : 'New automation'} onOpenChange={(o) => { if (!o) onClose(); }} />
      <div className="ou-ae">
        <div className="ou-ae-row">
          <span className="ou-ae-emoji">
            <button type="button" className="ou-ae-emojibtn" aria-label="Pick an emoji" aria-expanded={picking} onClick={() => setPicking(!picking)}>{form.icon}</button>
            {picking ? <span className="ou-ae-emojis" role="listbox" aria-label="Emoji">{EMOJI.map((e) => <button key={e} type="button" role="option" aria-selected={e === form.icon} onClick={() => { set('icon')(e); setPicking(false); }}>{e}</button>)}</span> : null}
          </span>
          <TextInput label="Name" isLabelHidden placeholder="Name" value={form.name} onChange={set('name')} width="100%" />
        </div>
        <label className="ou-ae-label">Prompt</label>
        <div className="ou-composer ou-ae-prompt">
          <TextArea label="Prompt" isLabelHidden rows={4} value={form.prompt} placeholder="What work do you want to automate?" onChange={set('prompt')} />
          <div className="ou-ae-pfoot">
            <span className="ou-ae-engine"><EngineMark id={form.engine_id} size={14} /><Selector size="sm" variant="ghost" label="Agent" isLabelHidden value={form.engine_id} onChange={set('engine_id')} options={engines.map((e) => ({ value: e.id, label: e.id }))} /></span>
            <span className="ou-ae-engine">{folderIcon}<Selector size="sm" variant="ghost" label="Project" isLabelHidden value={form.project_id} onChange={set('project_id')} options={(s.projects || []).map((p) => ({ value: p.id, label: p.name }))} /></span>
          </div>
        </div>
        <label className="ou-ae-label">Labels</label>
        <div className="ou-hm-chips">
          {[...new Set([...labelNames, ...form.labels])].map((l) => <button key={l} type="button" className={`ou-ny-chip ou-ae-lab${form.labels.includes(l) ? ' ou-on' : ''}`} aria-pressed={form.labels.includes(l)} onClick={() => toggleLabel(l)}>{l}</button>)}
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
          {['daily', 'weekdays', 'weekly'].includes(form.preset) ? <><span className="ou-ae-label">At</span><input type="time" className="ou-ae-time" aria-label="Time" value={form.time} onChange={(e) => set('time')(e.target.value)} /></> : null}
          {form.preset === 'custom' ? <><span className="ou-ae-label">Custom</span><TextInput label="Cron" isLabelHidden width={200} value={form.custom} onChange={set('custom')} placeholder="0 9 * * 1-5" /></> : null}
        </div>
        <div className="ou-ae-preview" data-valid={valid ? 'true' : 'false'}>
          {valid ? <><b>{scheduleWords({ cron })}</b><span className="ou-ae-cron">{cron}</span><span>Next: {runs.map(runWords).join(' · ') || 'not within a year'}</span></> : <b>Not a valid schedule. Five fields: minute hour day month weekday.</b>}
          <span className="ou-hm-muted">Local time. Runs while Ouros is open.</span>
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
        <div className="ou-ae-foot">
          <Button variant="ghost" label="Cancel" onClick={onClose} />
          <Button variant="primary" label={initial?.id ? 'Save' : 'Create automation'} isDisabled={!ready} onClick={save} />
        </div>
      </div>
    </Dialog>
  );
}

export function HomeAutomations() {
  const [list, setList] = useState(null);
  const [view, setView] = useState(() => { try { return load('auto-view') || 'box'; } catch { return 'box'; } });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [colours, setColours] = useState({});
  const [editing, setEditing] = useState(null);
  const refresh = async () => {
    const [r, l] = await Promise.all([rpc('automation.list', {}, true), rpc('label.list', {}, true)]);
    setList(r && r.result ? r.result.automations : []);
    setColours(Object.fromEntries(((l && l.result && l.result.labels) || []).map((x) => [x.name, x.colour])));
  };
  useEffect(() => { void refresh(); const t = setInterval(refresh, 60000); return () => clearInterval(t); }, []);
  const s = ui.snap || {};
  const projName = (pid) => (s.projects || []).find((p) => p.id === pid)?.name || pid;
  const q = query.trim().toLowerCase();
  const shown = (list || []).filter((a) => (filter === 'all' || (filter === 'active') === Boolean(a.enabled))
    && (!q || [a.name, projName(a.project_id), ...(a.labels || [])].some((v) => String(v || '').toLowerCase().includes(q))));
  const pickView = (v) => { setView(v); try { save('auto-view', v); } catch {} };
  const runNow = async (a) => {
    const r = await rpc('automation.run', { id: a.id });
    if (r && r.result) { toast(`Ran ${a.name}`); void refresh(); } else toast((r && r.error && (r.error.message || r.error)) || 'Could not run it', true);
  };
  const flip = async (a) => { await rpc('automation.enable', { id: a.id, enabled: !a.enabled }); void refresh(); };
  return (
    <section className="ou-hm-autos" data-view={view}>
      <div className="ou-hm-autohead">
        <h2 className="ou-hm-h">Automations<span className="ou-hm-count">{(list || []).length}</span></h2>
        <span className="ou-hm-autotools">
          <span className="ou-hm-search">{searchIcon}<TextInput size="sm" label="Search automations" isLabelHidden placeholder="Search" value={query} onChange={setQuery} width={160} /></span>
          <span className="ou-hm-filter">{filterIcon}<Selector size="sm" variant="ghost" label="Filter automations" isLabelHidden value={filter} onChange={(v) => setFilter(v || 'all')} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]} /></span>
          <Button size="sm" icon={plusIcon} label="New automation" onClick={() => setEditing({})} />
          <span className="ou-hm-seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === 'list'} title="List" onClick={() => pickView('list')}>{listIcon}</button>
            <button type="button" aria-pressed={view === 'box'} title="Boxes" onClick={() => pickView('box')}>{boxIcon}</button>
          </span>
        </span>
      </div>
      <p className="ou-hm-muted">Runs while Ouros is open.</p>
      {list === null ? <p className="ou-hm-muted">Loading.</p> : !shown.length ? <p className="ou-hm-muted">{list.length ? 'No automation matches.' : 'No automations yet. Add one in Settings.'}</p> : (
        [['Active', shown.filter((a) => a.enabled)], ['Paused', shown.filter((a) => !a.enabled)]].filter(([, rows]) => rows.length).map(([title, rows]) => (
          <div key={title} className="ou-hm-autogroup">
            <h3 className="ou-hm-sub">{title}<span className="ou-hm-pill">{rows.length}</span></h3>
            <ul className={view === 'box' ? 'ou-hm-autobox' : 'ou-hm-autolist'}>
              {rows.map((a) => {
                const status = <button type="button" className={`ou-hm-auto-st${a.enabled ? ' ou-on' : ''}`} title={a.enabled ? 'Pause' : 'Resume'} onClick={() => flip(a)}>{a.enabled ? 'Active' : 'Paused'}{a.enabled && nextWords(a.next_due) ? ` · ${nextWords(a.next_due)}` : ''}</button>;
                const chips = (
                  <span className="ou-hm-chips">
                    <span className="ou-ny-chip">{folderIcon}{projName(a.project_id)}</span>
                    <span className="ou-ny-chip">{clockIcon}{scheduleWords(a)}</span>
                    {(a.labels || []).map((l) => <span key={l} className="ou-ny-chip ou-hm-label" style={colours[l] ? { color: colours[l], borderColor: `color-mix(in srgb, ${colours[l]} 45%, transparent)` } : undefined}>{l}</span>)}
                  </span>
                );
                const run = <Button size="sm" variant="ghost" icon={playIcon} label="Run now" onClick={() => runNow(a)} />;
                return view === 'box' ? (
                  <li key={a.id} data-id={a.id}>
                    <span className="ou-hm-autotop">
                      <span className="ou-hm-emoji" aria-hidden="true">{a.icon || '⚙️'}</span>
                      <button type="button" className="ou-hm-autoname ou-hm-link" title="Edit" onClick={() => setEditing(a)}>{a.name}</button>
                      <span className="ou-hm-autoside">{run}</span>
                    </span>
                    {a.prompt ? <p className="ou-hm-autoprompt">{a.prompt}</p> : null}
                    {chips}
                    <span>{status}</span>
                  </li>
                ) : (
                  <li key={a.id} data-id={a.id}>
                    <span className="ou-hm-emoji" aria-hidden="true">{a.icon || '⚙️'}</span>
                    <button type="button" className="ou-hm-autoname ou-hm-link" title="Edit" onClick={() => setEditing(a)}>{a.name}</button>
                    {chips}
                    <span className="ou-hm-autoside">{status}{run}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      {editing ? <AutomationEditor initial={editing} labelNames={Object.keys(colours)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} /> : null}
    </section>
  );
}
