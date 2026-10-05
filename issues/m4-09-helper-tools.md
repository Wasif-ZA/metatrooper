# M4-9 Helper tools for every pipeline (`assists`)

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- `pipelines/assists.json` (MIT, with the pipelines) is the one registry:
  ```json
  {"<tool id>": {"name": "...", "repo": "owner/name", "licence": "...", "risk": "ok" | "caution",
                 "risk_note": "...", "egress": "none" | "<what leaves the machine, and where>",
                 "detect": ["<exe>", "<arg>", "..."], "install": "<one line>",
                 "reached_by": "cli" | "npm" | "pip" | "mcp"}}
  ```
  `reached_by` is shown on the chip only. `detect` is an argv array run without a shell; only this
  first-party file supplies it. `egress` is required; known non-`none` values today: mcp-server-chart sends
  chart data to `antv-studio.alipay.com`; Windows-MCP has `ANONYMIZED_TELEMETRY=true`; markitdown-ocr sends
  page images to an LLM; gpt-researcher uses a remote filter when `TYPESAFE_API_KEY` is set.
- `contracts/pipeline.schema.json` gains an optional top-level `assists` array:
  `[{"tool": "<tool id>", "steps": ["<step id>", "..."], "use": "<one sentence>"}]`. `pipeline.validate`
  refuses a tool id missing from the registry, a step id missing from the pipeline, or a registry entry
  with no `egress`.
- At run start the runner runs every referenced `detect` in parallel, 5 s timeout each, and writes
  `<run_dir>/assists.json`: `[{"tool", "installed": true | false, "version": "<first non-empty stdout line, max 120 chars>" | null}]`.
  Exit code 0 means installed. Detection never fails or delays the run beyond 5 s.
- For an agent step with installed helpers, the runner appends one block to the prompt:
  "Helpers installed on this machine (use one when it fits; you do not have to):" followed by one line per
  helper, "- <name>: <use>". The block comes from `<run_dir>/assists.json`, so it is fixed for the run and
  an approval's `action_hash` stays stable. With no installed helpers the prompt is byte for byte unchanged.
- The run screen shows a chip per helper: installed (with version) or "not installed" with its install
  line; `caution` shows `risk_note`; non-`none` `egress` shows in orange.
- M4 fills `assists` in the five built pipeline files:

| Pipeline | Helpers (tool: steps) |
|---|---|
| two-engine-review | semgrep: codex-review; difftastic: diff; ast-grep: codex-review; reviewdog: bucket notes only |
| spec-to-pr | gh: spec; act: build; OpenSpec: spec; context7: build |
| e2e-browser-qa | Playwright: fix; agent-browser: qa; chrome-devtools-mcp: qa; BackstopJS: fix |
| website-build | Lighthouse: critique; shadcn CLI: build; screenshot-to-code: build; BackstopJS: critique |
| design-variants | screenshot-to-code: variants; Storybook: variants; cursor-talk-to-figma-mcp: directions; odiff: polish |

  Each `use` sentence comes from the "Step it helps, and how" column of `research-assists.md`. A helper on a
  code or action step (reviewdog on `bucket`) is listed on the chip but adds no prompt text.

## Acceptance criteria

- M4-14. `pipeline.validate` refuses an `assists` entry with an unknown tool or step and a registry entry
  without `egress`, and accepts all five updated pipeline files.
- M4-15. With a fake `semgrep.cmd` on PATH, the `codex-review` prompt file contains the helper block naming
  semgrep; with no helper installed, every rendered prompt equals its pre-M4-9 text byte for byte.
- M4-16. A `detect` that never exits delays run start by at most 5.5 s and marks that helper not installed.
- M4-17. Approving a publish gate, then installing a helper, then letting the step run, does not make the
  approval stale.
- M4-18. The run screen shows one chip per helper; `caution` shows its note; non-`none` egress is orange.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-14 to M4-18 | `core/test/assists.test.ts`; M4-18 in `workbench/test/assists-chips.test.ts` | unit and Electron |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
