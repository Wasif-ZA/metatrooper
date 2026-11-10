import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Code } from '@astryxdesign/core/Code';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { createStore } from './store.js';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { PluginInstall } from './plugin-install.jsx';

export const addonsStore = createStore({ tick: 0, rows: null });

const svg = (d, size = 18) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const AGENT = 'M2.5 3h11v10h-11zM5 6.5l2 1.5-2 1.5M8.5 10.5h3';
const PLUGIN = 'M6 2.5h4v2.2a1.3 1.3 0 102.6 0h.9v4h-2.2a1.3 1.3 0 100 2.6h2.2v2.2H9.1v-1a1.3 1.3 0 10-2.6 0v1H2.5V9.5h1a1.3 1.3 0 100-2.6h-1V4.7H6z';
const SEARCH = 'M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zM10.3 10.3l3.2 3.2';
const KIND = [['agent', 'Agents'], ['plugin', 'Plugins']];
const STATE = [['on', 'On'], ['off', 'Off'], ['bad', 'Not ready']];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function items(engines, rows) {
  const agents = [...engines].sort((a, b) => (a.light === 'red') === (b.light === 'red') ? byId(a, b) : a.light === 'red' ? -1 : 1).map((e) => ({
    kind: 'agent', id: e.id, state: e.light === 'red' ? 'bad' : 'on', e,
    text: [e.id, e.fix, e.detail, e.plugin_id].join(' '),
  }));
  const plugins = Array.isArray(rows) ? [...rows].sort(byId).map((p) => ({
    kind: 'plugin', id: p.id, state: p.enabled ? 'on' : 'off', p,
    text: [p.id, p.description, ...(p.permissions || [])].join(' '),
  })) : [];
  return [...agents, ...plugins];
}

function card(it, open, toggle, remove) {
  const { e, p } = it;
  const source = (p ? ['Plugin', p.version && `v${p.version}`] : ['Agent', e.version && `v${e.version}`, e.plugin_id && `from ${e.plugin_id}`]).filter(Boolean).join(' · ');
  const perms = p ? p.permissions || [] : [];
  const shown = open ? perms : perms.slice(0, 3);
  return (
    <article key={`${it.kind}:${it.id}`} className={open ? 'ou-acard ou-acard-open' : 'ou-acard'}>
      <span className="ou-acard-tile">{svg(p ? PLUGIN : AGENT)}</span>
      <div className="ou-acard-name"><b>{it.id}</b><span>{source}</span></div>
      <div className="ou-acard-slot">
        {p ? <><Switch size="sm" label={p.enabled ? 'On' : 'Off'} isLabelHidden value={!!p.enabled} isDisabled data-action="addon-toggle" data-id={p.id} /><Badge label="Not built yet" /><Button size="sm" variant="ghost" label="Remove" onClick={() => remove(p.id)} /></>
          : it.state === 'bad' ? <><Badge label="Not ready" className="ou-notready" /><Button size="sm" label="Check again" data-action="check-engines" /></>
          : <Badge label="Ready" className="ou-acard-ready" />}
      </div>
      <p className="ou-acard-desc">
        {p ? p.description || 'No description' : it.state === 'bad' ? <>{e.fix || e.detail || 'Not ready'}{e.install ? <> <Code>{e.install}</Code></> : null}</> : 'Ready.'}
      </p>
      {p ? (
        <div className="ou-tags">
          {perms.length ? shown.map((t) => <span key={t} className="ou-tag">{t}</span>) : <span className="ou-tag ou-tag-quiet">No permissions</span>}
          {perms.length > 3 ? <button type="button" className="ou-tag ou-tag-more" data-action="addon-more" data-id={p.id} aria-expanded={open} onClick={() => toggle(p.id)}>{open ? 'Show less' : `+${perms.length - 3}`}</button> : null}
        </div>
      ) : null}
    </article>
  );
}

