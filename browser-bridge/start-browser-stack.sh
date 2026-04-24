#!/bin/bash
# Start browser stack: Xvfb → Chromium → LLM Bridge
# Run as: bash start-browser-stack.sh [start|stop|status]

set -e

DISPLAY_NUM=99
CHROME_PORT=9222
BRIDGE_PORT=7788
CHROME_DATA="/root/.chrome-sessions"
BRIDGE_SCRIPT="/opt/browser-bridge/browser-llm-bridge.js"
PID_DIR="/var/run/browser-bridge"

mkdir -p "$PID_DIR" "$CHROME_DATA"

case "${1:-start}" in
  start)
    echo "[stack] Starting browser stack..."

    # 1. Xvfb
    if ! pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null; then
      Xvfb :${DISPLAY_NUM} -screen 0 1280x800x24 -ac &
      echo $! > "$PID_DIR/xvfb.pid"
      sleep 1
      echo "[stack] Xvfb started on :${DISPLAY_NUM}"
    else
      echo "[stack] Xvfb already running"
    fi

    # 2. Chromium
    if ! curl -s http://localhost:${CHROME_PORT}/json/version > /dev/null 2>&1; then
      DISPLAY=:${DISPLAY_NUM} chromium-browser \
        --no-sandbox \
        --disable-dev-shm-usage \
        --remote-debugging-port=${CHROME_PORT} \
        --remote-debugging-address=127.0.0.1 \
        --user-data-dir="${CHROME_DATA}" \
        --no-first-run \
        --no-default-browser-check \
        --disable-background-timer-throttling \
        --disable-backgrounding-occluded-windows \
        --disable-renderer-backgrounding \
        --window-size=1280,800 \
        &>/var/log/chromium-bridge.log &
      echo $! > "$PID_DIR/chromium.pid"
      sleep 4
      echo "[stack] Chromium started (CDP on port ${CHROME_PORT})"
    else
      echo "[stack] Chromium already running"
    fi

    # 3. Bridge
    if ! curl -s http://localhost:${BRIDGE_PORT}/health > /dev/null 2>&1; then
      node "$BRIDGE_SCRIPT" &>/var/log/browser-llm-bridge.log &
      echo $! > "$PID_DIR/bridge.pid"
      sleep 2
      echo "[stack] Bridge started on port ${BRIDGE_PORT}"
    else
      echo "[stack] Bridge already running"
    fi

    echo "[stack] All services started"
    ;;

  stop)
    echo "[stack] Stopping browser stack..."
    for svc in bridge chromium xvfb; do
      if [ -f "$PID_DIR/$svc.pid" ]; then
        kill "$(cat $PID_DIR/$svc.pid)" 2>/dev/null || true
        rm -f "$PID_DIR/$svc.pid"
        echo "[stack] Stopped $svc"
      fi
    done
    ;;

  status)
    echo "=== Browser Stack Status ==="
    echo -n "Xvfb:     "; pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null && echo "RUNNING" || echo "STOPPED"
    echo -n "Chromium: "; curl -s http://localhost:${CHROME_PORT}/json/version > /dev/null 2>&1 && echo "RUNNING (CDP OK)" || echo "STOPPED"
    echo -n "Bridge:   "; curl -s http://localhost:${BRIDGE_PORT}/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('RUNNING — LLMs:', ','.join(d['llms'][:4]),'...')" 2>/dev/null || echo "STOPPED"
    ;;

  *)
    echo "Usage: $0 [start|stop|status]"
    exit 1
    ;;
esac
