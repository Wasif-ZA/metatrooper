import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Settings, settingsStore } from '../../ui/src/settings.jsx';

export async function run(fixture) {
  const results = [];
  const host = document.getElementById('root');
  const root = createRoot(host);
  let generation = 0;
  let data;
  let open = true;
  let calls = [];
  const equal = (actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const search = () => host.querySelector('input[type="search"]');
  const titles = () => [...host.querySelectorAll('.ou-rowtitle')].map(n => n.textContent);
  const headings = () => [...host.querySelectorAll('.ou-group h3')].map(n => n.textContent);
  const input = async (element, value) => {
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();
  };
  const key = (element, value) => {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    flushSync(() => element.dispatchEvent(event));
    return event.defaultPrevented;
  };
  const mount = async (section = 'general') => {
    data = structuredClone(fixture); calls = []; open = true;
    Object.assign(globalThis, {
      ui: { projectId: 'p1', settingsLook: { themes: [] }, look: { theme: { name: 'neutral' } } },
      settingsView: { isOpen: () => open, close: () => { open = false; } },
      api: { settingsPage: async () => data, setCheck: async (...args) => { calls.push(['setCheck', ...args]); }, setSetting: async (...args) => { calls.push(['setSetting', ...args]); } },
      toast: (...args) => calls.push(['toast', ...args]),
    });
    flushSync(() => { settingsStore.set({ data, section }); root.render(<Settings key={generation++} />); });
    await tick();
  };
  const check = async (name, fn) => {
    try { await fn(); results.push({ name }); }
    catch (error) { results.push({ name, error: error.stack || String(error) }); }
  };
  try {
    await check('search matches labels case-insensitively across sections', async () => {
      await mount(); await input(search(), 'lOoP aLaRm');
      equal(headings(), ['Reliability']); equal(titles(), ['Loop alarm']);
      equal(host.querySelector('.ou-crumb').textContent, 'Settings›Search');
    });
    await check('search matches hints and groups results by section', async () => {
      await mount(); await input(search(), '  pRoJeCt  ');
      equal(headings(), ['Reliability', 'Safety']);
      equal(titles(), ['Check command for this project', 'Sites where agents may use my sign-in']);
      await input(search(), 'SHORTER COMMAND OUTPUT');
      equal(headings(), ['General']); equal(titles(), ['Route shell commands through metarouter']);
    });
    await check('empty search message preserves the query text', async () => {
      await mount(); await input(search(), 'NOsuch <setting>');
      equal(host.querySelector('.ou-scol').textContent, 'No setting matches "NOsuch <setting>".');
      equal(host.querySelectorAll('.ou-row').length, 0);
    });
    await check('choosing a nav item clears the search and restores its page heading', async () => {
      await mount(); await input(search(), 'project');
      const safety = [...host.querySelectorAll('nav button')].find(n => n.textContent === 'Safety');
      if (!safety) throw new Error('Safety navigation button is missing');
      flushSync(() => safety.click()); await tick();
      equal(search().value, ''); equal(host.querySelector('.ou-crumb').textContent, 'Settings›Safety');
      equal(host.querySelector('.ou-stitle h1').textContent, 'Safety'); equal(headings(), ['Computer use', 'Browser']);
    });
    await check('slash focuses search only while Settings is open and outside fields', async () => {
      await mount(); const outside = document.getElementById('outside'); outside.focus();
      equal(key(outside, '/'), true); equal(document.activeElement === search(), true);
      outside.focus(); open = false; equal(key(outside, '/'), false); equal(document.activeElement === outside, true);
      open = true;
      for (const tag of ['input', 'textarea', 'select']) {
        const field = document.createElement(tag); document.body.append(field); field.focus();
        equal(key(field, '/'), false); equal(document.activeElement === field, true); field.remove();
      }
      outside.focus(); equal(key(outside, 'x'), false); equal(document.activeElement === outside, true);
    });
    for (const event of ['enter', 'blur']) await check('check command saves changed text on ' + event + ' and ignores unchanged text', async () => {
      await mount('reliability');
      const command = () => host.querySelector('input[placeholder="npm test"]');
      const commit = async () => {
        if (event === 'enter') key(command(), 'Enter');
        else { flushSync(() => { command().focus(); command().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.getElementById('outside') })); document.getElementById('outside').focus(); }); }
        await tick(); await tick();
      };
      await commit(); equal(calls, []);
      await input(command(), 'node --test'); await commit();
      equal(calls, [['setCheck', 'p1', 'node --test']]);
    });
    await check('reset writes the default and disappears after the refreshed value matches', async () => {
      await mount('reliability');
      data.reliability.loop_nudge_at = 9; data.defaults = { 'reliability.loop_nudge_at': 3 };
      api.setSetting = async (key, value) => { calls.push(['setSetting', key, value]); data.reliability.loop_nudge_at = value; };
      flushSync(() => settingsStore.set({ data: { ...data } }));
      const reset = host.querySelector('button[aria-label="Reset to default"]');
      if (!reset) throw new Error('Reset to default button is missing');
      flushSync(() => reset.click()); await tick(); await tick();
      equal(calls, [['setSetting', 'reliability.loop_nudge_at', 3]]);
      equal(host.querySelectorAll('button[aria-label="Reset to default"]').length, 0);
    });
  } finally { flushSync(() => root.unmount()); }
  return results;
}
