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
6. `requires` lists every plugin used by `uses: plugin:...`.
7. No step with `role: "publish"` or `external: true` may use `fanout`. Several external actions need
   several steps, each with its own gate and hash.
8. An agent step with `role: "publish"` or `external: true` must pin `engine` to one engine id, so the
   engine that publishes is part of what the user approves. Role binding never picks a publishing engine.
9. `kind: "pipeline"` may nest at most 3 levels deep and may not include itself directly or indirectly.

Validation errors are stored in `pipeline.errors` and shown in the form view next to the offending step.

## Run directory

`<project>/.harness/runs/<run_id>/`. The runner adds `.harness/` to the project's `.git/info/exclude` on the
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

- Default (`host: wt`): a new session with the prompt as the CLI's first argument. Claude: `claude "<prompt>"`.
  Codex: `codex "<prompt>"`. agy and plugin engines: the engine's `prompt_arg` from its registry entry; an
  engine without one gets the prompt on the clipboard plus a `handoff` gate saying "paste into window
  <name>".
- `continue: <step>` with the herdr host installed: `agent.prompt` into that step's herdr pane with
  `wait: {until: "done"}`. Without herdr: a new session in a new window as above, and the run log records
  `memory not kept`.

Done when, in this order of preference:

1. The output file exists, parses, and has `status: done`, and
2. the session reports `done` (Claude Stop hook, Codex notify, herdr `done`), or the output file has not
   changed for 10 s.

`status: failed` in the file, a missing required output key, the session exiting without the file, or
`timeout_minutes` passing, fails the step. The session is never killed by the runner; on failure its card
says "step failed, session left open".

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
- An `auto-external` gate is created by the runner in front of any external step whose pipeline file forgot a
  gate but whose plugin declares it external; validation already rejects such files, so this only catches
  plugins updated after the pipeline was saved.
- A `code` step cannot resolve any gate: `ctx.gate` has no resolve method, and the core rejects
  `gate.resolve` from any origin but `workbench`, `tray` or `cli`.

## Fan-out, worktrees, ports

- `fanout: N` runs the step N times in parallel. With `worktree: true`, each index gets
  `git worktree add <~/.agent-harness/worktrees/<project_id>/<run_id>-<i>> -b harness/<run_id>-<i>`.
- Ports: the core is the only allocator. For each index it takes the lowest port at or above 3001 that has no
  `port_lease` row and is not currently listening (checked with `Get-NetTCPConnection -State Listen`), writes
  the lease in the same transaction, and passes it as `{{port}}` to `dev_command`. Because allocation is one
  process and one transaction, parallel variants cannot collide. Leases are released when the variant is
  discarded or the run ends.
- With `browser: true`, each index gets its own browser pane owned by that index's session.

## Dev servers

For a step with `dev_command` and a leased port, the runner:

1. Spawns `dev_command` (with `{{port}}` resolved) in the worktree through `cmd.exe /d /s /c`, with the user's
   normal environment (it is the user's own project command, not a plugin), hidden window, and records the pid
   in `dev_server`.
2. Polls `http://127.0.0.1:<port>/` every 250 ms until any HTTP response arrives, for at most 90 s. Only then
   does it point the step's browser pane at the URL. No response in 90 s fails the step with the last 50 lines
   of the server's output.
3. Stops it with `taskkill /PID <pid> /T /F` when the variant is discarded, when the run ends, or when the core
   shuts down, and releases the port lease.

## Loops, resume, breaker

- `steps.<id>.passed` is true when that step's latest iteration has `status = 'done'` and its outputs do not
  contain `passed: false`. `verify` steps should write `passed: true` or `passed: false` explicitly.
- `loop`: after the last step of the group, evaluate `until`. True: continue. False: rerun the group with
  `iteration + 1`. At `max`: pause with `paused_why = 'loop-max'`.
- Resume: `run.resume` restarts from the first step whose status is not `done`, keeping every finished
  step's outputs and files.
- Breaker: a step that fails 3 times across resumes sets the run to `failed` with `paused_why = 'breaker'`.

## Budgets

- The runner sums `usage` rows for the run after every processed event.
- `max_tokens` and `max_usd`: when reached, no new step starts and the run pauses with
  `paused_why = 'budget'`. Steps already running are allowed to finish.
- Overshoot bound: the most a run can exceed its budget is the combined usage of the steps running when the
  limit was reached. To keep that small, a run with a budget runs at most `max_parallel` agent steps at once
  (default 3, pipeline field `budget.max_parallel`); further fan-out indexes wait.
- `max_minutes`: wall-clock limit for the whole run, the only limit that applies to engines whose usage is
  `unknown`.

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
