#!/bin/bash
# === Setup Persistent Sessions ===
# Moves chrome profile to /opt/chrome-sessions (survives reboots)
# and installs session-watchdog as systemd service

set -e

PERSISTENT_DIR="/opt/chrome-sessions"
TMP_DIR="/tmp/chrome-sessions"
BRIDGE_DIR="/opt/browser-bridge"

echo "[setup] Setting up persistent session storage..."

# 1. Create persistent profile dir with strict permissions
mkdir -p "$PERSISTENT_DIR"
chmod 700 "$PERSISTENT_DIR"

# 2. Copy existing sessions from /tmp if they exist
if [ -d "$TMP_DIR" ] && [ "$(ls -A $TMP_DIR 2>/dev/null)" ]; then
  echo "[setup] Copying existing sessions from /tmp to $PERSISTENT_DIR..."
  cp -a "$TMP_DIR/." "$PERSISTENT_DIR/" 2>/dev/null || true
  echo "[setup] Sessions copied"
fi

# 3. Install watchdog script
cp "$BRIDGE_DIR/session-watchdog.sh" /usr/local/bin/session-watchdog
chmod 700 /usr/local/bin/session-watchdog

# 4. Create systemd service for watchdog
cat > /etc/systemd/system/session-watchdog.service << 'EOF'
[Unit]
Description=Browser Session Security Watchdog
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
ExecStart=/usr/local/bin/session-watchdog
Restart=always
RestartSec=3
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 5. Create systemd service for browser stack
cat > /etc/systemd/system/browser-bridge.service << 'EOF'
[Unit]
Description=Browser LLM Bridge (Xvfb + Chromium + Node Bridge)
After=network.target session-watchdog.service
Requires=session-watchdog.service

[Service]
Type=forking
ExecStartPre=/bin/bash -c 'mkdir -p /opt/chrome-sessions && chmod 700 /opt/chrome-sessions'
ExecStart=/opt/browser-bridge/start-persistent.sh start
ExecStop=/opt/browser-bridge/start-persistent.sh stop
Restart=on-failure
RestartSec=10
User=root
Environment=DISPLAY=:99

[Install]
WantedBy=multi-user.target
EOF

# 6. Create persistent startup script (uses /opt/chrome-sessions)
cat > /opt/browser-bridge/start-persistent.sh << 'SCRIPT'
#!/bin/bash
DISPLAY_NUM=99
CHROME_PORT=9222
BRIDGE_PORT=7788
PROFILE_DIR="/opt/chrome-sessions"
PID_DIR="/var/run/browser-bridge"

mkdir -p "$PID_DIR"

case "${1:-start}" in
  start)
    # Xvfb
    if ! pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null; then
      Xvfb :${DISPLAY_NUM} -screen 0 1280x800x24 -ac &
      echo $! > "$PID_DIR/xvfb.pid"
      sleep 1
    fi

    # Chromium
    if ! curl -s http://localhost:${CHROME_PORT}/json/version > /dev/null 2>&1; then
      DISPLAY=:${DISPLAY_NUM} chromium-browser \
        --no-sandbox \
        --disable-dev-shm-usage \
        --remote-debugging-port=${CHROME_PORT} \
        --remote-debugging-address=127.0.0.1 \
        --user-data-dir="${PROFILE_DIR}" \
        --no-first-run \
        --no-default-browser-check \
        --disable-background-timer-throttling \
        --disable-backgrounding-occluded-windows \
        --window-size=1280,800 \
        &>/var/log/chromium-bridge.log &
      echo $! > "$PID_DIR/chromium.pid"
      sleep 5
    fi

    # VNC (for manual login sessions)
    if ! pgrep x11vnc > /dev/null; then
      DISPLAY=:${DISPLAY_NUM} x11vnc -nopw -rfbport 5900 -forever -shared -bg \
        -o /var/log/x11vnc.log
    fi

    # Bridge
    if ! curl -s http://localhost:${BRIDGE_PORT}/health > /dev/null 2>&1; then
      node /opt/browser-bridge/browser-llm-bridge.js \
        &>/var/log/browser-llm-bridge.log &
      echo $! > "$PID_DIR/bridge.pid"
      sleep 2
    fi
    echo "Browser stack started"
    ;;

  stop)
    for svc in bridge chromium xvfb; do
      [ -f "$PID_DIR/$svc.pid" ] && kill "$(cat $PID_DIR/$svc.pid)" 2>/dev/null || true
      rm -f "$PID_DIR/$svc.pid"
    done
    ;;

  status)
    echo -n "Xvfb:     "; pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null && echo "RUNNING" || echo "STOPPED"
    echo -n "Chromium: "; curl -s http://localhost:${CHROME_PORT}/json/version > /dev/null 2>&1 && echo "RUNNING" || echo "STOPPED"
    echo -n "VNC:      "; pgrep x11vnc > /dev/null && echo "RUNNING (port 5900)" || echo "STOPPED"
    echo -n "Bridge:   "; curl -s http://localhost:${BRIDGE_PORT}/health > /dev/null 2>&1 && echo "RUNNING" || echo "STOPPED"
    echo -n "Watchdog: "; systemctl is-active session-watchdog 2>/dev/null || echo "STOPPED"
    ;;
esac
SCRIPT
chmod +x /opt/browser-bridge/start-persistent.sh

# 7. Enable and start services
systemctl daemon-reload
systemctl enable session-watchdog
systemctl start session-watchdog
systemctl enable browser-bridge

echo ""
echo "=== Setup Complete ==="
echo "Session profile: $PERSISTENT_DIR (root-only, 700)"
echo "Watchdog:        systemctl status session-watchdog"
echo "Browser stack:   systemctl status browser-bridge"
echo "Wipe incidents:  /var/log/session-wipe-incidents.log"
echo ""
echo "Security: any unauthorized access to session files → instant wipe + kill Chrome"
