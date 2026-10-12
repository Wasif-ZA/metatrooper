# M7-09: Files panel, read the agent's worktree beside its tile

Part of the MetaTrooper desk epic, Milestone 7. Priority: Medium. Effort: 2.75 CC days (build; milestone review share in spec.md). Depends on: M6-21.
Decisions: D79 (the panel), D80 (CodeMirror 6 under a star-gate waiver). UI mockup:
`issues/m7-09-files-panel-mockup.html`.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-9, D79 and D80.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

Wasif sometimes wants to read a file an agent is working on: check a function it named, skim a config, read a
test it wrote. Today that means leaving MetaTrooper for VS Code. The desk shows what agents did (Diff, Git) but
never the file itself. Agent desks surveyed 2026-10-12 do the same thing: a light viewer docked beside the agent,
not an IDE. Warp has a native editor panel beside the terminal and says it is "not trying to rebuild an IDE"
(docs.warp.dev/code/code-editor). Claude Code desktop has a diff viewer plus a file-editor pane for spot edits
(code.claude.com/docs/en/desktop). Conductor has a file explorer and no editor. The Codex app sends clicks to an
external editor.

## Current state (verified 2026-10-12 at 077454a)

| Piece | Where | State |
|---|---|---|
| Ctrl+click a path in a tile | `workbench/renderer/terminal.js:72-80` | Link provider calls `troop.openLink(target, line, col)` |
| Open in VS Code | `workbench/src/main.ts:487-495` | `openLink` runs `code -g file:line:col` via `resolveLaunch('code')`, else shows the file in Explorer |
| Path guard | `workbench/src/main.ts:215-218` | `inside(root, file)`; used only for snapshots (`main.ts:324`) |
| File owners | `core/src/sessions/owners.ts:273` | `ownersAsync(db, repo)` returns each dirty path's owning sessions; main already imports it (`main.ts:23`) |
| Session folder | `workbench/src/queries.ts:28` | Each session row carries `cwd` |
| Pair layout | `workbench/renderer/wall.js:143-152` | `BIG` holds up to two big slots; `pair(id)` / `unpair()` |
| Strip tabs | `workbench/renderer/index.html:27`, `app.js:336` | Diff, Git, Hand back, Browser; no Files |
| Renderer scripts | `workbench/renderer/index.html:50-57` | Classic scripts, no bundler. `vendor/gsap.min.js` is a committed vendored file |
| CSP | `workbench/renderer/index.html:5` | `script-src 'self'`, no `worker-src` |
| File read IPC | `workbench/src/main.ts` | None |

## Proposed change

A Files panel that docks in the second big slot, beside the focused tile. It shows that session's folder: a tree,
tabs, a CodeMirror 6 view, read-only by default. One file at a time can be unlocked for a guarded save. "Open in
VS Code" covers real editing.

```
+----------------------------+---------------------------------------------+
| tile: claude  Fix cart ... | FILES  ~/code/shopfront  fix/cart-rounding  x|
|                            | Changed (3)        | promo.ts  Form.tsx  x   |
|  > Read(src/cart/promo.ts) |  M src/cart/promo.ts| 39  export function ... |
|  > Update(promo.ts) 41-42  |  A src/cart/promo.test.ts 40   const free = |
|                            | All files          | 41   return round(...  |
|                            |  > src/            |                         |
|                            |    > cart/         | [Edit] [Open in VS Code]|
+----------------------------+---------------------------------------------+
```

### Implementation details

1. **Vendored CodeMirror (D80).** Add exact-pinned devDependencies to `workbench/package.json`: `codemirror`,
   `@codemirror/view`, `@codemirror/state`, `@codemirror/search`, `@codemirror/language`,
   `@codemirror/lang-javascript`, `@codemirror/lang-python`, `@codemirror/lang-json`, `@codemirror/lang-markdown`,
   `@codemirror/lang-css`, `@codemirror/lang-html`. New entry `workbench/renderer/vendor-src/codemirror.mjs`
   re-exports what the panel uses. New script `workbench/scripts/vendor-codemirror.ts` runs
   `npx --yes esbuild@0.25.0 renderer/vendor-src/codemirror.mjs --bundle --minify --format=iife
   --global-name=CM --outfile=renderer/vendor/codemirror.js` and is wired as `npm run vendor:cm`. The output is
   committed, like `vendor/gsap.min.js`. Versions are exact (no `^`), taken from npm on the day work starts.
   `workbench/package-lock.json` pins the resolved versions; rebuilding with
   `npm ci && npm run vendor:cm` must give the same sha256. No CSP change: no workers, no inline script. Add the MIT notice to
   `THIRD-PARTY-NOTICES.md`.

