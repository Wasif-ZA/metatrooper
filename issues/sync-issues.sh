#!/usr/bin/env bash
# Creates or fixes every child issue. Safe to run again: edits open issues whose title starts with "#N ", creates the rest.
# Titles are single-quoted so backticks are never run as commands.
set -euo pipefail
for m in 'M1 core loop' 'M2 design and coding lanes' 'M3 every other lane'; do
  gh api "repos/{owner}/{repo}/milestones" -f title="$m" >/dev/null 2>&1 || true
done
existing=$(gh issue list --state open --limit 200 --json number,title --jq '.[] | "\(.number)\t\(.title)"')
sync() {
  local num
  num=$(printf '%s\n' "$existing" | awk -F'\t' -v p="#$1 " 'index($2,p)==1{print $1; exit}')
  if [ -n "$num" ]; then
    gh issue edit "$num" --title "$2" --milestone "$3" --body-file "$4" >/dev/null && echo "fixed   #$num $2"
  else
    gh issue create --title "$2" --milestone "$3" --body-file "$4" && echo "created $2"
  fi
}
sync 1 '#1 Core service' 'M1 core loop' 'issues/01-core-service.md'
sync 3 '#3 Plugin system' 'M1 core loop' 'issues/03-plugin-system.md'
sync 2 '#2 Callrouter Plan A, in the callrouter repo, meeting its own criteria 1 to 8; then its `troop-plugin.json`' 'M1 core loop' 'issues/02-callrouter-plan-a-in-the-callrouter-repo-meeting-i.md'
sync 4 '#4 Pipeline runner' 'M1 core loop' 'issues/04-pipeline-runner.md'
sync 5 '#5 Electron workbench' 'M1 core loop' 'issues/05-electron-workbench.md'
sync 6 '#6 Live browser' 'M1 core loop' 'issues/06-live-browser.md'
sync 9 '#9 Two-engine review pipeline and view' 'M1 core loop' 'issues/09-two-engine-review-pipeline-and-view.md'
sync 10 '#10 Hand-back tray' 'M1 core loop' 'issues/10-hand-back-tray.md'
sync 11 '#11 Token meter and prices (reads `usage` from #1 and callrouter "saved")' 'M1 core loop' 'issues/11-token-meter-and-prices-reads-usage-from-1-and-call.md'
sync 31 '#31 Agent-native `paratroopers` CLI and skill' 'M1 core loop' 'issues/31-agent-native-paratroopers-cli-and-skill.md'
sync 13 '#13 Measurement tooling for the adoption gate' 'M1 core loop' 'issues/13-measurement-tooling-for-the-adoption-gate.md'
sync 7 '#7 Inspiration board and `agent-reach` plugin' 'M2 design and coding lanes' 'issues/07-inspiration-board-and-agent-reach-plugin.md'
sync 8 '#8 Variants grid' 'M2 design and coding lanes' 'issues/08-variants-grid.md'
sync 14 '#14 `github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants`' 'M2 design and coding lanes' 'issues/14-github-and-deploy-plugins-spec-to-pr-e2e-browser-q.md'
sync 23 '#23 `docs-and-release-notes`' 'M2 design and coding lanes' 'issues/23-docs-and-release-notes.md'
sync 25 '#25 `security` plugin and `security-review-and-upgrade`' 'M2 design and coding lanes' 'issues/25-security-plugin-and-security-review-and-upgrade.md'
sync 27 '#27 herdr host plugin' 'M2 design and coding lanes' 'issues/27-herdr-host-plugin.md'
sync 29 '#29 Usage limits and account switcher' 'M2 design and coding lanes' 'issues/29-usage-limits-and-account-switcher.md'
sync 30 '#30 Diff annotation and file drag' 'M2 design and coding lanes' 'issues/30-diff-annotation-and-file-drag.md'
sync 28 '#28 Signed packaging through SignPath Foundation (Electron now; Tauri in milestone 3)' 'M2 design and coding lanes' 'issues/28-signed-packaging-through-signpath-foundation-elect.md'
sync 15 '#15 `media` plugin and `footage-to-edit`' 'M3 every other lane' 'issues/15-media-plugin-and-footage-to-edit.md'
sync 16 '#16 `social-scheduler` plugin and `clips-to-scheduled-posts`' 'M3 every other lane' 'issues/16-social-scheduler-plugin-and-clips-to-scheduled-pos.md'
sync 17 '#17 `seo` plugin and `seo-audit-fix`' 'M3 every other lane' 'issues/17-seo-plugin-and-seo-audit-fix.md'
sync 18 '#18 `cite-check` plugin and `deep-research-cited`' 'M3 every other lane' 'issues/18-cite-check-plugin-and-deep-research-cited.md'
sync 19 '#19 `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`' 'M3 every other lane' 'issues/19-gmail-plugin-prospect-list-to-drafts-inbox-triage-.md'
sync 20 '#20 `data` plugin and `data-to-dashboard`' 'M3 every other lane' 'issues/20-data-plugin-and-data-to-dashboard.md'
sync 22 '#22 `docs-export` plugin and `study-notes-to-pdf`' 'M3 every other lane' 'issues/22-docs-export-plugin-and-study-notes-to-pdf.md'
sync 24 '#24 `desktop` plugin, handoff gate UI, `form-fill-batch`' 'M3 every other lane' 'issues/24-desktop-plugin-handoff-gate-ui-form-fill-batch.md'
sync 21 '#21 Template gallery (17 templates)' 'M3 every other lane' 'issues/21-template-gallery-17-templates.md'
sync 12 '#12 Tauri tray companion, signed through #28'"'"'s pipeline' 'M3 every other lane' 'issues/12-tauri-tray-companion-signed-through-28-s-pipeline.md'
sync 26 '#26 Open-core seams' 'M3 every other lane' 'issues/26-open-core-seams.md'
