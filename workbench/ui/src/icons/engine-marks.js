// Our own mark per engine on a 16 px grid: a distinct shape and colour each, never a vendor logo.
export const ENGINE_MARKS = {
  claude: { name: 'Claude', colour: '#E8743B', shape: (c) => `<circle cx="8" cy="8" r="5.5" fill="${c}"/>` },
  codex: { name: 'Codex', colour: '#2F9E6E', shape: (c) => `<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="${c}"/>` },
  agy: { name: 'agy', colour: '#3B7BE8', shape: (c) => `<path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="${c}"/>` },
  gemini: { name: 'Gemini', colour: '#9B5DE5', shape: (c) => `<path d="M8 2 14 13.5H2z" fill="${c}"/>` },
  copilot: { name: 'Copilot', colour: '#1FA2B8', shape: (c) => `<path d="m8 1.5 5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z" fill="${c}"/>` },
  opencode: { name: 'OpenCode', colour: '#D4A017', shape: (c) => `<circle cx="8" cy="8" r="4.25" fill="none" stroke="${c}" stroke-width="2.5"/>` },
  pi: { name: 'Pi', colour: '#E0457B', shape: (c) => `<rect x="1.5" y="5" width="13" height="6" rx="3" fill="${c}"/>` },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function engineName(id) {
  const key = String(id || '').trim().toLowerCase();
  return ENGINE_MARKS[key]?.name ?? (String(id || '').trim() || 'Unknown engine');
}

/** The inner SVG markup for an engine id; an unknown engine gets an outlined square with its first letter. */
export function engineMarkInner(id) {
  const key = String(id || '').trim().toLowerCase();
  const m = ENGINE_MARKS[key];
  if (m) return m.shape(m.colour);
  const letter = esc(Array.from(key)[0]?.toUpperCase() ?? '?');
  return `<rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-opacity="0.5"/><text x="8" y="11.25" text-anchor="middle" fill="currentColor" font-size="8.5" font-weight="600" font-family="system-ui, sans-serif">${letter}</text>`;
}

/** A whole SVG string for plain-script screens (the sidebar), titled with the engine name. */
export function engineMarkSvg(id, size = 14) {
  const name = esc(engineName(id));
  return `<svg class="emark" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" role="img" aria-label="${name}"><title>${name}</title>${engineMarkInner(id)}</svg>`;
}
