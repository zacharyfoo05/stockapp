#!/usr/bin/env bash
# Auto-pull loop — run this once, leave it in a terminal tab.
# Fetches origin every 4 seconds; fast-forwards if there are new commits.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Watching branch: $BRANCH  (Ctrl-C to stop)"
while true; do
  git fetch origin "$BRANCH" --quiet 2>/dev/null
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$(date '+%H:%M:%S')  New commits — pulling…"
    git pull --ff-only origin "$BRANCH"
  fi
  sleep 4
done
