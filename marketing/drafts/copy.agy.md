# Copy Audit and Replacement: cc

This document audits the copy in `site/index.html` against `README.md`, provides strict replacements for unsupported claims, and specifies banner copy for social assets.

---

## 1. Claim Audit

Every factual claim in `site/index.html` evaluated strictly against `README.md`.
Verdicts:
- **backed**: explicitly supported by line(s) in `README.md`.
- **not backed**: absent from `README.md`.
- **contradicted**: conflicts directly with facts in `README.md`.

| Location in `site/index.html` | Claim in `site/index.html` | `README.md` Line(s) | Verdict | Notes |
|---|---|---|---|---|
| `<title>` (line 6) | Product name is "Ouros" | 4, 64-65 | **contradicted** | Product name is `cc`. The repo and package names use `MetaTrooper`. The window mark says `cc`. |
| `<meta name="description">` (line 7) | "Run Claude Code, Codex and Gemini side by side on one wall." | 5, 47, 56, 80 | **backed** | Supported by lines 5, 47, 56, and 80. |
| `<meta name="description">` (line 7) | "Agents can drive a browser and your Windows apps, and anything risky stops for you first." | 6 | **backed** | Verbatim from line 6. |
| `<meta name="description">` (line 7) | "Free, open source, local, no account." | 1, 22, 31, 321-325 | **not backed** | "Local, no account" is backed. Licences are AGPL-3.0 and MIT, but the terms "free" and "open source" do not appear in `README.md`. |
| Header brand (line 80) | Brand is `Ouros` | 4, 64-65 | **contradicted** | Product name is `cc`. |
| Hero `<h1>` (line 85) | "Your agents. One wall." | 5, 47, 56 | **backed** | Live terminal tiles side by side on the wall. |
| Hero `<p>` (line 86) | "Run Claude Code, Codex and Gemini side by side, each in a terminal that keeps going." | 5, 80 | **backed** | Supported by lines 5 and 80. |
| Hero `<p>` (line 86) | "The one that needs you comes to you." | 127 | **backed** | Supported by line 127. |
| Hero `<p>` (line 86) | "Agents can drive a browser and your Windows apps, and anything risky stops for you first." | 6 | **backed** | Verbatim from line 6. |
| Hero `.facts` (line 87) | "Windows first, Linux beta" | 1, 23, 78 | **not backed** | Line 1 states "Windows first" and line 78 specifies "Windows 10 or 11". Linux is never mentioned in `README.md`. |
| Hero `.facts` (line 87) | "Local, on your machine" | 1, 283 | **backed** | Supported by line 1 ("Local only") and line 283. |
| Hero `.facts` (line 87) | "No account, no telemetry" | 1, 31 | **backed** | Verbatim in line 1 and line 31. |
| Hero install (line 88) | `git clone https://github.com/Wasif-ZA/metatrooper` | 84 | **backed** | Matches line 84. |
| Hero figure (line 90) | "Recording: four agents on the wall; one asks a question, turns orange and moves to the big slot" | 47, 56, 127-128 | **backed** | Describes wall behavior where a waiting tile turns orange and moves to the big slot. |
| Hero caption (line 90) | "The wall, on demo data." | None | **not backed** | "Demo data" is not mentioned in `README.md`. |
| Section "Four parts" (line 94) | "Four parts" | 52-59 | **backed** | Supported by line 52. |
| Section "Four parts" (line 95) | "Free and open source." | 22, 321-325 | **not backed** | `README.md` details AGPL-3.0 and MIT licences, but does not use the words "free" or "open source". |
| Section "Four parts" (line 95) | "It runs the official CLIs you install and sign in to yourself, and never reads their logins." | 61-62 | **backed** | Supported by lines 61-62 ("cc runs the official CLIs you install and sign in to yourself. It never signs in for you and never reads their login tokens."). |
| Card 1 (line 97) | "The wall: Every agent is a live terminal tile. The one waiting for you comes to the big slot." | 47, 56 | **backed** | Supported by lines 47 and 56. |
| Card 2 (line 98) | "Browser use: Agents drive browser panes in the app. New sites, passwords and send buttons wait for you." | 57, 147 | **backed** | Supported by lines 57 and 147. |
| Card 3 (line 99) | "Computer use: On Windows, agents act on the app windows you give them. One key takes over." | 58, 171, 184 | **backed** | Supported by lines 58, 171, and 184. |
| Card 4 (line 100) | "Core services: A background service owns the terminals. Sessions come back after a restart." | 59, 196, 198 | **backed** | Supported by lines 59, 196, and 198. |
| Section heading (line 107-108) | "Needs you", "The one that needs you comes to you." | 48, 127 | **backed** | Supported by lines 48 and 127. |
| Wall list (line 110) | "True status. Working, waiting for you, done or exited, read from each agent's own hooks. A waiting tile says why." | 130-132 | **contradicted** | Hooks are only used for Claude Code; Codex uses notify settings and others use process status. `README.md` does not state that "A waiting tile says why". |
| Wall list (line 111) | "No stolen keys. A waiting tile holds back for 3 s while you type in the big one." | 127-128 | **backed** | Supported by lines 127-128. |
| Wall list (line 112) | "Alt keys. Alt+J jumps to the longest wait. Your terminal keeps every Ctrl key." | 133-134 | **backed** | Supported by lines 133-134. |
| Wall list (line 113) | "Ctrl+K. One search over sessions, commands and the text in every terminal." | 135 | **backed** | Supported by line 135. |
| Wall list (line 114) | "Per tile. Cost, context fill, changed files, and a preview chip for its dev server." | 136-137 | **backed** | Supported by lines 136-137. |
| Browser section (line 123) | "A browser your agents drive, with you in charge." | 57, 144, 149 | **backed** | Supported by lines 57, 144, and 149. |
| Browser list (line 125) | "Approvals. Password fields, credential-like text and Send, Pay or Delete buttons stop at a card. Approve once, for the session, or reject." | 147-150 | **backed** | Supported by lines 147-150. |
| Browser list (line 126) | "Origins. The first input on a new site asks first. List trusted sites in the project config." | 151-152, 268-270 | **contradicted** | Allowed origins are set in `browser.allow_origins` in `~/.metatrooper/settings.json`. Lines 268-270 state: "A project's .troop/config.json cannot add to it, since an agent can write that file". |
| Browser list (line 127) | "Secrets. An agent types {{secret:NAME}} into a password field on the saved site. It never sees the value." | 159-160 | **backed** | Supported by lines 159-160. |
| Browser list (line 128) | "Handoff. An agent can hand you the pane to sign in, then you give it back." | 162-163 | **backed** | Supported by lines 162-163. |
| Browser list (line 129) | "Its own cursor. Each agent's cursor glides to what it clicks, in its tile's colour. Your pointer never moves." | 166-167 | **backed** | Supported by lines 166-167. |
| Browser figure (line 132) | "Recording: an agent's coloured cursor glides to a Send button in a browser pane and an approval card appears" / "Browser use with the agent cursor." | 147-148, 166-167 | **backed** | Supported by lines 147-148 and 166-167. |
| Desktop section (line 139) | "Your Windows apps, only the ones you give." | 58, 171, 174 | **backed** | Supported by lines 58, 171, and 174. |
| Desktop list (line 141) | "Grants. Pick Give window on a tile. The agent acts on that window and its own dialogs, nothing else." | 174-175 | **backed** | Supported by lines 174-175. |
| Desktop list (line 142) | "Built in. It uses Windows UI Automation. Nothing extra is installed." | 171-172 | **backed** | Supported by lines 171-172. |
| Desktop list (line 143) | "Take-over. Ctrl+Alt+Q pauses every agent's input, desktop and browser." | 184-185 | **backed** | Supported by lines 184-185. |
| Desktop list (line 144) | "Watcher. Input from another program, or a change while you are away, pauses the agents and tells you." | 186-189 | **backed** | Supported by lines 186-189. |
| Desktop list (line 145) | "Refused. The Ouros window, admin windows and the secure desktop can never be given." | 4, 64-65, 177 | **contradicted** | Line 177 specifies "The cc window, elevated (admin) windows and the secure desktop can never be granted." Product name is `cc`, not `Ouros`. |
| Desktop figure (line 148) | "Recording: an agent types into Notepad with its cursor showing; Ctrl+Alt+Q pauses it and the tile says paused by you" | 184-185 | **not backed** | `README.md` never mentions `Notepad`. Line 185 states calls return `"paused by the user"`, not `"paused by you"`. |
| Core section (line 153) | "Core services" | 15, 54, 59, 194 | **backed** | Supported by lines 15, 54, 59, and 194. |
| Core subhead (line 154) | "The parts you notice only when they are missing." | None | **not backed** | Unbacked phrase not present in `README.md`. |
| Core list (line 156) | "Terminals that survive. Close or crash the window and every agent keeps working." | 196-197 | **backed** | Verbatim match to lines 196-197. |
| Core list (line 157) | "Sessions come back. After a restart, live sessions resume in the same layout, at most 3 at a time." | 198-199 | **backed** | Supported by lines 198-199. |
| Core list (line 158) | "Ports and previews. A dev server an agent starts gets an Open preview chip. Agent panes reach only their own ports." | 201-203 | **backed** | Supported by lines 201-203. |
| Core list (line 159) | "Quiet notifications. No toast for the tile you are looking at. Optional ntfy, Slack, Discord, Teams or webhook." | 204-205 | **backed** | Supported by lines 204-205. |
| Core list (line 160) | "Limits that carry on. A Claude session that hit its limit continues when the limit resets." | 206-207 | **backed** | Supported by lines 206-207. |
| Core list (line 161) | "Public API. A named pipe with JSON-RPC and stable, versioned methods. No TCP port." | 210-212 | **backed** | Supported by lines 210-212. |
| Works with (line 166-167) | "Works with", "Any interactive CLI agent an engine file describes. Built in, among others." | 5, 31, 80, 131-132, 235, 324 | **backed** | Supported by lines 31, 131-132, 235, and 324. |
| Works with chips (line 168) | `Claude Code` | 5, 80, 104, 130, 206, 214, 229, 249, 276 | **backed** | Explicitly supported across `README.md`. |
| Works with chips (line 168) | `Codex CLI` | 5, 80, 130, 214, 230, 236, 260 | **backed** | Explicitly supported across `README.md`. |
| Works with chips (line 168) | `Gemini CLI` | 80, 214 | **backed** | Line 80 lists `gemini` CLI; line 214 lists `Gemini`. |
| Works with chips (line 168) | `Antigravity CLI (agy)` | 80, 260 | **backed** | Line 80 and 260 list `agy`. |
| Works with chips (line 168) | `opencode` | None | **not backed** | `opencode` does not appear anywhere in `README.md`. |
| Works with chips (line 168) | `MCP servers and plugins` | 144, 171, 214-215, 238 | **backed** | Supported by lines 144, 171, 214-215, and 238. |
| Get started (line 172) | "Get started" | 10, 72 | **backed** | Quickstart section in `README.md`. |
| Get started (line 173) | "There is no installer yet. You run it from a clone. You need Node 24.16 or newer and at least one agent CLI signed in." | 74, 79, 80 | **backed** | Supported by lines 74, 79, and 80. |
| Get started code (lines 174-177) | Setup code block omitting `node core/cli.ts start` | 84-88, 91 | **contradicted** | Omits `node core/cli.ts start`. Quickstart requires starting the core in the background before launching workbench. |
| Get started note (line 178) | "The window starts the core service for you. Linux steps and every command are in the README." | 78, 88 | **contradicted** | Line 88 requires manual core start (`node core/cli.ts start`). Line 78 specifies Windows only; `README.md` contains zero Linux steps. |
| Limits (line 182) | "Limits, stated plainly" | 17, 299 | **backed** | Known limits section. |
| Limits list (line 184) | "Windows first. Linux is a beta from source, without computer use. macOS is not supported." | 1, 23, 78 | **not backed** | `README.md` states "Windows first" and lists Windows 10 or 11 only. Neither Linux beta nor macOS is mentioned. |
| Limits list (line 185) | "No installer or auto-update yet. You update with git pull." | 74 | **not backed** | Line 74 backs "There is no installer yet", but "auto-update" and "You update with git pull" do not appear in `README.md`. |
| Limits list (line 186) | "Not a guard against hostile programs. Grants and approvals cover Ouros's own tools. A program running as you can already drive your apps; the watcher tells you when it sees one." | 4, 64-65, 186-189, 305-306 | **contradicted** | Substantive points backed by lines 186-189 and 305-306, but the product name `Ouros` contradicts `cc`. |
| Limits list (line 187) | "Take-over is close to instant. A key already posted to an app may land just after the pause." | 311-312 | **backed** | Verbatim from lines 311-312. |
| Limits list (line 188) | "No sandbox for agents' code yet. Agents use your machine with your permissions." | 315-316 | **backed** | Supported by lines 315-316. |
| Questions: What leaves my machine? (line 194) | "The core and the window make no network connection of their own. Your agents talk to their own vendors, as they do outside Ouros. Pages you open in a browser pane load as in any browser." | 4, 64-65, 283-285 | **contradicted** | Technical answer is backed by lines 283-285, but "outside Ouros" contradicts `cc`. |
| Questions: Do I need an account or API keys? (line 195) | "No. Install and sign in to the official CLIs yourself. Ouros runs them and never reads their login tokens." | 1, 4, 31, 61-62, 64-65 | **contradicted** | Backed by lines 1, 31, and 61-62, but naming `Ouros` contradicts `cc`, and "API keys" is absent from `README.md`. |
| Questions: What does it change? (line 196) | "State lives in ~/.metatrooper/. Launching Claude Code installs hooks in its settings file, and one command takes them out again, leaving the rest byte for byte." | 104-106, 288 | **backed** | Supported by lines 104-106 and 288. |
| Questions: Can an agent approve? (line 197) | "No. Only the window can approve, through a key agents are not given." | 149 | **not backed** | Line 149 confirms "Only the window can approve, never an agent", but "through a key agents are not given" is not in `README.md`. |
| Questions: Licence (line 198) | "The core and window are AGPL-3.0. The SDK, plugins, skills, engine files and public formats are MIT." | 22, 321-325 | **backed** | Supported by lines 22 and 321-325. |
| Release section (line 202) | "Hear about the first release. On GitHub, choose Watch, then Custom, then Releases. You hear once, when the first release is tagged. Watch releases on GitHub" | 24, 84 | **not backed** | Line 24 notes "status pre-release" and line 84 provides the GitHub link, but release watch instructions are not in `README.md`. |
| Footer brand (line 206) | Brand link `Ouros` | 4, 64-65 | **contradicted** | Product name is `cc`. |
| Footer author (line 207) | "Built in Sydney by Wasif Zaman." | 84 | **not backed** | `README.md` gives the repository URL `Wasif-ZA/metatrooper` in line 84, but neither "Sydney" nor "Wasif Zaman" appears in `README.md`. |
| Footer disclaimer (line 207) | "Not affiliated with or endorsed by Anthropic, OpenAI or Google." | 62 | **backed** | Supported by line 62. |
| Footer source link (line 208) | `Source` link to repository | 84 | **backed** | Matches line 84. |

