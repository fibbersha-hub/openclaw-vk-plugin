#!/usr/bin/env python3
"""
vk_competitors.py — Мониторинг конкурентов в VK Market.

Команды:
  report          — сводный отчёт: наши цены vs конкуренты
  scan            — обновить данные конкурентов (сохраняет в data/competitors_cache.json)
  list            — список отслеживаемых конкурентов
  add <group_id>  — добавить конкурента (screen_name или числовой ID)

Данные хранятся в:
  /opt/studio-3d/data/competitors.json         — список конкурентов
  /opt/studio-3d/data/competitors_cache.json   — кэш товаров (после scan)

Токен берётся из /opt/studio-3d/config/config.env:
  VK_ACCESS_TOKEN  — community token (market.get работает без user token)
"""

import sys
import os
import json
import time
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

CONFIG_ENV       = Path("/opt/studio-3d/config/config.env")
OPENCLAW_JSON    = Path("/root/.openclaw/openclaw.json")
DATA_DIR         = Path("/opt/studio-3d/data")
COMPETITORS_FILE = DATA_DIR / "competitors.json"
CACHE_FILE       = DATA_DIR / "competitors_cache.json"
OUR_GROUP_ID     = "YOUR_GROUP_ID"   # Ульвар

VK_API = "https://api.vk.com/method"
VK_V   = "5.199"


# ─────────────────────────────────────────────────────────────────

def load_config() -> dict:
    cfg = {}
    # 1. config.env (studio-3d)
    if CONFIG_ENV.exists():
        for line in CONFIG_ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    # 2. openclaw.json — токен сообщества привязан к этому серверу, имеет приоритет
    if OPENCLAW_JSON.exists():
        try:
            oc = json.load(open(OPENCLAW_JSON))
            vk = oc.get("channels", {}).get("vk", {})
            t = vk.get("token", "")
            if not t:
                for acc in vk.get("accounts", {}).values():
                    t = acc.get("token", "").strip()
                    if t:
                        break
            if t:
                cfg["VK_ACCESS_TOKEN"] = t  # переопределяем: этот токен работает на сервере
        except Exception:
            pass
    return cfg


def get_token(cfg: dict) -> str:
    return cfg.get("VK_ACCESS_TOKEN", "") or cfg.get("VK_USER_TOKEN", "")


def vk_call(method: str, params: dict, token: str) -> dict:
    params = {"v": VK_V, "access_token": token, **params}
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        f"{VK_API}/{method}", data=data, method="POST",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": {"error_msg": str(e)}}


