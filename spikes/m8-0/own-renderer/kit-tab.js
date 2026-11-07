TABS.push(['kit', 'Kit']); // adds the Kit tab to the tab strip
const KIT_CSS = ['tiles', 'ide', 'r2', 'r3', 'r4', 'kit', 'assets']; // kit stylesheets, loaded inside the shadow root only
function kitTab() {
  queueMicrotask(() => { // fills the placeholder with the kit surface inside a shadow root
    const host = document.getElementById('kitHost');
    if (!host || host.shadowRoot) return;
    const s = window.KIT_SPEC;
    host.attachShadow({ mode: 'open' }).innerHTML = KIT_CSS.map((f) => `<link rel="stylesheet" href="../../spikes/m8-0/own-renderer/${f}.css">`).join('') + `<div data-d="1" data-u="vscode" style="--t3:#7c7c7c;background:var(--c0);color:var(--t1);font:13px/1.4 var(--ui)">${window.kitSurface(s.spec, s.source, s.agent)}</div>`;
  });
  return '<div id="kitHost"></div>';
}
document.getElementById('view').addEventListener('click', (e) => { // forwards a kit data-event click to main over the call channel
  const t = e.composedPath()[0].closest && e.composedPath()[0].closest('[data-event]');
  if (t) void window.troop.call('kit.event', { event: t.dataset.event });
});
