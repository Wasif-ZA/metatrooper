#!/usr/bin/env bash
# Pushes each open issue's title, milestone and body from its file. Files are named <GitHub number>-<subject>.md.
# Titles are single-quoted so backticks are never run as commands.
set -euo pipefail
sync() {
  gh issue edit "$1" --title "$2" --milestone "$3" --body-file "$4" >/dev/null && echo "synced #$1 $2"
}