2. **Main process IPC (`workbench/src/main.ts`, new `workbench/src/files.ts`).** Every call takes a `sessionId`;
   main resolves the root from the session row's `cwd`. The renderer never sends a root.

   ```ts
   import type { Owner } from '../../core/src/sessions/owners.ts';   // { id, title, state }, owners.ts:11
   type Err = { error: 'no_session' | 'no_folder' | 'outside' | 'missing' | 'not_file' | 'denied' };
   type Entry = { name: string; kind: 'file' | 'dir'; size: number };
   files.list(sessionId: string, dir: string): Promise<Entry[] | Err>
   files.read(sessionId: string, rel: string): Promise<
     { text: string; mtimeMs: number; size: number } | Err | { error: 'binary' | 'too_big'; size: number }>
   files.stat(sessionId: string, rel: string): Promise<{ mtimeMs: number; size: number } | Err>
   files.write(sessionId: string, rel: string, text: string, baseMtimeMs: number,
     overrides: { changed?: boolean; owned?: boolean }): Promise<
     { ok: true; mtimeMs: number } | { conflict: 'changed_on_disk'; mtimeMs: number } | { owned: Owner[] } | Err>
   files.find(sessionId: string, query: string): Promise<string[] | Err>   // quick open, max 50
   files.changed(sessionId: string): Promise<Array<{ path: string; status: 'M' | 'A' | 'D' | '?' }> | Err |
     { error: 'git_failed' }>
   ```

   - Errors: an unknown `sessionId` is `no_session`; a session with a null or missing `cwd` is `no_folder`;
     `EACCES` or `EPERM` is `denied`; a directory passed to `read`, `stat` or `write` is `not_file`.
   - Guard, in this order. A `rel` that is absolute (`path.isAbsolute`), has a drive letter, or holds a NUL byte
     is `outside`. A `cwd` that no longer exists is `no_folder`. Then `root = fs.realpathSync(cwd)` and
     `target = path.resolve(root, rel)`; a target failing `inside(root, target)` is `outside`, whether or not it
     exists. A target that does not exist is `missing`. Otherwise `fs.realpathSync(target)` must pass `inside(root, real)`, or it is
     `outside`. This catches a symlink pointing out of the root. Paths compare with `normPath` (owners.ts:16),
     so Windows case differences do not escape.
   - `list` returns one directory level, dirs first then files, each sorted case-insensitively. It hides `.git`.
     `node_modules`, `dist` and `build` are listed but collapsed.
   - `read` refuses over 5 MB (`too_big`). It returns `binary` when the first 8 KB holds a NUL byte. Text is
     decoded as UTF-8 with `fatal: true`; a file that fails to decode opens read-only with "Not UTF-8, read-only"
     and cannot be unlocked. A UTF-8 BOM is kept and written back. The editor keeps the file's line ending (CRLF
     when the first line ending is `\r\n`, via `EditorState.lineSeparator`), so an unedited save is byte-identical.
   - `write` runs its checks in a fixed order, and each override skips only its own check.
     1. Unless `overrides.changed`, it returns `conflict` when the file's mtime differs from `baseMtimeMs`.
     2. Unless `overrides.owned`, it checks owners:
        - `repo = await repoOfAsync(cwd)`, then `ownersAsync(db, repo)`.
        - It compares `normPath(path.relative(repo, real))` with each `OwnedPath.path`.
        - It returns `owned` with the owners that are not `sessionId` and whose `state` is `working` or
          `waiting_for_you`.
        - Outside a git repo, there are no owners.
     3. It writes to `.<name>.mt-<crypto.randomUUID()>.tmp` in the folder of the resolved real path (a symlink
        is never replaced; its target is written) and copies the target's mode onto the temp file.
     4. It re-reads the mtime. If the mtime moved since step 1 and `overrides.changed` is not set, it deletes the
        temp file and returns `conflict`.
     5. Otherwise it renames the temp file over the real path. If any step from 3 on throws, it deletes the
        temp file and returns `denied` (`EACCES`, `EPERM`, `EBUSY`) or rethrows anything else.
     - A writer landing between steps 4 and 5 is the accepted race: the window is one `rename` call.
     - `write` never creates or deletes user files.
   - `find` matches file names from `git ls-files --cached --others --exclude-standard` (falling back to a walk
     capped at 20,000 entries when the folder is not a git repo or git fails), run in `cwd` so paths are relative
     to it. Matching ignores case. Order: basename starts with the query, then basename contains it, then the path
     contains it; ties go to the shorter path, then alphabetical.
   - `changed` reuses the M6-21 changed-files source for the session. It returns `[]` for a clean worktree. If git
     fails it returns `{ error: 'git_failed' }`, and the Changed group shows "git unavailable".

