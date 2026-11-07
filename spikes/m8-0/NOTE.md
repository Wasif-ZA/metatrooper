# M8-0 host spikes: VS Code/VSCodium webview vs Ouros's own renderer

Evidence for Wasif's M8-0 call (criterion M8-00c, both hosts). Nothing here decides it; spec.md is untouched.
Both spikes open the kit screen `specs/f-done.json` as a tab (M8-00d). Built 2026-11-08 overnight.

| | A: VS Code webview (`vscode-webview/`) | B: own renderer (`own-renderer/` + 3 lines in `workbench/`) |
|---|---|---|
| Ran for real? | Yes. `code` 1.145.2 with `--extensionDevelopmentPath`, isolated user-data-dir, screenshot over CDP. `codium` is not installed, so it ran on Microsoft's build. | No. `workbench/node_modules` is absent (Electron not installed, installs banned), so the screenshot is headless Chrome loading the real `index.html` + `app.js` with stubbed `window.troop`, `Terminal`, `FitAddon`. |
| How the tab opens | `vscode.window.createWebviewPanel('ourosKit', spec.tab, ViewColumn.One, {enableScripts:true})`; CSS and JS inlined into `panel.webview.html`; `surface()` renders into `.main`. | `TABS.push(['kit','Kit'])`; the existing strip calls `openTab('kit')` then `render()`; one new branch in `render()` returns a host div; kit CSS and `surface()` go into a shadow root on it. |
| How events reach the core | Webview `acquireVsCodeApi().postMessage({event})` from a delegated `[data-event]` click; extension host `panel.webview.onDidReceiveMessage`. Seen working: `event {"event":"Open PR #41"}` landed in the log. The extension host would then need its own link to the Ouros core (socket or child process). | `#view` click listener (uses `composedPath()` to see into the shadow root) calls `window.troop.call('kit.event', {event})`, the existing preload `call` channel to `ipcMain`, which forwards RPC to the core. Renderer side seen working in the harness. Main rejects it today (-32601) until `kit.event` is added to `UI_METHODS` and the core implements it. |
| Title-bar IDE \| WALL switch | Extensions cannot put widgets in VS Code's title bar. Nearest: a status bar item (`createStatusBarItem`), an `editor/title` action icon, a command, or a custom editor. The switch would not sit where the kit draws it. | The app draws its own `<header class="title">` (`renderer/index.html:14`), so the switch can sit there as plain HTML. The window uses the native OS frame; the kit's drawn window buttons would need `frame:false`. |
| Lines written | 22 (`package.json` 1, `extension.js` 21) + 6 for the CDP screenshot script. | 15 (`kit-tab.js`) + 3 in workbench (`app.js` 1 added, 1 changed; `index.html` 1). |
| Kit files copied | 6518 lines (7 CSS, `kit.js`, `assets.js`, `f-done.json`), verbatim. | 3942 lines (7 CSS with `:root` rewritten to `:host`, `kit.js` wrapped in an IIFE, `f-done.json` as `f-done.js`). |
| Screenshot | `C:/Users/User/.cache/claude-scratch/ouros-overnight-2026-11-08/m8-0-spikes/judge/spike-a-vscode.png` | `C:/Users/User/.cache/claude-scratch/ouros-overnight-2026-11-08/m8-0-spikes/judge/spike-b-own.png`. It was taken mid-build. Afterwards, `kit-tab.js` gained wrapper attributes (`data-d`, `data-u`, `--t3`) from a duplicate session. The committed file was not re-shot: a quick re-shoot with a rebuilt harness did not open the tab. |

## What broke

