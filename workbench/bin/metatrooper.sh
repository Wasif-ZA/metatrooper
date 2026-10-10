#!/bin/sh
# Linux twin of metatrooper.cmd: opens the window detached from this terminal.
dir="$(cd "$(dirname "$0")/.." && pwd)"
nohup "$dir/node_modules/electron/dist/electron" "$dir" "$@" >/dev/null 2>&1 &
