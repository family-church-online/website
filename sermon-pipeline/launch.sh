#!/usr/bin/env bash
# Family Church Sermon Pipeline — GUI launcher
# Double-click this file, or point a .desktop shortcut at it.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load env vars from .env (website root, then pipeline dir)
set -a
[ -f "$SCRIPT_DIR/../.env" ]  && source "$SCRIPT_DIR/../.env"
[ -f "$SCRIPT_DIR/.env" ]     && source "$SCRIPT_DIR/.env"
set +a

exec node "$SCRIPT_DIR/pipeline.mjs" --gui
