// Agent split: the working agent's live terminal stays in the wall's big slot; this half shows what it is making.
// The rail form lists every worktree agent of the run; picking one moves its terminal into the big slot.
const agentRail = {
  /** The run's worktree agent sessions, oldest first; empty when the run has none. */
  sessions(m) {
    return m.sessions.filter((x) => x.step_id && (m.meta.steps[x.step_id] || {}).worktree).sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  },
  /** True when the watched step fanned out into more than one session, or the rail slot was picked by hand. */
  shown(m, slotRail) {
    if (slotRail) return true;
    const w = m.watch;
    return Boolean(w && m.sessions.filter((x) => x.step_id === w.id).length > 1);
  },
  html(m, h, selId) {
    const list = agentRail.sessions(m);
    if (!list.length) return '<aside class="rail"><div class="empty">No worktree agents in this run yet.</div></aside>';
    return `<aside class="rail" aria-label="Worktree agents">${list.map((x) => {
      const step = m.list.find((s) => s.id === x.step_id);
      const tail = x.cwd ? x.cwd.split(/[\\/]/).filter(Boolean).pop() : '';
      return `<button class="ri${x.id === selId ? ' on' : ''} st-${h.esc(x.state)}" data-rs="rail" data-id="${h.esc(x.id)}" title="${h.esc(x.cwd || '')}">
        <span class="rt">${h.esc(step ? step.title : x.step_id)}</span><span class="re">${h.esc(x.engine_id)}${tail ? `  ·  ${h.esc(tail)}` : ''}</span>
        <span class="rs">${h.esc(x.state)}</span><span class="rl">${h.esc(x.last_line || x.last_tool || '')}</span></button>`;
    }).join('')}</aside>`;
  },
};

runLayouts['agent-split'] = {
  render(m, h) {
    const w = m.watch;
    const prog = m.list.map((s) => `<span class="seg s-${h.esc(s.status)}" title="${h.esc(`${s.title}: ${h.label(s)}`)}"><i></i></span>`).join('');
    const gate = m.list.find((s) => s.kind === 'gate' && s.status === 'waiting');
    const sums = h.sums(m);
    const body = `<section class="arts"><div class="sec">Changes${sums ? `  ·  ${sums.files} files  +${sums.add} -${sums.del}` : ''}</div><div class="files" data-keep="as-files">${h.files(m)}</div>
        <div class="sec">Run log</div><div class="tb" data-keep="as-log" data-follow>${m.log.map(h.eventLine).join('') || '<span class="ln c-dim">No log lines yet.</span>'}</div></section>`;
    return `<nav class="prog">${prog}</nav>
      <section class="who">${w ? `<span class="gl">${h.glyph(w)}</span><span class="tt">${h.esc(w.title)}</span><span class="eng">${h.esc(h.who(w))}</span><span class="took">${h.took(w)}</span><span class="sp"></span><span class="hint">live terminal on the left</span>` : '<span class="hint">No agent is working on this run yet.</span>'}</section>
      ${m.rail ? `<div class="railwrap">${agentRail.html(m, h, w && w.session && w.session.id)}${body}</div>` : body}
      ${gate ? `<section class="drawer halo"><span class="edge"></span>${h.gateCard(m, gate)}</section>` : ''}
      <footer class="foot"><span>elapsed <b>${h.fmt(m.elapsed)}</b></span><span><b>${m.tokens ? m.tokens.toLocaleString('en-US') : '-'}</b> tok</span><span><b>${m.usd ? `$${m.usd.toFixed(2)}` : '-'}</b></span><span>${m.done} of ${m.list.length} steps</span></footer>`;
  },
};
