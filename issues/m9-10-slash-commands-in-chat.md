# M9-10: Typing / in the chat box lists Claude's real slash commands

Part of Ouros, Milestone 9 (daily driver). Priority: High. Effort: 0.5 d. Depends on: nothing.
**Spec 2026-11-18. Code and tests done (17 pass, 8/8 mutants caught). Bundle rebuild and manual checks a, b, c, e and the full suite (i) pending.**

## Source of truth

- His ask, 2026-11-18, with a screenshot of cc's Home screen: "it should be / commands from here ... from the chat screen".
- His call, 2026-11-18 (D1): list user, project and plugin skills plus command files. No built-ins. Other agents keep today's list.

## Goal

He drives cc from its chat box. Typing `/` there should offer the same commands he would type in a Claude terminal (`/spec`, `/codex:review`, `/two-engine`), so a new agent can start straight into a skill.

## Current state (checked 2026-11-18)

- The box says "@ for files, / for commands" (`workbench/ui/src/home.jsx:128`).
- `/` only lists the box's own buttons: Attach files, Branch and model, Start (`workbench/ui/src/composer.jsx:132-135`). Nothing reads any skill folder.
- A launch prompt reaches Claude as a positional argument (`core/src/engines/registry.ts:71`), so a prompt that starts with `/spec` already runs that skill. No core change is needed.
- All three composer call sites already pass the agent id as `engine.id`: Home (`home.jsx:138`), Inbox answer (`inbox.jsx:339`), Automations (`automations.jsx:229`).
- On this laptop: 60 skill folders in `~/.claude/skills`, 69 in the vault's `.claude/skills`, 0 command files in either. Enabled plugins (from `~/.claude/settings.json` `enabledPlugins`): `vercel` (37 skills, 9 commands), `codex` (3 skills, 8 commands), `understand-anything` (9 skills). `mattpocock-skills` and `claude-mem` are installed but disabled.

## Change

### `workbench/src/commands.ts` (new)

`listCommands(home: string, projectRoot: string | null): { name: string; description: string; source: 'project' | 'user' | 'plugin' }[]`

Reads, in this order; the first entry with a given name wins:

| Order | Where | Name |
|---|---|---|
| 1 | `<projectRoot>/.claude/skills/<dir>/SKILL.md` | `<dir>` |
| 2 | `<projectRoot>/.claude/commands/<file>.md` | `<file>` |
| 3 | `<home>/.claude/skills/<dir>/SKILL.md` | `<dir>` |
| 4 | `<home>/.claude/commands/<file>.md` | `<file>` |
| 5 | each plugin enabled in `<home>/.claude/settings.json` `enabledPlugins`, at the first `installPath` in `<home>/.claude/plugins/installed_plugins.json`: `skills/<dir>/SKILL.md` and `commands/<file>.md` | `<plugin>:<dir>` or `<plugin>:<file>`, where `<plugin>` is the key before `@` |

Rules:

- A skill's name is its frontmatter `name:` when set (that is what Claude accepts: folder `gstack-spec` is typed `/spec`), else its folder name. A command's name is its file name.
- Folders and files starting with `.` or `_` are skipped (`vercel/commands/_conventions.md` is not a command).
- Frontmatter longer than the 4 KB read is parsed up to where the read stops.
- Skip a skill whose frontmatter has `user-invocable: false`.
- The description is the frontmatter `description:`, first line, cut to 100 characters. Empty if there is none.
- Read at most the first 4 KB of each file.
- A missing or unreadable folder or JSON file is skipped. It never throws.
- Only top-level command files. Subfolders of `commands/` are out of scope.
- Sorted by name.

### `workbench/src/main.ts`

Next to `fsFind` (line 619): `on('commandsList', (projectId, engineId) => engineId === 'claude' ? listCommands(app.getPath('home'), projectRoot(projectId)) : [])`. An unknown project gives user and plugin commands only.

### `workbench/src/preload.cjs`

Next to line 53: `commandsList: (projectId, engineId) => ipcRenderer.invoke('commandsList', projectId, engineId)`.

### `workbench/ui/src/composer.jsx`

- `Mentions` takes `engineId={engine?.id}`.
- When a `/` token opens, call `api.commandsList(ui.projectId, engineId)` once. Keep the result until the token closes.
- Ranking for query `q`, ignoring case: names that start with `q`, then names that contain `q`, then descriptions that contain `q`. Show at most 8.
- The box's own actions (Attach files, Start, ...) stay, listed after the commands, filtered as today.
- A command row shows `/name`, then its description dimmed on the same line, cut with an ellipsis.
- Picking a command replaces the token with `/name ` (one trailing space) and puts the caret after it. It does not send.
- Picking an action works as today.
- For any agent other than Claude, `/` behaves exactly as today.

### Not changed

`home.jsx`, `inbox.jsx`, `automations.jsx` (they already pass `engine.id`), core, `ide.jsx`, `ui.css`.

## Acceptance checks

- [ ] M9-10a. With Claude picked on Home, typing `/sp` lists `/spec` first, with its description.
- [ ] M9-10b. Picking it leaves `/spec ` in the box, caret at the end. Start launches Claude, and the new agent runs the skill.
- [ ] M9-10c. `/codex:` lists the codex plugin's commands, for example `/codex:review`.
- [x] M9-10d. Nothing from `claude-mem` or `mattpocock-skills` appears (both disabled).
- [ ] M9-10e. With Codex picked, `/` shows only Attach files, Branch and model, Start (as today).
- [x] M9-10f. A project skill and a user skill with the same folder name appear once, and the project one wins.
- [x] M9-10g. A skill with `user-invocable: false` does not appear.
- [x] M9-10h. A missing `~/.claude/plugins/installed_plugins.json` gives user and project commands, with no error.
- [ ] M9-10i. `npm test` in `workbench/` passes. The new test file is green.

## Tests

| Layer | What | Count |
|---|---|---|
| Unit | `listCommands` against a temp home and project: order and dedupe, `user-invocable: false`, disabled plugin, missing JSON, description cut, plugin prefix | +6 |
| Unit | `commandsList` handler returns `[]` for engine `codex` | +1 |
| Manual | M9-10a to e in the running app | 5 |

Per the vault rule, Codex writes the tests if Claude writes the code (`/tests-brief`).

## Order

1. `commands.ts` and its tests.
2. `main.ts`, `preload.cjs`.
3. `composer.jsx`.
4. Rebuild the bundle (`npm --prefix workbench/ui run build`) only after the other session's uncommitted `ui.bundle.js` work is committed, so the two are not mixed.

## Rollback

Revert the commit. Nothing is stored. Nothing is written outside the bundle.

## Effort

1.5 h `commands.ts` + 1 h tests + 0.5 h IPC + 1.5 h composer + 0.5 h manual checks.

## Out of scope

- Claude Code built-ins (`/compact`, `/review`, `/init`).
- Codex and agy commands.
- Subfolders of `commands/`.
- Running a command straight from the list without pressing Start.
- Watching skill folders for changes. The list is re-read each time `/` opens.
