import { useEffect } from 'react';
import { CommandPalette } from '@astryxdesign/core/CommandPalette';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { createStore } from './store.js';
import { ideShown, ideCommands, ideFiles, openPath } from './ide.jsx';

export const paletteStore = createStore({ open: false });
export const confirmStore = createStore({ item: null });

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
const cmd = (group, label, run, id = `cmd:${group}:${label}`) => {
  runs.set(id, run);
  return { id, label, auxiliaryData: { group } };
};

const IDE_KEYS = [
  { keys: 'Ctrl+P', does: 'Find a file', where: 'IDE' },
  { keys: 'Ctrl+Shift+F', does: 'Search in files', where: 'IDE' },
  { keys: 'Ctrl+Shift+G', does: 'Changes', where: 'IDE' },
  { keys: 'Ctrl+S', does: 'Save', where: 'IDE' },
  { keys: 'Ctrl+W', does: 'Close tab', where: 'IDE' },
  { keys: 'Ctrl+Shift+P', does: 'Commands', where: 'IDE' },
];

const allKeys = () => [
  ...(typeof KEYS !== 'undefined' ? KEYS : globalThis.KEYS || []),
  ...IDE_KEYS,
];

const keyItem = (k, i) => {
  const meta = `${k.keys} · ${k.where}`;
  const label = `${k.does} · ${meta}`;
  const id = `key:${k.keys}:${k.does}:${i}`;
  return cmd('Keys', label, () => { paletteView.close(); if (k.where === 'anywhere' || k.where === 'IDE') setTimeout(() => pressKeys(k.keys), 0); }, id);
};

// A Keys row presses its first combo; rows tied to a tile or the browser only name the key.
export function pressKeys(keys) {
  const parts = String(keys).split(',')[0].trim().split('+');
  const key = parts.pop();
  if (!key || key === 'Esc' || /click/.test(key)) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: key.length === 1 ? key.toLowerCase() : key, ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), bubbles: true, cancelable: true }));
}

const file = (path, group) => ({ id: path, label: path, auxiliaryData: { group } });
const slashed = (f) => String(f).replace(/\\/g, '/');

function commands() {
  const out = [...ideCommands(cmd)];
  const seen = new Set(out.map((x) => x.id));
  const items = typeof paletteItems === 'function' ? paletteItems() : [];
  for (const x of items.filter((y) => !y.stay)) {
    const run = x.confirm ? () => confirmStore.set({ item: x }) : x.run;
    const item = cmd(x.group, x.label, run);
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
    const cmdHits = commands().filter((c) => c.label.toLowerCase().includes(lq));
    const keyHits = q ? allKeys().map(keyItem).filter((c) => c.label.toLowerCase().includes(lq)) : [];
    let scrollHits = [];
    if (q && ui?.snap?.core?.online && typeof rpc === 'function') {
      try {
        const session_ids = [...ui.snap.sessions, ...(typeof shellRows === 'function' ? shellRows() : [])].map((x) => x.id);
        const r = await rpc('session.search', { query: q, session_ids }, true);
        if (r && r.result && Array.isArray(r.result.hits)) {
          scrollHits = r.result.hits.slice(0, 20).map((hit, i) =>
            cmd('Scrollback', hit.text, () => void openHit(hit), `scroll:${hit.session_id}:${hit.line}:${i}`)
          );
        }
      } catch {}
    }
    return [...files, ...cmdHits, ...keyHits, ...scrollHits];
  },
};

export function Palette() {
  const { open } = paletteStore.use();
  const { item: confirmItem } = confirmStore.use();
  useEffect(() => {
    if (!open) return;
    const container = document.getElementById('cmdk');
    if (!container) return;
    const highlightFirst = () => {
      const input = container.querySelector('input[role="combobox"]');
      if (input && !input.getAttribute('aria-activedescendant') && container.querySelector('[role="option"]')) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      }
    };
    const observer = new MutationObserver(highlightFirst);
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-activedescendant', 'aria-selected'],
    });
    highlightFirst();
    return () => observer.disconnect();
  }, [open]);
  return (
    <>
      <CommandPalette
        isOpen={open}
        onOpenChange={(v) => (v ? paletteView.open() : paletteView.close())}
        searchSource={source}
        label="Commands"
        emptySearchText="Nothing matches."
        onValueChange={(id) => setTimeout(() => (runs.get(id) ?? (() => void openPath(id)))(), 0)}
      />
      {confirmItem ? (
        <AlertDialog
          isOpen
          onOpenChange={(v) => { if (!v) confirmStore.set({ item: null }); }}
          title={confirmItem.name || confirmItem.label}
          description="Open agents stop."
          actionLabel={confirmItem.confirm === 'stop' ? 'Stop core' : 'Restart core'}
          actionVariant="destructive"
          onAction={async () => {
            const run = confirmItem.run;
            confirmStore.set({ item: null });
            await run?.();
          }}
        />
      ) : null}
    </>
  );
}
