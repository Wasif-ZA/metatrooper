'use strict';

// "+ Terminal" in the Wall's top bar: opens a plain shell beside a pane, by click (beside the last focused pane) or by dragging onto a pane.
const wallTerm = (() => {
  const TYPE = 'application/x-cc-shell';
  let lastTile = null;
  let dropAt = null;

  async function open(kind, beside) {
    if (!kind || !ui.projectId) return null;
    const r = await rpc('shell.open', { project_id: ui.projectId, kind });
    if (!r.result) return null;
    const id = r.result.shell_id;
    ui.shells.push({ id, label: r.result.label, cwd: r.result.cwd, project_id: ui.projectId, kind });
    toWall();
    const anchor = beside && termView.tile(beside) ? beside : wall.big();
    if (anchor) wall.promote(anchor);
    render();
    wall.unpair();
    wall.pair(id);
    termView.tile(id)?.querySelector('textarea')?.focus();
    return id;
  }

  function menu(btn) {
    const m = document.getElementById('menu');
    const kinds = ui.shellKinds || [];
    const items = kinds.length
      ? kinds.map((k) => `<div class="item" role="menuitem" tabindex="-1" draggable="true" data-wall-term="${esc(k.kind)}" title="Click to open beside the focused pane, or drag onto a pane">${esc(k.label)}</div>`).join('')
      : '<div class="item" role="menuitem" tabindex="-1" aria-disabled="true">No shells found on this machine</div>';
    m.innerHTML = `<div class="kmenu"><div class="mh">Terminal beside a pane</div>${items}</div>`;
    const r = btn.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 240))}px`;
    m.style.top = `${r.bottom + 4}px`;
    showMenu(m);
  }

  const kindOf = (el) => el.dataset.wallTerm || (ui.shellKinds || [])[0]?.kind || '';
  const mark = (tile) => {
    if (dropAt === tile) return;
    dropAt?.classList.remove('drop-at');
    dropAt = tile;
    tile?.classList.add('drop-at');
  };

  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('#centre .tile'); if (t) lastTile = t.dataset.id; });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-wall-term-btn]');
    if (btn) { menu(btn); return; }
    const it = e.target.closest?.('#menu [data-wall-term]');
    if (it) { hideMenu(); void open(it.dataset.wallTerm, lastTile); }
  });
  document.addEventListener('dragstart', (e) => {
    const it = e.target.closest?.('[data-wall-term], [data-wall-term-btn]');
    if (!it || !kindOf(it)) return;
    e.dataTransfer.setData(TYPE, kindOf(it));
    e.dataTransfer.effectAllowed = 'copy';
  });
  document.addEventListener('dragend', () => mark(null));
  const centre = document.getElementById('centre');
  centre.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    mark(e.target.closest('.tile'));
  }, true);
  centre.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes(TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const tile = e.target.closest('.tile');
    mark(null);
    hideMenu();
    void open(e.dataTransfer.getData(TYPE), tile ? tile.dataset.id : lastTile);
  }, true);

  return { open };
})();
