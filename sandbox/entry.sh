#!/bin/sh
# Links read-only logins into the writable home, marks the worktree trusted, then runs the engine.
set -e
if [ -d /troop/logins ]; then
  cd /troop/logins
  find . -type f | while read -r f; do
    rel="${f#./}"
    mkdir -p "$HOME/$(dirname "$rel")"
    ln -sf "/troop/logins/$rel" "$HOME/$rel"
  done
  cd - >/dev/null
fi
dir="$(pwd)"
cat > "$HOME/.claude.json" <<EOF
{"hasCompletedOnboarding": true, "bypassPermissionsModeAccepted": true, "projects": {"$dir": {"hasTrustDialogAccepted": true}}}
EOF
mkdir -p "$HOME/.codex"
printf '[projects."%s"]\ntrust_level = "trusted"\n' "$dir" > "$HOME/.codex/config.toml"
exec "$@"
