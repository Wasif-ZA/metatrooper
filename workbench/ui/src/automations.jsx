import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';

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
    return `Cron ${c.join(' ')}`;
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
const filterIcon =<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3.5h10M4 7h6M6 10.5h2" /></svg>;

export function HomeAutomations() {
  const [list, setList] = useState(null);
  const [view, setView] = useState(() => { try { return load('auto-view') || 'box'; } catch { return 'box'; } });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [colours, setColours] = useState({});
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
                      <span className="ou-hm-autoname">{a.name}</span>
                      <span className="ou-hm-autoside">{run}</span>
                    </span>
                    {a.prompt ? <p className="ou-hm-autoprompt">{a.prompt}</p> : null}
                    {chips}
                    <span>{status}</span>
                  </li>
                ) : (
                  <li key={a.id} data-id={a.id}>
                    <span className="ou-hm-emoji" aria-hidden="true">{a.icon || '⚙️'}</span>
                    <span className="ou-hm-autoname">{a.name}</span>
                    {chips}
                    <span className="ou-hm-autoside">{status}{run}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
