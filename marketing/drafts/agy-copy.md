## show-hn

Show HN: cc: an IDE built around your coding agents

I built cc because I was running three coding agents in three separate terminals. I kept losing track of which agent was waiting on me. I also had to paste screenshots back and forth so an agent could see what it built.

cc puts every agent in a terminal it owns and shows you which one needs you. Around them sits an editor, so you can read and change code without leaving the window.

When an agent asks a question or waits for permission, its tile turns orange and moves to the big slot. Alt keys let you navigate tiles without stealing terminal shortcuts. A background service owns the terminals, so sessions keep running if you close the window.

The IDE includes tabs, file search, and diff reviews. Comments on diff lines go straight back to the agent as your next message. Agents can also drive browser panes and granted Windows app windows through MCP servers. Sensitive actions stop for your approval first.

Honest limits: cc is a pre-release project at version 0.1.0. It runs on Windows only. There is no installer yet, so you install from source.

cc runs the official CLIs you install yourself. cc is not affiliated with Anthropic, OpenAI or Google.

I would appreciate specific feedback on:
1. The wall layout and tile switching.
2. The approval flow for browser and desktop tools.
3. Build or setup issues on your machine.

Source: https://github.com/Wasif-ZA/metatrooper

## r-claudeai

I built cc, a free AGPL-3.0 desktop IDE for Claude Code on Windows

I got tired of juggling terminal windows while running Claude Code on Windows. I frequently missed prompts when Claude paused to ask a question. I also found it tedious to copy screenshots back and forth to show Claude what its code rendered.

To fix this for my own workflow, I built cc. It is free and open source under the AGPL-3.0 licence.

cc runs Claude Code in a terminal owned by a background service. If you close the window or if it crashes, your agent keeps working.

The app uses the official Claude Code CLI that you install and authenticate yourself. On first run, cc adds hooks to `~/.claude/settings.json`. These hooks let cc detect when Claude is working, waiting for you, or done.

On the wall screen, each agent gets its own terminal tile. When Claude needs your input, its tile turns orange and moves to the big slot.

Around the terminal tiles sits a full code editor. You can search files, inspect diffs, and edit code directly. If you add a comment to a line of a diff, that comment is sent to Claude as your next prompt.

Claude can also drive browser panes inside the window through an MCP server. Dangerous actions stop for your approval first. Password fields, new web origins, and buttons named Send or Submit always require your confirmation.

Honest limits to know before trying it:
1. It is an early pre-release at version 0.1.0.
2. It runs on Windows only. It was tested on Windows 11.
3. There is no installer yet. You must clone the repository and build from source using Node 24.16 or newer.
4. If you decide to uninstall, run `node core/cli.ts hooks uninstall` to clean up the hooks in `~/.claude/settings.json`.

cc makes no network connections of its own. It has no accounts and collects no telemetry.

cc is not affiliated with Anthropic, OpenAI or Google.

Repo: https://github.com/Wasif-ZA/metatrooper

## r-chatgptcoding

Running multiple Codex and CLI coding agents side by side in cc

If you run multiple Codex sessions simultaneously, managing them across different terminals quickly becomes messy. You lose track of which session has finished and which session needs an answer.

I built cc to solve this problem. It is a local desktop IDE designed to run multiple coding agents side by side on Windows.

Each agent runs in its own terminal tile on a shared wall. Codex reports its status through its notify setting. Tiles clearly display whether an agent is working, waiting for you, done, or exited.

When an agent needs your input or permission, its tile turns orange and moves into the main slot. You can switch between tiles using Alt keys, so your standard terminal hotkeys remain untouched.

You can run Codex alongside other agents across separate git worktrees using `troop launch codex --worktree [branch]`.

A background service owns all agent terminals. If you close the app window, every agent continues running. When you restart the core, it automatically resumes up to 3 live sessions.

The window also includes a code editor, diff viewer, and integrated browser panes. Agents can interact with browser panes, but sensitive actions stop for your approval. Visiting a new site, filling a password field, or clicking a submit button requires your confirmation.

Honest limits:
- cc is an early pre-release at version 0.1.0.
- It is Windows only.
- There is no installer, so you must install and run it from source using Node 24.16+.

The core is free and open source under the AGPL-3.0 licence. It is local only, with no account signups and no telemetry.