3. **Wall slot (`workbench/renderer/wall.js`).** Reserved id `files` may sit in `BIG[1]`. New
   `openFiles()` calls `unpair()` if two tiles are paired, then pushes `files`. New `closeFiles()` removes it.
   `pair(id)` closes the Files panel first. Layout places `#files-panel` in the big2 rectangle with the existing
   animation. A splitter between the slots drags from 30% to 70% of the wall width (default 50%), saved in
   `localStorage` as `files.width`. Only one panel exists. It follows the focused tile: focusing another tile
   switches the panel's root and restores that session's open tabs (kept in memory per session, max 8 tabs; a
   ninth tab closes the oldest clean tab, and when all 8 are dirty the ninth opens nothing and says so).

4. **Panel UI (new `workbench/renderer/files.js` and `files.css`, loaded after `wall.js`).** It follows
   `issues/m7-09-files-panel-mockup.html`.
   - Header: `FILES`, the root folder, the branch, and a close button.
   - Left column (220 px, resizable 160-360 px): a **Changed** group from `files.changed` with M/A/D/? letters,
     then **All files** as a lazy tree.
   - Right column: a tab bar (dot = unsaved, lock icon = read-only), the CodeMirror view and a footer
     (`Ln 41, Col 12`, language, `Read-only` or `Editing`, and the `Edit` / `Save` / `Open in VS Code` buttons).
   - The theme maps to the `wall.css` tokens (`--pane`, `--ink`, `--mute`, `--hairline`, `--wait`, `--del`,
     `--mono`).
   - States: an empty root shows "No folder for this session". `binary` and `too_big` show a one-line notice and
     the `Open in VS Code` button. A `D` row in Changed opens a read-only notice, "Deleted in the worktree".
     `missing` on an open tab shows the same notice and keeps the tab, so unsaved text is not lost.
     `no_folder` shows "No folder for this session". `denied` shows "No permission to read this file".

5. **Edit flow.** Every tab opens read-only (`EditorState.readOnly`). `Edit` unlocks that tab only, and the
   footer turns `--wait` orange with `Editing`. One tab per session can be unlocked at a time: `Edit` on a second
   tab first locks the current one, and if it has unsaved text it asks Save / Discard / Cancel. `Ctrl+S` calls
   `files.write(..., {})`.
   - `conflict`: a bar says "Changed on disk since you opened it". Buttons: `Reload` (discard yours) and
     `Keep mine`, which retries with `{ changed: true }`. If that retry returns `owned`, the owner bar replaces it.
   - `owned`: a bar names the owning session ("claude: Fix cart rounding is working on this file"). Buttons:
     `Save anyway`, which retries with the overrides already granted plus `{ owned: true }`, and `Cancel`.
   - Unsaved text asks Save / Discard / Cancel before any of these: closing its tab, closing the panel, pairing
     a tile (which closes the panel) or quitting. Closing the panel or quitting lists every dirty tab across all
     sessions in one prompt: Save all / Discard all / Cancel. Save all saves them in order; the first `conflict`
     or `owned` stops the run, cancels the close, and shows that tab with its bar. Switching the focused tile keeps the dirty tab in that session's
     memory, with no prompt.
   - Polling: while the panel is visible, the shown tab calls `files.stat` every 2 s and the Changed group calls
     `files.changed` every 2 s. A clean tab whose mtime moved reloads silently and keeps the scroll position. A
     dirty tab whose mtime moved shows the conflict bar at once.

