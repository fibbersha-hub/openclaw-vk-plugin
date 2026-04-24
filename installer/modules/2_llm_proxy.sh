#!/usr/bin/env bash
# Module 2: LLM Key Rotator Proxy (Groq + OpenRouter)
set -euo pipefail

PROXY_DIR="/opt/groq-proxy"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"

info "Installing LLM Proxy to $PROXY_DIR..."
mkdir -p "$PROXY_DIR"
cp "$ROOT_DIR/groq-proxy/server.mjs"        "$PROXY_DIR/"
cp "$ROOT_DIR/groq-proxy/model_checker.py"  "$PROXY_DIR/"

# package.json for socks-proxy-agent
cat > "$PROXY_DIR/package.json" << 'EOF'
{
  "name": "llm-rotator-proxy",
  "type": "module",
  "dependencies": {
    "socks-proxy-agent": "^8.0.2"
  }
}
EOF

info "Installing proxy dependencies..."
cd "$PROXY_DIR" && npm install --silent
ok "Dependencies installed"

# systemd service
cat > /etc/systemd/system/groq-proxy.service << EOF
[Unit]
Description=OpenClaw LLM Key Rotator Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROXY_DIR
EnvironmentFile=$OPENCLAW_DIR/.env
ExecStart=/usr/bin/node $PROXY_DIR/server.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable groq-proxy
systemctl start groq-proxy

ok "groq-proxy.service started"
info "Health check: curl http://127.0.0.1:8787/health"
