#!/usr/bin/env python3
"""
Sage Daily Digest — ежедневная сводка для Любы.
Запускается по cron: 0 9 * * * (9:00 UTC = 15:00 Алматы)
Отправляет VK-сообщение пользователю (VK_OWNER_ID из конфига).

Включает:
1. Обновление остатков с MFM (если скрипт доступен)
2. Состояние Великого Мудреца (какие LLM работают)
3. Краткую статистику активности за день
4. Список товаров с критически малым остатком
"""
import json, os, sys, subprocess, urllib.request, urllib.parse, psycopg2
from datetime import datetime, timedelta

DIGEST_RECIPIENT_ID = os.getenv('DIGEST_RECIPIENT_ID', '')   # VK user ID получателя дайджеста
OWNER_ID            = os.getenv('DIGEST_OWNER_ID', '')        # VK user ID владельца (копия)
OPENCLAW_CFG        = '/root/.openclaw/openclaw.json'
STUDIO_DB = dict(
    host=os.getenv('STUDIO_DB_HOST', '127.0.0.1'),
    port=int(os.getenv('STUDIO_DB_PORT', '5432')),
    dbname=os.getenv('STUDIO_DB_NAME', 'studio_db'),
    user=os.getenv('STUDIO_DB_USER', 'studio_app'),
    password=os.getenv('STUDIO_DB_PASSWORD', ''),   # задаётся через config.env
)
BRIDGE_URL          = 'http://127.0.0.1:7788'
SAGE_DB_PATH        = '/root/.sage/sage.db'
UPDATE_STOCKS_SCRIPT= '/opt/studio-3d/scripts/update_stocks_mfm.py'
LOW_STOCK_THRESHOLD = 3   # показываем товары с остатком < N штук


def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}", flush=True)


def get_vk_token():
    try:
        cfg = json.load(open(OPENCLAW_CFG))
        return cfg['plugins']['entries']['vk']['config']['accounts']['default']['token']
    except Exception as e:
        log(f"Token error: {e}")
        return None


def send_vk(user_id, message):
    token = get_vk_token()
    if not token:
        log("No VK token")
        return False
    url = (f"https://api.vk.com/method/messages.send"
           f"?user_id={user_id}"
           f"&message={urllib.parse.quote(message)}"
           f"&random_id={int(datetime.utcnow().timestamp())}"
           f"&access_token={token}"
           f"&v=5.131")
    try:
        resp = json.loads(urllib.request.urlopen(url, timeout=10).read())
        if resp.get('error'):
            log(f"VK error: {resp['error'].get('error_msg')}")
            return False
        log(f"Sent to {user_id} OK")
        return True
    except Exception as e:
        log(f"Send failed: {e}")
        return False


# ── 1. Обновление остатков ────────────────────────────────────────────────────

def update_stocks():
    """Запускает скрипт синхронизации остатков с MFM."""
    if not os.path.exists(UPDATE_STOCKS_SCRIPT):
        log("update_stocks_mfm.py not found, skip")
        return None
    log("Updating stocks on MFM...")
    try:
        result = subprocess.run(
            [sys.executable, UPDATE_STOCKS_SCRIPT],
            capture_output=True, text=True, timeout=120,
            cwd='/opt/studio-3d'
        )
        if result.returncode == 0:
            log("Stocks updated OK")
            return "✅ Остатки обновлены на MFM"
        else:
            log(f"update_stocks failed: {result.stderr[:200]}")
            return f"⚠️ Обновление остатков: ошибка ({result.returncode})"
    except Exception as e:
        log(f"update_stocks exception: {e}")
        return f"⚠️ Обновление остатков: {e}"


# ── 2. Остатки из БД ──────────────────────────────────────────────────────────

def get_inventory_summary():
    """Возвращает сводку по остаткам: итого и критически малые."""
    try:
        conn = psycopg2.connect(**STUDIO_DB)
        cur = conn.cursor()
        # Total counts
        cur.execute("SELECT COUNT(*), SUM(stock) FROM products WHERE is_archived=0")
        total_items, total_stock = cur.fetchone()
        # Zero stock
        cur.execute("SELECT COUNT(*) FROM products WHERE is_archived=0 AND stock=0")
        zero_count = cur.fetchone()[0]
        # Low stock
        cur.execute(
            "SELECT title_ru, stock, price_rub FROM products "
            "WHERE is_archived=0 AND stock > 0 AND stock < %s "
            "ORDER BY stock ASC, title_ru",
            (LOW_STOCK_THRESHOLD,)
        )
        low = cur.fetchall()
        conn.close()
        return {
            'total_items': total_items,
            'total_stock': total_stock or 0,
            'zero_count': zero_count,
            'low_stock': low,
        }
    except Exception as e:
        log(f"Inventory error: {e}")
        return None