cc is not affiliated with Anthropic, OpenAI or Google.

Repository: https://github.com/Wasif-ZA/metatrooper

## r-commandline

troop: manage persistent coding agent terminals from the command line

I built `troop` to run and monitor CLI coding agents on Windows.

The core runs as a background service. It owns the terminal sessions so they survive if you close the window or exit your shell.

Key commands:
- `troop start`: starts the background service.
- `troop ping`: checks if the service is running.
- `troop launch codex --worktree [branch]`: launches an agent in a dedicated git worktree.
- `troop launch claude --project [path]`: launches an agent in a specific project directory.
- `troop sessions`: lists all active and past sessions.
- `troop owners [path]`: shows which session modified each file.
- `troop stop`: stops the background service.

When the core restarts, it resumes up to 3 live sessions automatically. Each session resumes using its engine's native resume flag.

Other tools can communicate with the core over a Windows named pipe at `\\.\pipe\metatrooper` using JSON-RPC.

Limits:
- cc is a pre-release project at version 0.1.0.
- It is Windows only.
- There is no installer package. You build from source using Node 24.16+.
- When running from source, use `node core/cli.ts` in place of `troop`.

Licence is AGPL-3.0. No accounts. No telemetry.

cc is not affiliated with Anthropic, OpenAI or Google.

Source: https://github.com/Wasif-ZA/metatrooper

## x-thread

1/7 Running three coding agents in three terminals gets chaotic fast. You lose track of which one is waiting for you. You paste screenshots back and forth so an agent can see its work. I built cc to fix this.

2/7 cc puts every agent into a live terminal tile. When an agent needs your input, its tile turns orange and moves to the big slot. Alt keys let you navigate tiles without stealing your terminal shortcuts.

3/7 Terminals run under a background service. If you close the window, your agents keep working. When the core restarts, it resumes your live sessions in the same layout.

4/7 An editor sits around the terminals. You can inspect diffs and edit code directly. Comments placed on a diff line go straight back to the agent as your next instruction.

5/7 Agents can drive browser panes and granted Windows app windows. Password fields, new web origins, and send buttons stop for your approval first. One hotkey pauses all agent input.

6/7 The honest limits: cc is a pre-release project at version 0.1.0. It is Windows only. There is no installer, so you install from source with Node 24.16+. cc is not affiliated with Anthropic, OpenAI or Google.

7/7 cc is free and open source under AGPL-3.0. No accounts. No telemetry. Everything runs locally on your machine. Try it from source: https://github.com/Wasif-ZA/metatrooper

## linkedin

I built cc, a desktop IDE for running CLI coding agents side by side.
It organizes your agents, shows which one needs you, and keeps terminals alive in the background.

When you run several agents at once, you easily lose track of which one is waiting for an answer. You also waste time pasting screenshots back and forth between tools.

cc solves this by giving each agent its own terminal tile. When an agent asks a question or waits for approval, its tile turns orange and moves to the big slot.

An editor sits around the terminals. You can review diffs, stage commits, and edit files without leaving the window. Comments placed on diff lines go straight back to the agent as your next prompt.

Agents can also drive browser panes and granted Windows app windows through built-in MCP servers. Risky actions stop for your manual approval. Password fields, new web origins, and send buttons always ask first.

Honest limits: cc is an early pre-release at version 0.1.0. It is Windows only. There is no installer yet, so you install and run it from source with Node 24.16+.

cc is local only. No accounts, no telemetry. It is open source under AGPL-3.0.

cc is not affiliated with Anthropic, OpenAI or Google.

Repo: https://github.com/Wasif-ZA/metatrooper

## product-hunt

**Name**: cc

**Tagline**: An IDE built around your coding agents

**Description**: cc runs coding agents side by side in persistent terminals. One place shows who needs you. Includes a code editor, diff reviews, and safe browser and desktop automation. Windows only, pre-release, install from source.

**First Maker Comment**:
I built cc because I was tired of juggling multiple coding agents across separate terminal windows. I kept losing track of which agent was waiting on me.

cc gives each agent a live terminal tile. When an agent asks a question or waits for permission, its tile turns orange and moves to the main slot. A background service owns the terminals, so your sessions keep running even if you close the window.

