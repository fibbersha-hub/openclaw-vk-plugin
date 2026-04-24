#!/usr/bin/env bash
# Module 3: Browser LLM Bridge (Puppeteer + persistent Chromium sessions)
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-/opt/browser-bridge}"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

info "Installing Browser LLM Bridge to $BRIDGE_DIR..."
mkdir -p "$BRIDGE_DIR"

cp "$ROOT_DIR/browser-bridge/browser-llm-bridge.js"     "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/human-emulator.js"          "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/multi-llm-analyst.js"       "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/diagnostic-tracker.js"      "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/session-watchdog.sh"        "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/setup-persistent-sessions.sh" "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/start-browser-stack.sh"     "$BRIDGE_DIR/"
chmod +x "$BRIDGE_DIR"/*.sh

# package.json
cat > "$BRIDGE_DIR/package.json" << 'EOF'
{
  "name": "browser-llm-bridge",
  "dependencies": {
    "puppeteer-core": "^21.0.0",
    "express": "^4.18.2"
  }
}
EOF

info "Installing Chromium (headless browser)..."
if ! command -v chromium-browser &>/dev/null && ! command -v google-chrome &>/dev/null; then
  apt-get install -y chromium-browser --no-install-recommends -qq
  ok "Chromium installed: $(chromium-browser --version 2>/dev/null || echo 'ok')"
else
  ok "Chromium already installed"
fi

info "Installing Node.js dependencies..."
cd "$BRIDGE_DIR" && npm install --silent
ok "Dependencies installed"

# systemd service for the bridge server
cat > /etc/systemd/system/openclaw-bridge.service << EOF
[Unit]
Description=OpenClaw Browser LLM Bridge
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$BRIDGE_DIR
EnvironmentFile=${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}/.env
ExecStart=/usr/bin/node $BRIDGE_DIR/browser-llm-bridge.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw-bridge

echo ""
warn "IMPORTANT: Before starting the bridge, you need to log in to LLM websites."
warn "Run the setup script to open browser sessions:"
echo "    bash $BRIDGE_DIR/setup-persistent-sessions.sh"
echo ""
warn "Then start the service:"
echo "    systemctl start openclaw-bridge"
echo ""
info "Supported LLMs: ChatGPT, Claude, DeepSeek, Perplexity, Mistral, Qwen"
ok "Bridge installed (not started — login required first)"
