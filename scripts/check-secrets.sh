#!/usr/bin/env bash
# ============================================================
# check-secrets.sh — обязательная проверка перед git push
# Запускается автоматически как pre-push хук.
# Также можно запустить вручную: bash scripts/check-secrets.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo ""
echo "🔍 Проверка секретов перед публикацией на GitHub..."
echo ""

# ── Паттерны которые ЗАПРЕЩЕНЫ (блокируют push) ──────────────
declare -A BANNED
BANNED["VK community token"]="vk1\.a\.[A-Za-z0-9_\-]{40,}"
BANNED["OpenAI / sk- key"]="sk-[A-Za-z0-9]{20,}"
BANNED["OpenRouter key"]="sk-or-v1-[a-f0-9]{60,}"
BANNED["Groq key"]="gsk_[A-Za-z0-9]{40,}"
BANNED["Cerebras key"]="csk-[A-Za-z0-9]{40,}"
BANNED["Anthropic key"]="sk-ant-[A-Za-z0-9\-]{40,}"
BANNED["Mistral key"]="[a-zA-Z0-9]{32}  # check context"
BANNED["Tavily key"]="tvly-[a-zA-Z0-9\-]{20,}"
BANNED["Firecrawl key"]="fc-[a-f0-9]{30,}"
BANNED["ElevenLabs key"]="sk_[a-f0-9]{40,}"
BANNED["Generic password field"]="password\s*=\s*['\"][^'\"]{6,}['\"]"
BANNED["Generic secret= field"]="secret\s*=\s*['\"][^'\"]{6,}['\"]"
BANNED["Server IP (83.x)"]="83\.[0-9]+\.[0-9]+\.[0-9]+"
BANNED["SSH private key"]="BEGIN.*PRIVATE KEY"

# ── Паттерны-предупреждения (не блокируют, но показывают) ────
declare -A WARNINGS_MAP
WARNINGS_MAP["VK user ID (digits 9+)"]="[^a-z][0-9]{8,9}[^0-9]"
WARNINGS_MAP["Partial token fragment"]="[a-f0-9]{32,}"
WARNINGS_MAP["localhost URL with port"]="127\.0\.0\.1:[0-9]{4,5}"
WARNINGS_MAP["Internal path /root/"]="\/root\/"
WARNINGS_MAP["Internal path /opt/"]="\/opt\/"

# Получаем список файлов для проверки
# В режиме хука — файлы из staged, в ручном режиме — все git-tracked
if [ "${1:-manual}" = "hook" ]; then
    FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || git diff HEAD~1 --name-only 2>/dev/null)
else
    FILES=$(git ls-files)
fi

if [ -z "$FILES" ]; then
    echo "  Нет файлов для проверки."
    exit 0
fi

# ── Проверка запрещённых паттернов ───────────────────────────
echo "❌ Проверяю запрещённые секреты..."
for label in "${!BANNED[@]}"; do
    pattern="${BANNED[$label]}"
    matches=$(echo "$FILES" | xargs grep -lEI "$pattern" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo -e "  ${RED}СТОП: $label${NC}"
        # Show file:line
        echo "$FILES" | xargs grep -nEI "$pattern" 2>/dev/null | head -5 | sed 's/^/    /'
        ERRORS=$((ERRORS + 1))
    fi
done

# ── Проверка предупреждений ───────────────────────────────────
echo ""
echo "⚠️  Проверяю потенциально чувствительные данные..."
for label in "${!WARNINGS_MAP[@]}"; do
    pattern="${WARNINGS_MAP[$label]}"
    matches=$(echo "$FILES" | xargs grep -lEI "$pattern" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo -e "  ${YELLOW}ВНИМАНИЕ: $label${NC} — в файлах: $(echo $matches | tr '\n' ' ')"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# ── Проверка .gitignore ───────────────────────────────────────
echo ""
echo "📋 Проверяю .gitignore..."
MUST_IGNORE=(".env" "*.env" "API_KEYS.md" "ZNAIKA_KEYS.md" "*_KEYS.md" "*.pem" "*.key")
for pattern in "${MUST_IGNORE[@]}"; do
    if ! grep -qF "$pattern" .gitignore 2>/dev/null; then
        echo -e "  ${YELLOW}ВНИМАНИЕ: '$pattern' не в .gitignore${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# ── Итог ─────────────────────────────────────────────────────
echo ""
if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  PUSH ЗАБЛОКИРОВАН: найдено $ERRORS секрет(ов)        ║${NC}"
    echo -e "${RED}║  Удали секреты из файлов и повтори push.     ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS предупреждений. Проверь вручную — всё ли ок.${NC}"
    echo -e "${GREEN}✅ Критических секретов не найдено. Push разрешён.${NC}"
    exit 0
else
    echo -e "${GREEN}✅ Чисто. Секретов не найдено. Push разрешён.${NC}"
    exit 0
fi
