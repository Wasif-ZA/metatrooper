# FIX-W3: Typed notes and the chosen session are lost on re-render

From the 2026-10-31 audit of workbench. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- workbench/renderer/app.js:132-148, 245-246, 337-338

## What goes wrong

setHtml restores [data-key] fields from ui.drafts, but nothing writes ui.drafts since the pipelines UI left (verified: only the read at line 140). A state or title change re-renders, the comment note and hand-back note go blank, and the session select resets to its first option, so Send can go to the wrong agent. test/start-form.test.ts fills drafts by hand and hides it.

## Fix

One delegated input/change listener writes every [data-key] value to ui.drafts; clear it on send or cancel.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [x] FIX-W3a. Notes typed while an agent's title or state changes are kept. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/fix-w3-drafts.test.ts 1/1)
- [x] FIX-W3b. The selected session survives a re-render. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/fix-w3-drafts.test.ts 1/1)
- [x] FIX-W3c. Send or Cancel clears the draft. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/fix-w3-drafts.test.ts 1/1)
- [x] FIX-W3d. A test types, re-renders with a changed state, and checks the value. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/fix-w3-drafts.test.ts 1/1)

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.

Status 2026-11-24: done, every box ticked; each box names its test. Run by B4 on a8a3b642 with its own npm ci; full suite green on eca8743a (M).
