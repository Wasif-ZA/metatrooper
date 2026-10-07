# M4-8 M2 and M3 issue amendments (docs only)

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
Twelve pipelines are not built. Each of their issues gets: its helper rows from `research-assists.md`
(top 3 to 4, with licence risk and egress), and its ideas table from `ideas-coding.md` or `ideas-lanes.md`
(High value rows as requirements, the rest as notes). Issue #36 covers two pipelines, so it gets two lists.
`spec-build-review-handback` is an M1 built-in with no pipeline file yet, so its list goes into
`issues/archive/15-pipeline-runner.md`, the issue that ships the built-ins.

| Issue file | Pipeline | Helpers, first picks | Extra change |
|---|---|---|---|
| `issues/archive/15-pipeline-runner.md` | spec-build-review-handback | OpenSpec, spec-kit, context7, repomix | none |
| `issues/26-docs-and-release-notes.md` | docs-and-release-notes | git-cliff, release-please, changesets, vale | version bump computed from commit prefixes (ideas-coding.md) |
| `issues/27-security.md` | security-review-and-upgrade | osv-scanner, trivy, semgrep, gitleaks | reuse M4-4's scan function |
| `issues/32-media.md` | footage-to-edit | auto-editor, faster-whisper, Remotion (caution), OpenMontage (AGPL, caution) | none |
| `issues/33-social-scheduler.md` | clips-to-scheduled-posts | OpenMontage Clip Factory, AI-Youtube-Shorts-Generator, FunClip, Remotion | none |
| `issues/34-seo.md` | seo-audit-fix | unlighthouse, siteone-crawler, Lighthouse, lychee | none |
| `issues/35-cite-check.md` | deep-research-cited | crawl4ai, trafilatura, gpt-researcher, local-deep-research | none |
| `issues/36-gmail.md` | prospect-list-to-drafts | crawl4ai, gws, reacher (AGPL or paid, caution) | say the email-check helper is thin |
| same file | inbox-triage-drafts | gws, google_workspace_mcp, himalaya | none |
| `issues/37-data.md` | data-to-dashboard | DuckDB CLI, Evidence, Datasette, mcp-server-chart (egress) | node:sqlite stays the built-in path |
| `issues/38-docs-export.md` | study-notes-to-pdf | markitdown, docling, typst, pandoc (GPL, caution) | steps still unconfirmed |
| `issues/39-desktop.md` | form-fill-batch | Windows-MCP (egress), pywinauto, Playwright, UFO | copy selector patterns into the PowerShell actions |
| `issues/40-template-gallery.md` | template gallery | none | mine `Zie619/n8n-workflows` (MIT, 56,884) for step shapes per lane |
| `spec.md` Dependencies table | none | none | record pdf.js and the Google Node client (Apache-2.0) and Postiz (AGPL, API only) as accepted exceptions to the MIT rule |

## Acceptance criteria

- M4-13. Every row of the M4-8 table is applied; each of the 12 unbuilt pipelines lists at least 2 helpers.
