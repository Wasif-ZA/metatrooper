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
import { Home, homeStore } from './home.jsx';
import { Ide, drawIde, ideShown, ideKeys, openAt } from './ide.jsx';

const el = (id) => document.getElementById(id);

/** Mounts one screen into its existing container; the screen re-renders when its store changes. */
function mount(id, Screen) {
  const scheme = globalThis.ui?.look?.theme?.scheme === 'light' ? 'light' : 'dark';
  createRoot(el(id)).render(<Theme theme={neutralTheme} mode={scheme}><Screen /></Theme>);
}

const start = () => {
  mount('settings', Settings);
  mount('needsview', Inbox);
  mount('addons', Addons);
  mount('ide', Ide);
  el('home').replaceChildren();
  mount('home', Home);
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
globalThis.ideView = { draw: drawIde, shown: ideShown, open: openAt };

document.addEventListener('keydown', (e) => {
  if (!ideView.shown() || !e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p' && !e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.find(); }
  else if (k === 'f' && e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.search(); }
  else if (k === 'g' && e.shiftKey) { if (overlayOpen()) return; e.preventDefault(); ideKeys.changes(); }
  else if (k === 'p' && e.shiftKey) { e.preventDefault(); ideKeys.palette(!ideKeys.paletteOpen() && !overlayOpen()); }
  else if (k === 's' && !e.shiftKey) { if (e.defaultPrevented || overlayOpen() || ideKeys.asking()) return; e.preventDefault(); ideKeys.save(); }
  else if (k === 'w' && !e.shiftKey) { e.preventDefault(); if (overlayOpen() || ideKeys.asking()) return; ideKeys.closeTab(); }
  else if (k === 'v' && e.shiftKey) { if (overlayOpen()) return; if (ideKeys.preview()) e.preventDefault(); }
});

// home.js stays loaded for homeView.set and shown; only its drawing is replaced.
homeView.draw = () => {
  el('home').hidden = !homeView.shown();
  document.querySelectorAll('.vseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === (ui.view || 'wall'))));
  homeStore.set({ tick: homeStore.get().tick + 1 });
};

// Enter or Space on a focused row acts like a click on it.
document.addEventListener('keydown', (e) => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.('.ou-irow, .ou-agent')) return;
  e.preventDefault();
  e.target.click();
});
