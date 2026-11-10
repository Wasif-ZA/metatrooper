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

globalThis.addonsView = { shown: () => ui.view === 'addons', draw: drawAddons };
