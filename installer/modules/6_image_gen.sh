#!/usr/bin/env bash
# Module 6: Image Generation (ModelsLab)
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
info() { echo -e "  ${CYAN}•${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

info "Installing Image Generation skill..."

mkdir -p "$OPENCLAW_DIR/skills/image-gen"
mkdir -p "/opt/openclaw-imagegen/output"

cp "$ROOT_DIR/skills/image-gen/imagegen.py"  "$OPENCLAW_DIR/skills/image-gen/"
cp "$ROOT_DIR/skills/image-gen/SKILL.md"     "$OPENCLAW_DIR/skills/image-gen/"

ok "Image generation installed"
info "Free tier: 100 images/day (ModelsLab)"
info "Models: flux, sdxl, dreamshaper, realistic-vision, anime"
info "Output stored in: /opt/openclaw-imagegen/output"