---

## 2. Replacement Copy

Strict replacements for every claim that is not backed or contradicted, plus new page metadata. Every line uses only facts from `README.md` and cites its line numbers. Public copy uses `cc`, never `Ouros`.

### Page Metadata

#### `<title>`
- `cc: an IDE built around your coding agents` (cite: line 4)

#### `<meta name="description">` (must be under 160 characters)
- `cc runs Claude Code and Codex in live terminal tiles. Risky actions stop for you. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 4-6, 56, 62)
  - Character count: 130 characters.
- Alternative without vendor names:
  `cc is an IDE built around CLI coding agents. Live terminal tiles show who needs you. Risky browser and Windows actions stop for you.` (cite: lines 4-6, 56-58)
  - Character count: 132 characters.

#### `og:description` (must be under 200 characters)
- `cc runs Claude Code, Codex and other CLI agents side by side in terminal tiles. Risky browser and Windows actions stop for you. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 4-6, 56-58, 62)
  - Character count: 176 characters.

#### `twitter:description` (must be under 200 characters)
- `cc puts your coding agents in live terminal tiles. The agent that needs you comes to you. Risky actions stop for you. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 4-6, 56, 62, 127)
  - Character count: 168 characters.

#### `og:image:alt`
- `cc wall showing agent terminal tiles, with an orange tile in the big slot waiting for user input.` (cite: lines 47, 56, 127-128)

---

### Replacement Copy for Content Audit Items

#### Brand and Header (replacing `Ouros`)
- Header Brand: `cc` (cite: lines 4, 65)
- Footer Brand: `cc` (cite: lines 4, 65)

#### Hero Facts List (replacing `Windows first, Linux beta`)
- Line 1: `Windows first. Windows 10 or 11.` (cite: lines 1, 78)
- Line 2: `Install from source.` (cite: lines 1, 74)
- Line 3: `Local only: no account, no telemetry.` (cite: lines 1, 31)

#### Hero Screenshot and Figure (replacing "on demo data")
- Caption: `The wall with agent terminal tiles.` (cite: lines 47, 56)
- Alt text: `Four agent terminal tiles on the wall. One asks a question, turns orange, and moves to the big slot.` (cite: lines 47, 56, 127-128)

#### Section "Four parts" Subhead (replacing "Free and open source")
- Subhead: `Core under AGPL-3.0. cc runs the official CLIs you install and sign in to yourself, and never reads their login tokens.` (cite: lines 22, 61-62, 323)

#### Wall Status Feature (replacing incorrect hooks claim)
- Heading: `Status you can trust.` (cite: line 130)
- Body: `Each tile says working, waiting for you, done or exited. Claude Code reports it through its hooks, Codex through its notify setting, and other engines from their process. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 62, 130-132)

