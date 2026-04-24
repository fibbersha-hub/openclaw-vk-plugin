#!/usr/bin/env bash
# ============================================================
# OpenClaw VK Plugin — Interactive Installer
# Supports Ubuntu 20.04+ / Debian 11+
# ============================================================
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"
BRIDGE_DIR="${BRIDGE_DIR:-/opt/browser-bridge}"
SAGE_DIR="${SAGE_DIR:-/opt/openclaw-sage}"
ENV_FILE="$OPENCLAW_DIR/.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[•]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
header()  { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}\n"; }
ask()     { echo -e "${YELLOW}[?]${NC} $*"; }

# ── Banner ──────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
cat << 'EOF'
   ___                  ____ _
  / _ \ _ __   ___ _ _ / ___| | __ ___      __
 | | | | '_ \ / _ \ '_ \ |   | |/ _` \ \ /\ / /
 | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /
  \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/
       |_|         VK Plugin Installer
EOF
echo -e "${NC}"
echo "  Modular AI assistant for VK communities"
echo "  https://github.com/your-username/openclaw-vk-plugin"
echo ""

# ── Check root ──────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Run as root: sudo bash installer/install.sh"
fi

# ── Step 0: Check dependencies ──────────────────────────────
header "Step 0: Checking system dependencies"
bash "$SCRIPT_DIR/modules/0_check_deps.sh"

# ── Module selection ────────────────────────────────────────
header "What do you want to install?"
echo "  The system consists of independent modules."
echo "  You can install only what you need."
echo ""

declare -A INSTALL_MODULES

# Module 1 — Core (always)
echo -e "  ${GREEN}[1] VK Bot Core${NC} (required)"
echo "      The main bot: receives messages, processes button presses,"
echo "      routes commands to scripts. Needs: VK community token."
echo ""
INSTALL_MODULES[core]=1

# Module 2 — LLM Proxy
ask "[2] Install LLM Proxy (Groq + OpenRouter key rotator)? [y/N]"
echo "      Routes AI requests through a pool of free API keys."
echo "      Needs: 1+ Groq key or 1+ OpenRouter key."
read -rp "      Your choice: " yn
[[ "$yn" =~ ^[Yy] ]] && INSTALL_MODULES[llm_proxy]=1 || INSTALL_MODULES[llm_proxy]=0
echo ""

# Module 3 — Browser LLM Bridge
ask "[3] Install Browser LLM Bridge (free LLMs via Puppeteer)? [y/N]"
echo "      Connects to 6 LLMs (ChatGPT, Claude, DeepSeek, etc.) in a real browser."
echo "      No API keys needed — uses your logged-in browser sessions."
echo "      Needs: Chromium, ~2GB RAM per session."
read -rp "      Your choice: " yn
[[ "$yn" =~ ^[Yy] ]] && INSTALL_MODULES[browser_bridge]=1 || INSTALL_MODULES[browser_bridge]=0
echo ""

# Module 4 — Великий Мудрец (needs bridge + cerebras)
if [[ "${INSTALL_MODULES[browser_bridge]}" == "1" ]]; then
  ask "[4] Install Великий Мудрец (multi-LLM consensus bot)? [y/N]"
  echo "      Queries all browser LLMs in parallel, synthesizes with Cerebras."
  echo "      Adds 🧙 button to the bot menu. Needs: Cerebras API key (free)."
  read -rp "      Your choice: " yn
  [[ "$yn" =~ ^[Yy] ]] && INSTALL_MODULES[sage]=1 || INSTALL_MODULES[sage]=0
  echo ""
else
  INSTALL_MODULES[sage]=0
fi

# Module 5 — Personal tools
ask "[5] Install Personal Tools (notes, reminders, todos, daily digest)? [y/N]"
echo "      SQLite-based personal assistant features in the bot."
echo "      No extra API keys needed."
read -rp "      Your choice: " yn
[[ "$yn" =~ ^[Yy] ]] && INSTALL_MODULES[personal_tools]=1 || INSTALL_MODULES[personal_tools]=0
echo ""

# Module 6 — Image generation
ask "[6] Install Image Generation (ModelsLab, 100 free images/day)? [y/N]"
echo "      Generates images by text prompt. Needs: ModelsLab API key (free)."
read -rp "      Your choice: " yn
[[ "$yn" =~ ^[Yy] ]] && INSTALL_MODULES[image_gen]=1 || INSTALL_MODULES[image_gen]=0
echo ""

# ── Summary ─────────────────────────────────────────────────
header "Installation plan"
echo "  Will install:"
echo -e "  ${GREEN}✓${NC} VK Bot Core"
[[ "${INSTALL_MODULES[llm_proxy]}"     == "1" ]] && echo -e "  ${GREEN}✓${NC} LLM Proxy (Groq + OpenRouter)"
[[ "${INSTALL_MODULES[browser_bridge]}"== "1" ]] && echo -e "  ${GREEN}✓${NC} Browser LLM Bridge (Puppeteer)"
[[ "${INSTALL_MODULES[sage]}"          == "1" ]] && echo -e "  ${GREEN}✓${NC} Великий Мудрец"
[[ "${INSTALL_MODULES[personal_tools]}"== "1" ]] && echo -e "  ${GREEN}✓${NC} Personal Tools"
[[ "${INSTALL_MODULES[image_gen]}"     == "1" ]] && echo -e "  ${GREEN}✓${NC} Image Generation"
echo ""
ask "Proceed? [Y/n]"
read -rp "  " yn
[[ "$yn" =~ ^[Nn] ]] && { info "Installation cancelled."; exit 0; }

# ── Collect API keys ─────────────────────────────────────────
header "Configuring API keys"
bash "$SCRIPT_DIR/modules/configure_keys.sh" \
  "${INSTALL_MODULES[llm_proxy]}" \
  "${INSTALL_MODULES[sage]}" \
  "${INSTALL_MODULES[image_gen]}"

# ── Install modules ──────────────────────────────────────────
header "Installing modules"

bash "$SCRIPT_DIR/modules/1_vk_bot.sh"

[[ "${INSTALL_MODULES[llm_proxy]}"     == "1" ]] && bash "$SCRIPT_DIR/modules/2_llm_proxy.sh"
[[ "${INSTALL_MODULES[browser_bridge]}"== "1" ]] && bash "$SCRIPT_DIR/modules/3_browser_bridge.sh"
[[ "${INSTALL_MODULES[sage]}"          == "1" ]] && bash "$SCRIPT_DIR/modules/4_sage.sh"
[[ "${INSTALL_MODULES[personal_tools]}"== "1" ]] && bash "$SCRIPT_DIR/modules/5_personal_tools.sh"
[[ "${INSTALL_MODULES[image_gen]}"     == "1" ]] && bash "$SCRIPT_DIR/modules/6_image_gen.sh"

# ── Done ─────────────────────────────────────────────────────
header "Installation complete!"
echo -e "  ${GREEN}OpenClaw VK Plugin is installed and running.${NC}"
echo ""
echo "  Config: $ENV_FILE"
echo "  Logs:   journalctl -u openclaw -f"
echo "  Status: systemctl status openclaw"
echo ""
echo "  Next steps:"
echo "  1. Open your VK community and send any message to the bot"
echo "  2. You should see the main menu with buttons"
echo "  3. Check docs/ for full usage guide"
echo ""
