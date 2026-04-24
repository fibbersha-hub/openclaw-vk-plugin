#!/usr/bin/env bash
# Module 4: Великий Мудрец (multi-LLM consensus + reports)
set -euo pipefail

BRIDGE_DIR="${BRIDGE_DIR:-/opt/browser-bridge}"
SAGE_DIR="${SAGE_DIR:-/opt/openclaw-sage}"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

info "Installing Великий Мудрец..."
mkdir -p "$SAGE_DIR/reports"

cp "$ROOT_DIR/browser-bridge/sage.py"            "$BRIDGE_DIR/"
cp "$ROOT_DIR/browser-bridge/report-generator.js" "$BRIDGE_DIR/"

info "Installing report generation dependencies..."
# chartjs-node-canvas for bar charts
cd "$BRIDGE_DIR" && npm install --save chartjs-node-canvas chart.js handlebars showdown --silent
# mermaid-cli for pie diagrams (global)
npm install -g @mermaid-js/mermaid-cli --silent 2>/dev/null || true
# md-to-pdf for PDF export (global)
npm install -g md-to-pdf --silent 2>/dev/null || true

ok "Report generators installed"
ok "Великий Мудрец ready"
info "Sessions stored in: $SAGE_DIR"
info "Reports stored in:  $SAGE_DIR/reports"