# ── 3. Статус LLMs ────────────────────────────────────────────────────────────

def get_llm_status():
    """Возвращает кол-во рабочих/отключённых LLMs."""
    try:
        req = urllib.request.Request(f'{BRIDGE_URL}/llm-status',
                                     headers={'User-Agent': 'Mozilla/5.0'})
        data = json.loads(urllib.request.urlopen(req, timeout=3).read())
        disabled = [(k, v.get('reason','')) for k, v in data.items() if v.get('disabled')]
        ok = [k for k in data if not data[k].get('disabled')]
        return {'ok': ok, 'disabled': disabled}
    except Exception:
        return None


# ── 4. Sage активность за день ────────────────────────────────────────────────

def get_sage_activity():
    """Считает запросы за последние 24 часа из sage SQLite."""
    try:
        import sqlite3
        conn = sqlite3.connect(SAGE_DB_PATH)
        yesterday = (datetime.utcnow() - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
        cnt = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE asked_at > ?", (yesterday,)
        ).fetchone()[0]
        conn.close()
        return cnt
    except Exception:
        return None


# ── Сборка сообщения ──────────────────────────────────────────────────────────

def build_digest(stocks_result, inventory, llm_status, activity):
    today = datetime.utcnow().strftime('%d.%m.%Y')
    lines = [f"📦 Дайджест Студии 3D — {today}"]
    lines.append("")

    # Обновление остатков
    if stocks_result:
        lines.append(stocks_result)

    # Статистика остатков
    if inventory:
        lines.append(f"\n📊 Остатки товаров:")
        lines.append(f"  Всего SKU: {inventory['total_items']} | "
                     f"Единиц: {inventory['total_stock']} шт")
        if inventory['zero_count']:
            lines.append(f"  🔴 Закончились (0 шт): {inventory['zero_count']} товаров")

        if inventory['low_stock']:
            lines.append(f"\n⚠️ Заканчиваются (меньше {LOW_STOCK_THRESHOLD} шт):")
            for title, stock, price in inventory['low_stock'][:10]:
                lines.append(f"  • {title[:38]} — {stock} шт")
            if len(inventory['low_stock']) > 10:
                lines.append(f"  ... и ещё {len(inventory['low_stock'])-10} позиций")
        else:
            lines.append("  ✅ Критических нехваток нет")

    # Великий Мудрец
    lines.append(f"\n🧙 Великий Мудрец:")
    if llm_status:
        ok_str = ', '.join(llm_status['ok']) if llm_status['ok'] else 'нет'
        lines.append(f"  Работают: {ok_str}")
        if llm_status['disabled']:
            for name, reason in llm_status['disabled']:
                lines.append(f"  🔴 {name}: {reason or 'отключён'}")
    else:
        lines.append("  ⚠️ Не удалось получить статус")

    if activity is not None:
        lines.append(f"  Запросов за 24ч: {activity}")

    lines.append("\n— Бот Студии 🤖")
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(test_mode=False):
    log("=== Daily Digest ===")

    # 1. Обновляем остатки
    stocks_result = update_stocks()

    # 2. Собираем данные
    inventory  = get_inventory_summary()
    llm_status = get_llm_status()
    activity   = get_sage_activity()

    # 3. Строим сообщение
    message = build_digest(stocks_result, inventory, llm_status, activity)

    log("Message preview:")
    print(message)
    print()

    if test_mode:
        log(f"TEST MODE: отправляем только владельцу ({OWNER_ID})")
        send_vk(OWNER_ID, "[TEST] " + message)
    else:
        log("Отправляем Любе...")
        send_vk(DIGEST_RECIPIENT_ID, message)
        # Копия владельцу
        send_vk(OWNER_ID, "[КОПИЯ] " + message)

    log("=== Done ===")


if __name__ == '__main__':
    test = '--test' in sys.argv
    main(test_mode=test)
