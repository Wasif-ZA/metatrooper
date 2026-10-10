# Security

Windows and Linux (beta). Local only: no account, no telemetry.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: the **Security** tab of
https://github.com/Wasif-ZA/metatrooper, then **Report a vulnerability**. Do not open a public issue.

Say what an attacker can do, the steps or a proof of concept, and the version and OS. You get a reply within 7 days.
A fix ships in the next release, and the advisory credits you unless you ask not to be named.

## Scope

In scope: the core (`core/`), the workbench (`workbench/`), the hooks it installs, the named pipe, the plugin
installer and permission screen, the sandbox, and the plugins and pipelines in this repository.

Out of scope: the agent CLIs themselves (Claude Code, Codex, agy), which have their own vendors; and anything that
needs another process already running as the same Windows or Linux user, since that process can read your files
anyway (see "Known limits" in the README).

## Supported versions

Only the latest release gets fixes.