Around the terminals sits a code editor. You can view diffs, stage files, and send line comments directly back to an agent. Agents can also drive browser panes and granted Windows app windows through MCP servers. Actions like clicking send buttons, entering passwords, or visiting new sites stop for your approval first.

cc is local only. It has no accounts and collects zero telemetry. It is open source under the AGPL-3.0 licence.

Here are the honest limits. cc is a pre-release project at version 0.1.0. It runs on Windows only. There is no installer yet, so you need to clone the repository and run it from source with Node 24.16+.

cc is not affiliated with Anthropic, OpenAI or Google.

Please test it and share your thoughts.
Repo: https://github.com/Wasif-ZA/metatrooper

**Gallery Captions**:
- `assets/ouros/today.png`: Home screen: Good morning dashboard showing 3 agents ran overnight, 1 waiting for you, 2 finished, 41 passing tests, and $3.10 spent. Displays active tasks, pending approvals, and an overnight event timeline.
- `assets/ouros/ide.png`: IDE screen: Code editor showing limit.ts with inline diff highlights, keep and undo buttons, test results and TypeScript error in the bottom terminal, and an agent chat sidebar on the right.
- `assets/ouros/wall.png`: Wall screen: Multi-terminal layout with live agent sessions. The session needing input shows an orange alert, alongside dev server logs, background tasks, and an agent drafting documentation.
- `assets/ouros/jobs.png`: Desktop use screen: Four granted application windows where agents work on spreadsheets, sales pipelines, poster graphics, and UI wireframes with explicit approval cards for changes.
- `assets/ouros/review.png`: Review screen: Source control diff view where a user types an inline comment on line 10 of limit.ts to send feedback directly back to Claude as the next instruction.

## devto

---
title: Why I Built cc: An IDE for Coding Agents on Windows
published: false
tags: opensource, programming, windows, productivity
---

I use CLI coding agents daily. A few months ago, my workflow broke down.

I was running three agents in three terminal windows. One agent refactored an endpoint. Another agent wrote tests. A third agent researched a documentation bug.

The problem was not their code. The problem was keeping track of them.

I kept losing track of which agent was waiting on me. An agent would pause for a simple confirmation. That terminal sat in the background for twenty minutes before I noticed it.

Meanwhile, I wasted time pasting screenshots back and forth. An agent wrote a web component. To show the agent what it rendered, I took a screenshot, saved it, and pasted the file path into the prompt.

Terminal tabs were never designed to manage multiple coding agents.

I decided to build an environment designed around coding agents. I call the project cc.

cc puts every agent in a terminal it owns and shows you which one needs you. Around them sits an editor, so you can read and change code without leaving the window.

I wanted three things:
First, I wanted to see every agent at a glance.
Second, I wanted the agent that needed my attention to come directly to me.
Third, I wanted terminal sessions to survive if I closed the window.

Everything in cc grew from those requirements.

The central screen in cc is the wall.

On the wall, every agent runs inside a live terminal tile. The interface monitors what each agent is doing.

When an agent asks a question or waits for permission, its tile turns orange and moves to the big slot. You do not scan multiple tabs to find the paused task. It comes straight to your focus.

The wall respects your current input. If you were typing in the big tile, the app waits three seconds before moving another tile into that slot. It never steals your keystrokes.

Finished agents fold into compact one-line bars.

Navigation uses Alt keys rather than Control keys. Pressing Alt with the arrow keys moves between tiles. Alt+J jumps to the session that has waited the longest. Alt+N labels each tile with a letter. Because navigation relies on Alt, your active terminal keeps every Control key shortcut.

Running agents inside a terminal app still forces you to switch back and forth to an editor.

cc includes a code editor around the terminal tiles.

The IDE screen provides tabs, a file explorer, and file search via Ctrl+P. Ctrl+Shift+F searches across project files. The bottom panel houses problems and an integrated shell.

Files that an agent modified carry a mark in the file tree. You can open any changed file as a diff.

If you leave a comment on a line in a diff, that comment goes straight back to that agent as your next message. It includes the file path and line range automatically.

Pasting screenshots by hand was another problem I wanted to eliminate.

cc includes browser automation through the metatrooper-browser MCP server. Agents drive browser panes inside the window. There is no remote debugging port and no browser extension.

