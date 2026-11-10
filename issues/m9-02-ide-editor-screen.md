# M9-02: IDE screen that edits: tabs, CodeMirror 6, save, find, search

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 2 d. Depends on: M9-01 for save and search.
**Build 2026-11-10 (running). Tests and visual judge 2026-11-12.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/build-brief-ide.md`, "Part A". That brief is the spec, with every size, id and key.
- `research/cm6-spike.md` (measured facts), `research/ide-groundwork.md`.
- Frame reference: `research/ref-shots/herdr/06-showcase-layout-code.webp`.
- `research/vscode-gap.md` rows 3, 4, 5 and 10. Decision D80: CodeMirror 6 is the editor.

## Goal

He opens, edits and saves markdown, TypeScript, JSON, CSS and HTML in Ouros, with the keys he already uses in VS Code.

## Scope

Everything in Part A of the brief. In short:

| # | Part |
|---|---|
| 1 | Explorer: Files and Search views, tree loaded one folder at a time |
| 2 | Tabs with a dirty dot, breadcrumb, Save and Reload |
| 3 | Editable CodeMirror 6 with syntax colours for js, ts, json, md, css, html |
| 4 | Ctrl+P, Ctrl+Shift+F, Ctrl+S, Ctrl+W, Ctrl+F, Ctrl+Shift+P |
| 5 | Changes mode: the diff of an agent's edits, in the same tab |
| 6 | Agents panel under the editor |

## Out of scope

- The brief's "Leave out" list stands: autosave, autocomplete, lint, format, split editors, minimap, light scheme.
- Rendered markdown preview. Markdown opens as coloured source this week.
- A terminal inside the IDE. Shells stay on the Wall (M9-03).
- Language servers. Python, Java and LaTeX work goes to VS Code through M9-05.

## Contract

- Files touched: only those listed under "A. Hard rules" in the brief.
- Keeps `globalThis.ideView = { draw, shown }` and the ids `ide`, `ide-find`, `ide-agents`, `ide-search`.
- Dependencies: the 12 pinned CodeMirror and Lezer packages in the brief, all MIT. Nothing else.
- Old `renderer/ide.js` and `ide.css` stay on disk until their four test files are moved, then they are deleted in the same commit as the move.

## Acceptance checks

- [ ] M9-02a. On screen: Ctrl+P, type part of a name, Enter. The file opens in a tab with colours.
- [ ] M9-02b. Type in it: the tab shows the dirty dot. Ctrl+S clears it. Undo still works after a tab switch.
- [ ] M9-02c. Ctrl+Shift+F, type a word, Enter. Click a hit: the file opens with the caret on that line.
- [ ] M9-02d. Close a dirty tab: the three-way question appears. Cancel keeps the tab and the edit.
- [ ] M9-02e. Typing `c`, space or Escape in the editor never triggers an app shortcut.
- [ ] M9-02f. Switch project and come back: unsaved edits are still there.
- [ ] M9-02g. A file an agent changed shows File and Changes; Changes shows the added and removed lines.
- [ ] M9-02h. Orange appears only on an agent that is waiting for him.
- [ ] M9-02i. The four old IDE test files are rewritten against the new screen; a mutation run catches every mutant.
- [ ] M9-02j. Gemini and Codex judge a screenshot beside the Herdr reference. Points both raise are fixed.

## Engines

- Build: Opus worker. Tests: Codex. Visual judge: Gemini and Codex. If Codex is at its limit: Gemini writes the tests.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- The builder never writes its own tests. Every test batch gets a mutation check.
- No Vite. No dependency beyond the pinned list. No em dashes. One-line comments.
