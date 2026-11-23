import fs from 'node:fs';
import path from 'node:path';

/** Parses VS Code's JSON with comments and trailing commas; null when it does not parse. */
export function parseJsonc(text: string): unknown {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let out = '';
  for (let i = 0, str = false; i < text.length; i++) {
    const c = text[i];
    if (str) { out += c; if (c === '\\') out += text[++i] ?? ''; else if (c === '"') str = false; continue; }
    if (c === '"') { str = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    if (c === ',') {
      let j = i + 1;
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === '/' && text[j + 1] === '/') { while (j < text.length && text[j] !== '\n') j++; continue; }
        if (text[j] === '/' && text[j + 1] === '*') { j += 2; while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++; j += 2; continue; }
        break;
      }
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  try { return JSON.parse(out); } catch { return null; }
}

export interface VsKey { key: string; command: string; text?: string }
export interface VsFound { theme: string | null; sidebar: string | null; keys: VsKey[]; chords: VsKey[] }

/** Reads the user's VS Code settings and keybindings from `<appData>/Code/User`; null when VS Code has no user folder there. */
export function readVsCode(appData: string): VsFound | null {
  const dir = path.join(appData, 'Code', 'User');
  if (!fs.existsSync(dir)) return null;
  const read = (f: string) => { try { return parseJsonc(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
  const s = read('settings.json');
  const k = read('keybindings.json');
  const settings = s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
  const rows = (Array.isArray(k) ? k : []).filter((x): x is VsKey => Boolean(x) && typeof x.key === 'string' && typeof x.command === 'string' && !x.command.startsWith('-')).map((x) => ({ key: x.key.toLowerCase().trim(), command: x.command, ...(typeof (x as { args?: { text?: unknown } }).args?.text === 'string' ? { text: (x as { args: { text: string } }).args.text } : {}) }));
  return {
    theme: typeof settings['workbench.colorTheme'] === 'string' ? settings['workbench.colorTheme'] : null,
    sidebar: typeof settings['workbench.sideBar.location'] === 'string' ? settings['workbench.sideBar.location'] : null,
    keys: rows.filter((x) => !x.key.includes(' ')),
    chords: rows.filter((x) => x.key.includes(' ')),
  };
}

/** The cc theme closest to a VS Code theme name: light themes map to Crisp light, high contrast and dark ones keep cc's default; null when nothing should change. */
export function themeFor(vsTheme: string | null): string | null {
  if (!vsTheme) return null;
  if (/high contrast/i.test(vsTheme)) return null;
  return /light/i.test(vsTheme) ? 'light' : null;
}

/** One summary of what the import applied and what it skipped, with the reason for each skip (M8-20a,b). */
export function importSummary(found: VsFound, applied: { theme: string | null }): { applied: string[]; skipped: string[] } {
  const done: string[] = [];
  const skip: string[] = [];
  if (found.theme) (applied.theme ? done.push(`theme "${found.theme}" as ${applied.theme === 'light' ? 'Crisp light' : applied.theme}`) : skip.push(`theme "${found.theme}": cc keeps its dark look`));
  if (found.sidebar && found.sidebar !== 'left') skip.push(`side bar on the ${found.sidebar}: cc's side bar is fixed on the left`);
  for (const k of [...found.keys, ...found.chords]) {
    if (k.key === 'shift+enter' && k.command === 'workbench.action.terminal.sendSequence' && k.text === '\u001b\r') done.push('shift+enter: cc already sends Esc then Enter in terminals');
    else skip.push(`${k.key} (${k.command}): cc cannot rebind keys yet`);
  }
  return { applied: done, skipped: skip };
}
