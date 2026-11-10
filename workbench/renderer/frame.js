'use strict';

// The left sidebar: view nav, this project's agents, Add-ons and Settings.
globalThis.frameView = (() => {
  const root = document.documentElement;
  const rail = () => root.classList.contains('side-rail');

  function set(narrow) {
    root.classList.toggle('side-rail', narrow);
    const b = document.getElementById('frameTog');
    const words = narrow ? 'Expand sidebar' : 'Collapse sidebar';
    b.title = `${words} (Ctrl+B)`;
    b.setAttribute('aria-label', words);
    b.setAttribute('aria-expanded', String(!narrow));
  }

  function toggle() {
    set(!rail());
    save('sidebar', rail() ? 'rail' : 'wide');
    dispatchEvent(new Event('resize'));
  }

  function draw() {
    const view = globalThis.settingsView?.isOpen() ? 'settings' : ui.view || 'wall';
    const isSettings = view === 'settings';
    if (root.classList.contains('side-auto') !== isSettings) {
      if (isSettings) root.classList.add('side-auto'); else root.classList.remove('side-auto');
      dispatchEvent(new Event('resize'));
    }
    [...document.querySelectorAll('#frame [data-action="view"]'), ...document.querySelectorAll('#frame [data-action="settings"]')].forEach((b) => {
      if ((b.dataset.view || 'settings') === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const nw = document.querySelector?.('#frame .fnew');
    if (nw) nw.hidden = !project();
    const n = needsCount();
    const pill = document.getElementById('frameNeeds');
    pill.hidden = !n;
    pill.textContent = n ? String(n) : '';
    const mine = project() ? ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)) : [];
    const mono = (x) => esc(String(x.engine_id || '').slice(0, 2).toUpperCase());
    const dot = (x) => (x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : '');
    setHtml('frame-agents', mine.length ? mine.map((x) => `<button class="fagent" data-action="pick" data-id="${esc(x.id)}" data-mono="${mono(x)}" title="${esc(taskOf(x))}" aria-label="${esc(taskOf(x))}, ${esc(x.engine_id)}, ${esc(STATE_WORDS[x.state] || x.state)}"><span class="fdot ${dot(x)}"></span><span class="ftx"><span class="ft">${esc(taskOf(x))}</span><span class="fe">${esc(x.engine_id)}</span></span></button>`).join('') : '<p class="fempty">No agents running</p>');
  }

  document.addEventListener('DOMContentLoaded', () => {
    set(load('sidebar') === 'rail');
    document.getElementById('frameTog').addEventListener('click', toggle);
    document.getElementById('frame-agents').addEventListener('click', (e) => { if (e.target.closest('[data-action="pick"]') && ui.view !== 'wall') homeView.set('wall'); });
  });

  return { draw, toggle };
})();
