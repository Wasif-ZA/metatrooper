/* The Add-ons screen: which agents are ready and which plugins are installed, with what each plugin may do. Read only. */
globalThis.addonsView = (() => {
  let rows = null;
  let pending = null;
  const el = () => document.getElementById('addons');
  const shown = () => ui.view === 'addons';

  function paint() {
    const engines = ui.snap.engines;
    const agents = engines.map((e) => `<div class="hrow static"><span class="hdot${e.light === 'red' ? ' bad' : e.light === 'green' ? ' work' : ''}"></span><div class="ht"><b>${esc(e.id)}</b><span>${e.light === 'red' ? esc(e.fix || e.detail || 'Not ready') : `Ready${e.version ? ` · ${esc(e.version)}` : ''}`}</span></div>${e.light === 'red' && e.install ? `<code>${esc(e.install)}</code>` : ''}${e.plugin_id ? `<span class="hpill">from ${esc(e.plugin_id)}</span>` : ''}</div>`).join('');
    const plugins = (rows || []).map((p) => `<div class="hrow static top"><span class="hdot${p.enabled ? ' work' : ''}"></span><div class="ht"><b>${esc(p.id)}</b><span>${esc(p.description || 'No description')}</span>${p.permissions.length ? `<ul class="aperms">${p.permissions.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<span>Asks for no permissions</span>'}</div><span class="hwhen">${esc(p.version)}${p.enabled ? '' : ' · off'}</span></div>`).join('');
    setHtml('addons', `<div class="hcol">
      <header class="hhead"><div><h1>Add-ons</h1><p>Agents Ouros can start, and plugins that add tools.</p></div><button class="btn" data-action="check-engines">Check agents again</button></header>
      <h2>Agents</h2><div class="hrows">${agents || '<p class="hempty pad">No agents found.</p>'}</div>
      <h2>Plugins</h2>${rows === null ? '<p class="hempty">Loading.</p>' : plugins ? `<div class="hrows">${plugins}</div>` : '<p class="hempty">No plugins installed.</p>'}
      <p class="anote">Install or remove a plugin from a terminal: <code>troop plugin install &lt;folder or URL&gt;</code>, <code>troop plugin remove &lt;id&gt;</code>. Ouros shows what a plugin may do before it installs.</p>
    </div>`);
  }

  async function draw() {
    el().hidden = !shown();
    if (!shown()) { rows = null; pending = null; return; }
    if (rows === null && pending === null) {
      const mine = pending = {};
      paint();
      const got = (await api.addons()) || [];
      if (pending !== mine) return;
      rows = got;
    }
    if (shown()) paint();
  }

  return { draw, shown };
})();
