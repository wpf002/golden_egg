#!/usr/bin/env bash
#
# Install the Golden Egg background agents (macOS launchd).
#
# WHY launchd one-shot jobs instead of an always-on server with node-cron:
#   - node-cron only fires while its process is awake. A laptop asleep at 07:00
#     loses that tick forever, and a missed scan day is a permanently missing
#     cohort of eggs — RSS only serves recent items, so you cannot backfill a
#     catalyst you never saw.
#   - launchd runs a missed StartCalendarInterval job when the machine wakes.
#   - No long-lived process means nothing holds port 5050 away from `npm run dev`.
#
# Installs two agents:
#   scan   — weekdays 07:00 local. SPENDS CREDITS (bounded by SCAN_MAX_CREDITS).
#   closes — weekdays 22:30 local (after the US close). Free; quote data only.
#
# Usage:
#   ./ops/install-agents.sh          # install + load
#   ./ops/uninstall-agents.sh        # remove
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$REPO/logs"

# launchd runs with no shell, no PATH, and no nvm. Every path must be absolute.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not on PATH. Run via a shell where 'node' resolves (nvm use)." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
TSX="$REPO/node_modules/tsx/dist/cli.mjs"

if [[ ! -f "$TSX" ]]; then
  echo "error: tsx not found at $TSX — run 'npm install' first." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "error: node $NODE_MAJOR found; this app needs >=20 (see .nvmrc)." >&2
  exit 1
fi

mkdir -p "$AGENTS" "$LOGS"

# $1=label  $2=script  $3=hour  $4=minute
write_agent() {
  local label="$1" script="$2" hour="$3" minute="$4"
  local plist="$AGENTS/$label.plist"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$TSX</string>
    <string>$REPO/$script</string>
  </array>

  <key>WorkingDirectory</key><string>$REPO</string>

  <!-- launchd starts with a bare environment; give node its own bin dir. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <!-- Runs on wake if the machine was asleep at the scheduled time. That is
       the whole reason this is a launchd job and not an in-process cron. -->
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
  </array>

  <!-- One-shot: run, log, exit. Never resurrect on failure — a crash-looping
       scan would spend credits on repeat. -->
  <key>RunAtLoad</key><false/>
  <key>KeepAlive</key><false/>

  <key>StandardOutPath</key><string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$label.log</string>
</dict>
</plist>
PLIST
  # bootout is idempotent-ish; ignore "not found" on a first install.
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$plist"
  echo "  loaded $label  ->  weekdays $(printf '%02d:%02d' "$hour" "$minute")  ($plist)"
}

echo "Installing Golden Egg agents"
echo "  repo: $REPO"
echo "  node: $NODE_BIN (v$NODE_MAJOR)"
echo ""
write_agent "com.goldenegg.scan"   "server/scripts/run-scan.ts"                 7 0
write_agent "com.goldenegg.closes" "server/scripts/backfill-closes.ts"         22 30

cat <<EOF

Done. Two agents installed.

  com.goldenegg.scan    weekdays 07:00  — SPENDS CREDITS (capped by SCAN_MAX_CREDITS)
  com.goldenegg.closes  weekdays 22:30  — free (quote data only)

Because these are launchd calendar jobs, a scheduled run that falls while the
Mac is asleep fires when it wakes, rather than being lost.

  logs:     tail -f $LOGS/com.goldenegg.scan.log
  status:   launchctl list | grep goldenegg
  run now:  launchctl kickstart -k gui/$UID/com.goldenegg.scan
  remove:   ./ops/uninstall-agents.sh

Set SCAN_SCHEDULE= and CLOSES_SCHEDULE= (empty) in .env so a running dev server
doesn't ALSO schedule these — the concurrency guard would reject the duplicate
anyway, but one scheduler is easier to reason about.
EOF
