#!/usr/bin/env python3
"""
vk_parser.py — VK-аналитика для бота Ульвар.

Команды:
  group-stats <screen_name>             — статистика группы (участники, посты, товары)
  audience    <screen_name> [--limit N] — демография аудитории (user token)
  search-groups <query> [--limit N]     — поиск групп по теме

Токены берутся из /opt/studio-3d/config/config.env:
  VK_USER_TOKEN        — user token (для demographics, search)
  VK_ACCESS_TOKEN      — community token (fallback)
"""

import sys
import os
import time
import json
import argparse
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

CONFIG_ENV    = Path("/opt/studio-3d/config/config.env")
OPENCLAW_JSON = Path("/root/.openclaw/openclaw.json")
VK_API = "https://api.vk.com/method"
VK_V = "5.199"


# ─────────────────────────────────────────────────────────────────
# Конфиг
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


def get_token(cfg: dict, user: bool = False) -> str:
    # user=True — методы требующие user token (groups.search, groups.getMembers с полями)
    # user=False — community token (groups.getById, wall.get, market.get)
    if user:
        return cfg.get("VK_USER_TOKEN", "") or cfg.get("VK_ACCESS_TOKEN", "")
    return cfg.get("VK_ACCESS_TOKEN", "") or cfg.get("VK_USER_TOKEN", "")


# ─────────────────────────────────────────────────────────────────
# VK API
# ─────────────────────────────────────────────────────────────────

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


def api_error(result: dict) -> str | None:
    if "error" in result:
        return result["error"].get("error_msg", "unknown error")
    return None


# ─────────────────────────────────────────────────────────────────
# Команда: group-stats
# ─────────────────────────────────────────────────────────────────

def cmd_group_stats(screen_name: str, token: str):
    # Инфо о группе
    r = vk_call("groups.getById", {
        "group_id": screen_name,
        "fields": "members_count,description,activity,site,status,verified,market",
    }, token)
    if err := api_error(r):
        print(f"❌ groups.getById: {err}")
        sys.exit(1)

    groups = r.get("response", {})
    if isinstance(groups, dict):
        groups = groups.get("groups", [groups])
    g = groups[0] if groups else {}

    name        = g.get("name", screen_name)
    members     = g.get("members_count", 0)
    activity    = g.get("activity", "")
    verified    = "✅" if g.get("verified") else ""
    site        = g.get("site", "")
    group_id    = g.get("id", "")

    # Стена — последние посты
    wall = vk_call("wall.get", {
        "owner_id": f"-{group_id}",
        "count": 10,
        "filter": "owner",
    }, token)
    posts = wall.get("response", {})
    post_count = posts.get("count", 0)
    items = posts.get("items", [])

    avg_likes = avg_reposts = avg_views = 0
    if items:
        avg_likes   = sum(p.get("likes", {}).get("count", 0)   for p in items) // len(items)
        avg_reposts = sum(p.get("reposts", {}).get("count", 0) for p in items) // len(items)
        avg_views   = sum(p.get("views", {}).get("count", 0)   for p in items) // len(items)

    last_post_date = ""
    if items:
        ts = items[0].get("date", 0)
        last_post_date = datetime.fromtimestamp(ts).strftime("%d.%m.%Y")

    # Товары
    market_r = vk_call("market.get", {
        "owner_id": f"-{group_id}",
        "count": 1,
        "extended": 0,
    }, token)
    market_count = market_r.get("response", {}).get("count", 0)

    # Форматируем вывод
    lines = [
        f"📊 {name} {verified}",
        f"vk.com/{screen_name}",
        "",
        f"👥 Подписчики:  {members:,}".replace(",", " "),
        f"📝 Всего постов: {post_count:,}".replace(",", " "),
        f"🛍️ Товаров:     {market_count}",
    ]
    if activity:
        lines.append(f"🏷️ Тематика:    {activity}")
    if site:
        lines.append(f"🌐 Сайт:       {site}")
    if last_post_date:
        lines.append("")
        lines.append(f"Последний пост: {last_post_date}")
        lines.append(f"Средние показатели (10 постов):")
        lines.append(f"  ❤️  Лайки:    {avg_likes}")
        lines.append(f"  🔁 Репосты:  {avg_reposts}")
        lines.append(f"  👁️ Просмотры: {avg_views:,}".replace(",", " "))

    er = round(avg_likes / max(members, 1) * 100, 3) if members else 0
    if er:
        lines.append(f"  📈 ER (лайки/подп.): {er}%")

    print("\n".join(lines))


# ─────────────────────────────────────────────────────────────────
# Команда: audience
# ─────────────────────────────────────────────────────────────────

