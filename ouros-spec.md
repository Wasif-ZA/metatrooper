# Ouros: system spec (Milestone 8)

Copied 2026-10-31 from scratch `~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`. Relative links (CATALOGUE.md, kit files, boards) point at that scratch prototype until M8-1 moves the kit into this repo. Children: `spec.md` Milestone 8, `issues/m8-*.md`.


Written 2026-10-30, cleaned 2026-10-30T18:15+11:00 after a Codex + Gemini contradiction audit (../two-engine-docs/reconcile.md). Status: design, built as a working prototype in scratch. Real build starts after the freeze (from 2026-11-09).
Parts list: [CATALOGUE.md](CATALOGUE.md) (generated from kit.js). Evidence: RESEARCH.md, MORE.md, PIPELINES.md, INVENTORY.md in this folder.

## Answer first

**Direction, 2026-11-05 (Wasif). This narrows the list below where they differ.**

- Developers first. Non-developers doing code work next. His words: "mostly for devloper and people non devs too who needs to code work".
- Job screens are add-ons after launch. His words: they "will come after post launch". Children: M8-J1 to M8-J8.
- Core services first. His words: "spend more time on core services and how can differnt to exist markert". And: "have all means having nothing".
- The main aim is learning how apps are made, not money. Marketing comes later. He tests demand by posting online. Dates still matter.
- Item 6 is narrowed: "for anyone" now means developers, then non-developers doing code work. A baker's or a traveller's own job screen is an add-on.
- Item 8 is narrowed: the built-in workflows stay, and the first audience is developers.
- Items 0, 1 and 7 stay as the long-term idea. They are not the first release.

**The honest difference (`~/.cache/claude-scratch/ouros-direction-2026-11-05/core/CORE.html`, research-ide/F/RIVALS.md, read 2026-11-05).**

- Nothing is unique as written.
- Real today: the same gates on browser and computer use for any vendor's agent, with several agents at once and your pointer left alone on Windows. Computer use is Windows only.
- Real, may tie: no account and no telemetry in a multi-agent desk. Herdr may match it. "Works with no vendor cloud" is not true yet.
- Unproven and not built: the frozen judge. It runs tests from a host-held copy, so an edit on disk changes nothing. A good hook author could copy it.
- Unproven: reshaping by asking with no agent code, and lessons replayed before use.
- A board note "Not seen in the six" means only those six products. RIVALS.md overrides it.

The list below is kept as history:

