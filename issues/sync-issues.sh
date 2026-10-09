#!/usr/bin/env bash
# Pushes each open issue's title, milestone and body from its file. Files are named <GitHub number>-<subject>.md.
# Titles are single-quoted so backticks are never run as commands.
set -euo pipefail
sync() {
  gh issue edit "$1" --title "$2" --milestone "$3" --body-file "$4" >/dev/null && echo "synced #$1 $2"
}
sync 26 '`docs-and-release-notes` pipeline' 'M2 design and coding lanes' 'issues/26-docs-and-release-notes.md'
sync 27 '`security` plugin and `security-review-and-upgrade`' 'M2 design and coding lanes' 'issues/27-security.md'
sync 29 'Usage limits and account switcher' 'M2 design and coding lanes' 'issues/29-usage-limits-and-accounts.md'
sync 31 'Signed installer through SignPath Foundation' 'M2 design and coding lanes' 'issues/31-signed-installer.md'
sync 32 '`media` plugin and `footage-to-edit`' 'M3 every other lane' 'issues/32-media.md'
sync 33 '`social-scheduler` plugin and `clips-to-scheduled-posts`' 'M3 every other lane' 'issues/33-social-scheduler.md'
sync 34 '`seo` plugin and `seo-audit-fix`' 'M3 every other lane' 'issues/34-seo.md'
sync 35 '`cite-check` plugin and `deep-research-cited`' 'M3 every other lane' 'issues/35-cite-check.md'
sync 36 '`gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`' 'M3 every other lane' 'issues/36-gmail.md'
sync 37 '`data` plugin and `data-to-dashboard`' 'M3 every other lane' 'issues/37-data.md'
sync 38 '`docs-export` plugin and `study-notes-to-pdf`' 'M3 every other lane' 'issues/38-docs-export.md'
sync 39 '`desktop` plugin, handoff gate UI, `form-fill-batch`' 'M3 every other lane' 'issues/39-desktop.md'
sync 40 'Template gallery' 'M3 every other lane' 'issues/40-template-gallery.md'
sync 42 'Open-core seams' 'M3 every other lane' 'issues/42-open-core-seams.md'
