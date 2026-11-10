import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { List, ListItem } from '@astryxdesign/core/List';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { createStore } from './store.js';

export const addonsStore = createStore({ tick: 0, rows: null });

export function Addons() {
  const { rows } = addonsStore.use();
  if (ui.view !== 'addons') return null;
  const engines = ui.snap.engines;
  return (
    <div className="ou-col">
      <header className="ou-split">
        <div>
          <Heading level={1}>Add-ons</Heading>
          <Text as="p" color="secondary">Agents Ouros can start, and plugins that add tools.</Text>
        </div>
        <Button label="Check agents again" data-action="check-engines" />
      </header>
      <Heading level={2}>Agents</Heading>
      {engines.length ? (
        <List hasDividers>
          {engines.map((e) => {
            const bad = e.light === 'red';
            return (
              <ListItem key={e.id} label={e.id} description={bad ? e.fix || e.detail || 'Not ready' : `Ready${e.version ? ` · ${e.version}` : ''}`}
                startContent={<StatusDot variant={bad ? 'error' : e.light === 'green' ? 'success' : 'neutral'} label={bad ? 'Not ready' : 'Ready'} />}
                endContent={<span className="ou-actions">{bad && e.install ? <Code>{e.install}</Code> : null}{e.plugin_id ? <Badge label={`from ${e.plugin_id}`} /> : null}</span>} />
            );
          })}
        </List>
      ) : <EmptyState title="No agents found." isCompact />}
      <Heading level={2}>Plugins</Heading>
      {rows === null ? <Text color="secondary">Loading.</Text> : rows.length ? (
        <List hasDividers>
          {rows.map((p) => (
            <ListItem key={p.id} align="start" label={p.id}
              description={<>{p.description || 'No description'}{p.permissions.length ? <ul className="ou-perms">{p.permissions.map((t) => <li key={t}>{t}</li>)}</ul> : <><br />Asks for no permissions</>}</>}
              startContent={<StatusDot variant={p.enabled ? 'success' : 'neutral'} label={p.enabled ? 'On' : 'Off'} />}
              endContent={<Text color="secondary" size="sm">{p.version}{p.enabled ? '' : ' · off'}</Text>} />
          ))}
        </List>
      ) : <EmptyState title="No plugins installed." isCompact />}
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
    const got = (await api.addons()) || [];
    if (pending !== mine) return;
    addonsStore.set({ rows: got });
    return;
  }
  addonsStore.set({ tick: addonsStore.get().tick + 1 });
}
