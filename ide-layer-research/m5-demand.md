# MetaTrooper demand check before the 2026-12-01 launch

Written 2026-10-09T18:45+11:00. Raw results: `~/.cache/claude-scratch/metatrooper-m5-2026-10-09/demand/`.

## The answer

Launch with the coding desk and four coding pipelines. Everything else people ask for in this space is
about the desk itself (more engines, remote machines, several repos, several accounts, one instruction
file), not about running video, sales or email jobs from it.

- **Keep for launch (4 of 17 pipelines):** spec-to-pr, spec-build-review-handback, two-engine-review,
  e2e-browser-qa.
- **Keep for after launch (2):** footage-to-edit, website-build. Real demand, but heavy to maintain.
- **Cut to template (8):** design-variants, docs-and-release-notes, security-review-and-upgrade,
  clips-to-scheduled-posts, seo-audit-fix, deep-research-cited, data-to-dashboard, form-fill-batch.
- **Cut to later, not in the gallery (3):** prospect-list-to-drafts, inbox-triage-drafts,
  study-notes-to-pdf. No signal from anyone running a coding desk.
- **Features cut or held:** inspiration board, variants grid, agent cursors, 12 of the 15 run layouts,
  TOON output (stays an opt-in flag), Tauri tray, code map, sandbox host (off by default).

One threat to the money plan: `openai/codex-plugin-cc` (33,994 stars) already gives Claude Code users a free,
official Codex review. Pro cannot sell "Codex reviews Claude". It has to sell the fix loop, the proof gate,
and the third engine.

## How this was counted

- GitHub numbers are **total reactions** on the issue (`reactions.total_count`), pulled 2026-10-09. The
  2026-10-08 file counted thumbs-up only, so some numbers differ slightly (cmux Linux: 218 then, 219 now).
- HN numbers are points, treated as the same unit as GitHub reactions for ranking. Stars are shown as context but never used to rank, because a star counts a
  toolkit, not a request.
- **Ranking rule:** the strongest single signal decides the rank. Ties break on how many independent
  repos or forums raised it. Signals are never added across sources.
- **The desk test** for each pipeline: did anyone ask to run it from an agent desk or a coding agent, or
  does only a standalone product exist? Stars for a standalone product (browser-use, Skyvern, Renovate)
  prove the category exists, not that a desk should own it.
- Reddit: 10 Exa searches over r/ClaudeAI, r/ClaudeCode, r/ChatGPTCoding and r/codex, 6 to 8 threads each. Reddit blocked direct reads (Jina and
  old.reddit both refused), so Reddit evidence is thread presence and date only, no vote counts.
- Exa's free limit cut in twice; every query finished on a slower retry. The raw `exa_p09.json` (SEO) was
  later overwritten by a rate-limit reply; its results survive in `demand/exa-summary-1.txt`.
- Rivals pulled: stablyai/orca, herdrdev/herdr, manaflow-ai/cmux, superset-sh/superset,
  BloopAI/vibe-kanban, smtg-ai/claude-squad, generalaction/emdash, coder/mux (now `coder/xum`, few
  issues), pingdotgg/t3code, slopus/happy. Top 40 each, in `demand/rival-top-issues.tsv`.

## 1. The 20 most-asked-for capabilities

"MT" says whether MetaTrooper has it today.

