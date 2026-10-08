# Pipeline runtime contract

Version 1. The file format is `pipeline.schema.json`. This file says how a run executes it.

## Validation (before a pipeline can be saved or run)

1. The file matches the JSON Schema.
2. Every `{{ }}` reference resolves to an input or an earlier step. Forward references fail.
3. **Publish rule.** Every step with `role: "publish"` or `external: true` has a `kind: "gate"` step with
   `gate: "approve"` earlier in the same pipeline, with no other publish or external step between them. A
   step marked `external` by its plugin action's manifest counts, even if the pipeline file does not say so.
4. `continue` names an earlier `kind: "agent"` step.
5. `loop.steps` are consecutive and end with the step that carries the loop.
6. `requires` lists every plugin used by `uses: plugin:...`. A `kind: "action"` step's plugin must be
   installed and enabled and must declare that action.
7. No step with `role: "publish"` or `external: true` may use `fanout`. Several external actions need
   several steps, each with its own gate and hash.
8. An agent step with `role: "publish"` or `external: true` must pin `engine` to one engine id, so the
   engine that publishes is part of what the user approves. Role binding never picks a publishing engine.
9. `kind: "pipeline"` may nest at most 3 levels deep and may not include itself directly or indirectly.

Validation errors are stored in `pipeline.errors` and shown in the form view next to the offending step.

## Run directory

`<project>/.troop/runs/<run_id>/`. The runner adds `.troop/` to the project's `.git/info/exclude` on the
first run, so run files are never committed by accident.

