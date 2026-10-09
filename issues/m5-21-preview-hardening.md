# M5-21 Two hardening fixes in every preview and unshipped pipeline

Child of Milestone 5 in `spec.md`. Tag: done in code 2026-10-09 (M5-D27). Built by three Sonnet builders on
`m5-hp-a`, `m5-hp-b` and `m5-hp-c`, each fix verified against the code before it was made; tests by Codex in
`core/test/m5-21-preview-a.test.ts`, `-b` and `-c` (fixture repairs by Claude, named in their commits). Ideas came from
`ide-layer-research/m5-repo-scan-preview.md`; ideas the code already handled were skipped.

## The fixes

| Pipeline | Failure it closes | Commit |
|---|---|---|
| website-build | the design step stalled on a permission prompt (now `edits`) | 2dee100 |
| website-build | a missing Vercel link surfaced only at preview, after the build; a `link` check now runs first | 2c78242 |
| design-variants | three agent steps stalled on permission prompts (now `edits` or `contained`) | cfc8455 |
| design-variants | a variant whose direction file was missing built from the brief alone | 2865cc7 |
| docs-and-release-notes | tags but no release listed every merged PR | 09afab2 |
| docs-and-release-notes | PRs merged earlier on release day were listed again | 43420c0 |
| security-review-and-upgrade | a failed `npm outdated` read as nothing outdated | cbd3fa8, 2aa6926 |
| security-review-and-upgrade | `optionalDependencies` were never listed | e92c518 |
| footage-to-edit | the edit step could end without rendering `final.mp4` | 3114d72 |
| footage-to-edit | an empty folder, dot files, or a silent whisper pass looked clean | 319385f |
| clips-to-scheduled-posts | every moment dropped still ran to the schedule step | 988c4fd |
| clips-to-scheduled-posts | a TikTok privacy typo failed only after approval | dafbe25 |
| seo-audit-fix | a blocked or failing start page gave a clean empty crawl | 81b24a1 |
| seo-audit-fix | a crawl cut at its page limit did not say pages were left | 331dde0 |
| deep-research-cited | a report citing nothing passed cite-check | cb760a3 |
| deep-research-cited | quotes in table rows and block quotes were never checked | 5913e45 |
| data-to-dashboard | a failed source check was ignored | d714332 |
| data-to-dashboard | a semicolon, tab or pipe separated file loaded as one column | 5e7f657, 81a8e70 |
| form-fill-batch | submit reported success when a window failed | 76d6d6b |
| form-fill-batch | a row with no recorded window was skipped silently | fd075b1 |
| prospect-list-to-drafts | a list that kept no prospect still reached the spend gate | 8bf80d3 |
| prospect-list-to-drafts | sources returned success when no site could be fetched | afe0d26 |
| inbox-triage-drafts | HTML-only mail filled the body with style and script text | 0ab8228 |
| inbox-triage-drafts | a missing rules file went unnoticed at the approve gate | 2fd6460 |
| study-notes-to-pdf | a scanned PDF with no text layer produced empty notes | 6a0bb96 |
| study-notes-to-pdf | unsourced lines reached signoff without a warning | 8c2ff57 |

The approval changes in website-build and design-variants raise how much those steps do without asking; spec-to-pr's
agent steps already run `contained`, so this follows that precedent.

## Product calls found, not built

- docs-and-release-notes: the release tags the remote branch, but the docs and CHANGELOG edits are only staged
  locally; its three parallel update lanes share one index; `breaking_no_doc` is never read.
- security-review-and-upgrade: `high_reachable` is never read; with nothing outdated the bump step is told to upgrade
  "none".
- Shell-running steps on `edits` approval (docs update, changelog, samples; footage edit and visual-check; security
  notes) still ask per shell command.
- design-variants: the inspiration board falls back to GitHub repos only when Exa fails.
- clips-to-scheduled-posts: resuming after a partial schedule posts the earlier ones twice.
- data-to-dashboard: ragged CSV rows are counted but never shown.
- seo-audit-fix: `prioritise` may omit key pages, so the speed check can pass on nothing; robots.txt Allow and
  wildcards are not honoured.
- form-fill-batch: re-running submit after a partial failure presses Submit again on windows that already submitted.
- prospect-list-to-drafts: emails that fail `check` are still drafted on approve; a second run duplicates drafts.
- inbox-triage-drafts: `gmail/read` stops at 50 messages; reply drafts do not compare `to` with the thread.