0. The core idea (Wasif, 2026-10-30): the IDE is the intelligent UI. It morphs to what the user needs. "I want to build a website" turns the IDE into a website builder; "cut this footage into a 2-minute video" turns it into a cutting room; "design a mounting bracket" turns it into a part-design bench. Each new request changes it again. The whole workspace can change; gates, the needs-you inbox and Undo cannot (section 6c).
1. Generating every screen with a model is too expensive, so Ouros keeps ready-made assets (section 5b): 66 components ported from MetaTrooper's old approved screens and the persona work, on top of 58 base parts. Agents do not write screens. They send a short JSON description that names parts and assets from one fixed catalogue (124 in all). Ouros draws it. The drawing is built and tested in scratch; the IDE wiring is the build plan (section 9).
2. This is ChatGPT-style generated UI for an IDE, with one difference that matters: no agent HTML, no iframe, no script. The catalogue is the only way to draw.
3. Screens land in IDE places: an editor tab, the agent panel, a wall tile, the inbox, the status bar, the phone. The same JSON draws in all of them.
4. "Custom to you" comes from three things Ouros keeps per user: templates (screens learned from your own workflows), a profile (density, theme, parts you never open), and your existing IDE settings.
5. Only Ouros itself can draw orange or a real gate. An agent that tries gets a grey "asks you" card with its name on it.
6. (Narrowed 2026-11-05, see above.) It is for anyone, not only developers. For any request (a trip, a shop's week, exam revision, a pull request) a screen maker researches how good apps show that kind of task, then builds the screen from the catalogue (section 6b).
7. The main product is that Ouros grows with you (Wasif, 2026-10-30): it ships starting blocks, not finished apps, and gives you the ability to shape them to your own workflow. It changes slowly, in small steps you can undo (section 6d). The engines behind the blocks (section 5c) are plumbing.
8. (Narrowed 2026-11-05, see above.) Scope cut (Wasif, 2026-10-30): building every engine and pipeline "may not be worth it". Built in: the most common workflows of engineers in general, and three loops by which agents fix their own mistakes (the loops run under the UI; their controls live in Settings, decided 2026-11-10). Everything else is an open-source plugin the user explores (section 6e).

## 1. The idea, and what Ouros copies

ChatGPT apps (the Apps SDK, built on MCP Apps) let a tool return a UI resource. The host renders that resource in a sandboxed iframe and talks to it over postMessage. Source: RESEARCH.md, "Security model" (ext-apps README). That lets any app draw anything, which is why it needs a sandbox.

Ouros takes the declarative route instead, the way json-render and Google's A2UI do: the model can only pick parts from a catalogue, each part has a schema, and one renderer draws them. Ouros copies the pattern and adds no dependency (json-render and A2UI are Apache-2.0 and fail the dependency gate; RESEARCH.md, "Repos").

| | ChatGPT apps | Ouros |
|---|---|---|
| What the agent sends | an HTML resource | JSON naming catalogue parts |
| Where it runs | sandboxed iframe | Ouros's own renderer, no iframe |
| Can it run script | yes, inside the sandbox | no |
| Looks like the host | only if the app author styles it so | always: every part uses the IDE theme |
| Learns the user | no | yes: templates and profile (section 6) |

## 2. How it flows

```
agent ──ouros_ui(surface, zone, spec)──> Ouros
                                          │ 1 validate each part against the catalogue
                                          │ 2 bad part -> plain-text box, siblings still draw
                                          │ 3 apply the user's profile (density, theme, hidden parts)
                                          │ 4 expand templates (`use`)
                                          │ 5 draw into the zone, source-tagged (agent or system)
user clicks a button ──event──> Ouros ──> the agent that drew it (or the gate system, for gates)
```

Decided: the transport is two MCP tools: `ouros_ui` draws screens (this section) and `ouros_workspace` changes the layout (section 6c). Proposed (2026-10-30): a third, `ouros_engine`, runs the engine behind an asset (section 5c). Claude Code, Codex and Gemini all speak MCP, so no agent needs a plugin.

## 3. Message shapes

What the prototype builds is the drawing only: `surface(spec, source, agent)` in kit.js turns JSON into HTML. The tool, the surface registry, zones and event delivery below are decided here and built in G2 to G4.

The `ouros_ui` tool, one call per surface:

```ts
type Part = { type: string; [prop: string]: unknown };          // see CATALOGUE.md
type Surface = {
  catalogue: string;               // catalogue version the agent wrote against
  surface: string;                 // id, e.g. "run-r0412"; same id replaces the old surface
  zone: 'tab' | 'panel' | 'tile' | 'inbox' | 'status' | 'phone';
  title: string;                   // tab or card title
  spec: Part;                      // usually { type: 'page', children: [...] }
};
type UiResult = { surface: string; status: 'drawn' | 'partly' | 'rejected'; fellBack: string[] }; // fellBack: parts shown as text, with why
type UiEvent = {
  surface: string; partId?: string;
  event: string;                   // the button's `event`, or its label
  context?: Record<string, string | number | boolean>;  // field values on the same surface
};
```

Decided:
- **Who owns a surface.** The agent session that created it. Only that session can replace or delete it; a call naming someone else's surface is rejected.
- **How a click gets back.** Ouros launches and drives the agent sessions (as MetaTrooper does), so a click is delivered as the next message in that agent's session, prefixed `[ouros-ui]`. No polling tool is needed. If the session has ended, the click is kept in the inbox.
- **Gates never travel this path.** A real gate is answered through the gate system with a single-use token that Ouros issues for one exact action and hash. An event named "approve" from an agent surface is just text to that agent.
- **Versions.** Every call, and every streaming message below, carries `catalogue: "<version>"`. A part newer than the host draws as text naming the part.
- **Questions wait forever.** A question (a `choice` the agent is waiting on) never resolves by time passing. It stays in the inbox until you answer it or the agent withdraws it, and the agent's dependent work stays paused.

After the freeze, copied from A2UI (RESEARCH.md, "Streaming" and "Updates"):

```ts
type Message = { catalogue: string } & (
  | { op: 'create'; surface: string; zone: Surface['zone']; title: string }
  | { op: 'parts'; surface: string; parts: Array<Part & { id: string; children?: string[] }> } // flat list: draws as parts arrive
  | { op: 'data'; surface: string; path: string; value: unknown }                               // JSON pointer, e.g. /tokens
  | { op: 'delete'; surface: string });
```

A child id that has not arrived yet draws as `spinner`. Value updates (a live token count) use `data` and never resend parts.

## 4. Zones

| Zone | Where | Size it gets | Typical parts |
|---|---|---|---|
| tab | an editor tab, like a file | full editor area | page, columns, table, diff, preview, doc |
| panel | the agent's panel, above its input | about 260px high | choice, log, tool, digest, gate |
| tile | the body of a wall tile | about 300 x 220 | log, steps, spark, agent |
| inbox | one row in the needs-you inbox | one line + one action | choice (folded), gate |
| status | one status bar item | a few words | text, kbd, time |
| phone | the phone page | 390px wide, columns stack | anything; columns fold to one |

Pipeline screens (the 17 in specs/p-*.json) open as a full-height tab and hide the panel, the way MetaTrooper gave each pipeline its own screen.

## 5. The catalogue

124 parts: 58 base parts in 8 groups (layout, text, data, input and actions, agent and run, review and documents, general screens, templates) and 66 assets (section 5b). Full list with props and examples: CATALOGUE.md.

Where they came from: 20 from the first pass (13 new, 7 harvested from round-3 screens), 10 from the 17 MetaTrooper pipelines (PIPELINES.md), 3 shared by every outside tool (kv, tool, tree), 19 from the two research passes (RESEARCH.md, MORE.md), 6 for screens anyone needs (stat, grid, chart, calendar, image, file).

Rules:
- Every text value is escaped. Fixed-value props at the top level of a part are checked, and a wrong one sends the part to the plain-text box. Inside lists (a step's state, a tone) an unknown value falls back to the plain style instead.
- A part with a missing or wrong prop draws as a plain-text box that says why. Its siblings still draw. Isolation is per part and per list item (rows, steps, options, lines); a chart is one item, so one bad series sends the whole chart to text.
- Budgets: at most 12 levels of nesting and 1,500 parts per screen; past that, the rest is cut and a plain-text note says so.
- Adding a part is a catalogue change, not an agent change. The catalogue has a version; an agent that names a part from a newer version gets the plain-text box, never a crash.
- A new part needs a real screen that uses it. The research lists 7 more (MORE.md) that wait for one.

## 5b. Assets: MetaTrooper's screens, kept as parts

Why: drawing a whole screen with a model each time costs tokens and time, and every result looks different. Ouros
instead keeps about 60 ready-made assets. An agent only names them; the look, the styles and the layout logic are
already in Ouros (cost in section 8).

Where they came from (2026-10-30 pass, four sessions in parallel, kit/assets/CONTRACT.md):
- 20 from the coding pipelines (two-engine review, browser QA, spec hand-back, spec to PR; 20 + 17 + 18 + 11 = 66): duel, bucketboard,
  coveragemap, triagequeue, prinline, tracestrip, commandlog, flowgrid, beforeafter, qasession, handbacksheet,
  spechinge, sessionsplit, workspacestack, agentthread, runlog, artifactcols, prfirst, pipebar, agentsplit.
- 17 from the make and media pipelines (website, design variants, video, clips, SEO, docs, security, research, lead
  gen, data, study): previewstage, variantsgrid, abcstage, directionlanes, cuttimeline, screening, takecards,
  clipcards, postweek, releasedraft, depledger, posture, citations, leadtable, pageview, rowgrid, slidenote.
- 18 from the MetaTrooper app itself (wall, tile, folded bar, approvals, inbox, usage, menus, palette, panes, diff,
  git, hand-back, browser, dither material): walltile, foldbar, inkstamp, apptopbar, approvalsheet, inboxdrop,
  usagecard, dropmenu, cmdpalette, footstrip, panetabs, diffscope, gitpanel, handbacktab, browsertab, dither,
  agentdrawer, startagent.
- 11 for personas no MetaTrooper screen covered: viewport3d, featuretree, partprops, bom, sitepages, datagrid,
  manuscript, flashcard, calllist, stockshelf, axischart.

Each asset is one file that registers itself (`kit/assets/<name>.js` + `.css`), carries `origin` (the old screen
it was ported from; the crop is in assets/origin/) and keeps that screen's character (pixel stamps, dashed cards,
dither, step bars) in Ouros's tokens. `node build_assets.mjs --strict` bundles them and refuses a duplicate name,
a style that leaks out of its asset, a stray global name, or a class round-3 already styles. `node check.mjs` fuzzes
every asset: each list, object and text in its example is swapped for hostile values; any markup leak or any
host-style gate on an agent surface fails the run. Gates inside an asset are always drawn through the base `gate`
part, so the agent-surface downgrade applies.

Overlap (logged, not merged): duel / bucketboard, abcstage / variantsgrid, tracestrip / flowgrid, sessionsplit /
workspacestack, handbacktab / handbacksheet / handback, panetabs / tabs, diffscope / diff, walltile / tile,
cmdpalette / list, dither / bar and meter. They are ports of different approved screens; merging is a build-time
cleanup after the freeze (../two-engine-assets/reconcile.md).

## 5c. Engines: what does the work behind an asset

Changed 2026-10-30 (6e): engines are now plugins. An engine registry file below is a plugin manifest; `ouros_engine`
runs only installed, enabled plugins, inside their sandbox.

Why: an asset is only the look. When the IDE turns into a cutting room, something must really cut the video. Each
asset action is backed by an open-source engine that an agent can call, and the engine's output becomes the asset's
JSON. The map of engines per asset, with stars, licence and gate result, is ../ENGINES.html (research and raw
lane replies in ../../ouros-capabilities-2026-10-30/, 2026-10-30; checked by Codex and Gemini).

**Three kinds of engine.**
- **Separate process (cli or mcp).** Most engines: ffmpeg, whisper.cpp, OpenTimelineIO, DuckDB, build123d, typst,
  pandoc, playwright, gh. Ouros never links them. This is also what keeps GPL, LGPL and AGPL engines usable (S3,
  rule R1).
- **In the webview (wasm or JS).** Only for drawing what is already on disk: pdf.js pages, three.js drawing a GLB
  that build123d exported, Mediabunny frame strips. Charts need no engine: SQL rows go straight into the chart
  asset's labels and values. replicad (LGPL OCCT wasm) is a runner-up only. Ouros host code calls these, never an agent. They must pass the
  dependency gate themselves, because they are linked.
- **Already in MetaTrooper.** git, gh recipes, the browser pane, the run log.

**The engine registry.** One file per engine, `engines/<id>.json`, read by agents and screen makers:

```json
{ "id": "whisper", "repo": "ggml-org/whisper.cpp", "version": "<pinned at build>", "licence": "MIT", "gate": "PASS",
  "surface": "cli", "install": "user",
  "actions": [{ "name": "captions", "argv": ["whisper-cli", "-m", "{model}", "-f", "{audio}", "-ojf", "-of", "{out}"],
                "reads": ["{audio}"], "writes": ["{out}.json"], "network": false,
                "binds": { "asset": "screening", "from": "{out}.json#/transcription", "to": "/captions" } }] }
```

- `argv` is an array. There is no shell, so a file name cannot inject a command.
- `reads` and `writes` must stay inside the workspace. `network: true` engines (Netlify deploy, arXiv lookup,
  scorecard) say so on the asset.
- `binds` names the JSON pointer in the engine's output and the asset prop it fills. That is the whole "binding"
  column of the map. Where the engine's output does not fit the asset, a small named converter does the work
  (auto-editor v3 JSON to OTIO, planegcs dof() to the "Under-defined, 1 free" stamp). Converters are Ouros code and
  are tested like parts.

**How a call runs.** A third MCP tool beside `ouros_ui` and `ouros_workspace`:

```ts
type EngineCall = { engine: string; action: string; args: Record<string, string>; surface?: string };
type EngineResult = { status: 'ok' | 'failed' | 'gated'; out: string[]; log: string; bound?: string };
```

1. The agent calls `ouros_engine({engine:'whisper', action:'captions', args:{...}, surface:'cut-r12'})`.
2. Ouros checks the action against the registry, fills `argv`, runs it in the workspace and logs it as a grey line.
3. If `surface` is given, Ouros applies `binds` and sends a `data` update to that surface (section 3), so the
   screening asset fills with real captions without the agent re-sending the screen.
4. A click on an asset button ("Trim", "Order", "Publish") still goes to the agent that drew it (section 3). The
   agent decides, then calls `ouros_engine`.

**Gates.** An engine action that leaves the machine or spends money is a real gate, drawn by Ouros only:
publish a site, deploy, send an email, schedule a social post, place a purchase order, open or merge a PR. Drafts
are not gated (a draft email, a draft deploy URL, a draft PR stays a log line). The action carries `gate: true` in
the registry; an agent cannot remove it.

**Install.** Engines are installed by the user (`install: "user"`) unless Wasif decides to bundle some. Bundling a
GPL or LGPL build means shipping its exact source (S3, rule R2); a user-installed engine carries no duty for Ouros.
The first time an asset needs a missing engine, Ouros shows what to install and why, as a calm card.

**Not engines.** Some asset tasks have no open-source engine and stay agent work: writing flashcards and quizzes,
choosing who to call and why, finding leads, design directions, critique beyond Lighthouse scores, solving a
captcha (always a hand-back to you).

## 6. Custom to you

Three layers, applied in this order.

**Your IDE (already designed).** Ouros reads your VS Code or JetBrains settings and keymaps (round-1 decision). Theme, font and icons carry into every generated screen, because every part uses the theme's colours.

**Your profile.** A small file per user (profiles/*.json in the prototype):

```json
{ "density": "compact", "theme": "1", "hide": ["kv"], "reading": "plain" }
```

- `density` changes spacing everywhere. `theme` picks one of the five themes. `hide` drops parts you never open. `reading` (plain or technical) tells screen makers which words to use. In the prototype, host.html applies density and theme, kit.js applies hide, and reading is not built.
- `hide` can never remove gates, questions, hand-back lists, the pipeline bar or layout parts (tested).
- Ouros may learn these from what you do: which parts you open, fold or scroll past; which density you set by hand. Each learned change is listed in Settings > Learning with Undo, and is re-tested on past runs before it is kept (replay before keep).
- Ouros never learns away, on its own: the stop list, real gates, the needs-you colour, core chrome (explorer, editor, terminal, wall). This covers unasked profile learning only. A layout you asked for may hide core panes (section 6c), and so may a named layout learned from your requests.
- How many observations it takes to learn a change, and what the replay must show, are set in G7. Until then every learned change is applied with Undo and dropped if the replay breaks a past run.

**Your templates.** A template is a saved screen with gaps, written `{{name}}`. An agent fills it with `{ "type": "use", "template": "run-summary", "data": {...} }`.

- A gap that is the whole value (`"{{steps}}"`) takes any JSON: a list of steps, a list of log lines. A gap inside text (`"Morning {{who}}"`) takes text. Either way the result goes through the same checks as any other spec.
- Where templates come from: Ouros mines your transcripts for workflows you repeat (the two-engine review, spec to PR), and keeps the screen you used for each one as a template. That is how each user ends up with their own set.
- Size, measured in the prototype: the run-summary call is 946 characters; resending its structure each time would add 540 more. Characters, not tokens; the token saving is unmeasured.

## 6b. Any screen, for anyone: the screen maker

Ouros is not only a code editor. A baker, a student and a traveller should each get a screen that fits their task. Nobody hand-builds those screens. A screen maker does, with the same catalogue.

```
request ("show my bakery's week")
  │ 1 match: a template you already have for this kind of task? use it, fill the data, done
  │ 2 research: how do the best apps show this task? (web search through the agent's own tools;
  │   your own files and past screens first). Output: 2 to 4 references and the one number or
  │   decision that matters
  │ 3 compose: pick parts from the catalogue, lay them out for the zone, plain words for the audience
  │ 4 check: validate (every part from the catalogue), fit the zone, no orange
  │ 5 show: draws as an agent surface; the references sit on the screen in a `sources` part
  │ 6 keep: if you open it again or ask for it twice, it becomes a template (replay before keep)
  ▼
screen
```

Decided:
- The screen maker is an ordinary agent role, not a separate engine. Any agent (Claude, Codex, Gemini) can play it; it needs only `ouros_ui`, the catalogue and its normal research tools.
- Research is cheap and bounded: about 10 minutes (hard limit 15), 2 to 4 references, cited on the screen. Repeat requests skip research through templates (step 1); a template keeps the sources that were fetched and checked when it was made.
- When the catalogue lacks a part, the screen maker uses the closest parts and writes down what it wanted ("parts I wanted"). A part asked for by 3 different screens becomes a catalogue proposal, built and tested like any other part (section 5). Agents never invent parts at draw time.
- Images only come from the user's own files or Ouros's asset store (`asset:<id>`). An agent cannot point an image at a URL; that would leak what you look at.
- Words match the audience: the profile carries a reading level (plain by default), so a baker never sees "diff" or "hunk".

Note: the prototype's clock is fixed at 2026-10-30T17:00+11:00 so countdowns in the shots stay stable; the real build reads the system clock.

Proof in the prototype: three screen makers (Sonnet helpers) built screens for non-developer requests, each from 2 to 4 cited references and the catalogue only. All three passed validate.mjs on their own. Files: specs/any-trip.json, any-bakery.json, any-revise.json; notes in any-*.md.

| Request | References it used | What it put first |
|---|---|---|
| 5-day budget trip to Tokyo for two | Wanderlog, TripIt, Google Travel | total cost and what is still to book |
| A small bakery's week | Square dashboard, Square restock help, Bakerflow | "Flour runs out on Thursday. Call Marta today." |
| Biology exam in 3 weeks | Anki stats manual, Khan Academy mastery, Dunlosky 2013 | the weakest topic and a 20-minute quiz |

What they wanted, and what happened, using the 3-screens rule:

| Wanted | Asked by | Done |
|---|---|---|
| chart extras: target line, forecast values, share bar | revise, bakery, trip (3) | added: `target`, `forecast`, kind `share` |
| dates: countdown, due date, date range | revise, bakery, trip (3) | added: `time` takes a `label` ("Exam in 21 d") |
| buttons on a row: Call / Done, tick a box | bakery, revise (2) | added: `queue` item `actions`, `check` `event` (cheap, so not held back) |
| map, booking card, number stepper, table totals, donut | trip (1) | proposal; waits for 2 more screens |
| flashcard, timer, progress ring, heatmap | revise (1) | proposal |
| meter warning threshold | bakery (1) | proposal |

One honest gap: the revision screen maker cited Duolingo and Quizlet from memory, not from fetched pages. A screen maker must cite only what it fetched; G9's acceptance test checks every new `sources` link was read in the same run (sources reused from a template were checked when the template was made).

## 6c. The agent adjusts the IDE itself

Decided by Wasif, 2026-10-30: the whole workspace may change on request. An agent can add, move, resize, hide and swap any panel, including the explorer, editor, terminal and wall, and add new panels drawn from the kit. Menus, toolbar and keybindings are not part of this (that was a bigger option he did not pick).

The workspace is data. Ouros keeps one JSON file per layout:

```ts
type Pane =
  | { split: 'row' | 'col'; sizes: number[]; children: Pane[] }        // sizes are shares, each at least 8
  | { view: 'explorer' | 'editor' | 'agent' | 'terminal' | 'wall' }       // built-in views
  | { view: 'surface'; spec: string }                                     // a saved screen (specs/*.json)
  | { view: 'kit'; title?: string; part: Part };                          // any catalogue part, drawn as an agent surface
type Workspace = {
  name: string;                                                           // required; shown in the status bar
  by?: string; asked?: string;                                            // descriptive only; shown as quoted text
  rail: Array<'files' | 'search' | 'git' | 'debug' | 'agents' | 'ext' | 'todo'>;
  layout: Pane;                                                           // at most 4 levels deep
};
```

Agents change it through a second tool, `ouros_workspace`, with ops `set` (a whole layout), `patch` (add, move, resize, hide, show or swap one pane), `save` (name the current layout) and `restore` (go back to a saved one).

Rules:
- **Pinned, never in the JSON:** the title bar with the IDE | WALL switch, and the status bar with the needs-you inbox entry (count plus the first waiting item; click opens the inbox) and "Ctrl Alt 0 resets the layout". No layout or profile can remove them, because Ouros draws them outside the workspace.
- **Shown, then undoable:** every change, applied or refused, shows a banner with your words (or "layout change" when there are none), who set it, and two buttons: Undo (Ctrl Z) goes back to the layout before this change; My usual (Ctrl Alt 0) goes back to your default. Nothing asks first; it just happens and is one key from undone, matching auto mode.
- **Who set it comes from Ouros, not the JSON.** The setter is the agent session Ouros saw make the call. A `by` in the JSON that differs is shown only as quoted text.
- **Checked before it lands:** a missing name, unknown views, unknown rail items, bad sizes, a split with fewer than 2 panes, an empty or malformed pane, missing screens or more than 4 levels deep and the change is refused. The banner says why, and the old layout stays.
- **Gates still surface.** Hiding the agent panel or the wall never hides a gate: a waiting gate opens in the inbox and the status bar shows it.
- **Learned, gently.** A layout you ask for twice becomes a named layout. When the same kind of work starts again, Ouros applies it with the banner and Undo, as with any other change; it does not ask first (replay before keep, section 6). It never switches layouts while an agent is mid-step.

Proof in the prototype: workspace.html draws any workspaces/*.json. Four layouts from four requests: your usual (VS Code), a video edit day, a bakery with no code at all, and a study space. Five more are refused, leaving the usual layout in place: an iframe pane with an unknown side bar button, no name, a null pane, a one-pane split, and five levels deep. `node kit/validate.mjs` checks every layout (every bad*.json must be refused).

**Personas: one request, a different tool.** Eight persona layouts (workspaces/persona-*.json), each built only from
assets and base parts: engineer (part design: 3D view, feature tree, properties, bill of materials), website
(page tree, live preview at 1280 and 390, section settings, publish), editor (footage bin, monitor, cutting
timeline), analyst, writer, student, shop, researcher. Website and editor are also drawn as three frames:
1 the request in the usual IDE, 2 the IDE transformed, 3 after one more request.

**While it changes.** Between the request and the new layout, Ouros shows a setup state: the banner reads "Setting up
<layout>…" with Stop (Esc), the old panes dim and the agent stays full strength. Like the inbox line, the setup text
comes from Ouros, never from the layout JSON.

## 6d. Grows with you: blocks, not a finished app

His words (2026-10-30): it "slowly blends into what the user wants and works within their workflow". Ouros gives
"the starting blocks but the user ends up customising to their unique needs". It does not give full functionality,
"only the ability to do so".

**What ships.** Blocks, not apps: the 124 parts and assets (5, 5b), the built-in workflows and their checks (6e), and
8 starter layouts (the personas, as examples; a domain one works once its plugins are installed). A starter layout is
a first draft of a workspace, never the finished thing.

**How a user grows it.** By asking, in their own words, while they work: "put the waveform under the timeline",
"read my orders from the Shopify export", "show me only what is due today". The agent answers with blocks: a layout
change (6c), a screen (6b), or an engine action wired to an asset (5c). Each answer is saved as part of the user's
own **capability**:

```json
{ "name": "my cutting room", "from": ["cut this into 2 minutes", "waveform under the timeline"],
  "layout": "...", "screens": ["..."], "engines": [{ "engine": "whisper", "action": "captions", "binds": "..." }],
  "history": [{ "at": "2026-11-12T10:04+11:00", "change": "waveform under timeline", "by": "you", "undo": "..." }] }
```

A capability belongs to one workspace, is plain JSON, and every entry in `history` has Undo. Starting the same kind
of task again opens your capability, not the starter.

**How it blends in slowly.**
- Most change comes from the user asking. Ouros adds small proposals of its own only from what it sees repeated: you
  open the same three panes every morning, you always fix the same caption style, you redo the same SQL. A proposal
  is one small change, shown as a calm card with the reason ("you did this 4 times this week"). Applied only when you
  say yes.
- At most one proposal is pending at a time, so the workspace never jumps.
- Before a learned change is kept it is replayed on your past runs (6, replay before keep). It is listed on the
  Settings > Learning with Undo.
- What counts as "better" is only what you show: you kept it or undid it, you corrected it or not, the task finished.
  Measured on this machine; nothing is sent anywhere.

**How far growth goes.** Anything beyond the blocks happens because the user asked, never on Ouros's own initiative:
- assembling blocks and writing small converters between them: yes, as above;
- a new engine: the agent proposes a plugin from the index (6e); installing it is a real gate (7) and it stays off
  until you enable it;
- new code for a block that does not exist: only when the user asks for it; it lands as a catalogue proposal (G10)
  with tests before it can be used.

**Out.** No sharing of capabilities between users in the first build. No silent changes. No change to the pinned
chrome (title bar, inbox, gates, Undo) by any capability.

## 6e. The starting point, and agents that fix their own mistakes

His words (2026-10-30): building every engine and pipeline "may not be worth it". Ouros gives engineers (software,
mechanical, electrical, civil and others) a good starting point, gives agents a way to keep fixing their own
mistakes, and leaves everything else to open-source engines as plugins the user explores. Evidence and the
Codex + Gemini check: STARTPOINT.html (research in ../../ouros-startpoint-2026-10-30/). The self-fixing loops also
draw on the 2026-10-24 deep dive (../../agent-research-2026-10-24/agent-research.html: 646-row catalogue, 86 repos
read in code, 195 paper notes). Its "nobody does X" rows are unverified claims, so none is stated here as fact.

### What is built in

The built-in part is a set of **workflows**: what an agent does and which checks it runs. They work in any layout.
The persona layouts (6c) stay as example layouts; a domain one (part design, cutting room) only does real work once
its plugins are installed.

Each source below measures something different, so each number names its source and its sample.

| # | Workflow | Who | Evidence |
|---|---|---|---|
| 1 | Fix a bug or an error | software | debugging is the top daily use among 132 Anthropic staff (55%, self-selected survey); "modify software to correct errors" is the single most common task on Claude.ai, 6% of all use (Nov 2025); fixes are 31% of 213 hand-classified Claude Code PRs (labels overlap) |
| 2 | Find and understand: the right file, spec, data or code, including web research | all engineers | the biggest measured time sink outside software: design engineers spent 55.75% of their time on information work (78 engineers, sampled hourly, 2010); construction teams 13.4% of the week looking for project data (599, 2018); CAD users 1.3 h a week finding the right design data (1,466, 2023). In code, understanding is the top specific intent in SWE-chat (18.2% of 229k prompts) |
| 3 | Build a feature, from plan to working change (including UI, boilerplate and code conversion) | software | new features rose from 14% to 37% of 200k internal Anthropic Claude Code transcripts (Feb to Aug 2025) and design and planning from 1% to 10%; UI components 12% and web or mobile apps 8% of 500k coding interactions; boilerplate and conversion are among the top tasks developers hand to AI (JetBrains 2025) |
| 4 | Git operations, review and hand-back | software | git operations are 12.6% of SWE-chat prompts; slow, unreliable review of agent changes is pain #2 across agent IDEs (research/next/PAINS.md) |
| 5 | Refactor and small fixes | software | 8.6% of internal Anthropic Claude Code tasks; 24.9% of the 213 classified PRs |
| 6 | Tests and docs | software | 18.8% and 22.1% of the 213 classified PRs; docs PRs merge most often (84% across 33k PRs from five agents) |
| 7 | Scripts, calculations and data, in any discipline's text formats | all engineers (hypothesis) | the text core agents can act on: Python or MATLAB scripts, spreadsheets, parametric CAD code, SPICE netlists, FEA input decks (eng lane, 2025-2026 papers). Ouros edits and runs them with generic checks (it parses, it runs, it exits 0); the domain verifier comes from a plugin |
| 8 | Reports and documents | all engineers | the top AI use among engineers: text generation 61%, text revision 42% (IEEE Region 9 survey) |

Rows marked "all engineers" rest on older studies and vendor surveys: no 2025-2026 source splits a mechanical,
electrical, civil or chemical engineer's week by task. Row 7 is a hypothesis to test with real users, not a finding.

Checking runs through all eight: IC design engineers spend 49% of their time on verification (2024) and 89% of US
engineers check every AI result by hand (402, 2026). That is the case for the loops below.

Not built in: deploy and monitoring, project and issue management (implementation planning stays inside row 3), and
every domain tool (CAD, circuits, simulation, video, shop). Those are plugins.

Corrected 2026-11-05, from research-ide/F/PAINS.md, section "Old findings, now updated". This section first cited
Stack Overflow 2025: 76% do not plan to use AI for deploy and monitoring, and 69% for project planning. The 2026
survey reads:

- Deploy and monitoring: 19.9% use AI, 36.0% do not use or plan to, 22.0% say it is not part of their work (n=12,547).
- Tickets and plans: 27.8% use AI, 30.5% do not plan to.
- The answer options changed, so the two years do not compare directly.

So "most do not plan to" no longer holds. PAINS.md B6 also says non-developers break at deploy, and Anthropic has
operating software at 21% of Claude Code sessions. Whether deploy stays out is his call (`spec.md`, open calls). The
screens add one issue list (M8-F20) and a Publish step (M8-F15), both also his call.

### How agents fix their own mistakes

Three loops, fastest first. What they aim at comes from 16,118 validated pushback episodes in 20,574 sessions
(categories overlap, and only failures that drew pushback are counted): ignoring the user's rules 38%, misreading
intent 27%, claiming done too early 23%, wrong code 18%, wrong diagnosis 12%, doing more than asked 10%. Of the
9.3% of episodes with a visible resolution, 91.5% needed the user to correct the agent. The loops move that work
from the user to Ouros.

Every run has a budget: a time limit, a token limit, and a timeout per check. Hitting any of them stops the run
and asks you.

Model provider failures sit under all three loops:
- Transient errors (rate limit, timeout, 5xx) retry with backoff in one place only. Retries stacked across layers
  multiply (OpenHands retries 5 times, Codex has its own stream retries).
- A provider that keeps failing is put on cooldown, then probed with one call before it is used again (LiteLLM
  cooldowns are the model; the report found this only in gateways).
- A fallback to another model happens only with your yes, and the panel says which model is answering. Silent
  downgrades are a top complaint (Gemini CLI dropping Pro to Flash, #2208).
- Before an action that re-bills the whole prompt cache (switching model, compacting), the panel says so.

**1. Check after every change (seconds).**
- After each edit Ouros runs the workspace's checks: diagnostics, typecheck, lint, the nearest tests, and the
  generic run checks for row 7. A failure goes back to the agent as its next message.
- The judge is out of the agent's reach. Ouros runs acceptance checks from a host-held copy of the tests, fixtures,
  check configs and logging taken at the start of the run, so an edit to them on disk changes nothing. The agent
  cannot write to those paths; a proposed change to a test or check is shown to you separately and is never part
  of a fix (a self-improving agent once "passed" by deleting the logging that caught it).
  Corrected 2026-11-05 (RIVALS.md row 1): blocking test writes is table stakes as a setting in Claude Code, Cursor
  and opencode. Only the frozen copy survives, and it is spec only. On native Windows no vendor was found doing the
  write block at OS level, and Ouros has no sandbox, so lean on the copy, not the write block.
- Your existing tests are the judge. Tests the agent wrote in the same run are only a hint: self-written tests
  misled Reflexion (MBPP 0.80 to 0.77), and Self-Refine's maths feedback said "everything looks good" on 94% of
  instances.
- A retry first rewinds the files to the turn's checkpoint, then starts from a clean context with a short summary
  of what failed. Retrying in the same context repeats the mistake: 71% of one model's failures were the same
  wrong reading.
- At most 3 tries (Aider's cap). The last try may go to a stronger model (plandex escalates). Then the agent stops
  and asks you, with what it tried.
- "Checks passed" and "request done" are two different results. The agent may report the second only when the
  task's own acceptance check passes (a test that shows the bug is fixed, the requested output exists). When no
  such check exists, the result is "needs your review", never "done".
- Checks fail closed. A missing test runner, a missing interpreter or a file type with no check counts as "no
  check", never as a pass (harness-evolver silently passed all of these).
- The agent can stop at any time with "I cannot do this honestly" and the reason. It is a normal result, not a
  failure. In ImpossibleBench (2510.20270) an abort option cut GPT-5 editing tests to pass from 54% to 9%; the
  effect on Claude models was weak.
- Bad output is repaired before it fails. A malformed tool call is fixed against its schema if the fix is
  mechanical (opencode tool-input-repair.ts), otherwise sent back with the validation error (instructor re-asks).
  A guessed repair can run a valid but wrong call, so every repair is shown in the transcript.
- A failed write or edit is reported as failed. Never "done" over a silent error (Gemini CLI's silent mkdir).
- Context is compacted before it overflows, and an overflow error is caught anyway (OpenCode tags both). Your
  rules and the task's acceptance check are carried through every compaction word for word, since a summary can
  drop a constraint.
- Before hand-back (workflow 4) a reviewer in a fresh context reads the diff, ideally a different model, because
  the same model shares the actor's blind spots. Its verdict is a hint, not the judge, and it costs about one more
  run. It also checks the reasons maintainers rejected agent PRs most: missing tests, docs and style (METR: 0 of 15
  agent PRs mergeable as-is, 42 minutes average to fix).
  Narrowed 2026-11-05 (CORE.html, M8-F17): the second model is optional and off by default, with its cost shown
  first, because the cost is untested. Today only the manual `skills/second-opinion` exists; the runner left in M6-1.

**2. A watcher on the run (minutes).**
- Deterministic first, in Ouros itself: each tool call is hashed, a nudge at 3 identical calls and a stop at 5
  (Cline's defaults), plus a count of failed turns in a row. The hash check also covers the other three patterns
  OpenHands stuck_detector.py looks for: the same error repeated, two actions alternating, and turns of text with
  no tool call. A call that waits on something changing (polling a build, a server coming up) counts as progress
  while its output changes, so it does not trip the alarm.
- Detection alone only stops the run. Each trip sends a recovery message first (restate the task, name the
  repeated step), and stops only if the next turn repeats it.
  Corrected 2026-11-05 (RIVALS.md row 8): this line once said OpenCode's `doom_loop` does this. Its docs
  (opencode.ai/docs/permissions) show a permission that asks you, at 3 identical calls. The loop code was not read,
  so check it before citing. The recovery message is Ouros's own proposal.
- Then a small second model, only for what a hash cannot see: drift from the task (restate the task and plan),
  doing more than asked, and wrong tool arguments. These were the commonest nudges among runs Meta's Wink
  recovered (loops 39%, task reminder 26%, scope creep 17%, tool arguments 17%; 90.9% recovery among runs that
  needed one nudge). Whether the model watcher earns its cost on top of the hash check is measured, not assumed:
  every nudge and every false trip is logged.

**3. Lessons across runs (days), through the proposal flow in 6d.**
- A lesson is one short rule with where it applies and the run it came from. It is made only from real signals:
  you correct the agent, undo its change, a reviewer comments, or the same check fails in two runs. Never from the
  agent's opinion of itself (self-written lessons gave no net benefit, -1.3 points, in the one study that measured
  it), and never from a plugin's text or output.
- A candidate lesson is quarantined and replayed: the run that caused it plus past runs that went well (five by
  default; G7 sets the final number). Two protected runs are not enough: in one study 55% of replay-evaluated
  proposals fixed their trigger while breaking a case that had worked. Ouros allows no regression at all, where
  that study allowed 0.05.
- The replay really re-runs the agent with the lesson. Scoring a cached transcript cannot show a change
  (harness-forge warns of this).
- The good runs used for the replay are not the ones the lesson was picked from. In Harness-Delta Attribution
  (2610.22466) 54% of harness-tuning gains were overfitting to the tasks used to tune.
- The replay must show the lesson changed what the agent did at a named step (Harness² keeps an edit only when it
  can point at that moment). A lesson that changes nothing is only cost: memory files added over 20% cost with no
  gain in success (2602.11988).
- A lesson is untrusted text, like a plugin's. Poisoned experience can become a lasting skill and fire in later
  sessions (SkillJack 2608.03509, 2609.13889). A lesson from a run that read outside text (web pages, issues,
  plugin output) is marked with that source on its card.
- A lesson store that fails to read is left untouched and goes read-only. One harness lost every saved lesson
  because a read error loaded an empty store that was then written back (bluenoah1991/agentic_context_engineering).
- A lesson that passes becomes the single pending proposal (6d): a calm card with the reason. It is active only
  after you say yes.
- Lessons live in Ouros's own store, not in a repo file, with atomic add, update and remove. "Export to AGENTS.md"
  is a button, so other tools can read them when you choose (no silent changes, 6d).
- Each lesson counts how often it helped and how often it was in play when something failed. A suspected bad lesson
  is checked by replaying with it removed; if removing it fixes things it is retired, and any lesson made from it
  goes too. A lesson that names code which no longer exists is flagged (Copilot memory does this).

Checkpoints under all three: every agent turn is a checkpoint (private git refs, untracked files included; restore
never deletes your ignored files), so any fix can be rewound. A checkpoint cannot undo what happened outside the
workspace (a sent message, a deploy, a paid call). Tools are marked safe or unsafe to repeat; after a rewind or a
crash, a long run resumes from its last step (see Settings > Reliability > Long runs) but never re-runs an unsafe tool call without asking you
(ACRFence: a retry after a restore can send a slightly different request and double a payment).

**Order of build.** The budget, loop 1, the hash watcher and checkpoints first: cheap, and each can be measured on
its own. The model watcher next, only if its logged nudges beat its cost. Loop 3 last, because no study has tested
lessons on one person's project over weeks, which is exactly Ouros's setting.

### Features that make the loops visible, and where they now live (2026-10-30, updated 2026-11-10)

Twelve features were drawn with the kit (specs/f-*.json, board ../NEWFEATURES.html, evidence in
../../ouros-startpoint-2026-10-30/features/FEATURE-LIST.md, checked by Codex and by Gemini's eye). Decided 2026-11-10:
reliability features keep their behaviour and lose their screens.

- Stays as a surface: find project information and revisions (f-find), live variables and DataFrames (f-data), outline
  for notebooks and reports (f-outline), plugin grants, updates and revocation (f-plugin, as an install dialog).
- Settings only, no screen: Done means proven (f-done), rewind preview and redo (f-rewind, a sheet from Undo), repair
  ladder with a protected judge (f-ladder), progress-aware loop alarm (f-loop), clarify inside the plan gate (f-intent,
  a decision card in Needs you), your rules as checks (f-rules), long runs that survive (f-runs), remembered, scoped
  tool access (f-toolaccess), lessons with proposals (f-lessons).
- Held for later: design revision compare (f-designdiff).

### Plugins: everything else

The engine map (ENGINES.html, 73 engines) becomes the seed plugin list, not build scope. A plugin is one engine
plus its manifest. You browse, install, enable and remove plugins on an Explore screen.

Why the rules are strict: most seed plugins start a local process (67 cli and 24 mcp rows). In nine of the ten
plugin stores studied a plugin runs with your full rights; only Zed enforces declared permissions, and it can
because its extensions run as WebAssembly. Real attacks came through updates and look-alike names: postmark-mcp was
clean for 15 versions and turned bad at 1.0.16; 73 "sleeper" and 77 "evil twin" extensions hit Open VSX in 2026.

**Manifest.** Most fields copy a real store (the P1 study names each source); `check` is Ouros's own.

```json
{ "id": "ggml-org/whisper", "version": "1.0.0", "schema_version": 1,
  "description": "Local captions and transcripts (whisper.cpp)",
  "source": { "repo": "ggml-org/whisper.cpp", "sha": "<40 chars>", "license": "MIT" },
  "host": ">=0.1 <0.3",
  "run": { "kind": "cli", "command": "whisper-cli",
           "artifacts": { "win-x64": { "url": "<release asset>", "sha256": "<hash>" } } },
  "capabilities": [{ "kind": "exec", "command": "whisper-cli" }, { "kind": "fs", "path": "${workspace}", "mode": "read" }],
  "check": { "argv": ["whisper-cli", "-f", "${fixture}/hello.wav", "-otxt"], "expect": "output contains hello" },
  "provides": { "tools": ["captions"], "assets": ["screening"] },
  "config": [{ "name": "model", "secret": false }] }
```

- **Installed means off.** Nothing a plugin ships runs until you enable it.
- **Confinement is real, not a list.** A list of allowed commands does not stop a native process reading your
  files. So a `wasm` plugin runs in a WebAssembly host that grants only what `capabilities` lists; a `cli` or `mcp`
  plugin runs inside an OS sandbox (AppContainer on Windows, Landlock or bubblewrap on Linux, the macOS sandbox),
  with file, network and child-process rules taken from `capabilities`. You can narrow the grant. Install steps get
  the same confinement.
- **Updates are a decision.** Every new artifact hash is an update you approve, with a version diff and the scan
  result, even when the capabilities did not change (postmark-mcp changed behaviour, not its manifest). Ouros runs
  the approved binary by its hash, never a name looked up on PATH.
- **A plugin's check is a hint, not the judge.** It runs only after enable, inside the grant, and only when that
  plugin's tools were used in the turn. Its output is untrusted text: shown to the agent as a hint, never a pass by
  itself.
- **Plugin text is untrusted.** Tool descriptions, output and any bundled skills or prompts are shown on the
  Explore screen before install and scanned. They can never grant the agent new rights: any action they lead to
  goes through the same host check as any other action, and they never become lessons.
- Registry side, not in the manifest: status (active, deprecated, removed with a reason), installs, a per-version
  scan, and a block list that disables a plugin remotely and says why.

**Index.** The official MCP registry searches names only and tells clients to build their own index; Smithery shuts
its proxy and CLI on 2026-10-31. Ouros keeps its own index over the MCP registry and GitHub, seeded from the engine
map.

**Explore screen**, in order of evidence: what it will run (capabilities, exact commands and the prompt text it
adds) before install; pinned version and a decision on every update; who published it and a look-alike warning;
the per-version scan; off until you enable it; where it runs (WebAssembly, OS sandbox, hosted); then installs,
licence, last update and categories. Download counts are shown but never treated as trust (246.8 million downloads
sit beside a 2.12 rating).

### Computer use and browser use (2026-11-02)

Both stay built in and keep their tool lists. Outside drivers and engines join as plugins behind those tools, so
grants, approvals and the take-over key still apply. Children: M8-38 to M8-43.

- **Computer use.** The built-in UI Automation driver stays the Windows default (D71, D78). M8-38 improves it with
  mechanisms read in other drivers, and M8-40 stops blind repeats of an unverified action. M8-39 spikes
  vercel-labs/agent-desktop and trycua/cua's cua-driver for macOS and Linux, where Ouros has no driver.
- **agent-desktop fits as a plugin only.** Linking it fails the dependency gate (5,985 stars, Apache-2.0). It has no
  per-window grant, so agents never reach it directly. On Windows its `type` and `right-click` need real input, which
  D78 forbids.
- **Browser use.** The in-process Electron pane stays. No outside driver can drive it, and M8-41 takes their best
  mechanisms instead. M8-42 adds `chrome-headless-shell` for background agents. Ouros ships no stealth feature.
- **Models.** M8-43 sets defaults per job. Sonnet 5.5 is the default for tree and browser work; Fable 5.1 costs 3.4
  times as much per browser task for no gain (Browser Use Bench v2.1).

## 7. Safety

| Rule | How it is enforced | Proof |
|---|---|---|
| No script, iframe, outside image URL or outside fetch | no part can emit them; `image` takes only `asset:<id>`; all text escaped | `node kit/check.mjs`: 16 hostile inputs plus 7 for the newer parts |
| One bad part never breaks a screen | each part and each nested item draws inside its own try | check.mjs: sibling and bad-row tests |
| Only Ouros draws orange or a real gate | every surface has a source. Agent surfaces turn the needs-you colour to plain white, hide "needs you" stamps, and draw `gate` as a grey "&lt;agent&gt; asks you · not a gate" card without action or hash | check.mjs: forged gate test; trust.png on the board |
| A gate's button cannot be answered by the agent that drew it | gate events go to the gate system, which shows the exact action and hash it computed itself | design rule; built after the freeze |
| Templates cannot escape | filled templates are re-validated; nesting stops at 3 levels | check.mjs: template injection tests |
| Agents cannot claim a part exists | unknown part = plain-text box naming it | validate.mjs on every spec |
| A profile cannot hide a gate | gate, choice, handback, pipe and layout parts ignore `hide` | check.mjs: hidden-gate test |
| No screen can freeze the IDE | 12 levels, 1,500 parts per screen | check.mjs: 5,000-deep and 5,000-wide tests |
| An agent cannot pretend to be someone else | on agent surfaces the asker's name is the real agent, never the `from` it sends | check.mjs: spoofed-name test |
| You always know who gets what you type | every field on an agent surface says "goes to &lt;agent&gt;"; there is no password field | check.mjs; secrets go through the OS keychain, never a field |
| A file the agent writes is not run by something trusted behind your back | an agent write to a file another tool executes (hooks, `.vscode/tasks.json`, MCP configs, agent config files) is shown as its own change and stays inactive until you approve it; most coding-agent CVEs in the deep dive came this way (CVSS up to 9.8), not through a broken sandbox | rule for G13; tested by an agent writing a task file that must not run |
| Ouros's own behaviour never changes silently | Ouros's default prompts, effort and loop settings are versioned; an update that changes them shows a diff, and you can pin the old ones apart from the model. Each update replays a fixed set of past runs before release | rule for G13; the top issue in the deep dive was a harness update ("unusable with the Feb updates", 2,072 thumbs-up) |
| Research does not leak your files | a screen maker's web searches use the request's words, never file contents, transcripts or names from your workspace; templates and assets belong to one workspace | rule for G9; tested by a canary file whose text must never appear in a search query |

## 8. What it costs in tokens

Measured on the 17 pipeline screens by `node kit/measure.mjs` (JSON.stringify, no spaces): the JSON an agent sends averages 1,457 characters per screen (24,772 for all 17; re-measured 2026-10-30T18:40+11:00 after the polish pass). The HTML Ouros draws from it averages 2,990 (50,828). So an agent that wrote the HTML itself would send about 2.05 times as much (50,828 ÷ 24,772), before any styling. Characters divided by 4 gives a rough token count (1,457 ÷ 4 ≈ 364 per screen); that is an estimate, not a measurement. Following the metarouter A/B lesson, no token saving is claimed until it is measured on real tasks.

Morphing the whole IDE (the 8 persona layouts, `node kit/cost.mjs`, 2026-10-30T19:45+11:00): the layout JSON an agent sends averages 2,929 characters (2,929 ÷ 4 ≈ 732 tokens, an estimate). The HTML Ouros draws from the kit and asset panes averages 8,839 characters, so writing it would cost about 3.0 times as much (8,839 ÷ 2,929), and the built-in views (editor, explorer, terminal) are not even counted. The styles (kit.css + assets.css, 302,659 characters) live in Ouros and are never sent. The range is wide: the cutting room draws 10.2 times what is sent, the study space 1.1 times, because its layout carries mostly the agent's own words.

## 9. Build plan (status 2026-11-15)

Host decided 2026-11-14 (`spec.md` D84): agent-drawn screens are @astryxdesign/core parts drawn as tabs inside cc (Electron). The kit lives in `workbench/ui/src/kit/`. Core stores surfaces in `core/src/surfaces.ts` (`ui.show`, `ui.get`, `ui.event`). Each step's issue (`issues/m8-NN-*.md`) holds the per-criterion status and the command that checks it. DONE means code and a passing test.

| Step | What | Done when | Status |
|---|---|---|---|
| G0 | Pick the host (Wasif's call) | the choice is in the D-list with its reason, the drawback of the option not taken and the gate numbers, and names how tabs and events are wired | PARTIAL: D84 made the call; it lacks the drawback, astryx's gate numbers and the IDE \| WALL switch |
| G1 | The kit in the repo: `catalogue.js`, `check.js`, `Draw.jsx`, `parts-*.jsx`; kit classes carry an `ou-` prefix; limits and state live in each `expand` call; `check.js` flattens nested JSON into a flat map of parts by id, so G8 needs no rewrite | `core/test/m8-01-kit-check.test.ts`, `workbench/test/m8-01-kit-draw.test.ts` and `m8-01-kit-parts.test.ts` pass | DONE |
| G2 | `ouros_ui` MCP tool + tab zone | Claude Code calls it and a tab opens with the screen; a bad part shows the plain-text box; another session's surface is refused | PARTIAL: all but the tab opening have tests |
| G3 | Events back, and form state | clicking a button delivers `{surface, event, context}` to the owning session within one turn; fields carry required, disabled, invalid and error states; a stale or repeated click is dropped; a click after the session ended lands in the inbox | PARTIAL: `ui.event` is built but has no test; Claude sees a click only at its next prompt |
| G4 | Panel, tile, inbox, status and phone zones | a zone matrix lists which parts each zone accepts (status: text, kbd, time; inbox: one line plus one action); a part a zone cannot hold folds to its first line with "open"; long tables, lists and queues show 50 rows with a "more" event; phone folds columns | PARTIAL: only the tab zone exists; tables cap at 200 rows with a count, not 50 rows with a "more" event |
| G5 | Source tagging tied to the real gate system | an agent-drawn gate cannot resolve a real gate (test) | PARTIAL: `gate` is not drawn and agent parts never use the needs-you colour; the source tests are not written |
| G6 | Templates mined from transcripts | 3 templates proposed from his own transcripts, each kept only after replay on past runs | NOT STARTED |
| G7 | Learned profile | hide and density changes appear in Settings > Learning with Undo | NOT STARTED |
| G8 | Streaming and data updates (A2UI style) | the binding from a `data` path to a part's prop is chosen and written here with one meter example; a half-sent screen draws; a token counter updates without resending parts | NOT STARTED |
| G9 | Screen maker role + asset store | a non-developer request produces a validated screen with cited sources in under 15 minutes; a repeat request uses its template and skips research | NOT STARTED |
| G10 | Catalogue proposals | a part wanted by 3 screens appears as a proposal with its props and the screens that asked; it ships only with tests in the m8-01 kit tests | PARTIAL: an unknown part stays a text box naming it (done); proposals are not built |
| G11 | `ouros_workspace` tool | each of the four example requests produces its layout; Undo restores the layout before the change and My usual restores your default, each in one key; a refused layout leaves the old one and names the reason; a waiting gate still shows while the agent panel is hidden | NOT STARTED |
| G12 | Plugin runner + `ouros_engine` tool (sections 5c, 6e) | whisper captions fill a screening surface through `binds` with no agent re-send; a publish action stops at a real gate; a missing engine shows its install card | NOT STARTED |
| G13 | Budget, loop 1, hash watcher, checkpoints (6e) | a failing test sends the agent back with the output; an edit to a protected test changes nothing; a retry rewinds files first; a run with no acceptance check ends as "needs your review"; every nudge is logged; a missing test runner is not a pass; a faked provider outage cools down, probes, and asks before any fallback; injected faults (timeout, malformed call, loop, crash mid-run) each end in the loop meant for them; each control is a Settings entry. Read first: cline checkpoints and loop-detection.ts (Apache-2.0), OpenHands stuck_detector.py (MIT), opencode tool-input-repair.ts and doom_loop (MIT) | not audited this pass (see `issues/m8-13-*.md`) |
| G14 | Plugins: manifest, sandbox, Explore screen, index (6e) | an undeclared file or network access from a cli plugin is refused by the OS sandbox; a changed artifact hash asks you; a remote block disables a plugin and says why | not audited this pass (see `issues/m8-14-*.md`) |
| G15 | Model watcher, then lessons through the proposal flow (6e, 6d) | the model watcher stays only if its logged nudges beat its cost; a lesson becomes active only after replay and your yes; removing a bad lesson by replay retires it; a lesson that changes no step is dropped; a corrupt store stays untouched; lessons are listed in Settings > Learning. Read first: the replay gate in 2609.24130 and the skillbook in kayba-ai/agentic-context-engine (Apache-2.0) | not audited this pass (see `issues/m8-15-*.md`) |

Tests per step: checker (`core/test/m8-01-kit-check.test.ts` grows with every part), renderer (`workbench/test/m8-01-kit-parts.test.ts` needs a fixture for every drawn part), core methods (`core/test/m8-02-ui-surface.test.ts` and one file per later step), screenshot (renders compared by eye, then by snapshot). Rollback: every step is behind one setting; turning it off falls back to plain text in the panel.

## 10. Out of scope

- Agent-written HTML or iframes, including MCP Apps from third parties. If ever allowed, they open behind a gate in a sandbox, never as catalogue parts.
- Charts beyond the current set (chart: bar, line, share; plus bar, meter, spark, tracker, matrix, timeline). A new chart kind waits for 3 screens that need it.
- A markdown part. Agents write plain text, `text`, `doc` and `code`; a markdown parser is one more thing to sanitise, so it stays out until a screen cannot do without it.
- Agents rewriting Ouros's own code (Darwin Gödel Machine, SICA), and agents tuning Ouros's prompts and tools (GEPA,
  meta-n, Harness²). Lessons are the only self-change in the first build. Reasons: these gains have been questioned
  for whether they last and stack (2610.11655, 2607.14004); proposers invent failures to guard against (Phantom
  Guardrails 2607.13083, 25% of runs); and a plain keep-only-if-better loop (karpathy/autoresearch, 98k stars) is
  what people actually adopt. Revisit after loop 3 has run on real projects.
- Menus, toolbar and keybindings. An agent can rearrange every panel (section 6c) but not rename menus or rebind keys; that option was offered and not picked.

## Files

| File | What |
|---|---|
| kit.js | catalogue, renderer, `surface()` source tagging, templates, profile |
| kit.css | part styles; agent-surface and density rules at the end |
| specs/*.json | 29 screens (17 pipelines, 3 made by screen makers for non-developers, 9 others) plus 12 phone screens (m-*.json, the phone design round), each with `source` and `agent` |
| any-*.md | screen makers' notes: references used, parts they wanted |
| templates/*.json | run-summary, review-duel |
| profiles/*.json | learned (learned example), newcomer (default) |
| check.mjs, validate.mjs | safety tests; every spec draws with catalogue parts only |
| measure.mjs | the size numbers in section 8 |
| ws.js, workspace.html, workspaces/*.json | the workspace as data: checker, layout drawer, four example layouts and five refusal cases |
| gen_catalogue.mjs | writes CATALOGUE.md from kit.js |
| host.html, spec-phone.html, gallery.html, shoot.mjs, board5.py | renders, shots, the board |


## Core screens and Settings (2026-11-10)

Decision D83 (spec.md): reliability features run under the UI. Each keeps its behaviour and acceptance criteria. It has a Settings entry and a log line, and a Needs-you item only when a person must act. Source: D-screens.md.

### Core screens

1. Home: say what you want, pick agent, project, branch, approval. Folds in the start box and the Today digest.
2. IDE: editor, explorer, terminal, the agent panel with the nested reviewer.
3. Wall: every agent on one screen, who needs you, across projects.
4. Review: changed files, line comments, commit, push, open PR.
5. Browser: agent browser with holder, Stop and Take over, point at an element, dev-server tab.
6. Needs you: gates, decisions, digest. The one place self-healing may call the person.
7. Plain job view: the same run as steps with no code, "Show the code".
8. Add-ons: browse, install, update, revoke plugins, skills, MCP.
9. Settings: every moved reliability feature, plus appearance, keys and History.
10. Tasks (his call): GitHub issues with a Start button.

Chrome that stays: title bar, status bar (carries "N healed"), command palette, agent list drawer, Usage popover, menus, toasts.

### Settings tree

General

| Label | Control | Default | From |
|---|---|---|---|
| Ask before each tool call | select: Ask / Auto mode in Ouros worktrees | Ask (recommended) | settings.sessions.approval |
| Always ask for these paths | list of paths | empty | settings.sessions.ask_paths |
| Use the metarouter | toggle | on | settings.sessions.metarouter |
| Default project | folder | none | settings.projects.default |
| Start on | select: Home / IDE / Wall | open call | M8-F13 |

Appearance and keys

| Label | Control | Default | From |
|---|---|---|---|
| Theme | select (7 themes) | Dither | settings.ui.theme; M7-15 |
| Working indicator | select: Sparkline / Equaliser | Sparkline | palette item |
| Tile header colour | select | current | M7-16 |
| Density | select | Default | M8-7 |
| Customize Look presets | select: Quiet / Default; reset; import from VS Code, Zed, JetBrains | Default | M8-19, M8-20 |
| Terminal font size, scrollback | number | 13, 10000 | settings.terminal.* |
| Keybindings | table | defaults | M7-12 |

Reliability

| Subsection | Label | Control | Default | From |
|---|---|---|---|---|
| Finishing | Say "done" only when a check passed | toggle (fail closed) | on | M8-F1 |
| Finishing | Wording of the result | select: "Agreed checks passed" / "Done" | open call | M8-F1 |
| Finishing | Acceptance check command (per project) | text | none = "Needs your review" | M8-13d |
| Finishing | Show what was not checked | toggle | on | spec.md open call |
| Repair | Fix failing checks automatically | toggle | on | M8-F3 |
| Repair | Most tries | number | 3 | section 6e (Aider cap) |
| Repair | Last try uses a stronger model | toggle, model select | on | section 6e |
| Repair | Protect tests, check configs and logging from agent edits | toggle | on | M8-13b |
| Repair | Rewind files before each retry | toggle | on | M8-13c |
| Watching | Loop alarm | toggle | on | M8-F4 |
| Watching | Nudge after N identical calls | number | 3 | M8-F4a |
| Watching | Stop after N identical calls | number | 5 | M8-F4b |
| Watching | Treat declared polling as progress | toggle | on | M8-F4c |
| Watching | Send a recovery message before stopping | toggle | on | section 6e |
| Watching | Model watcher (small second model) | toggle, model select | off until logged nudges beat its cost | M8-15a |
| Watching | False alarms so far | read-only count | 0 | M8-F4d |
| Budgets | Time limit per run | number, minutes | set at build | section 6e |
| Budgets | Token limit per run | number | set at build (demo used 200k) | M8-13, M8-23 |
| Budgets | Timeout per check | number, seconds | set at build | section 6e |
| Budgets | Note at this share of budget | number % | 80 | M8-23e |
| Budgets | At 100% | fixed: ask me | ask (gate) | M8-23e |
| Provider errors | Retries before giving up | number | 5 | M8-23 |
| Provider errors | Ask before switching to another model | toggle, locked on | on | section 6e |
| Provider errors | Pause a failing provider (cooldown) | number, seconds | set at build | section 6e |
| Checks | Run checks after every edit | toggle | on | section 6e |
| Checks | Repair malformed tool calls and show each repair | toggle | on | section 6e |
| Checks | Warn before compacting or switching model (cache re-bill) | toggle | on | section 6e |
| Checks | Force compaction | none: never forced | n/a | M8-23f |
| Asking | Ask when a request can mean two things | toggle | on | M8-F5a |
| Asking | Flag edits outside the planned files | toggle | on | M8-F5b |
| Long runs | Keep runs going when Ouros closes | toggle | on | M8-F8a |
| Long runs | Resume after a crash or close | toggle | on | M8-23c |
| Long runs | Ask before re-running sends and deploys | toggle, locked on | on | M8-23d |
| Long runs | At a usage limit reset, carry on | toggle | off | M6-24 |
| Long runs | Tell me when a long run finishes | toggle | on | M8-F8b |
| Undo and checkpoints | Checkpoint | select: every turn / every run | every turn per 6e; open call | M8-F2 |
| Undo and checkpoints | Keep checkpoints for | number, days | set at build | M8-F2 |
| Your rules | Rules list with what enforces each and caught counts | list | empty | M8-F6 |
| Visibility | Show what Ouros fixed on its own | toggle | on | M8-23 |
| Visibility | "N healed" in the status bar | toggle | on | M8-23 |

Learning

| Label | Control | Default | From |
|---|---|---|---|
| Learn from my corrections | toggle | off until measured (proposed) | M8-15 |
| Auto-propose lessons | toggle | off | M8-29a |
| Replay a lesson on how many past runs | number | 5 | section 6d |
| Learn my layout and density | toggle | on, one pending proposal at a time | M8-7c |
| Let Ouros adapt the layout | toggle (confidence floor) | on | M8-35 |
| What Ouros learned | list with Undo per row | empty | M8-7a |
| Export lessons to AGENTS.md | button | n/a | section 6d |
| Lesson store state | read-only status | ok | section 6d |

Savings

| Label | Control | Default | From |
|---|---|---|---|
| Shrink shell output | toggle | off | settings.savers.shrink_shell |
| Lean handoffs | toggle | off | settings.savers.lean_handoffs |
| Smaller screenshots | toggle | off | settings.savers.small_screenshots |
| Cheapest model per step | toggle | off | settings.savers.cheap_model |
| Show repeat-read note on Usage | toggle | on | M8-24c |

Safety and permissions

| Label | Control | Default | From |
|---|---|---|---|
| Gate list (A1-A9) | read-only list | fixed | M8-21 |
| Suggest demoting a gate I always allow | toggle | off, open call | M8-21 |
| Hold edits to hooks, task files and agent configs for approval | toggle | on | M8-13g |
| Tool access per tool, per project, subagents column | table (allow / ask / deny) | ask | M8-F11 |
| Allowed browser origins | list | empty | settings.browser.allow_origins |
| Take-over key | key | Control+Alt+Q | settings.desktop.takeover_key |
| Pause when I touch the desktop | toggle | on | settings.desktop.watch_pause |
| Never repeat an unverified desktop action | toggle, locked on | on | M8-40 |

Add-ons

| Label | Control | Default | From |
|---|---|---|---|
| Ask before every plugin update | toggle, locked on | on | M8-F10c |
| Remote block list | toggle | on | M8-14c |
| Second-model review before hand-back | toggle, model select | off, cost shown first | M8-F17 |

Notifications

| Label | Control | Default | From |
|---|---|---|---|
| Sinks (Slack, ntfy, webhook) | list | empty | M5-15 |
| Events sent | multi-select of 12 kinds | gate, handoff, run-failed, budget, missing-secret, approval | M5-15 |
| Push to my phone | select: needs-you only / plus finished | open call | M8-F23 |

Activity

| Label | Control | Default | From |
|---|---|---|---|
| Audit trail (who did what and why) | read-only list | n/a | M8-F21 |
| Agent scorecard | read-only table | "not enough runs" under 5 | M8-45d |
| Open logs folder | button | n/a | palette item |

Advanced

| Label | Control | Default | From |
|---|---|---|---|
| Pin the Ouros prompts and loop settings; show a diff on update | toggle | proposed on | section 6e |
| Restart core / Stop core | buttons with confirm | n/a | palette items |
| Worktree: run npm ci, stale days | toggle, number | on, 7 | settings.worktree.* |

### Open calls (his)

- Rewind: keep a small restore preview sheet, or no preview at all (the file list becomes a log entry).
- Rewind checkpoint: a snapshot per run or per turn (spec.md open call).
- Tool access, audit trail, scorecard, notification sinks, phone push: confirm he counts them as Settings tables.
- Learned page: profile and lessons shown as one list in Settings > Learning, or two.
- Usage: stays a title-bar popover, or becomes a full page.
- Home, Today, Start screen and New agent: merged into one Home. M8-F13 line 18 says Today is separate.
- Tasks (n11): built in, or a plugin. Without it the core list is nine.
- Runs by itself (n13) and Notch: post-launch, or fold n13 into the Wall.
- History panel: folded into the agent list drawer, or a separate panel as M7-12 specs.
- Report verify (verify.json): classed as an add-on, his look.
- Spec conflict: M8-17 line 17 says wall tile footers never show cost; M8-23 line 16 shows "164k of 200k tokens" in the tile footer.
- Spec conflict: M8-F13 line 18 says Home is not the Today screen, while Home and Today overlap.