- **A:** at first the text was dark on dark. The theme variables live under `[data-d="1"]`, so the fix was `<html data-d="1">`. `ide.css` sets `overflow:hidden` on body, so `.main` needed `height:100vh;overflow:auto`. The Geist fonts are not bundled, so the screen falls back to system-ui. VS Code adds its own Chat panel, toast and activity bar around the tab. The `data-event` value is the button label, not an id.
- **B:** `kit.js` top-level `const esc` and `function render` clash with `app.js` (redeclared const is a SyntaxError; `render` would replace the app's). Fixed by wrapping kit.js in an IIFE that exposes `window.kitSurface`. `ide.css` has global `*`/`html`/`body` resets that restyled the whole workbench, so the spike uses a shadow root. The CSP (`connect-src 'none'`) blocks fetching the JSON, so the spec ships as a JS file. The kit is drawn for 1440px and is cramped in the 860px split pane. The xterm `node_modules` tags 404 without an install.

## Dependency gate (gh, 2026-11-08)

| Repo | Licence | Stars | Last push | Latest release | Open issues | Archived |
|---|---|---|---|---|---|---|
| VSCodium/vscodium | MIT | 33,996 | 2026-10-31 | 1.143.17232 (2026-10-28) | 151 | no |
| microsoft/vscode (source) | MIT | 195,129 | 2026-11-07 | 1.145.2 (2026-11-06) | 21,849 | no |

- VSCodium passes the gate: MIT licence, over 25k stars, maintained (pushed 8 days ago).
- It trails upstream by about two minor versions (1.143 vs 1.145).
- The `code` binary on this machine is Microsoft's build, which ships under a proprietary licence, not MIT. Spike A ran there, not on VSCodium.
- Option B is Ouros's own code, so it is exempt from the gate. Electron 44.4.5 is already a workbench devDependency.

## Drawbacks, facts only

- **A, webview:**
  - Ouros becomes a guest. It cannot draw the IDE | WALL switch in the title bar.
  - Chrome it does not own (Chat panel, activity bar, toasts) sits around every screen.
  - Each event needs a second hop: webview to extension host, then extension host to the core.
  - It ships against a fork that lags upstream.
  - Users install VSCodium plus an extension.
- **B, own renderer:**
  - Every IDE piece (editor, explorer, terminal, settings) is Ouros's to build and maintain.
  - The kit CSS must be isolated from the workbench (shadow root here).
  - `kit.js` globals had to be wrapped.
  - This spike was not run in real Electron tonight, so the Electron path is unproven end to end.

## Gemini fidelity verdict

**How it ran:**
- Gemini 3.8 Flash via `agy-run.sh --lane visual` (the `/agy-visual` render mode, judging existing PNGs), 98s.
- It saw three images: the kit reference `kit/shots/features/f-done.png` and the two spike screenshots.
- It was asked to judge the fidelity of the screen content only, not the host chrome.
- Full output: `C:/Users/User/.cache/claude-scratch/ouros-overnight-2026-11-08/m8-0-spikes/judge/verdict.txt`.

**Gemini's verdict:**
- **A: 10/10.** "Visually faithful ... with no visible deviations." It notes that the Chat sidebar narrows the editor but does not clip the screen.
- **B: 5/10.** In priority order:
  1. A serif (Times) fallback font across the whole surface.
  2. The checkbox squares are missing; bare check glyphs show instead.
  3. Square corners on the cards, pills and buttons.
  4. No monospace on the hashes, commands and file refs.
  - It also notes that the workbench's left pane takes about 40% of the width.
- **Gemini's closing line:** "Spike A is much closer to the reference."

**Checked against the PNGs by Claude:**
- **B, serif font: wrong.** The B screenshot is sans-serif.
- **B, checkbox squares: right.** They are missing in B; A draws them.
- **B, corners and monospace: right.** B shows square corners and no monospace.
- **A, "no deviations": overstated.** A also lacks the monospace on hashes and commands, because Geist Mono is not bundled in either spike.

The B gaps most likely come from moving the kit CSS into a shadow root (`:root` rewritten to `:host`). The B screenshot is also a Chrome harness, not real Electron. These are spike-build issues, not limits of the host; this is my reading, and it is untested.