| # | Capability | Strongest signal | Other sources | MT |
|---|---|---|---|---|
| 1 | One instruction file every agent reads (AGENTS.md) | 6,685 reactions, [claude-code #6235](https://github.com/anthropics/claude-code/issues/6235), 2025-08-21 | claude-code #31005 546 (2026-03-05); t3code skill discovery bugs 65, 32, 22 | Partial: importers bring skills, not instruction files |
| 2 | Linux desktop | 1,463, [codex #11023](https://github.com/openai/codex/issues/11023), 2026-02-07 | cmux #330 219 (2026-02-23); superset #405 23 | Partial: code is portable, only Windows tested |
| 3 | Several accounts or subscriptions per engine | 1,055, [claude-code #18435](https://github.com/anthropics/claude-code/issues/18435), 2026-01-15 | claude-code #36151 1,036; orca #11557 21 (2026-07-30) | No |
| 4 | Remote, SSH and WSL backends | 876, [codex #10450](https://github.com/openai/codex/issues/10450), 2026-02-03 | t3code WSL 137 and remote backends 32; cmux #1664 38; superset #1513 34; herdr #1170 18; emdash #901 8 | No |
| 5 | Usage and limits visible before you hit them | 726, [claude-code #16157](https://github.com/anthropics/claude-code/issues/16157), 2026-01-03 (limit complaint) | claude-code #38335 545; codex #28879 560; t3code #228 37; HN Usage Monitor 245 (2025-06-19); 8 Reddit tracker apps 2026-03 to 2026-08; CodexBar 22.3k stars | Yes |
| 6 | Code intelligence (LSP, find references) | 607, [codex #8745](https://github.com/openai/codex/issues/8745), 2026-01-05 | orca #961 37, #3035 27, #14872 14; gemini-cli #2465 132 | Partial: code map is not LSP |
| 7 | Drive and approve from a phone | 544, [codex #9224](https://github.com/openai/codex/issues/9224), 2026-01-14 | claude-code #29006 165, #28351 138; HN Omnara 310 (2025-08-12); Reddit r/ClaudeCode 4 threads 2025-12 to 2026-04 | No (v3) |
| 8 | Undo or rewind an agent's change | 521, [codex #9203](https://github.com/openai/codex/issues/9203) | claude-code #353 178 | Partial: worktrees, engine rewind |
| 9 | Plan or spec before code | 505, [codex #2101](https://github.com/openai/codex/issues/2101) | gemini-cli #4666 203; vibe-kanban #1848 8; spec-kit 140.5k stars; HN spec workflow for Claude Code 20 (2026-05-22) | Yes |
| 10 | Keep secrets out of the agent's context | 470, [codex #2847](https://github.com/openai/codex/issues/2847), 2025-08-28 | Reddit "Claude Code wishlist" .claudeignore, 2025-03-12 | Partial: gitleaks at publish gates |
| 11 | Subagents shown as nested threads | 413, [codex #2604](https://github.com/openai/codex/issues/2604) | t3code subagent threads 36; t3code OpenCode subagents 25 | Partial |
| 12 | Review the diff inside the tool | 285, [claude-code #33932](https://github.com/anthropics/claude-code/issues/33932), 2026-03-13 | superset #935 13; orca PR reviews 14; emdash #1635 4; Reddit "trust me bro" thread 2026-03-04 | Yes |
| 13 | Two models check each other's work | HN Mysti 216, [item 46365105](https://news.ycombinator.com/item?id=46365105), 2025-12-23 | HN adamsreview 85 (2026-05-11); 8 Reddit threads in r/ChatGPTCoding, r/ClaudeCode, r/codex, r/ClaudeAI, 2026-03 to 2026-08; codex-plugin-cc 34.0k stars; claude-review-loop 724; pr-cockpit 494 | Yes |
| 14 | More engines: Pi, Copilot CLI, OpenCode, Kiro | 198, [t3code #402](https://github.com/pingdotgg/t3code/issues/402), 2026-03-07 | t3code Copilot 185, OpenCode 130; happy OpenCode 55, 41, 36, 29, Pi 30; orca DeepSeek 31; vibe-kanban Kiro 11 | No: three engines |
| 15 | Issues from a tracker (GitHub, GitLab, Gitea) become tasks | 152, [claude-code #12346](https://github.com/anthropics/claude-code/issues/12346) | vibe-kanban GitLab 26, import issues 9, sync 7; orca task sources 20, Gitea 18, Forgejo 14; superset GitLab 11 | No |
| 16 | A local sandbox so skip-permissions is safe | HN Coasts 99, [item 47575417](https://news.ycombinator.com/item?id=47575417), 2026-03-30 | claude-code sandbox #28018 80; orca #13665 21; superset 6 (2026-10-08 thumbs-up count); HN yolo-cage 60; 6 Reddit threads building their own, 2026-01 to 2026-05 | Yes (sandbox host) |
| 17 | Several repos in one workspace | 70, [orca #1099](https://github.com/stablyai/orca/issues/1099), 2026-04-26 | orca #7568 40, #21118 13; t3code #1453 33; superset #2364 21; claude-squad 7, 6; vibe-kanban 7; mux 4 | No |
| 18 | Reliable "needs you" alerts | 69, [claude-code #29438](https://github.com/anthropics/claude-code/issues/29438) | t3code #780 64; cmux #1027 42 and #2322 22; emdash 4; vibe-notch 2.5k stars; 8 Reddit threads 2025-10 to 2026-07 | Yes (hand-back tray, OSC) |
| 19 | Sessions and layouts survive a restart | 50, [cmux #480](https://github.com/manaflow-ai/cmux/issues/480), 2026-02-25 | cmux 37, 27; superset 9 (2026-10-08 thumbs-up count); t3code load `codex resume` threads 26; claude-squad 3 | Yes (core reattach) |
| 20 | A browser inside the tool | 27, [cmux #719](https://github.com/manaflow-ai/cmux/issues/719), 2026-03-01 | cmux browser engines 24; Reddit "Codex has in-app browsers" 2026-07-10; HN Comet MCP 28, Peek-CLI 13; chrome-devtools-mcp 53.8k stars | Yes |

Just below the cut: an unattended loop (vibe-kanban "Ralph Wiggum mode" 20; snarktank/ralph 21.9k
stars), no sign-in and no telemetry (superset 22 and 11; t3code telemetry 19 (2026-10-08 thumbs-up count); vibe-kanban 10), worktree
setup hooks and naming (herdr 24, vibe-kanban cleanup 19, superset 13 and 10, claude-squad 8).

A warning from the same data: vibe-kanban's top issue is "Bring back old UI" (33), plus "keep the Kanban
board" (15, 15, 8, 7). Moving users between layouts costs goodwill.

## 2. Verdicts

Evidence count = independent sources found (repos, forums, HN posts, guides), not votes.

### The 17 pipelines

| Lane | Pipeline | Verdict | Evidence | Reason |
|---|---|---|---|---|
| coding | spec-to-pr | KEEP-LAUNCH | 9 | Plan-first is a top ask (codex 505, gemini 203); spec-kit 140.5k and superpowers 296.7k; Reddit "Claude plans, Codex builds" threads |
| coding | spec-build-review-handback | KEEP-LAUNCH | 6 | Same demand as spec-to-pr, and it is the only path for GitLab and no-PR users (vibe-kanban GitLab 26, emdash local merge 3). It shares every step with spec-to-pr except the last, so keeping both costs one pipeline plus a tail |
| coding | two-engine-review | KEEP-LAUNCH | 12 | Most independent sources of any pipeline; 8 Reddit threads describe doing it by hand. Free rival: codex-plugin-cc 34.0k |
| coding | e2e-browser-qa | KEEP-LAUNCH | 9 | chrome-devtools-mcp 53.8k, playwright-mcp 38.0k, agent-browser 43.7k are all agent-run; HN Magnitude 179; 7 Claude Code how-to posts 2026-03 to 2026-05 |
| design | website-build | KEEP-AFTER | 6 | Demand is skill-shaped (ui-ux-pro-max-skill 134.0k, screenshot-to-code 80.1k); no rival issue asks a desk for it |
| design | design-variants | CUT (template) | 7 | Already a common skill (gstack design-shotgun, give-me-five, design-explore, design-variant-picker, parallel-design-variants) and Figma's agent does it; no votes or issues, so a template is enough |
| docs | docs-and-release-notes | CUT (template) | 3 | git-cliff 12.3k and release-drafter 3.9k run in CI; AI changelog posts on HN top out at 5 points |
| security | security-review-and-upgrade | CUT (template) | 4 | Renovate 22.7k owns upgrades; claude-code-security-review 6.3k is a CI action; two-engine-review already finds security issues |
| video | footage-to-edit | KEEP-AFTER | 6 | Real agent demand: browser-use/video-use 28.5k ("edit videos with coding agents"), hyperframes 59.4k, HN Palmier 191; but ffmpeg and render maintenance, and not a coding-desk launch story |
| video | clips-to-scheduled-posts | CUT (template) | 3 | Owned by SaaS (8 Opus Clip style products in one search) and postiz 36.9k; posting needs platform APIs and gates |
| seo | seo-audit-fix | CUT (template) | 5 | claude-seo 18.6k and marketingskills 53.8k are skills; HN "Claude Code SEO" has no post over 10 points |
| research | deep-research-cited | CUT (template) | 4 | gpt-researcher 30.0k and storm 31.6k are standalone; Claude Code skills exist (1.2k top); no desk ask |
| marketing | prospect-list-to-drafts | CUT (later) | 0 | HN: no post over 10 points; repos at 3 stars or less; sales SaaS owns it; sends email, so maximum gate cost |
| email | inbox-triage-drafts | CUT (later) | 1 | GitHub repos at 0 to 1 star; one Claude Code guide (Fluxmail, 2026-09-24); Gmail OAuth upkeep |
| data | data-to-dashboard | CUT (template) | 3 | 8 "CSV to dashboard with Claude Code" tutorials, all one-prompt jobs; HN hits are YC products |
| study | study-notes-to-pdf | CUT (later) | 0 | Only consumer SaaS note apps; nobody runs this from a coding desk |
| forms | form-fill-batch | CUT (template) | 2 | browser-use 117.3k and Skyvern 23.2k own it as standalone tools; captcha and terms risk |

Lanes at launch drop from 12 to 1 (coding), with design and video back after launch.

### Major features

| Feature | Verdict | Evidence | Reason |
|---|---|---|---|
| Wall of engine terminals | KEEP-LAUNCH | 15+ | Every rival; 15 Reddit threads asking how to run several sessions; HN parallel-agent posts 189 and 174 |
| Gates before anything external | KEEP-LAUNCH | 6 | gemini-cli "cost me 300 dollars" 170; cmux forced bypass 27 and trust bypass 19; superset hardcoded skip-permissions 13 |
| Hand-back tray | KEEP-LAUNCH | 7 | Rank 18 above; cmux's flaky "Needs Input" (42) is the complaint it answers |
| OSC signal | KEEP-LAUNCH | 4 | Plumbing for the hand-back tray; herdr agent-detection bugs (11, 6, 6) show screen-guessing fails |
| Usage limits meter | KEEP-LAUNCH | 8 | Rank 5; Pane already advertises it, so it is expected, not a differentiator |
| Live browser panes | KEEP-LAUNCH | 9 | Rank 20, and e2e-browser-qa needs one. Everyone is converging on it: herdr-browser pane, agent-browser live dashboard, VS Code agent browser tools, Cloudflare Live View |
| Agent cursors in the browser pane | KEEP-AFTER | 0 | Nobody asked; nice demo, extra upkeep |
| Plugin system with importers | KEEP-LAUNCH | 6 | Skills dwarf tools (superpowers 296.7k, anthropics/skills 180.0k); t3code skill-discovery bugs 65, 32, 22, 12 show importing is hard and wanted |
| Template gallery (17 templates) | KEEP-LAUNCH | 4 | Cheap, and it is where the cut pipelines go |
| 15 run layouts | CUT to 3 | 3 | Layout asks are small (cmux sidebar 25, tabs 18; t3code themes 29) and vibe-kanban's UI churn (33) shows the cost |
| Inspiration board | CUT (later) | 1 | One product sells it (moodspec, "the moodboard your coding agent can read"); no user ask, vote or issue anywhere |
| Variants grid | CUT (template) | 6 | Goes with design-variants; the skills above already open their own browser grid, so a browser pane covers it |
| Sandbox host (Docker) | KEEP-AFTER | 6 | Demand is real (rank 16), but Docker now ships Claude Code sandboxes itself (docker/docs); ship off by default |
| Code map | KEEP-AFTER | 4 | The asks are for LSP navigation (codex 607, orca 37, 27), not a map; code-review-graph 32.0k is installed, not owned |
| TOON output | CUT (later) | 1 | HN 178 is for the format (2025-10-26); no desk ask; token savings do not sell (Quesma). Leave the opt-in flag, do not market it |
| Tauri tray | KEEP-AFTER | 2 | Already deferred; cmux global-hotkey asks (26, 25) are the nearest signal |

Code map and TOON are cut on demand alone. The standing goal that MetaTrooper saves tokens is a separate
reason to keep building them after launch.

## 3. Five things users want that MetaTrooper lacks

1. **Several repos in one workspace.** Asked in 6 rivals: orca 70, 40 and 13; t3code 33; superset 21;
   claude-squad 7 and 6; vibe-kanban 7; mux 4. The widest cross-rival request found.
2. **Remote, SSH and WSL backends.** codex 876; t3code WSL 137; cmux 38; superset 34 and 11; herdr 18;
   emdash 8. A Windows-first desk that cannot reach WSL projects misses the people most likely to try it.
3. **More than three engines.** Pi 198, Copilot CLI 185, OpenCode 130 (t3code); OpenCode four times in
   happy (55, 41, 36, 29); orca DeepSeek 31; vibe-kanban Kiro 11. The engine registry is data, so each
   one is an adapter, not a rewrite.
4. **Several accounts per engine.** claude-code 1,055 and 1,036; orca 21. People with two Max plans want
   to switch without logging out.
5. **One instruction file for every engine.** claude-code AGENTS.md 6,685 and 546. MetaTrooper runs three
   engines that each read a different file (CLAUDE.md, AGENTS.md, GEMINI.md); keeping them in step is the
   job a three-engine desk is best placed to do.

Runner-up: tracker issues as tasks (claude-code GitLab 152; vibe-kanban 26, 9, 7; orca 20, 18, 14).
