#!/bin/bash
# === Session Watchdog v1.0 ===
# Monitors browser session files.
# ANY read/copy attempt by a non-Chromium process → instant wipe.
#
# Protected files: Cookies, Login Data, Network/Cookies
# Allowed processes: chromium-browser, chromium, node (bridge reads nothing sensitive)
# Triggers wipe on: cp, scp, rsync, tar, cat, python, curl, dd, sqlite3, strings, xxd

set -euo pipefail

PROFILE_DIR="/opt/chrome-sessions/Default"
WIPE_LOG="/var/log/session-watchdog.log"
INCIDENT_LOG="/var/log/session-wipe-incidents.log"

# Sensitive files to monitor
SENSITIVE_FILES=(
  "Cookies"
  "Login Data"
  "Login Data-journal"
  "Web Data"
  "Network/Cookies"
  "Sessions"
  "Session Storage"
  "Local Storage"
  "IndexedDB"
)

# Processes allowed to read session files (Chromium itself)
ALLOWED_PROCESSES=(
  "chromium"
  "chromium-browser"
  "chrome"
)

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$WIPE_LOG"
}

incident() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INCIDENT: $*" | tee -a "$INCIDENT_LOG" "$WIPE_LOG"
}

wipe_sessions() {
  local reason="$1"
  incident "WIPE TRIGGERED — reason: $reason"

  # 1. Kill Chromium immediately
  ps aux | grep -E 'chromium|chrome' | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
  incident "Chromium killed"

  # 2. Wipe all sensitive session data
  if [ -d "$PROFILE_DIR" ]; then
    # Overwrite with zeros before delete (prevent forensic recovery)
    for f in \
      "$PROFILE_DIR/Cookies" \
      "$PROFILE_DIR/Cookies-journal" \
      "$PROFILE_DIR/Login Data" \
      "$PROFILE_DIR/Login Data-journal" \
      "$PROFILE_DIR/Web Data" \
      "$PROFILE_DIR/Web Data-journal" \
      "$PROFILE_DIR/History" \
      "$PROFILE_DIR/Visited Links"; do
      if [ -f "$f" ]; then
        size=$(stat -c%s "$f" 2>/dev/null || echo 0)
        dd if=/dev/urandom of="$f" bs=1 count="$size" 2>/dev/null || true
        rm -f "$f"
        incident "Wiped: $f"
      fi
    done

    # Wipe Network cookies
    rm -rf "$PROFILE_DIR/Network" 2>/dev/null || true
    rm -rf "$PROFILE_DIR/Session Storage" 2>/dev/null || true
    rm -rf "$PROFILE_DIR/Local Storage" 2>/dev/null || true
    rm -rf "$PROFILE_DIR/IndexedDB" 2>/dev/null || true
    rm -rf "$PROFILE_DIR/Sessions" 2>/dev/null || true

    incident "All session data wiped"
  fi

  # 3. Also wipe /tmp sessions if exists
  if [ -d "/tmp/chrome-sessions/Default" ]; then
    rm -rf "/tmp/chrome-sessions/Default/Cookies"* 2>/dev/null || true
    rm -rf "/tmp/chrome-sessions/Default/Login Data"* 2>/dev/null || true
    incident "Also wiped /tmp/chrome-sessions"
  fi

  incident "WIPE COMPLETE"
}

is_allowed_process() {
  local pid="$1"
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then return 0; fi
  local comm
  comm=$(cat "/proc/$pid/comm" 2>/dev/null || echo "unknown")
  for allowed in "${ALLOWED_PROCESSES[@]}"; do
    if [[ "$comm" == *"$allowed"* ]]; then
      return 0
    fi
  done
  # Also check full cmdline
  local cmdline
  cmdline=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ' | head -c 200)
  for allowed in "${ALLOWED_PROCESSES[@]}"; do
    if [[ "$cmdline" == *"$allowed"* ]]; then
      return 0
    fi
  done
  return 1
}

log "Session Watchdog started. Monitoring: $PROFILE_DIR"
log "Allowed processes: ${ALLOWED_PROCESSES[*]}"

# Ensure profile dir exists
mkdir -p "$PROFILE_DIR"
chmod 700 /opt/chrome-sessions

# Monitor for open/read/access events on sensitive files
# Note: %p (PID) not supported in older inotifywait — use fuser to find accessing process
inotifywait \
  --monitor \
  --recursive \
  --event open,access,moved_from \
  --format '%T %w %f %e' \
  --timefmt '%Y-%m-%dT%H:%M:%SZ' \
  "$PROFILE_DIR" 2>/dev/null | \
while IFS=' ' read -r ts dir file event; do
  # Skip empty
  [ -z "$file" ] && continue

  # Only care about sensitive files
  sensitive=0
  for sf in "${SENSITIVE_FILES[@]}"; do
    if [[ "$file" == *"$sf"* ]] || [[ "$file" == "Cookies"* ]] || [[ "$file" == "Login"* ]]; then
      sensitive=1
      break
    fi
  done
  [ "$sensitive" = "0" ] && continue

  fullpath="${dir}${file}"

  # Get accessing PID via fuser
  accessing_pid=$(fuser "$fullpath" 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -1)

  log "ACCESS: $event on $file by PID=${accessing_pid:-unknown}"

  # If we can't determine PID or it's not chromium — wipe
  if [ -z "$accessing_pid" ]; then
    # Can't verify — log but don't wipe (avoid false positives on file close)
    continue
  fi

  if ! is_allowed_process "$accessing_pid"; then
    accessing_cmd=$(cat "/proc/$accessing_pid/cmdline" 2>/dev/null | tr '\0' ' ' | head -c 100)
    wipe_sessions "Unauthorized access to $file by PID=$accessing_pid ($accessing_cmd)"
  fi
done