#### Browser Allowed Origins Feature (replacing project config claim)
- Heading: `Origins.` (cite: line 151)
- Body: `The first input on a new site asks first. Sites listed in browser.allow_origins in your settings file never ask for being new.` (cite: lines 151-152, 267-270)

#### Windows App Granted Refusals (replacing `The Ouros window`)
- Heading: `What it refuses.` (cite: line 177)
- Body: `The cc window, elevated (admin) windows and the secure desktop can never be granted.` (cite: line 177)

#### Desktop Use Figure (replacing Notepad and "paused by you")
- Caption: `Computer use on a granted window, then the take-over key.` (cite: lines 170, 174, 184)
- Alt text: `An agent drives a granted Windows app with its cursor showing. Ctrl+Alt+Q pauses it and calls return paused by the user.` (cite: lines 182-185)

#### Core Services Subhead (replacing unbacked phrase)
- Subhead: `A background service owns the terminals. Sessions come back after a restart.` (cite: lines 59, 196, 198)

#### "Works with" Chips (cutting unbacked `opencode`)
- Chips: `Claude Code`, `Codex`, `Gemini`, `Antigravity CLI (agy)`, `MCP servers and plugins`. (cite: lines 80, 144, 171, 214-215, 260)
- Mandatory Disclaimer: `Not affiliated with or endorsed by Anthropic, OpenAI or Google.` (cite: line 62)

