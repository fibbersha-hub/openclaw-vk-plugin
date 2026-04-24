#!/usr/bin/env bash
# Module 0: Check and install system dependencies
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }

MISSING=()

check_cmd() {
  local cmd=$1 pkg=${2:-$1} install_cmd=${3:-"apt-get install -y $pkg"}
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd found ($(command -v "$cmd"))"
  else
    warn "$cmd not found — will install"
    MISSING+=("$install_cmd")
  fi
}

echo "  Checking dependencies..."
echo ""

# OS check
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  ok "OS: $NAME $VERSION_ID"
else
  warn "Cannot detect OS version"
fi

# Node.js 18+
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(process.version)" 2>/dev/null || echo "unknown")
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [[ "$NODE_MAJOR" -ge 18 ]]; then
    ok "Node.js $NODE_VER"
  else
    warn "Node.js $NODE_VER found but v18+ required — will upgrade"
    MISSING+=("node_upgrade")
  fi
else
  warn "Node.js not found — will install"
  MISSING+=("node_install")
fi

# Python 3.9+
if command -v python3 &>/dev/null; then
  PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
  PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
  if [[ "$PY_MAJOR" -ge 3 && "$PY_MINOR" -ge 9 ]]; then
    ok "Python $PY_VER"
  else
    warn "Python $PY_VER found but 3.9+ required"
    MISSING+=("apt-get install -y python3.11")
  fi
else
  warn "Python 3 not found — will install"
  MISSING+=("apt-get install -y python3 python3-pip")
fi

check_cmd sqlite3   "sqlite3"
check_cmd git       "git"
check_cmd curl      "curl"
check_cmd systemctl "systemd" "echo 'systemd required'"

echo ""

# Install missing
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "  Installing missing dependencies..."
  apt-get update -qq

  for cmd in "${MISSING[@]}"; do
    case "$cmd" in
      node_install)
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        ok "Node.js installed: $(node --version)"
        ;;
      node_upgrade)
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        ok "Node.js upgraded: $(node --version)"
        ;;
      *)
        eval "$cmd" -qq
        ;;
    esac
  done
fi

ok "All dependencies satisfied"
