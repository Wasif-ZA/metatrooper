import { ACTIONABLE } from './snapshot.ts';

export type Step =
  | { tool: 'navigate'; url: string }
  | { tool: 'back' }
  | { tool: 'click' | 'type' | 'select'; role: string; name: string; submit?: boolean; value?: string; password?: boolean }
  | { tool: 'key'; keys: string };

const MODS: Record<string, string> = { alt: 'Alt', control: 'Control', ctrl: 'Control', meta: 'Meta', cmd: 'Meta', command: 'Meta', shift: 'Shift' };
const NAMED: Record<string, string> = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', space: 'Space', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
const J = JSON.stringify;

/** The Playwright spelling of a recorded key combo, or null when a part is not a known modifier or named key. */
function canonKeys(keys: string): string | null {
  const parts = keys.split('+').map((p) => p.trim().toLowerCase());
  const own = (m: Record<string, string>, k: string) => (Object.hasOwn(m, k) ? m[k] : '');
  const last = own(NAMED, parts.pop()!);
  const mods = parts.map((p) => own(MODS, p));
  return last && mods.every(Boolean) ? [...mods, last].join('+') : null;
}

/** Builds the Playwright test file text for the recorded steps. */
export function exportTest(steps: Step[]): string {
  let fills = 0;
  const lines = steps.flatMap((s): string[] => {
    if (s.tool === 'navigate') return [`await page.goto(${J(s.url)});`];
    if (s.tool === 'back') return ['await page.goBack();'];
    if (s.tool === 'key') { const k = canonKeys(s.keys); return k ? [`await page.keyboard.press(${J(k)});`] : ['// a key press was not recorded']; }
    if (!s.name) return [`// a ${s.tool} on an element with no name was not recorded`];
    const at = s.password === true ? `page.getByLabel(${J(s.name)}, { exact: true })` : ACTIONABLE.has(s.role) ? `page.getByRole(${J(s.role)}, { name: ${J(s.name)}, exact: true })` : `page.getByText(${J(s.name)}, { exact: true })`;
    if (s.tool === 'click') return [`await ${at}.click();`];
    if (s.tool === 'select') return [`await ${at}.selectOption(${J(s.value)});`];
    return [`await ${at}.fill(process.env.MT_FILL_${++fills} ?? '');`, ...(s.submit ? [`await ${at}.press('Enter');`] : [])];
  });
  const body = (lines.length ? lines : ['// nothing recorded yet']).map((l) => `  ${l}`).join('\n');
  return `import { test } from '@playwright/test';\n\ntest('recorded by MetaTrooper', async ({ page }) => {\n${body}\n});\n`;
}
