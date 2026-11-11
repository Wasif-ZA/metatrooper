// Inner markup of the sidebar and top bar icons on the set's 16 px grid (1.5 stroke, round caps and joins, currentColor),
// shared by the React components (shell.jsx) and the plain-script screens (frame.js, app.js) through globalThis.ourosIcon.
export const SHAPES = {
  home: '<path d="M2.5 7 8 2.5 13.5 7v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M6.5 13.5v-4h3v4"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  wall: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M8 2.5v11M2.5 8h11"/>',
  inbox: '<path d="M2.5 9.5 4.25 3.5h7.5l1.75 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M8 8.5v2l1.25 1"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  filter: '<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>',
  folder: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5z"/>',
  folderAdd: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 2h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5z"/><path d="M8 7.5v3.5M6.25 9.25h3.5"/>',
  pullRequest: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5m1.5-1.5L7.5 4.5 9 6"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  chevronDown: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  panel: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6 2.5v11"/>',
  coreDot: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  usage: '<path d="M2.75 11.5a5.25 5.25 0 1 1 10.5 0"/><path d="M8 11.5 10.5 7.5"/>',
  addOns: '<path d="M6 2.5h4v3h3v4h-3v4H6v-4H3v-4h3z"/>',
  flag: '<path d="M3.5 14V2.5M3.5 3h8l-1.75 2.75L11.5 8.5h-8"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6"/><circle cx="8" cy="8" r="4.25"/>',
  chevronRight: '<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>',
  orchestrator: '<rect x="5.5" y="2" width="5" height="3.5" rx="1"/><path d="M8 5.5V8M4 11V9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/>',
  attach: '<path d="m13 7.5-5.25 5.25a3 3 0 0 1-4.25-4.25L9 3a2 2 0 0 1 2.85 2.85l-5.4 5.4a1 1 0 0 1-1.42-1.42L9.75 5.1"/>',
  options: '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>',
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  commit: '<circle cx="8" cy="8" r="2.5"/><path d="M1.5 8h4M10.5 8h4"/>',
  changes: '<path d="M9.5 2.5h-5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7z"/><path d="M9.5 2.5v3h3M8 6.75v3M6.5 8.25h3M6.5 11.25h3"/>',
  run: '<path d="M5 3.25v9.5a.5.5 0 0 0 .77.42l7.1-4.75a.5.5 0 0 0 0-.84l-7.1-4.75A.5.5 0 0 0 5 3.25z"/>',
  schedule: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  sort: '<path d="M5 13V3M2.75 5.25 5 3l2.25 2.25M11 3v10M8.75 10.75 11 13l2.25-2.25"/>',
  listView: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  gridView: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  emoji: '<circle cx="8" cy="8" r="5.5"/><path d="M5.75 9.5a2.75 2.75 0 0 0 4.5 0M6 6.5v.25M10 6.5v.25"/>',
  approval: '<path d="M8 2.5 3 4.5v3c0 2.75 2 4.75 5 6 3-1.25 5-3.25 5-6v-3L8 2.5z"/>',
  learn: '<path d="M8 4.25C6.75 3.25 4.75 3 2.5 3.25v9c2.25-.25 4.25 0 5.5 1 1.25-1 3.25-1.25 5.5-1v-9C11.25 3 9.25 3.25 8 4.25zM8 4.25v9"/>',
  stepOpen: '<circle cx="8" cy="8" r="5.5"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
  engine: '<path d="M8 2.5c.4 2.75 1.75 4.1 4.5 4.5-2.75.4-4.1 1.75-4.5 4.5-.4-2.75-1.75-4.1-4.5-4.5 2.75-.4 4.1-1.75 4.5-4.5zM12.5 11v2.5M11.25 12.25h2.5"/>',
  // Ouros mark candidates: a ring that takes its own tail, drawn as line icons.
  mark1: '<path d="M12.6 5.5A5.25 5.25 0 1 1 8 2.75"/><path d="M8 2.75h2.5M8 2.75 10 1.25"/><circle cx="11.6" cy="3.6" r=".75" fill="currentColor" stroke="none"/>',
  mark2: '<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5"/><path d="M13.5 8A3 3 0 1 0 8 5.5"/><circle cx="8" cy="2.5" r="1" fill="currentColor" stroke="none"/>',
  mark3: '<rect x="2.5" y="2.5" width="11" height="11" rx="4"/><path d="M10 2.5H6.5"/><path d="M10.5 6.5 8 9 6.5 7.5"/>',
};

const ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A whole SVG string for one icon; an unknown name gives ''. */
export function iconSvg(name, size = 16, title = '') {
  const inner = SHAPES[name];
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" ${ATTRS} ${title ? `role="img" aria-label="${esc(title)}"` : 'aria-hidden="true"'} focusable="false">${title ? `<title>${esc(title)}</title>` : ''}${inner}</svg>`;
}

/**
 * A 14 px progress ring: arc = done/total; state picks the colour and ending (done = full ring with a check, failed = ring
 * with an x); working with no total = a short arc the stylesheet spins (`.ouros-ring-spin`, off for reduced motion).
 */
export function progressRingSvg({ state, done = 0, total = 0, size = 14, title = '' }) {
  const colour = { working: '#eab308', waiting: '#f97316', done: '#10b981', failed: '#ef4444' }[state] ?? 'currentColor';
  const pct = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  const track = '<circle cx="7" cy="7" r="5.25" stroke="currentColor" stroke-opacity=".22"/>';
  const ring = (dash, cls = '') => `<circle${cls} cx="7" cy="7" r="5.25" stroke="${colour}" pathLength="100" stroke-dasharray="${dash} 100" transform="rotate(-90 7 7)"/>`;
  let body;
  if (state === 'done') body = `${ring(100)}<path d="m4.75 7.1 1.5 1.5 3-3" stroke="${colour}"/>`;
  else if (state === 'failed') body = `${ring(100)}<path d="m5.25 5.25 3.5 3.5m0-3.5-3.5 3.5" stroke="${colour}"/>`;
  else if (total > 0) body = track + (pct > 0 ? ring(pct) : '');
  else if (state === 'waiting') body = ring(100);
  else body = track + ring(25, ' class="ouros-ring-spin"');
  const label = title || `${state}${total > 0 ? `, ${done} of ${total}` : ''}`;
  return `<svg class="ouros-ring" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 14 14" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${body}</svg>`;
}

globalThis.ourosIcon = iconSvg;
globalThis.progressRingSvg = progressRingSvg;