#### Quickstart Instructions and Commands (replacing inaccurate steps)
- Intro: `There is no installer yet. You run cc from a clone of this repo. You need Windows 10 or 11, Node 24.16 or newer, and at least one agent CLI installed and signed in.` (cite: lines 74, 78-80)
- Code block:
  ```bash
  git clone https://github.com/Wasif-ZA/metatrooper
  cd metatrooper/core && npm ci
  cd ../workbench && npm ci
  cd ..
  node core/cli.ts start
  node core/cli.ts ping
  cd workbench && npm run dev
  ```
  (cite: lines 84-89, 91)
- Note: `node core/cli.ts start starts the core in the background before the window opens. Tested on Windows 11.` (cite: lines 78, 88, 91)

#### Limits List Items (replacing Linux beta, auto-update, and `Ouros`)
- Platform limit: `Windows first. Requires Windows 10 or 11. Tested on Windows 11.` (cite: lines 1, 23, 78)
- Installer limit: `There is no installer yet. You run cc from a clone of this repo.` (cite: line 74)
- Threat model limit: `Grants and approvals do not stop a hostile program running as you. Such a program can already read your files and drive your apps.` (cite: lines 305-306)

#### Questions Section Items
- Question 1 (Network traffic):
  - Summary: `What leaves my machine?` (cite: line 283)
  - Answer: `The core and the window make no network connection of their own. Your agents talk to their own vendors, as they do outside cc. Pages you or an agent open in a browser pane load as in any browser.` (cite: lines 283-285)
