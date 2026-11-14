# M8-J7: Support desk job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-support.json`. Shot: `proto/shots/persona-t-support.png`. Parts: `proto/kit/parts-job4a.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4a.md`; `research-ide/E/LAYOUTS.md` "support"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Zendesk Agent Workspace.
A late wedding cake complaint. The agent drafts the reply and works out a $96 refund (15% of $640). Orange waits because it costs money.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| Draft lands in the reply box | Intercom | It appears where you already work, and you send it |
| Change logged in the thread; Reply or Note switch | Chatwoot | You can see what the agent changed |

Differs: no ticket list column. The Ouros agent pane is the only chat, so there are not two. No reference for Zendesk's own copilot panel was found.

## Evidence

- Sierra says it doubled to $400M+ a year in five months: its own blog.
- Ramp shows AI support bots under 1%, so this is early and in big firms. Ramp does not measure traditional help desks.

## Blocked on

- Which engine or plugin holds the tickets. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J7a. The workspace loads as an example and passes validate.mjs.
- [ ] M8-J7b. With no engine installed, the screen says so and shows an install card, never a demo ticket as real.
- [ ] M8-J7c. With a plugin installed, a real ticket opens with its history.
- [ ] M8-J7d. A reply or a refund waits at a real gate from M8-21.
- [ ] M8-J7e. Customer text reaches the agent labelled as outside text.
- [ ] M8-J7f. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
