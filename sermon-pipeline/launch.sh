#!/usr/bin/env bash
# Family Church Sermon Pipeline — GUI launcher
# Double-click this file, or point a .desktop shortcut at it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load env vars from .env (website root, then pipeline dir)
set -a
[ -f "$SCRIPT_DIR/../.env" ]  && source "$SCRIPT_DIR/../.env"
[ -f "$SCRIPT_DIR/.env" ]     && source "$SCRIPT_DIR/.env"
set +a

# Ask whether to run for real or just do a dry run
zenity --question \
  --title="Sermon Pipeline" \
  --text="What would you like to do?" \
  --ok-label="Run Pipeline" \
  --cancel-label="Dry Run (test only)" \
  --width=380
CHOICE=$?

if [ $CHOICE -eq 0 ]; then
  exec node "$SCRIPT_DIR/pipeline.mjs" --gui
elif [ $CHOICE -eq 1 ]; then
  exec node "$SCRIPT_DIR/pipeline.mjs" --gui --dry-run
else
  exit 0  # window closed
fi
