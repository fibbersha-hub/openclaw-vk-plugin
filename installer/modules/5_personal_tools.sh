#!/usr/bin/env bash
# Module 5: Personal Tools (notes, reminders, todos, daily digest)
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"
DATA_DIR="/opt/openclaw-notes"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

info "Installing Personal Tools..."

mkdir -p "$OPENCLAW_DIR/scripts" "$DATA_DIR"
cp "$ROOT_DIR/scripts/notes.py"          "$OPENCLAW_DIR/scripts/"
cp "$ROOT_DIR/scripts/reminders.py"      "$OPENCLAW_DIR/scripts/"
cp "$ROOT_DIR/scripts/todos.py"          "$OPENCLAW_DIR/scripts/"
cp "$ROOT_DIR/scripts/daily_digest.py"   "$OPENCLAW_DIR/scripts/"
cp "$ROOT_DIR/scripts/vk_parser.py"      "$OPENCLAW_DIR/scripts/"
cp "$ROOT_DIR/scripts/vk_competitors.py" "$OPENCLAW_DIR/scripts/"

# Reminders cron: check every minute
(crontab -l 2>/dev/null; echo "* * * * * OPENCLAW_DIR=$OPENCLAW_DIR python3 $OPENCLAW_DIR/scripts/reminders.py check >> /var/log/openclaw-reminders.log 2>&1") \
  | sort -u | crontab -

ok "Personal tools installed"
ok "Reminders cron configured (checks every minute)"
info "Data stored in: $DATA_DIR"
