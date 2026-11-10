import { CommandPalette } from '@astryxdesign/core/CommandPalette';
import { createStore } from './store.js';
import { ideShown, ideCommands, ideFiles, openPath } from './ide.jsx';

export const paletteStore = createStore({ open: false });

export const paletteView = {
  open() {
    paletteStore.set({ open: true });
    globalThis.reportPaneBounds?.();
  },
  close() {
    paletteStore.set({ open: false });
    globalThis.reportPaneBounds?.();
  },
  toggle(force) {
    const next = typeof force === 'boolean' ? force : !paletteStore.get().open;
    if (next) paletteView.open(); else paletteView.close();
  },
  isOpen: () => Boolean(paletteStore.get().open),
};

const runs = new Map();
const cmd = (group, label, run) => {
  const id = `cmd:${group}:${label}`;
  runs.set(id, run);
  return { id, label, auxiliaryData: { group } };
};

const file = (path, group) => ({ id: path, label: path, auxiliaryData: { group } });
const slashed = (f) => String(f).replace(/\\/g, '/');

function commands() {
  const out = [...ideCommands(cmd)];
  const seen = new Set(out.map((x) => x.id));
  const items = typeof paletteItems === 'function' ? paletteItems() : [];
  for (const x of items.filter((y) => !y.confirm && !y.stay)) {
    const item = cmd(x.group, x.label, x.run);
    if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  return out;
}

const source = {
  bootstrap() {
    const fileHits = ideShown() ? ideFiles(file) : [];
    return [...fileHits, ...commands()];
  },
  async search(q) {
    const files = ideShown()
      ? [...new Set(((await api.fsFind(ui.projectId, q)) || []).map(slashed))].slice(0, 20).map((p) => file(p, 'Files'))
      : [];
    const lq = q.toLowerCase();
    return [...files, ...commands().filter((c) => c.label.toLowerCase().includes(lq))];
  },
};

export function Palette() {
  const { open } = paletteStore.use();
  return (
    <CommandPalette
      isOpen={open}
      onOpenChange={(v) => (v ? paletteView.open() : paletteView.close())}
      searchSource={source}
      label="Commands"
      emptySearchText="Nothing matches."
      onValueChange={(id) => setTimeout(() => (runs.get(id) ?? (() => void openPath(id)))(), 0)}
    />
  );
}