Sensitive actions require explicit user approval. Entering passwords, typing credential-like text, or clicking buttons named Send, Submit, Pay, Delete, or Publish triggers an approval card. The card displays a redacted crop of the element. You approve once, approve for the session, or reject.

cc also provides computer use on Windows through the metatrooper-desktop MCP server. It uses Windows UI Automation, which is built into Windows.

An agent can only interact with app windows you explicitly give it. You click Give window on the agent tile and choose an application. Elevated admin windows and the cc window itself cannot be granted.

Each agent has a visible cursor that glides to its target. Pressing Ctrl+Alt+Q immediately pauses all agent actions.

The core runs as a background service. It manages terminal instances independently of the user interface.

If you close the window, the background service preserves your sessions. When the core starts again, it resumes live sessions automatically.

cc makes no network connections of its own. It requires no user account and collects zero telemetry. Your agents communicate directly with their respective providers. Local state is stored in your user directory.

Honest limits must be stated clearly.

cc is an early pre-release project at version 0.1.0. It is Windows only. I tested it on Windows 11. There is no installer package yet. You must clone the repository and build from source. Some parts of the IDE interface are marked as not built yet. There is no code sandbox yet, so agents execute commands with your user permissions.

cc runs official CLIs that you install and authenticate yourself. cc is not affiliated with Anthropic, OpenAI or Google.

If you want to test cc, you need Windows 10 or 11, Node 24.16 or newer, and an installed agent CLI such as Claude Code or Codex.

Clone the repository and install dependencies:

```bash
git clone https://github.com/Wasif-ZA/metatrooper
cd metatrooper/core && npm ci
cd ../workbench && npm ci
cd ..
node core/cli.ts start
node core/cli.ts ping
node core/cli.ts skills install
cd workbench && npm run dev
```

Explore the code and report issues on GitHub: https://github.com/Wasif-ZA/metatrooper

## github-release

# v0.1.0 Pre-release

This is the first public pre-release of cc, an IDE built around your coding agents.

cc puts your CLI coding agents side by side in persistent terminals. One place shows you which agent needs you. It includes a code editor, diff reviews, and safe browser and desktop automation.

### Highlights
- The Wall: live terminal tiles for each agent. The agent waiting for you turns orange and moves to the big slot. Alt keys let you navigate tiles without interfering with terminal shortcuts.
- Persistent terminals: a background service owns the terminals. Sessions survive if the window closes. The core resumes live sessions when it restarts.
- IDE and diff reviews: code editor with tabs, file search, and side-by-side diffs. Comments placed on diff lines are sent directly to the agent as your next instruction.
- Safe browser use: agents drive browser panes through an MCP server. Password fields, new web origins, and send buttons stop for manual approval.
- Windows computer use: agents act on granted application windows through Windows UI Automation. Your real pointer never moves. One hotkey (Ctrl+Alt+Q) pauses all agent actions.
- Local and private: no accounts, no telemetry, and no external network calls from cc itself. Core is open source under AGPL-3.0.

### Requirements
- Windows 10 or 11 (tested on Windows 11).
- Node 24.16 or newer (tested on 24.18).
- At least one agent CLI installed and signed in: `claude`, `codex`, `gemini` or `agy`.
- A network connection for the first run.

### Install from source
There is no installer yet. You run cc from a clone of this repository.

```bash
git clone https://github.com/Wasif-ZA/metatrooper
cd metatrooper/core && npm ci
cd ../workbench && npm ci
cd ..
node core/cli.ts start          # starts the core in the background
node core/cli.ts ping           # checks the core is up
node core/cli.ts skills install # optional: copies the bundled agent skills
cd workbench && npm run dev     # opens the window; needs a desktop session
```

What to expect:
- `npm ci` in `workbench/` downloads Electron and builds the editor files. It takes a minute and needs network.
- `npm ci` in `core/` may warn about scripts for `node-pty`. It is only a warning.
- `npm ci` in `workbench/` may report vulnerabilities from `npm audit`. They do not stop the install.
- On first run the window asks how agents should start: ask before each tool call (the default) or auto mode in worktrees. You can change it later in `~/.metatrooper/settings.json` (`sessions.approval`).
- From source, `troop` in any message means `node core/cli.ts`.

