#!/usr/bin/env bash
# Module 1: VK Bot Core
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

info "Installing VK Bot Core to $OPENCLAW_DIR..."

# Copy files
mkdir -p "$OPENCLAW_DIR/src" "$OPENCLAW_DIR/personas" "$OPENCLAW_DIR/scripts"
cp -r "$ROOT_DIR/src"/*       "$OPENCLAW_DIR/src/"
cp -r "$ROOT_DIR/personas"/*  "$OPENCLAW_DIR/personas/"
cp    "$ROOT_DIR/index.ts"    "$OPENCLAW_DIR/"
cp    "$ROOT_DIR/setup-entry.ts" "$OPENCLAW_DIR/"
cp    "$ROOT_DIR/tsconfig.json"  "$OPENCLAW_DIR/"
cp    "$ROOT_DIR/package.json"   "$OPENCLAW_DIR/"
cp    "$ROOT_DIR/openclaw.plugin.json" "$OPENCLAW_DIR/"

# Load .env
set -a; source "$OPENCLAW_DIR/.env"; set +a

info "Installing Node.js dependencies..."
cd "$OPENCLAW_DIR" && npm install --production --silent
ok "Dependencies installed"

info "Building TypeScript..."
cd "$OPENCLAW_DIR" && npx tsc --noEmit false
ok "Build complete"

# systemd service
cat > /etc/systemd/system/openclaw.service << EOF
[Unit]
Description=OpenClaw VK Plugin
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$OPENCLAW_DIR
EnvironmentFile=$OPENCLAW_DIR/.env
ExecStart=/usr/bin/node $OPENCLAW_DIR/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw
systemctl start openclaw

ok "openclaw.service started"