6. **Entry points.**
   - Each tile header gets a `Files` button beside `Diff`. `Ctrl+Shift+E` toggles the panel for the big tile.
     `Esc` with focus in the panel closes it.
   - Ctrl+click a path in a tile (`terminal.js:79`) opens it in the panel at `line:col` when it is inside that
     session's root. Any other path, and Ctrl+Shift+click, keeps today's `openLink` behaviour (VS Code).
   - The Diff tab's file rows get an `Open` action that opens the panel on that file.
   - `Ctrl+P` with focus in the panel opens quick open (`files.find`). `Ctrl+F` uses CodeMirror's search panel.
   - `Open in VS Code` calls the existing `openLink(absPath, line, col)`.

## Acceptance criteria

- [ ] M7-09a. With a session whose cwd is `C:/x/repo`, `files.read(id, '../secret.txt')`, an absolute path outside
  the root, and a symlink inside the root that points outside it each return `{ error: 'outside' }`.
- [ ] M7-09b. `files.read` on a 6 MB file returns `too_big`. On a PNG it returns `binary`. On a 2 MB `.ts` file it
  renders. Perf check on the Windows 11 laptop used for the M6-14 spike: the test generates a 50,000-line, 2 MB `.ts` fixture, opens it, and
  scrolls from top to bottom by setting `scrollTop` in 50 steps over 2 s. `workbench/scripts/longtask-session.ts`
  records no long task over 100 ms during the scroll.
- [ ] M7-09c. Opening the panel while two tiles are paired unpairs them. The focused tile stays in `BIG[0]` and
  the panel takes `BIG[1]`. Pairing a tile while the panel is open closes the panel.
- [ ] M7-09d. Ctrl+click on `src/cart/promo.ts:41:12` in a tile opens the panel on that file, with the cursor on
  line 41, column 12. Ctrl+Shift+click on the same text runs `code -g`.
- [ ] M7-09e. A tab is read-only on open: typing changes nothing. After `Edit`, typing and `Ctrl+S` write the file.
  A byte-for-byte read after the save matches the editor text.
- [ ] M7-09f. If the file's mtime changes on disk after the tab opened, `Ctrl+S` shows the conflict bar and the file
  on disk is unchanged until `Keep mine`.
- [ ] M7-09g. If another live session owns the file per `ownersAsync`, `Ctrl+S` shows the owner bar naming that
  session, and nothing is written until `Save anyway`.
- [ ] M7-09h. The Changed group lists exactly the M6-21 changed files for the session. Editing a file outside
  MetaTrooper adds it within 2 s of the next poll.
- [ ] M7-09i. `Ctrl+P` then `promo` lists `src/cart/promo.ts` first in a repo that also has `docs/promotions.md`.
- [ ] M7-09j. Focusing another tile switches the panel's root and restores that session's last open tabs.
- [ ] M7-09k. No CSP change in `index.html`. `renderer/vendor/codemirror.js` is under 400 KB minified.
  `npm ci && npm run vendor:cm` run twice gives the committed file's sha256 both times.
- [ ] M7-09n. With unsaved text in a tab, closing the panel, pairing a tile and unlocking a second tab each ask
  Save / Discard / Cancel. `Cancel` leaves the text and the layout unchanged.
- [ ] M7-09o. `files.read` with an unknown session returns `no_session`. With a null `cwd` it returns
  `no_folder`. With a folder path it returns `not_file`. On an existing absolute `C:/Windows/win.ini` it returns
  `outside`, never `missing`.
