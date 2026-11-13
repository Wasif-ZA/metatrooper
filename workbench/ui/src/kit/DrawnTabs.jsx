import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { createStore } from '../store.js';
import { Drawn } from './Draw.jsx';

const store = createStore({ tick: 0 });
const states = new Map();
const bump = () => store.set({ tick: store.get().tick + 1 });
const of = (pid) => states.get(pid) || states.set(pid, { tabs: [], active: null, seen: new Map(), fresh: true }).get(pid);

/** Reads the surfaces the snapshot names for the open project and opens or refreshes one tab each; a closed tab stays closed until the agent redraws it. */
export async function syncDrawn() {
  const pid = ui.projectId;
  if (!pid || ui.view !== 'ide') return;
  const st = of(pid);
  const fresh = st.fresh;
  st.fresh = false;
  for (const s of (ui.snap.surfaces || []).filter((x) => x.project_id === pid)) {
    if (st.seen.get(s.id) === s.seq) continue;
    st.seen.set(s.id, s.seq);
    const out = await api.call('ui.get', { surface: s.id });
    const r = out.kind === 'reply' ? out.reply.result : null;
    if (!r) { st.seen.delete(s.id); continue; }
    let t = st.tabs.find((x) => x.id === s.id);
    if (!t) { t = { id: s.id }; st.tabs.push(t); if (!fresh) st.active = s.id; }
    Object.assign(t, { title: s.title, spec: r.spec, session: s.session_id });
    bump();
  }
}

/** The drawn screens over the editor area; the Files tab hands the area back to the editor. */
export function DrawnTabs({ pid }) {
  store.use();
  const st = states.get(pid);
  if (!st || !st.tabs.length) return null;
  const cur = st.tabs.find((t) => t.id === st.active);
  const close = (id) => { st.tabs = st.tabs.filter((t) => t.id !== id); if (st.active === id) st.active = null; bump(); };
  if (!cur) return <div className="ou-drawn-chips">{st.tabs.map((t) => <Button key={t.id} size="sm" variant="secondary" label={t.title} onClick={() => { st.active = t.id; bump(); }} />)}</div>;
  return (
    <div className="ou-drawn-layer">
      <div className="ou-drawn-bar">
        <TabList size="sm" layout="hug" overflow="auto" value={st.active || ''} onChange={(v) => { st.active = v || null; bump(); }}>
          {st.tabs.map((t) => (
            <Tab key={t.id} value={t.id} label={t.title} title={t.title}
              endContent={<IconButton size="sm" variant="ghost" label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); close(t.id); }} />} />
          ))}
        </TabList>
        <Button size="sm" variant="ghost" label="Back to files" onClick={() => { st.active = null; bump(); }} />
        <Text className="ou-drawn-who" color="secondary" size="sm">drawn by session {cur.session.slice(-6)}</Text>
      </div>
      <Drawn spec={cur.spec} />
    </div>
  );
}

