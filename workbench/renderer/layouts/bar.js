// Background runs: a 36px bar under the wall per run; it opens the run screen by itself only when the run needs you.
const runBars = (() => {
  const rules = window.layoutRules;
  const BOOT = Date.now();
  const seenKey = {};
  const shut = new Set();
  let ctx = null;
  let el = null;
  let lastTouch = -1e12;

  function init(c) {
    ctx = c;
    el = document.createElement('div');
    el.id = 'runbars';
    el.className = 'runbars';
    document.body.appendChild(el);
    const touch = () => { lastTouch = Date.now(); };
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-bar-close]');
      if (x) { shut.add(x.dataset.barClose); ctx.render(); return; }
      if (e.target.closest('[data-action]')) return;
      const b = e.target.closest('.rbar');
      if (b) open(b.dataset.run);
    });
  }

  const ended = (r) => ['done', 'failed', 'cancelled'].includes(r.status);

  /** Background runs to show: live ones, plus ones that ended since the window opened until the user closes them. */
  function runs() {
    const s = ctx.snap();
    if (!s) return [];
    return s.runs.filter((r) => {
      if (r.parent_run || shut.has(r.id)) return false;
      const p = s.pipelines.find((x) => x.id === r.pipeline_id);
      if (!p || !p.background) return false;
      return !ended(r) || (r.ended_at && Date.parse(r.ended_at) >= BOOT);
    });
  }

  function data(run, list) {
    const sig = list.map((x) => x.status).join();
    if (run.pipeline_id === 'e2e-browser-qa') return findingStore.get(ctx.api, run.id, sig, ctx.render);
    if (run.pipeline_id === 'two-engine-review') return reviewStore.get(ctx.api, run.id, sig, ctx.render);
    if (!rules.RULES[run.pipeline_id]) return null;
    const c = (flags[run.id] ||= { at: 0, data: null, sig });
    if (c.sig !== sig || Date.now() - c.at > 8000) {
      c.sig = sig;
      c.at = Date.now();
      void ctx.api.runDetail(run.id).then((d) => { c.data = rules.flagsOf(d && !d.error ? d : null); ctx.render(); });
    }
    return c.data;
  }
  const flags = {};

  const needKey = (run, list, d) => (rules.opens(run, list, d) ? `${d ? `${d.disagree}:${d.critical}` : ''}:${rules.activeStep(list).failed ? 'f' : ''}:${rules.moment(run, list, d)}` : '');

  function open(runId) {
    const st = ctx.stepsOf(runId);
    if (st) seenKey[runId] = needKey(st.run, st.list, data(st.run, st.list));
    ctx.openRun(runId);
  }

  function line(run, st, d) {
    const p = ctx.snap().pipelines.find((x) => x.id === run.pipeline_id);
    const id = (p && p.title) || run.pipeline_id;
    const secs = Math.round(((run.ended_at ? Date.parse(run.ended_at) : Date.now()) - Date.parse(run.started_at)) / 1000);
    const at = `${Math.min(st.at, st.list.length)}/${st.list.length}`;
    if (!ended(run)) {
      const s = ctx.snap().sessions.filter((x) => x.run_id === run.id && x.last_line).pop();
      return { text: `${id} · ${at} · ${secs}s`, last: s ? s.last_line : '', hot: false };
    }
    if (run.status !== 'done') return { text: `${id} · ${run.status}`, last: '', hot: true };
    if (d && d.open) return { text: `${id} done`, last: `${d.open} still open${d.critical ? ` · ${d.critical} critical` : ''}`, hot: true };
    if (d && (d.disagree || d.critical)) return { text: `${id} done`, last: [d.disagree ? `${d.disagree} disagree` : '', d.critical ? `${d.critical} critical` : ''].filter(Boolean).join(' · '), hot: true };
    return { text: `${id} done`, last: d && d.items ? `nothing needs you · ${d.items.length} finding${d.items.length === 1 ? '' : 's'}` : 'nothing needs you', hot: false };
  }

  function render() {
    if (!el) return;
    const list = runs();
    const html = list.map((run) => {
      const st = ctx.stepsOf(run.id);
      if (!st) return '';
      const d = data(run, st.list);
      const key = needKey(run, st.list, d);
      if (key && seenKey[run.id] !== key && !ctx.isOpen()) {
        const quiet = Date.now() - lastTouch;
        if (quiet >= rules.QUIET_MS) { seenKey[run.id] = key; setTimeout(() => ctx.openRun(run.id), 0); }
        else setTimeout(ctx.render, rules.QUIET_MS - quiet + 50);
      }
      const l = line(run, st, d);
      const cells = st.list.map((x) => `<i class="${x.status === 'done' ? 'd' : x.status === 'running' ? 'r' : x.status === 'failed' ? 'x' : ''}"></i>`).join('');
      return `<div class="rbar${l.hot ? ' hot' : ''}${l.hot && !ctx.isOpen() ? ' halo' : ''}${ended(run) ? ' end' : ''}" data-run="${reviewView.esc(run.id)}" role="button" tabindex="0" title="Open the run (Enter)">${l.hot && !ctx.isOpen() ? '<span class="edge"></span>' : ''}
        <span class="dot"></span><span class="cells">${cells}</span><span class="t">${reviewView.esc(l.text)}</span><span class="fl">${reviewView.esc(l.last)}</span>
        ${ctx.cancelButton(run)}<kbd>Enter</kbd>${ended(run) ? `<button class="x" data-bar-close="${reviewView.esc(run.id)}" title="Remove this bar">x</button>` : ''}</div>`;
    }).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /** Enter on the wall opens the first bar that needs you, else the first bar; returns true when it opened one. */
  function enter() {
    const bars = [...el.querySelectorAll('.rbar')];
    const b = bars.find((x) => x.classList.contains('hot')) || bars[0];
    if (!b) return false;
    open(b.dataset.run);
    return true;
  }

  return { init, render, enter, open };
})();
