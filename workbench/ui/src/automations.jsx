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