- Question 2 (Accounts):
  - Summary: `Do I need an account?` (cite: lines 1, 31)
  - Answer: `No. Install and sign in to the official CLIs yourself. cc runs them and never reads their login tokens.` (cite: lines 1, 31, 61-62)
- Question 4 (Agent self-approval):
  - Summary: `Can an agent approve its own actions?` (cite: line 149)
  - Answer: `No. Only the window can approve, never an agent.` (cite: line 149)

#### Release Section (cutting unbacked GitHub release notification flow)
- Heading: `Pre-release status.` (cite: line 24)
- Body: `cc is currently pre-release software. Repository source, issues and discussions live on GitHub.` (cite: lines 24, 84, 292)
- Action Button: `View source on GitHub` (cite: line 84)

#### Footer (replacing Sydney / author attribution)
- Text: `cc: an IDE built around your coding agents. Not affiliated with or endorsed by Anthropic, OpenAI or Google.` (cite: lines 4, 62)
- Link: `Source on GitHub` (cite: line 84)

---

## 3. Banner Copy

Copy for social and platform banners.
Rules applied:
- Every line cites its `README.md` lines.
- Headline is under 8 words (maximum 7 words).
- Supporting line is under 16 words (maximum 15 words).
- Where copy names Claude Code, Codex or Gemini, the line includes: `Not affiliated with Anthropic, OpenAI or Google.`
- No em dashes, no hype words, one idea per sentence, common words only.

