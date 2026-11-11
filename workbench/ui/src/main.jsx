import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './ui.css';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Settings, settingsStore } from './settings.jsx';
import { Inbox, inboxStore } from './inbox.jsx';
import { Addons, drawAddons } from './addons.jsx';
import { Home, homeStore, openNewTask } from './home.jsx';
import { Ide, drawIde, ideShown, ideKeys, openAt, dirtyIn, dropProject } from './ide.jsx';
import { Palette, paletteView } from './palette.jsx';
import { createStore } from './store.js';

// `ui` is app.js's top-level const: global, but not a globalThis property.
const schemeOf = () => (typeof ui !== 'undefined' && ui.look?.theme?.scheme === 'light' ? 'light' : 'dark');
const schemeStore = createStore({ scheme: schemeOf() });
// renderer/app.js applyLook calls this after every look change.
globalThis.setUiScheme = () => { if (schemeStore.get().scheme !== schemeOf()) schemeStore.set({ scheme: schemeOf() }); };

const el = (id) => document.getElementById(id);

function LiveTheme({ children }) {
  const { scheme } = schemeStore.use();
  return <Theme theme={neutralTheme} mode={scheme}>{children}</Theme>;
}

/** Mounts one screen into its existing container; the screen re-renders when its store or the scheme changes. */
function mount(id, Screen) {
  createRoot(el(id)).render(<LiveTheme><Screen /></LiveTheme>);
}

const start = () => {
  mount('settings', Settings);
  mount('needsview', Inbox);
  mount('addons', Addons);
  mount('ide', Ide);
  el('home').replaceChildren();
  mount('home', Home);
  const cmdk = document.createElement('div');
  cmdk.id = 'cmdk';
  document.body.appendChild(cmdk);
  mount('cmdk', Palette);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

globalThis.settingsView = {
  async open(id) {
    settingsStore.set({ data: await api.settingsPage(), ...(id ? { section: id } : {}) });
    el('settings').hidden = false;
    el('settings').focus();
    render();
  },
  close() {
    if (el('settings').hidden) return false;
    el('settings').hidden = true;
    render();
    return true;
  },
  isOpen: () => !el('settings').hidden,
};

globalThis.inboxView = {
  shown: () => ui.view === 'inbox',
  draw() {
    el('needsview').hidden = ui.view !== 'inbox';
    inboxStore.set({ tick: inboxStore.get().tick + 1 });
  },
};

// j and k move between rows on Needs you, as the old screen did.
document.addEventListener('keydown', (e) => {
  if (ui.view !== 'inbox' || (e.key !== 'j' && e.key !== 'k') || e.ctrlKey || e.altKey || e.metaKey || e.target.closest?.('input, textarea, select')) return;
  const rows = [...el('needsview').querySelectorAll('.ou-irow')];
  const at = rows.findIndex((r) => r.contains(document.activeElement));
  const next = rows[at + (e.key === 'j' ? 1 : -1)] || rows[e.key === 'j' ? 0 : rows.length - 1];
  if (next) { e.preventDefault(); next.focus(); }
});

globalThis.addonsView = { shown: () => ui.view === 'addons', draw: drawAddons };
globalThis.ideView = { draw: drawIde, shown: ideShown, open: openAt, dirtyIn, dropProject };
globalThis.paletteView = paletteView;

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (e.ctrlKey && e.shiftKey && !e.altKey && key === 'p') {
    if (paletteView.isOpen()) {
      e.preventDefault();
      paletteView.close();
    } else if (!overlayOpen()) {
      e.preventDefault();
      paletteView.open();
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (!ideView.shown() || !e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p' && !e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.find(); }
  else if (k === 'f' && e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.search(); }
  else if (k === 'g' && e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.changes(); }
  else if (k === 's' && !e.shiftKey) { if (e.defaultPrevented || overlayOpen() || ideKeys.asking()) return; e.preventDefault(); ideKeys.save(); }
  else if (k === 'w' && !e.shiftKey) { e.preventDefault(); if (overlayOpen() || ideKeys.asking()) return; ideKeys.closeTab(); }
  else if (k === 'v' && e.shiftKey) { if (overlayOpen()) return; if (ideKeys.preview()) e.preventDefault(); }
});

// home.js stays loaded for homeView.set and shown; only its drawing is replaced.
homeView.draw = () => {
  el('home').hidden = !(homeView.shown() || (ui.view === 'automations' && Boolean(project())));
  document.querySelectorAll('.vseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === (ui.view || 'wall'))));
  homeStore.set({ tick: homeStore.get().tick + 1 });
};

globalThis.newTask = openNewTask;

globalThis.addEventListener?.('home-select', () => homeStore.set({ open: [], tick: homeStore.get().tick + 1 }));

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'n' || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
  if (e.target.closest?.('input, textarea, select, .monaco-editor')) return;
  e.preventDefault();
  openNewTask();
});

// Enter or Space on a focused row acts like a click on it.
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.('.ou-irow, .ou-agent, .ou-ide-ahead')) return;
  e.preventDefault();
  e.target.click();
});