### First-run warnings
- Launching Claude Code from the window installs cc's hooks into `~/.claude/settings.json`. Running `node core/cli.ts hooks uninstall` removes them and leaves the rest of the file byte for byte.
- The core keeps its state in `~/.metatrooper/troop.db`. A newer core migrates it, after which an older build cannot open it.

### Known limits
- cc is an early pre-release at version 0.1.0.
- Windows only.
- Install from source only; there is no installer yet.
- Grants and approvals do not stop a hostile program running as you.
- The input watcher cannot name the program behind injected input.
- The send-button rule is English only. Other languages rely on new-site and credential rules.
- Apps without a UI Automation tree give the agent screenshots only.
- Take-over is close to instant, not instant.
- The browser pane trusts the pid a caller reports.
- No sandbox for agents' code yet. Agents run with your user permissions.
- Some IDE parts are not built yet. The UI marks them as Not built yet.

cc is not affiliated with Anthropic, OpenAI or Google.

Repo: https://github.com/Wasif-ZA/metatrooper

## video-script

| Time | Shot | On-screen | Voiceover |
|---|---|---|---|
| 00:00 to 00:08 | Wall | The Wall showing multiple live terminal tiles side by side. One tile turns orange and slides to the large central slot. | Running multiple coding agents in separate terminals gets chaotic. I built cc to give every agent a home. On the wall, the agent that needs you turns orange and comes straight to you. |
| 00:08 to 00:15 | Needs you | Needs you screen with a filtered list of questions and pending approvals across agents. | When an agent asks a question, it appears on the Needs you screen. You can review and answer every waiting prompt in one place. |
| 00:15 to 00:23 | IDE | IDE screen showing code editor, file tree, inline diffs, and diff line comment popup. | Around the terminals sits a full code editor. You can inspect diffs, edit files, and send line comments straight back to the agent as your next instruction. |
| 00:23 to 00:31 | browser pane with approval card | Browser pane with approval card showing a redacted credential crop and Approve or Reject buttons. | In the browser pane with approval card, agents can test web applications. Sensitive actions like passwords or submit buttons stop for your explicit approval first. |
| 00:31 to 00:39 | Give window | Give window dialog selecting an application window, followed by an agent driving that window with a colored cursor. | Through the Give window dialog, you grant agents access to specific Windows apps. Agents receive their own visible cursor, and your real mouse never moves. |
| 00:39 to 00:46 | Home | Home screen showing project folders, worktrees, active agent tasks, and overnight run cards. | The Home screen organizes your projects, git worktrees, and overnight agent progress into one clean tree. |
| 00:46 to 00:53 | Add-ons and Settings | Add-ons screen displaying detected agent CLIs and permissions, then switching to Settings with the takeover hotkey. | In Add-ons and Settings, you manage installed agent CLIs, plugin permissions, and emergency pause keys. |
| 00:53 to 01:00 | Wall | Returning to the Wall, with text showing the GitHub repository URL and limits. | cc is a pre-release project at version 0.1.0. It is Windows only and installs from source. cc is not affiliated with Anthropic, OpenAI or Google. Try it on GitHub. |

## community-blurb

I built cc, an open source desktop IDE for running coding agents side by side on Windows. Terminals run under a background service and stay alive if the window closes. When an agent needs input, its tile turns orange and moves to the big slot. It includes an editor, diff reviews, and safe browser use.
Limits: Windows only, pre-release v0.1.0, install from source. cc is not affiliated with Anthropic, OpenAI or Google.
Repo: https://github.com/Wasif-ZA/metatrooper

## newsletter-email

Subject: DRAFT: cc: open source desktop IDE for coding agents on Windows

Hi [Editor],

I built cc, an open source desktop IDE for developers running CLI coding agents like Claude Code or Codex.

cc hosts agents in persistent terminal tiles. When an agent needs input, its tile turns orange and moves to the main slot. Terminals run under a background service, so sessions survive if the window closes. It includes diff reviews and safe browser automation.

The core is AGPL-3.0 open source, local only, with no accounts and no telemetry.

Honest limits: pre-release v0.1.0, Windows only, install from source.

cc is not affiliated with Anthropic, OpenAI or Google.

Repo: https://github.com/Wasif-ZA/metatrooper

Notes for editors:
- Console.dev: Highlight AGPL-3.0 licence and pre-release status.
- TLDR / Changelog: Emphasize multi-agent terminal coordination.

Best,
Wasif