### 1. Open Graph Card (1200x630)

#### Copy Option A (With Agent Engine Names)
- **Headline**: `cc: an IDE for coding agents` (cite: line 4)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Run Claude Code side by side. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 5, 62)
  - Word count: 13 words (under 16 words).

#### Copy Option B (General)
- **Headline**: `cc: an IDE for coding agents` (cite: line 4)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Live terminal tiles show who needs you. Risky actions stop for you.` (cite: lines 5, 6, 56)
  - Word count: 12 words (under 16 words).

---

### 2. GitHub Social Preview (1280x640)

#### Copy Option A (With Agent Engine Names)
- **Headline**: `Your coding agents on one wall` (cite: lines 4, 47, 56)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Claude Code and Codex in live terminals. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 5, 56, 62)
  - Word count: 14 words (under 16 words).

#### Copy Option B (General)
- **Headline**: `Your coding agents on one wall` (cite: lines 4, 47, 56)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Terminal tiles show who needs you. Local only with no accounts and zero telemetry.` (cite: lines 1, 31, 56)
  - Word count: 14 words (under 16 words).

---

### 3. X Header (1500x500)

#### Copy Option A (With Agent Engine Names)
- **Headline**: `Live terminal tiles for coding agents` (cite: line 56)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Claude Code and Gemini side by side. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 5, 62, 80)
  - Word count: 14 words (under 16 words).

#### Copy Option B (General)
- **Headline**: `Live terminal tiles for coding agents` (cite: line 56)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Terminals that keep going. The agent waiting for you moves to the big slot.` (cite: lines 5, 56, 127, 196)
  - Word count: 14 words (under 16 words).

---

### 4. LinkedIn Banner (1584x396)

#### Copy Option A (With Agent Engine Names)
- **Headline**: `An IDE built around coding agents` (cite: line 4)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Run Claude Code with approval stops. Not affiliated with Anthropic, OpenAI or Google.` (cite: lines 5, 6, 62, 147)
  - Word count: 13 words (under 16 words).

#### Copy Option B (General)
- **Headline**: `An IDE built around coding agents` (cite: line 4)
  - Word count: 6 words (under 8 words).
- **Supporting line**: `Agents drive browser panes and Windows apps. Risky actions stop for approval.` (cite: lines 6, 57-58, 147)
  - Word count: 12 words (under 16 words).

---

### Asset and Visual Guidelines for Banners

Specs from `assets/logos/README.md` and repo guidelines:
- **Colours**:
  - Ink: `#151516` (background for dark cards, text for light cards)
  - Paper: `#f1f1ef` (background for light cards, text for dark cards)
  - Wait orange: `#ff7a1a` on dark backgrounds, `#c45200` on light backgrounds
- **Typography**:
  - Primary monospace: `Cascadia Mono`
  - Fallback stack: `ui-monospace, Consolas, monospace`
- **Logo and Marks**:
  - Main mark: `assets/logos/cc-mark.svg` (ink tile with nested c's and orange dot)
  - Wordmark: `assets/logos/cc-wordmark.svg` (mark plus `cc` in Cascadia Mono)
  - Light backgrounds: `assets/logos/cc-mark-ink.svg`
  - Dark backgrounds: `assets/logos/cc-mark-paper.svg`
  - Clear space: one dot width on every side.
  - Dot rule: do not recolour the orange dot.
- **Product Screenshots**:
  - Wall overview: `assets/ouros/wall.png`
  - IDE screen: `assets/ouros/ide.png`
