#!/usr/bin/env bash
#
# Remove the Golden Egg launchd agents. Stops all scheduled scans (and therefore
# all credit spend from automation).
set -euo pipefail

AGENTS="$HOME/Library/LaunchAgents"

for label in com.goldenegg.scan com.goldenegg.closes; do
  if launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$label" 2>/dev/null || true
    echo "  unloaded $label"
  fi
  if [[ -f "$AGENTS/$label.plist" ]]; then
    rm -f "$AGENTS/$label.plist"
    echo "  removed  $AGENTS/$label.plist"
  fi
done

echo ""
echo "Done — no scheduled scans will run. Logs in ./logs are left in place."