def cmd_audience(screen_name: str, token: str, limit: int = 500):
    # Получаем ID группы
    r = vk_call("groups.getById", {"group_id": screen_name}, token)
    if err := api_error(r):
        print(f"❌ {err}")
        sys.exit(1)
    groups = r.get("response", {})
    if isinstance(groups, dict):
        groups = groups.get("groups", [groups])
    group_id = str(groups[0]["id"])

    # Получаем участников пачками по 1000
    members = []
    offset = 0
    batch = 1000
    while len(members) < limit:
        need = min(batch, limit - len(members))
        mr = vk_call("groups.getMembers", {
            "group_id": group_id,
            "count": need,
            "offset": offset,
            "fields": "sex,bdate,city",
        }, token)
        if err := api_error(mr):
            print(f"❌ groups.getMembers: {err}")
            print("ℹ️ Для демографии нужен VK_USER_TOKEN")
            sys.exit(1)
        items = mr.get("response", {}).get("items", [])
        if not items:
            break
        members.extend(items)
        offset += len(items)
        if len(items) < need:
            break
        time.sleep(0.35)

    total = len(members)
    if not total:
        print("❌ Не удалось получить список участников")
        sys.exit(1)

    # Анализ
    male = female = unknown_sex = 0
    ages = []
    cities: dict[str, int] = {}

    for m in members:
        sex = m.get("sex", 0)
        if sex == 2:   male += 1
        elif sex == 1: female += 1
        else:          unknown_sex += 1

        bdate = m.get("bdate", "")
        if bdate and bdate.count(".") == 2:
            try:
                year = int(bdate.split(".")[-1])
                age = datetime.now().year - year
                if 10 < age < 100:
                    ages.append(age)
            except ValueError:
                pass

        city = m.get("city", {}).get("title", "")
        if city:
            cities[city] = cities.get(city, 0) + 1

    # Топ городов
    top_cities = sorted(cities.items(), key=lambda x: -x[1])[:5]

    # Возрастные группы
    age_groups: dict[str, int] = {"13-17": 0, "18-24": 0, "25-34": 0, "35-44": 0, "45+": 0}
    for a in ages:
        if a < 18:   age_groups["13-17"] += 1
        elif a < 25: age_groups["18-24"] += 1
        elif a < 35: age_groups["25-34"] += 1
        elif a < 45: age_groups["35-44"] += 1
        else:        age_groups["45+"]   += 1

    avg_age = round(sum(ages) / len(ages)) if ages else 0

    pct = lambda n: f"{round(n / total * 100)}%" if total else "0%"

    lines = [
        f"👥 Аудитория: {screen_name}",
        f"Проанализировано: {total} участников",
        "",
        "— Пол —",
        f"  👨 Мужчины:  {male} ({pct(male)})",
        f"  👩 Женщины:  {female} ({pct(female)})",
    ]
    if unknown_sex:
        lines.append(f"  ❓ Не указан: {unknown_sex} ({pct(unknown_sex)})")

    if ages:
        lines += [
            "",
            f"— Возраст (средний: {avg_age} лет) —",
        ]
        for group, cnt in age_groups.items():
            bar = "█" * (cnt * 20 // max(age_groups.values(), default=1))
            lines.append(f"  {group}: {pct(cnt):>4}  {bar}")

    if top_cities:
        lines += ["", "— Топ городов —"]
        for city, cnt in top_cities:
            lines.append(f"  {city}: {cnt} ({pct(cnt)})")

    print("\n".join(lines))


# ─────────────────────────────────────────────────────────────────
# Команда: search-groups
# ─────────────────────────────────────────────────────────────────

def cmd_search_groups(query: str, token: str, limit: int = 10):
    r = vk_call("groups.search", {
        "q": query,
        "type": "group",
        "count": min(limit, 20),
        "sort": 6,  # сортировка по количеству участников
    }, token)
    if err := api_error(r):
        print(f"❌ groups.search: {err}")
        sys.exit(1)

    items = r.get("response", {}).get("items", [])
    if not items:
        print(f'🔍 По запросу "{query}" ничего не найдено.')
        return

    lines = [f'🔍 Группы по запросу "{query}" ({len(items)}):']
    for g in items:
        name     = g.get("name", "?")
        members  = g.get("members_count", 0)
        screen   = g.get("screen_name", "")
        verified = "✅" if g.get("verified") else ""
        closed   = "🔒" if g.get("is_closed") == 1 else ""
        lines.append(
            f"\n  {verified}{closed} {name}\n"
            f"  👥 {members:,} подп.  vk.com/{screen}".replace(",", " ")
        )

    print("\n".join(lines))


# ─────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VK Group Analytics")
    sub = parser.add_subparsers(dest="cmd")

    p1 = sub.add_parser("group-stats")
    p1.add_argument("screen_name")

    p2 = sub.add_parser("audience")
    p2.add_argument("screen_name")
    p2.add_argument("--limit", type=int, default=500)

    p3 = sub.add_parser("search-groups")
    p3.add_argument("query")
    p3.add_argument("--limit", type=int, default=10)

    args = parser.parse_args()
    if not args.cmd:
        parser.print_help()
        sys.exit(1)

    cfg = load_config()
    if not get_token(cfg):
        print("❌ VK_USER_TOKEN или VK_ACCESS_TOKEN не задан в config.env")
        sys.exit(1)

    if args.cmd == "group-stats":
        cmd_group_stats(args.screen_name, get_token(cfg))
    elif args.cmd == "audience":
        cmd_audience(args.screen_name, get_token(cfg, user=True), args.limit)
    elif args.cmd == "search-groups":
        cmd_search_groups(args.query, get_token(cfg, user=True), args.limit)


if __name__ == "__main__":
    main()
