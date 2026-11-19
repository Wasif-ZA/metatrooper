# Security

Windows 10 and 11, from a zip or source. Runs on your machine: no account, no telemetry.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: the **Security** tab of
https://github.com/Wasif-ZA/metatrooper, then **Report a vulnerability**. Do not open a public issue.

Say what an attacker can do, the steps or a proof of concept, the commit you ran, and your OS. You get a reply
within 7 days. A fix lands on `main` and in the next release, and the advisory credits you unless you ask not to be
named.

## Scope

cc is four parts. Each is in scope:

- **The wall:** the workbench window (`workbench/`), its approval cards, take-over key and watch layout.
- **Browser use:** the `metatrooper-browser` MCP server, the browser panes, origin rules, browser secrets, handoff
  and output scrubbing.
- **Computer use:** the `metatrooper-desktop` MCP server, the UI Automation helper, grants, the input watcher and the
  agent cursor overlay.
- **Core services:** the core (`core/`), the hooks it installs, the named pipe and its trusted UI key, session
  resume, port ownership, notifications, the plugin install screen and the plugins in this repository.

Good reports show an agent using cc's own tools to act outside the panes and windows it was given, to
perform a risky action without a person approving it, to keep acting after the take-over key, or to read a saved
secret.

Out of scope:

- The agent CLIs themselves (Claude Code, Codex, Gemini, agy), which have their own vendors.
- Anything that needs another process already running as the same Windows user. That process can read
  your files and drive your apps anyway. See "Threat model" in `spec.md`.
- Limits already listed under "Known limits" in the README, `spec.md` and the contracts.
- A session that starts a looser child after stripping `TROOP_SESSION_SECRET` from its environment, or after reading
  `~/.metatrooper/ui.key`. The session secret guards the normal `troop launch` path only; see "Threat model" in
  `spec.md`. A child started through `troop` with the secret that runs looser than its parent is in scope.

## Supported versions

There is no tagged release yet. Fixes go to `main`; once releases start, only the latest one gets fixes.