export function Addons() {
  const { rows } = addonsStore.use();
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState([]);
  const [open, setOpen] = useState([]);
  const [adding, setAdding] = useState(false);
  const [going, setGoing] = useState(null);
  if (ui.view !== 'addons') return null;
  const engines = ui.snap.engines;
  const loaded = Array.isArray(rows);
  const q = query.trim().toLowerCase();
  const hits = items(engines, rows).filter((it) => !q || it.text.toLowerCase().includes(q));
  const count = (key) => (!loaded && key !== 'agent' && key !== 'bad' ? '–' : hits.filter((it) => it.kind === key || it.state === key).length);
  const kinds = ticked.filter((k) => KIND.some(([x]) => x === k));
  const states = ticked.filter((k) => STATE.some(([x]) => x === k));
  const shown = hits.filter((it) => (!kinds.length || kinds.includes(it.kind)) && (!states.length || states.includes(it.state)));
  const filtered = !!q || ticked.length > 0;
  const wantPlugins = !kinds.length || kinds.includes('plugin');
  const tick = (key, on) => setTicked(on ? [...ticked, key] : ticked.filter((k) => k !== key));
  const toggle = (id) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  const clear = () => { setQuery(''); setTicked([]); };
  const retry = () => { addonsStore.set({ rows: null }); void drawAddons(); };
  const facet = (title, list) => (
    <section className="ou-group ou-facet">
      <h3>{title}</h3>
      <div className="ou-facetrows">
        {list.map(([key, label]) => (
          <div key={key} className={count(key) === 0 ? 'ou-facetrow ou-facetrow-zero' : 'ou-facetrow'}>
            <CheckboxInput size="sm" label={label} value={ticked.includes(key)} onChange={(on) => tick(key, on)} data-action="addon-facet" data-id={key} />
            <span className="ou-facetcount">{count(key)}</span>
          </div>
        ))}
      </div>
    </section>
  );
  return (
    <div className="ou-col ou-addons">
      <header className="ou-pagehead ou-addons-head">
        <div>
          <h1>Add-ons</h1>
          <p>Agents Ouros can start, and plugins that add tools.</p>
          <p className="ou-addons-scope">Changes apply to new sessions only.</p>
        </div>
        <span className="ou-actions">
          <Button label="Check agents again" variant="ghost" data-action="check-engines" />
          <Button label="Add add-on" variant="secondary" data-action="addon-add" onClick={() => setAdding(true)} />
        </span>
      </header>
      <div className="ou-addons-search">
        <TextInput type="search" size="lg" width="100%" label="Search add-ons" isLabelHidden value={query} onChange={setQuery} placeholder="Search by name, description or permission" startIcon={svg(SEARCH, 14)} hasClear data-action="addon-search" />
      </div>
      <div className="ou-addons-body">
        <aside className="ou-facets" aria-label="Filters">{facet('Kind', KIND)}{facet('State', STATE)}</aside>
        <div className="ou-results">
          <Text color="secondary" size="sm">{shown.length} result(s)</Text>
          {shown.map((it) => card(it, it.kind === 'plugin' && open.includes(it.id), toggle, setGoing))}
          {!engines.length && !filtered ? <EmptyState title="No agents found." isCompact actions={<Button label="Check agents again" data-action="check-engines" />} /> : null}
          {wantPlugins && rows === null ? <Text color="secondary">Loading plugins.</Text> : null}
          {wantPlugins && rows === 'error' ? (
            <div className="ou-addons-err"><span>Could not load plugins.</span><Button size="sm" label="Try again" data-action="addons-retry" onClick={retry} /></div>
          ) : null}
          {loaded && !rows.length && !filtered ? <EmptyState title="No plugins installed." isCompact /> : null}
          {filtered && !shown.length ? <EmptyState title="No add-ons match." isCompact actions={<Button label="Clear filters" data-action="addon-clear" onClick={clear} />} /> : null}
        </div>
      </div>
      {adding ? <PluginInstall onClose={(done) => { setAdding(false); if (done) retry(); }} /> : null}
      <AlertDialog isOpen={going !== null} onOpenChange={(isOpen) => { if (!isOpen) setGoing(null); }} title={`Remove ${going || 'this plugin'}?`} description="Its tools stop for new sessions. Open sessions keep what they started with." actionLabel="Remove" actionVariant="destructive"
        onAction={async () => { const id = going; setGoing(null); const r = await rpc('plugin.remove', { plugin_id: id }); if (r.result) { toast(`Removed ${id}`); retry(); } }} />
      <Text as="p" color="secondary">Install or remove a plugin from a terminal: <Code>troop plugin install &lt;folder or URL&gt;</Code>, <Code>troop plugin remove &lt;id&gt;</Code>. Ouros shows what a plugin may do before it installs.</Text>
    </div>
  );
}

let pending = null;

/** Loads the plugin list the first time the screen shows, and drops it when the screen is left. */
export async function drawAddons() {
  const shown = ui.view === 'addons';
  document.getElementById('addons').hidden = !shown;
  if (!shown) { pending = null; if (addonsStore.get().rows !== null) addonsStore.set({ rows: null }); return; }
  if (addonsStore.get().rows === null && pending === null) {
    const mine = pending = {};
    let got;
    try { got = (await api.addons()) || []; } catch { got = 'error'; }
    if (pending !== mine) return;
    pending = null;
    addonsStore.set({ rows: got });
    return;
  }
  addonsStore.set({ tick: addonsStore.get().tick + 1 });
}