Contents: `inputs.json`, one `<step_id>[-<i>].md` per agent step and fan-out index, `<step_id>.json` per
action, `log.jsonl` (the runner's own step transitions).

## Agent steps: the handoff contract

An agent step is one engine session. The runner builds the prompt from the template, then appends a fixed
footer:

```
When you are done, write your result to: <run_dir>/<step_id>[-<i>].md
Start that file with a front matter block containing these keys: <outputs, comma separated>, and status: done or failed.
Earlier step results you may need are in: <list of earlier output paths referenced by this step>
```

Launch:

- Default (`host: pty`): a new session with the prompt as the CLI's first argument. Claude: `claude "<prompt>"`.
  Codex: `codex "<prompt>"`. agy and plugin engines: the engine's `prompt_arg` from its registry entry; an
  engine without one gets the prompt on the clipboard plus a `handoff` gate saying "paste into window
  <name>".
- `continue: <step>`: a new session as above, and the run log records
  `memory not kept`.
- The step's working folder is marked trusted for that engine (its registry `trust` entry) before launch, so
  no engine stops on a trust screen.
- `approval` (`ask`, the default, `edits` or `contained`) picks the engine's `approval_profiles` entry. An
  unattended step needs `edits` or `contained`: in `ask` mode an engine such as agy stops to ask before any
  command or file write. two-engine-review gives its reviewers the diff as a file from a code step, so they
  need no shell, and runs them with `edits` so they can write their result file.

Done when, in this order of preference:

1. The output file exists, parses, and has `status: done`, and
2. the session reports `done` (Claude Stop hook, Codex notify, terminal bell when silent), or the output file has not
   changed for 10 s.

Front matter values are `key: value` scalars, `- item` lists, and `|` (lines kept) or `>` (folded to one
line) blocks. A ` # comment` after a one-word value is dropped, so `status: done  # ok` reads as `done`.

`status: failed` in the file, a missing required output key, the session exiting without the file, or
`timeout_minutes` passing, fails the step. So does a session that settles without writing the file for 2
minutes. The runner closes the step's session when the step ends, whether it passed, failed, timed out or
paused for budget; its transcript stays readable.

## Sub-pipeline steps (`kind: "pipeline"`)

- The runner creates a child `run` with `parent_run`, `parent_step` and `depth = parent depth + 1`, in the
  same project and run directory tree (`<run_dir>/<step_id>/`).
- `with` supplies the child's `inputs`; its values are templates resolved in the parent.
- The child's budget is the parent's remaining budget at that moment; the child's `usage` rows count toward
  the parent too.
- The child's gates appear in the parent's gate panel with the child pipeline's title. The parent step waits
  while the child is paused.
- When the child ends `done`, the parent step's `outputs` are the outputs of the child's last step. A child
  that fails or is cancelled fails the parent step.

## Action steps

`uses: plugin:<id>/<action>` runs the action as described in `plugins.md`, with `with` as the input JSON.
Its stdout JSON becomes the step outputs and is written to `<step_id>.json`.

## Gates

- `gate: approve` creates a `gate` row and pauses the run. If the next publish or external step is known,
  the gate stores `guards_step` and an `action_hash`: sha256 of canonical JSON (keys sorted, no whitespace),
  computed after all templates are resolved:
  - action step: `{"step": <id>, "action": <uses>, "args": <resolved with>, "destination": <value of the action's destination_field>}`
  - agent step: `{"step": <id>, "engine": <bound engine id>, "prompt_sha256": <sha256 of the full resolved prompt>, "destination": <the step's destination>}`
- When the guarded step is about to run, the runner recomputes the hash. A mismatch marks the gate `stale`,
  creates a new gate with the new summary, and pauses again. So an approval covers exactly one action with
  exactly those arguments.
- `gate: handoff` pauses until the user presses Continue. It never authorises a publish.
- After a fan-out worktree step, Pick on a tile marks that variant `picked` (one per run; picking another sets
  the old one back to `ready`). Later steps read it as `{{variants.picked.worktree}}` and
  `{{variants.picked.branch}}`, and `cwd: "{{variants.picked.worktree}}"` runs a step inside it. Validation
  requires a handoff gate between the fan-out step and the reference. `gate.resolve` refuses Continue on a
  handoff gate step that follows a fan-out worktree step while nothing is picked (VALIDATION, "pick a tile
  first"); the gate stays waiting.
- An `auto-external` gate is created by the runner in front of any external step whose pipeline file forgot a
  gate but whose plugin declares it external; validation already rejects such files, so this only catches
  plugins updated after the pipeline was saved.
- A `code` step cannot resolve any gate: `ctx.gate` has no resolve method, and the core rejects
  `gate.resolve` from any origin but `workbench`, `tray` or `cli`.

## Fan-out, worktrees, ports

- `fanout: N` runs the step N times in parallel. With `worktree: true`, each index gets
  `git worktree add <~/.metatrooper/worktrees/<project_id>/<run_id>-<i>> -b troop/<run_id>-<i>`. A folder at
  that path that git does not list as a worktree is deleted and made again; a `troop/` branch that survived
  is checked out as it is, without `-b`.
- When a run ends `done` or `cancelled`, each of its worktrees with no uncommitted or untracked changes is
  removed (`git worktree remove`, never forced), and each `troop/` branch with no commits beyond the project's
  HEAD is deleted (`git branch -d`). A worktree with changes, or a branch with commits, is the run's work and
  stays; the run log records each kept worktree. A `failed` run keeps everything for inspection.
- Ports: the core is the only allocator. For each index it takes the lowest port at or above 3001 that has no
  `port_lease` row and is not currently listening (checked with `Get-NetTCPConnection -State Listen`), writes
  the lease in the same transaction, and passes it as `{{port}}` to `dev_command`. Because allocation is one
  process and one transaction, parallel variants cannot collide. Leases are released when the variant is
  discarded or the run ends.
- With `browser: true`, each index gets its own browser pane owned by that index's session.

## Dev servers

For a step with `dev_command` and a leased port, the runner does the following after the agent finishes, or
before it starts when the step sets `serve: "before"` (a step whose agent checks the page while it works; a
server that never answers then fails the step without starting the agent). A later step that sets `browser`
and no `dev_command` on the same index reuses that pane and server, which stay up until the run ends or the
variant is discarded:

1. Spawns `dev_command` (with `{{port}}` resolved) in the worktree through `cmd.exe /d /s /c`, with the user's
   normal environment (it is the user's own project command, not a plugin), hidden window, and records the pid
   in `dev_server`.
2. Polls `http://127.0.0.1:<port>/` every 250 ms until any HTTP response arrives, for at most 90 s. Only then
   does it point the step's browser pane at the URL. No response in 90 s fails the step with the last 50 lines
   of the server's output.
3. Stops it with `taskkill /PID <pid> /T /F` when the variant is discarded, when the run ends, or when the core
   shuts down, and releases the port lease.

## Loops, resume, breaker

- `steps.<id>.passed` is true when that step's latest iteration has `status = 'done'` and its outputs contain
  `passed: true`. A missing `passed` counts as not passed, so the loop repeats and pauses at `loop-max`.
  `verify` steps write `passed: true` or `passed: false` explicitly.
- `loop`: after the last step of the group, evaluate `until`. True: continue. False: rerun the group with
  `iteration + 1`. At `max`: pause with `paused_why = 'loop-max'`.
- Resume: `run.resume` restarts from the first step whose status is not `done`, keeping every finished
  step's outputs and files.
- Breaker: a step that fails 3 times across resumes sets the run to `failed` with `paused_why = 'breaker'`.
  Resuming it clears the failed steps' failure counts and logs `breaker reset`.

## Budgets

- The runner sums `usage` rows for the run after every processed event.
- `max_tokens` and `max_usd`: when reached, no new step starts and the run pauses with
  `paused_why = 'budget'`. Steps already running are allowed to finish.
- Overshoot bound: the most a run can exceed its budget is the combined usage of the steps running when the
  limit was reached. To keep that small, a run with a budget runs at most `max_parallel` agent steps at once
  (default 3, pipeline field `budget.max_parallel`); further fan-out indexes wait.
- `max_minutes`: wall-clock limit for the whole run, the only limit that applies to engines whose usage is
  `unknown`. Time the run or any of its sub-pipeline runs spends waiting at a gate does not count.
- A step that fails while the run is paused leaves the run paused, and a step that fails in the same pass as
  a budget stop pauses the run for budget unless the breaker tripped; resume runs the failed step again.
- Raise and Resume in the workbench takes new limits for tokens, dollars and minutes, whichever stopped the run.

## Schedules

- `schedule` rows fire while the core is running. The core checks every 30 s.
- A fire time that passed while the core was down is recorded in `last_missed` and raised as a needs-you
  item. Missed runs are never back-filled.
- A scheduled run that fails raises a tray notification and a needs-you item.

## Code steps

Code steps do not use the plugin action stdio contract. The runner starts
`node --experimental-default-type=module <core>/code-host.js` with `child_process.fork` (Node IPC channel),
the stripped environment, and cwd set to the run directory. `code-host.js` imports the module and calls
`run(ctx)`. Every `ctx` method is an async request over the IPC channel (`process.send({id, method, args})`,
answered by the runner with `{id, result}` or `{id, error}`), so `startAgent` can wait minutes for an agent
step while `log` streams. The IPC channel exposes no gate method.

`export async function run(ctx)`, where `ctx` has: `inputs`, `steps` (read-only outputs so far), `runDir`,
`projectPath`, `log(msg)`, `readFile(rel)`, `writeFile(rel, text)` (both limited to `runDir`), and
`startAgent({prompt, engine?})` which runs an agent step under the same handoff contract and returns its
outputs. `run(ctx)` must return a JSON-serialisable object; the runner writes it to `<step_id>.json` and uses
it as the step's outputs. Throwing, or returning something that is not JSON-serialisable, fails the step. The
module runs in a separate node process with the same limits as plugin actions.

## Runner details (child #15)

Choices the sections above leave open, as built:

- Registry: pipelines come from `pipelines/*.json` in the repo (`builtin`), each enabled plugin's `pipelines`
  (`plugin:<id>`), and `<project>/.troop/pipelines/*.json` for every opened project (`project`); on a clashing
  id the later source wins. `pipeline.version` is the file's modification time in seconds. First-party plugins
  in the repo's `plugins/` folder register at core start as source `builtin`, approved as declared.
- A run copies its pipeline to `<run_dir>/pipeline.json` at start and always executes that copy, so editing
  the file mid-run changes nothing.
- Steps run in file order. A fan-out step's indexes run in parallel; agent indexes at most `max_parallel` at
  once whether or not the pipeline sets a budget. `steps.<id>.outputs.<key>` of a fanned-out step is the list
  of each index's value.
- An approval is used up by the one action it covers: when the guarded step starts, its gate becomes `stale`
  with the note `approval used by <step>`. A resume that re-runs that step asks again. A gate whose hash could
  not be computed at gate time (its step reads outputs made after the gate) is re-asked with the hash when
  the guarded step is reached.
- Rejecting any approve or handoff gate cancels the run.
- The engine without a `prompt_arg` gets its prompt on the clipboard and a `handoff` gate row; the run does
  not pause for it, and the gate settles itself when the output file arrives.
- Budgets count `tokens_in + tokens_out + cache_write`; `cache_read` is left out because cached reads would
  trip a token budget long before cost matters. A sub-pipeline's budget is the parent's remainder at start.
  Raising a parent's limits on resume raises each resumed sub-pipeline run's limits by the same amount.
- `run.resume` takes optional `max_tokens`, `max_usd` and `max_minutes`, which can only raise the run's
  limits. It refuses a run waiting at a gate (resolve the gate); a run stopped by the breaker resumes with
  its failure counts cleared. After `loop-max`, resume carries on with the step after the loop. Resuming a parent resumes its paused
  sub-pipeline runs.
- Dev servers start after the agent index writes a `status: done` output, since the worktree has no app to
  serve before that. They are stopped (and their `dev_server` rows removed) on discard, run end, run failure
  and core shutdown, and are not restarted when the core starts again.
- On core start, a step that was running an action, a code module or had no session yet is failed with
  "interrupted by core restart"; agent steps with a session and sub-pipeline steps are picked up again.
- `code-host.js` gets `--experimental-default-type=module` only when the running node still accepts it.
- `variant.combine` arrives with child #24.

## Layout and background

`layout` picks the screen a run is shown on. `view` is separate: it names the result pane for one step, and that
pane fills the active layout's output slot. Both
`layout` fields take one name from the frozen library in spec.md, Pipeline UI (enum `$defs.layout` in the
schema). Step kinds and gate kinds do not change.

- Pipeline `layout` (optional): the fallback, used only when the pipeline's pick rule matches nothing.
- Step `layout` (optional): a hint, used while that step is the active one.
- Pipeline `background` (optional, default `false`): `true` folds the run to the 36px wall bar; it opens only
  when it needs the user. `false` opens the run screen at start.

Which layout shows, first that applies:

1. The user's key, 1 to 5 (the pipeline's five layouts in order). It holds until the user presses 0 or the run
   ends. 0 hands the screen back to automatic.
2. A failed step shows `run-log`, or the stand-in its pick rule names when `run-log` is not among its five. A
   step hint never beats it.
3. The active step's `layout` hint.
4. The agent's pick, by the pipeline's pick rule.
5. The pipeline's `layout`.

Automatic changes (2 to 5) move the screen only when a gate starts waiting, a step fails, or a step has run for
5 s or more. Never within 2 s of the user's last click or key; a due change waits until 2 s after it. Keys 1 to 5
and 0 apply at once.

## Result panes

A step with `view` of `items`, `document`, `table` or `findings` gets its pane once it has started. The pane
renders inside the active layout's output slot (spec.md, Pipeline UI); when the layout changes, the pane moves with
it. The pane reads the step output of the same name (`document` also reads `sources` and `score`): a path
resolved inside the run folder, then the project folder, or the data inline in the output. Shapes:

- `items`: `[{"id","title","preview"?,"score"?,"reason"?,"status":"pending|approved|dropped|published|failed","error"?,"url"?}]`
- `document`: markdown, plus `sources` `[{"title","url"}]` and `score` `{"score":0-100,"threshold":N,"parts":{"<name>":N}}`
- `table`: `{"columns":["<step>"],"rows":[{"id","cells":{"<step>":{"status":"done|running|failed","value"?,"error"?}}}]}`
- `findings`: `[{"severity":"critical|high|medium|low","title","file"?,"line"?,"detail","fixed_by"?}]`

Approve, Back to pending and Drop on an `items` card call `run.item-set {run_id, step_id, id, status}`, which
rewrites that item's `status` in the file. Inline items are read only. Fixtures: tests/fixtures/result-panes/.