def load_competitors() -> list[dict]:
    if not COMPETITORS_FILE.exists():
        return []
    try:
        return json.loads(COMPETITORS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_competitors(data: list[dict]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    COMPETITORS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(data: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_market_items(group_id: str, token: str) -> list[dict]:
    """Получить все товары из VK Market группы."""
    items = []
    offset = 0
    while True:
        r = vk_call("market.get", {
            "owner_id": f"-{group_id}",
            "count": 100,
            "offset": offset,
            "extended": 0,
        }, token)
        if "error" in r:
            break
        batch = r.get("response", {}).get("items", [])
        if not batch:
            break
        items.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break
        time.sleep(0.35)
    return items


def parse_price(item: dict) -> float:
    """Извлечь цену из объекта товара VK."""
    price = item.get("price", {})
    if isinstance(price, dict):
        amount = price.get("amount", 0)
        return float(amount) / 100
    return float(price or 0)


def get_group_info(group_id: str, token: str) -> dict:
    r = vk_call("groups.getById", {
        "group_id": group_id,
        "fields": "name,screen_name,members_count",
    }, token)
    groups = r.get("response", {})
    if isinstance(groups, dict):
        groups = groups.get("groups", [groups])
    return groups[0] if groups else {}


# ─────────────────────────────────────────────────────────────────
# Команды
# ─────────────────────────────────────────────────────────────────

def cmd_list(_args):
    competitors = load_competitors()
    cache = load_cache()
    if not competitors:
        print("📋 Список конкурентов пуст.\nДобавь: vk_competitors.py add <screen_name>")
        return

    lines = [f"🕵️ Конкуренты ({len(competitors)}):"]
    for c in competitors:
        gid    = c.get("group_id", "?")
        name   = c.get("name", gid)
        screen = c.get("screen_name", "")
        cached = cache.get(gid, {})
        count  = cached.get("count", "не сканировалось")
        scanned = cached.get("scanned_at", "")
        lines.append(
            f"\n  {name}  vk.com/{screen}\n"
            f"  Товаров: {count}"
            + (f"  |  обновлено {scanned[:10]}" if scanned else "")
        )
    print("\n".join(lines))


def cmd_add(args):
    competitors = load_competitors()
    cfg   = load_config()
    token = get_token(cfg)
    if not token:
        print("❌ VK_ACCESS_TOKEN не задан")
        sys.exit(1)

    screen_name = args.group_id.lstrip("@").strip()
    # Проверяем что группа существует
    info = get_group_info(screen_name, token)
    if not info:
        print(f"❌ Группа '{screen_name}' не найдена")
        sys.exit(1)

    group_id = str(info.get("id", ""))
    name     = info.get("name", screen_name)
    screen   = info.get("screen_name", screen_name)

    # Проверяем дубликаты
    if any(c.get("group_id") == group_id for c in competitors):
        print(f"⚠️ {name} уже в списке конкурентов")
        return

    competitors.append({
        "group_id":    group_id,
        "name":        name,
        "screen_name": screen,
        "added_at":    datetime.now().strftime("%Y-%m-%d"),
    })
    save_competitors(competitors)
    print(f"✅ Добавлен конкурент: {name} (vk.com/{screen})")


def cmd_scan(_args):
    competitors = load_competitors()
    if not competitors:
        print("📋 Список конкурентов пуст. Добавь: vk_competitors.py add <screen_name>")
        return

    cfg   = load_config()
    token = get_token(cfg)
    if not token:
        print("❌ VK_ACCESS_TOKEN не задан")
        sys.exit(1)

    cache = load_cache()
    now   = datetime.now().strftime("%Y-%m-%d %H:%M")
    total = len(competitors)

    print(f"🔍 Сканирую {total} конкурентов...")
    for i, c in enumerate(competitors, 1):
        gid  = c["group_id"]
        name = c.get("name", gid)
        print(f"  [{i}/{total}] {name}...", end=" ", flush=True)

        items = get_market_items(gid, token)
        prices = [parse_price(item) for item in items if parse_price(item) > 0]

        cache[gid] = {
            "name":       name,
            "screen_name": c.get("screen_name", ""),
            "count":      len(items),
            "min_price":  min(prices) if prices else 0,
            "max_price":  max(prices) if prices else 0,
            "avg_price":  round(sum(prices) / len(prices)) if prices else 0,
            "scanned_at": now,
            "items":      [
                {"id": it["id"], "title": it.get("title", "")[:60], "price": parse_price(it)}
                for it in items
            ],
        }
        print(f"{len(items)} товаров")
        time.sleep(0.5)

    save_cache(cache)
    print(f"\n✅ Готово. Данные сохранены.")


def cmd_report(_args):
    competitors = load_competitors()
    cache = load_cache()

    if not competitors:
        print("📋 Список конкурентов пуст.\nДобавь: vk_competitors.py add <screen_name>")
        return

    cfg   = load_config()
    token = get_token(cfg)

    # Наши товары
    our_items = get_market_items(OUR_GROUP_ID, token) if token else []
    our_prices = [parse_price(it) for it in our_items if parse_price(it) > 0]
    our_avg    = round(sum(our_prices) / len(our_prices)) if our_prices else 0
    our_min    = min(our_prices) if our_prices else 0
    our_max    = max(our_prices) if our_prices else 0

    lines = [
        "🕵️ Отчёт по конкурентам",
        f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        "",
        f"🐺 Ульвар (наша группа)",
        f"   Товаров: {len(our_items)}",
        f"   Цены: {int(our_min)}–{int(our_max)} руб  |  средняя: {our_avg} руб",
        "",
        "─" * 35,
    ]

    not_scanned = []
    for c in competitors:
        gid    = c["group_id"]
        name   = c.get("name", gid)
        screen = c.get("screen_name", "")
        cached = cache.get(gid)

        if not cached:
            not_scanned.append(name)
            continue

        count     = cached.get("count", 0)
        min_p     = cached.get("min_price", 0)
        max_p     = cached.get("max_price", 0)
        avg_p     = cached.get("avg_price", 0)
        scanned   = cached.get("scanned_at", "")[:10]

        # Сравниваем средние цены
        if our_avg and avg_p:
            diff = round((avg_p - our_avg) / our_avg * 100)
            if diff > 20:
                price_comment = f"  📈 дороже нас на {diff}%"
            elif diff < -20:
                price_comment = f"  ⚠️ дешевле нас на {abs(diff)}%"
            else:
                price_comment = f"  ≈ цены схожи ({'+' if diff >= 0 else ''}{diff}%)"
        else:
            price_comment = ""

        lines += [
            f"\n  {name}  vk.com/{screen}",
            f"  Товаров: {count}  |  обновлено {scanned}",
            f"  Цены: {int(min_p)}–{int(max_p)} руб  |  средняя: {avg_p} руб",
            price_comment,
        ]

    if not_scanned:
        lines += ["", f"⚠️ Не сканировалось: {', '.join(not_scanned)}"]
        lines.append("Запустите: vk_competitors.py scan")

    print("\n".join(lines))


# ─────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VK Competitor Monitor")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("list")
    sub.add_parser("scan")
    sub.add_parser("report")

    p_add = sub.add_parser("add")
    p_add.add_argument("group_id", help="screen_name или числовой ID группы")

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        sys.exit(1)

    if args.cmd == "list":    cmd_list(args)
    elif args.cmd == "add":   cmd_add(args)
    elif args.cmd == "scan":  cmd_scan(args)
    elif args.cmd == "report": cmd_report(args)


if __name__ == "__main__":
    main()