- [ ] M7-09l. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-09m. The existing workbench and core suites still pass.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (`workbench/test/files.test.ts`) | Guard (`..`, absolute, drive letter, symlink out, Windows case), error codes, list order, binary and size limits, write check order and each override, temp-file cleanup on late conflict, owned check, find ranking | +13 |
| Integration (Electron, existing harness) | Ctrl+click opens the panel at line:col; Edit, then save, then read back; conflict bar; owner bar; pair and panel exclusion; unsaved-text prompts | +6 |
| Perf | 2 MB file scroll under the longtask script | +1 |

Codex writes the tests (D65 pattern: Claude writes the implementation).

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test. Never "make the tests pass".
2. Real code and real tests land in the same change. A placeholder, a stub assertion or a deferred test is not done.
3. Any change to a test, validator, CI step, timeout, tolerance, threshold, snapshot or suppression pragma is
   reported on its own line in your summary with its justification, before any other result.
4. A reported command names the command and its observed result. A command you did not run is not reported, and
   stderr is never silenced in a command you cite.
5. Your report is a claim until the parent re-executes it: say what you verified, what you reused, and what you
   could not check.
6. Never commit, push or open PRs from an agent; hand back the command.
7. Nothing here starts before the public release on 2027-01-19.
8. No em dashes; comments say what the code does, not why.

## Rollback plan

The panel is additive. Reverting the change removes `files.ts`, `files.js`, `files.css`, the vendored bundle and
the three new entry points. Ctrl+click goes back to `openLink` for every path. A save is a rename within one folder, so an app crash mid-save
leaves either the old file or the new one (power loss can still lose the newest write). Stray
`.<name>.mt-<uuid>.tmp` files are the only residue.

## Effort estimate

| Part | CC days |
|---|---|
| Vendor bundle, script, notices | 0.25 |
| `files.ts` IPC, guard, find, write checks | 0.75 |
| Wall slot, splitter, follow focus | 0.5 |
| Panel UI: tree, tabs, footer, theme, states | 0.75 |
| Edit flow and bars | 0.25 |
| Entry points (tile button, Ctrl+click, Diff row, keys) | 0.25 |
| **Build total** | **2.75** |

Review and two-engine checks are counted once for the milestone in `spec.md` (15%: 2.75 x 0.15 = 0.41).

## Files reference

| File | Change |
|---|---|
| `workbench/package.json` | Pinned CodeMirror devDependencies, `vendor:cm` script |
| `workbench/renderer/vendor-src/codemirror.mjs` | New bundle entry |
| `workbench/scripts/vendor-codemirror.ts` | New build script |
| `workbench/renderer/vendor/codemirror.js` | New, committed output |
| `workbench/src/files.ts` | New: list, read, write, find, changed, guard |
| `workbench/src/main.ts:487` | Register `files.*` handlers beside `openLink` |
| `workbench/src/preload.cjs:49` | Expose `files.*` |
| `workbench/renderer/wall.js:143-152` | `files` in `BIG[1]`, `openFiles`, `closeFiles`, pair exclusion |
| `workbench/renderer/terminal.js:79` | Ctrl+click inside the root opens the panel |
| `workbench/renderer/files.js`, `files.css` | New panel |
| `workbench/renderer/index.html:50-57` | Load `vendor/codemirror.js`, `files.js`, `files.css` |
| `workbench/renderer/app.js` | Tile `Files` button, Diff row `Open`, `Ctrl+Shift+E` |
| `THIRD-PARTY-NOTICES.md` | CodeMirror MIT notice |
| `workbench/test/files.test.ts` | New (Codex) |

## Out of scope

- Language servers: hover, go-to-definition, completion, diagnostics.
- Search across files (`Ctrl+Shift+F`), and creating, renaming or deleting files.
- A side-by-side diff editor (`@codemirror/merge`); the Diff tab stays the review surface.
- Folders other than the session's own `cwd`; a panel with no session.
- Multiple panels, or files as tiles in the grid.
- Vim keys, minimap, format on save, git blame.
