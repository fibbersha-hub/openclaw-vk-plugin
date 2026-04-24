#!/usr/bin/env bash
# Module: Interactive API key configuration wizard
# Args: $1=need_llm_proxy $2=need_sage $3=need_image_gen
set -euo pipefail

NEED_LLM_PROXY=${1:-0}
NEED_SAGE=${2:-0}
NEED_IMAGE_GEN=${3:-0}

OPENCLAW_DIR="${OPENCLAW_DIR:-/opt/openclaw-vk-plugin}"
ENV_FILE="$OPENCLAW_DIR/.env"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[•]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
ask()     { echo -e "${YELLOW}[?]${NC} $*"; }
link()    { echo -e "    ${CYAN}→${NC} $*"; }

# Ensure .env dir exists
mkdir -p "$OPENCLAW_DIR"

# Start with example if .env doesn't exist
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.env.example" "$ENV_FILE"
fi

write_env() {
  local key=$1 value=$2
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

validate_not_empty() {
  local value=$1 name=$2
  if [[ -z "$value" || "$value" == *"your_"* || "$value" == *"_here"* ]]; then
    echo -e "  ${YELLOW}!${NC} Skipped (empty or placeholder). You can set $name in $ENV_FILE later."
    return 1
  fi
  return 0
}

# ── VK Bot (always required) ────────────────────────────────
echo ""
echo -e "${BOLD}VK Community Token (required)${NC}"
echo "  This token lets the bot read and send messages in your community."
echo "  How to get it:"
link "1. Open your VK community → Manage → API usage"
link "2. Create or copy a community token"
link "3. Enable permissions: Messages, Photos"
link "Full guide: docs/VK_TOKENS_GUIDE_RU.md"
echo ""
ask "Paste your VK community token:"
read -rp "  Token: " vk_token
if validate_not_empty "$vk_token" "VK_COMMUNITY_TOKEN"; then
  write_env "VK_COMMUNITY_TOKEN" "$vk_token"
  success "VK token saved"
fi

echo ""
ask "Paste your VK community ID (number without minus):"
read -rp "  Community ID: " vk_id
if validate_not_empty "$vk_id" "VK_COMMUNITY_ID"; then
  write_env "VK_COMMUNITY_ID" "$vk_id"
  success "VK community ID saved"
fi

# ── LLM Proxy ────────────────────────────────────────────────
if [[ "$NEED_LLM_PROXY" == "1" ]]; then
  echo ""
  echo -e "${BOLD}Groq API Keys${NC}"
  echo "  Free tier: 1 request / 62 seconds per key."
  echo "  With 4 keys you get ~1 request / 15 seconds."
  link "Get free keys at: https://console.groq.com"
  link "   → Sign in → API Keys → Create API Key"
  echo ""
  for i in 1 2 3 4; do
    ask "Groq key #$i (press Enter to skip):"
    read -rp "  Key: " gkey
    if [[ -n "$gkey" && "$gkey" != "gsk_your"* ]]; then
      write_env "GROQ_KEY_${i}" "$gkey"
      success "Groq key #$i saved"
    else
      [[ $i -eq 1 ]] && echo "  (Skipped — you can add keys later in $ENV_FILE)"
      break
    fi
  done

  echo ""
  echo -e "${BOLD}OpenRouter API Keys (optional, adds free models)${NC}"
  link "Get free keys at: https://openrouter.ai/keys"
  link "   → Sign in → Keys → Create Key (free models available)"
  echo ""
  for i in 1 2 3; do
    ask "OpenRouter key #$i (press Enter to skip):"
    read -rp "  Key: " orkey
    if [[ -n "$orkey" && "$orkey" != "sk-or-v1-your"* ]]; then
      write_env "OPENROUTER_KEY_${i}" "$orkey"
      success "OpenRouter key #$i saved"
    else
      break
    fi
  done

  echo ""
  ask "SOCKS5 proxy? (leave empty if not needed — only for geo-restricted regions)"
  read -rp "  socks5h://user:pass@host:port or Enter to skip: " socks
  if [[ -n "$socks" ]]; then
    write_env "SOCKS_PROXY" "$socks"
    success "SOCKS5 proxy saved"
  fi
fi

# ── Cerebras (Sage) ──────────────────────────────────────────
if [[ "$NEED_SAGE" == "1" ]]; then
  echo ""
  echo -e "${BOLD}Cerebras API Key (for Великий Мудрец synthesis)${NC}"
  echo "  Used to synthesize responses from multiple LLMs into one answer."
  echo "  Free tier with generous limits and very fast inference."
  link "Get free key at: https://cloud.cerebras.ai"
  link "   → Sign Up → API Keys → Create Key"
  echo ""
  ask "Paste your Cerebras API key:"
  read -rp "  Key: " ckey
  if validate_not_empty "$ckey" "CEREBRAS_KEY"; then
    write_env "CEREBRAS_KEY" "$ckey"
    success "Cerebras key saved"
  fi
fi

# ── ModelsLab (Image Gen) ────────────────────────────────────
if [[ "$NEED_IMAGE_GEN" == "1" ]]; then
  echo ""
  echo -e "${BOLD}ModelsLab API Key (image generation)${NC}"
  echo "  Free tier: 100 images/day. Supports Flux, SDXL, and more."
  link "Get free key at: https://modelslab.com"
  link "   → Sign Up → Dashboard → API Key"
  echo ""
  ask "Paste your ModelsLab API key:"
  read -rp "  Key: " mlkey
  if validate_not_empty "$mlkey" "MODELSLAB_KEY"; then
    write_env "MODELSLAB_KEY" "$mlkey"
    success "ModelsLab key saved"
  fi
fi

echo ""
success "API keys configuration complete"
info "Config saved to: $ENV_FILE"
echo ""
