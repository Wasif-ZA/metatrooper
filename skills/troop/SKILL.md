---
name: troop
description: Start and follow MetaTrooper agent sessions from inside an agent session with the troop CLI.
---

# troop

Use the `troop` CLI to work with MetaTrooper's core. Always pass `--json` and read the JSON output.

## Start and follow agents

1. `troop launch <engine> --project <path> --prompt <text> --json` starts an agent and returns its `session_id`.
   Example: `troop launch codex --project . --worktree fix-login --prompt "fix the login test" --json`.
2. `troop launch --jobs <jobs.json> --json` starts several at once from `[{"engine","worktree","prompt"}, ...]`.
3. `troop sessions --json` lists sessions and their state (`working`, `waiting_for_you`, `done`, `idle`, `exited`).
4. `troop owners --json` lists the project's uncommitted files and the session that owns each.

## Pipe methods

The core's methods, generated from `core/src/methods.ts`. Stable ones keep their shape in protocol 1.

<!-- methods:start -->
```text
  core.ping              {}  (stable)
  settings.set           {key, value}
  core.stop              {}
  account.state          {}
  project.open           {path}  (stable)
  project.clear          {project_id}
  session.launch         {project_id, engine_id, prompt?, host?: "pty", browser?: boolean, parent_id?}  (stable)
  session.list           {project_id?, all?: bool}  (stable)
  session.wait           {session_id, states: [state, ...], timeout_ms}  (stable)
  session.resume         {session_id}  (stable)
  session.focus          {session_id}  (stable)
  session.live-text      {}  (stable)
  session.search         {query, session_ids?}
  session.seen           {session_id}
  session.hide           {session_id}
  session.limit-resume   {session_id, on: bool}
  session.clear-status   {session_id}
  session.owners         {project_id}
  session.paste-prompt   {session_id}
  needs_you.mark-read    {id}
  needs_you.mark-unread  {id}
  needs.dismiss          {id}
  shell.list             {}
  shell.open             {kind, project_id}
  shell.close            {shell_id}
  worktree.create        {project_id, branch?, base?: "HEAD"}  (stable)
  ui.hello               {ui_key}
  engines.check          {}
  hooks.install          {codex?: bool}
  hooks.uninstall        {codex?: bool}
  plugin.preview         {source}
  plugin.install         {source, approved_permissions, manifest_hash?, secrets?: {NAME: value}}
  plugin.remove          {plugin_id}
  plugin.secret.set      {plugin_id, name, value}
  mcp.resolve            {plugin_id, server_id}
  mcp.missing            {plugin_id, names}
  notify.sink.set        {kind, dest, name?, id?, kinds?, enabled?}  (stable)
  notify.sink.list       {}  (stable)
  notify.sink.test       {id}  (stable)
  notify.sink.remove     {id}  (stable)
  comment.deliver        {comment_id}
  pane.open              {project_id, url?, session_id?, agent?: bool}  (stable)
  pane.close             {pane_id}
  pane.url               {pane_id, url}
  pane.assign            {pane_id, session_id?}
  pane.capture           {pane_id, label}
  approval.check         {session_id, surface, target, action, args, control, password?, hidden?, file_dialog?, action_hash?}
  approval.resolve       {approval_id, decision, scope?}
```
<!-- methods:end -->

## Waiting for you

A session in `waiting_for_you` needs the human. Report it to the user and stop. Do not answer
another agent's prompt yourself.

## Tools and short output

`troop route` is metarouter, bundled with MetaTrooper. Use it for shell commands whose output is long:
`troop route exec -- <command>` prints the lines that matter and keeps the full log
(`troop route log` reads it back). `troop route search <words>` finds a saved recipe and
`troop route run <recipe> [args]` runs it. Inside a session MetaTrooper started, plain `metarouter` is the same
bundled copy.

## Rules

- Never commit, push or open PRs. Print the command for the user to run.
- If `troop ping` fails, the core is not running. Start it with `troop start` (detached). Never `troop serve` from an agent: the core would die when the agent session ends.
