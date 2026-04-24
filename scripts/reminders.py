#!/usr/bin/env python3
"""
Напоминания — SQLite хранилище + отправка через VK API
Использование:
  reminders.py add "напомни через 30 минут купить молоко" --peer PEER_ID
  reminders.py list [--peer PEER_ID] [--limit N]
  reminders.py delete ID
  reminders.py check         ← вызывается cron каждую минуту
  reminders.py setup-cron    ← добавляет cron-запись автоматически
"""

import sys
import os
import re
import json
import sqlite3
import urllib.request
import urllib.parse
import random
from datetime import datetime, timedelta, timezone

# Сервер в UTC, пользователь в UTC+5 (Оренбург / Екатеринбург)
TZ_OFFSET = timedelta(hours=5)

def now_local() -> datetime:
    """Текущее время в UTC+5 (без tzinfo — для совместимости с SQLite)."""
    return datetime.now(timezone.utc).replace(tzinfo=None) + TZ_OFFSET

DB_PATH = os.environ.get("REMINDERS_DB", "/opt/openclaw-notes/reminders.db")
OPENCLAW_CONFIG = "/root/.openclaw/openclaw.json"
CONTACTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "contacts.json")


def load_contacts() -> dict:
    """Загружает маппинг имён → peer_id из contacts.json."""
    try:
        with open(CONTACTS_PATH) as f:
            return {k.lower(): v for k, v in json.load(f).items()}
    except Exception:
        return {}


def resolve_recipient(text: str, sender_peer_id: int) -> tuple[int, str, str | None]:
    """
    Ищет 'для [Имя]' в тексте. Если найдено и имя в contacts — возвращает
    (peer_id получателя, текст без 'для Имя', имя контакта).
    Иначе возвращает (sender_peer_id, исходный текст, None).
    """
    m = re.search(r'\bдля\s+([а-яёА-ЯЁa-zA-Z]+)', text, re.I)
    if not m:
        return sender_peer_id, text, None
    name = m.group(1).lower()
    contacts = load_contacts()
    if name not in contacts:
        return sender_peer_id, text, None
    # Убираем "для Имя" из текста
    cleaned = (text[:m.start()] + text[m.end():]).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().rstrip('.,')
    return contacts[name], cleaned, m.group(1).capitalize()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reminders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            text       TEXT NOT NULL,
            peer_id    INTEGER NOT NULL,
            remind_at  TEXT NOT NULL,
            created    TEXT NOT NULL,
            sent       INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def get_vk_token():
    try:
        with open(OPENCLAW_CONFIG) as f:
            cfg = json.load(f)
        vk = cfg.get("channels", {}).get("vk", {})
        token = vk.get("token", "").strip()
        if not token:
            for acc in vk.get("accounts", {}).values():
                token = acc.get("token", "").strip()
                if token:
                    break
        return token
    except Exception as e:
        sys.stderr.write(f"Config read error: {e}\n")
        return ""


def vk_send(peer_id: int, message: str, token: str) -> bool:
    params = {
        "peer_id": str(peer_id),
        "message": message,
        "random_id": str(random.randint(0, 2147483647)),
        "v": "5.199",
        "access_token": token,
    }
    url = "https://api.vk.com/method/messages.send"
    data = urllib.parse.urlencode(params).encode()
    try:
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return "error" not in result
    except Exception as e:
        sys.stderr.write(f"VK send error: {e}\n")
        return False


MONTHS_RU = {
    "январ": 1, "феврал": 2, "март": 3, "апрел": 4,
    "май": 5, "мая": 5, "июн": 6, "июл": 7, "август": 8,
    "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12,
}

def _parse_date_ru(day: int, month_str: str, time_str: str, now: datetime) -> datetime:
    """Парсит конкретную дату: '23 апреля [в 10:00]'"""
    month = None
    ms = month_str.lower().rstrip("иея")
    if ms in ("текущего", "текущ", "этого"):
        month = now.month
    else:
        for key, val in MONTHS_RU.items():
            if key.startswith(ms) or ms.startswith(key[:4]):
                month = val
                break
    if not month:
        return None

    year = now.year
    # Если дата уже прошла в этом году — берём следующий
    try:
        candidate = datetime(year, month, day, 0, 0)
    except ValueError:
        return None
    if candidate.date() < now.date():
        candidate = datetime(year + 1, month, day, 0, 0)

    # Парсим время если указано
    if time_str:
        tm = re.search(r'(\d{1,2})[:.](\d{2})', time_str)
        if tm:
            candidate = candidate.replace(hour=int(tm.group(1)), minute=int(tm.group(2)))
        else:
            candidate = candidate.replace(hour=9, minute=0)  # дефолт 9:00
    else:
        candidate = candidate.replace(hour=9, minute=0)

    return candidate


def parse_add_args(full_text: str):
    """
    Парсит естественный язык напоминания — извлекает текст и время.
    Поддерживает:
      - через N минут/часов/дней
      - в HH:MM, завтра в HH:MM
      - на DD месяц [в HH:MM]  («на 23 апреля», «на 5 мая в 10:00»)
      - DD месяц [в HH:MM]     («23 апреля встреча»)
    Возвращает (reminder_text, remind_at_datetime or None).
    """
    # Убираем приветственный префикс
    text = re.sub(
        r'^(напомни(те)?(сь)?(\s+мне)?(\s+нам)?'
        r'|поставь\s+напоминание|поставь\s+заметку'
        r'|добавь\s+напоминание|напоминание)\s*',
        '', full_text, flags=re.I
    ).strip()

    now = now_local()
    remind_at = None
    time_span = None

    patterns = [
        # через N минут/минуты/минуту/мин
        (r'через\s+(\d+)\s*(минут\w*|мин\.?)',
         lambda m: now + timedelta(minutes=int(m.group(1)))),
        # через N часов/часа/час/ч
        (r'через\s+(\d+)\s*(часов|часа|час|ч\.?)(?:\s|$|[,.])',
         lambda m: now + timedelta(hours=int(m.group(1)))),
        # через N дней/дня/день
        (r'через\s+(\d+)\s*(дней|дня|день)(?:\s|$|[,.])',
         lambda m: now + timedelta(days=int(m.group(1)))),
        # завтра в HH:MM
        (r'завтра\s+в\s+(\d{1,2})[:.](\d{2})',
         lambda m: (now + timedelta(days=1)).replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)),
        # в HH:MM завтра
        (r'в\s+(\d{1,2})[:.](\d{2})\s+завтра',
         lambda m: (now + timedelta(days=1)).replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)),
        # на DD месяц [в HH:MM] — «на 23 апреля в 10:00»
        (r'на\s+(\d{1,2})\s+([а-яё]+)(?:\s+в\s+([\d:.]+))?',
         lambda m: _parse_date_ru(int(m.group(1)), m.group(2), m.group(3) or '', now)),
        # DD месяц [в HH:MM] — «23 апреля встреча» или «23 апреля в 10:00»
        (r'(\d{1,2})\s+([а-яё]{4,})(?:\s+в\s+([\d:.]+))?',
         lambda m: _parse_date_ru(int(m.group(1)), m.group(2), m.group(3) or '', now)),
        # N числа [в HH:MM] — «25 числа», «25-го числа»
        (r'(\d{1,2})[\-го]*\s*числа(?:\s+в\s+([\d:.]+))?',
         lambda m: _parse_date_ru(int(m.group(1)), "текущего", m.group(2) or '', now)),
        # на сегодня в HH:MM / на сегодня на HH:MM / на сегодня на HH.MM
        (r'на\s+сегодня\s+(?:в|на)\s+(\d{1,2})[:.](\d{2})',
         lambda m: _time_today_or_tomorrow(now, int(m.group(1)), int(m.group(2)))),
        # через N часов и N минут / на N часов N минут
        (r'(?:через|на)\s+(\d+)\s*час\w*\s+(?:и\s+)?(\d+)\s*мин\w*',
         lambda m: now + timedelta(hours=int(m.group(1)), minutes=int(m.group(2)))),
        # на HH:MM / на HH.MM (без «в»)
        (r'на\s+(\d{1,2})[.](\d{2})(?:\s|$|[,.])',
         lambda m: _time_today_or_tomorrow(now, int(m.group(1)), int(m.group(2)))),
        # в HH:MM (сегодня или завтра если уже прошло)
        (r'\bв\s+(\d{1,2})[:.](\d{2})(?:\s|$)',
         lambda m: _time_today_or_tomorrow(now, int(m.group(1)), int(m.group(2)))),
    ]

    for pattern, calc in patterns:
        m = re.search(pattern, text, re.I)
        if m:
            result = calc(m)
            if result is not None:
                remind_at = result
                time_span = (m.start(), m.end())
                break

    # Извлекаем текст напоминания (убираем временное выражение)
    if time_span:
        content = (text[:time_span[0]] + " " + text[time_span[1]:]).strip()
        content = re.sub(r'\s+', ' ', content).strip()
        # Убираем хвостовые точки/запятые
        content = content.rstrip('.,')
    else:
        content = text

    return content, remind_at


def _time_today_or_tomorrow(now: datetime, hour: int, minute: int) -> datetime:
    t = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if t <= now:
        t += timedelta(days=1)
    return t


def human_delta(remind_at: datetime) -> str:
    delta = remind_at - now_local()
    total_min = int(delta.total_seconds() / 60)
    if total_min < 0:
        return "просрочено"
    elif total_min < 60:
        return f"через {total_min} мин"
    elif total_min < 1440:
        h = total_min // 60
        m = total_min % 60
        return f"через {h} ч {m} мин" if m else f"через {h} ч"
    elif total_min < 43200:  # < 30 дней
        return remind_at.strftime("%d.%m в %H:%M")
    else:
        return remind_at.strftime("%d.%m.%Y в %H:%M")


def cmd_add(args):
    text_parts = []
    peer_id = None
    i = 0
    while i < len(args):
        if args[i] in ("--peer", "-p") and i + 1 < len(args):
            try:
                peer_id = int(args[i + 1])
            except ValueError:
                print(f"Ошибка: некорректный peer_id «{args[i+1]}»")
                sys.exit(1)
            i += 2
        else:
            text_parts.append(args[i])
            i += 1

    if peer_id is None:
        print("Ошибка: укажи --peer PEER_ID")
        sys.exit(1)

    full_text = " ".join(text_parts).strip()
    if not full_text:
        print("Ошибка: укажи текст напоминания")
        sys.exit(1)

    # Проверяем адресата ("для Солнца", "для Любы" и т.п.)
    target_peer_id, full_text, recipient_name = resolve_recipient(full_text, peer_id)

    content, remind_at = parse_add_args(full_text)

    if not content:
        print("Ошибка: не указан текст напоминания")
        sys.exit(1)

    if remind_at is None:
        print(
            "⚠️ Не понял время. Примеры:\n"
            "• «напомни через 30 минут купить молоко»\n"
            "• «напомни в 18:30 позвонить врачу»\n"
            "• «напомни завтра в 9:00 встреча»\n"
            "• «напомни через 2 часа проверить почту»\n"
            "• «напомни на 23 апреля встреча с врачом»\n"
            "• «напомни на 5 мая в 10:00 встреча»"
        )
        sys.exit(1)

    now_str = now_local().strftime("%Y-%m-%d %H:%M")
    remind_str = remind_at.strftime("%Y-%m-%d %H:%M")

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO reminders (text, peer_id, remind_at, created) VALUES (?, ?, ?, ?)",
        (content, target_peer_id, remind_str, now_str)
    )
    rid = cur.lastrowid
    conn.commit()
    conn.close()

    if recipient_name:
        print(
            f"⏰ Напоминание #{rid} установлено для {recipient_name}\n"
            f"📅 {human_delta(remind_at)} ({remind_str})\n"
            f"📝 {content[:100]}"
        )
    else:
        print(
            f"⏰ Напоминание #{rid} установлено\n"
            f"📅 {human_delta(remind_at)} ({remind_str})\n"
            f"📝 {content[:100]}"
        )


def cmd_list(args):
    peer_id = None
    limit = 10
    i = 0
    while i < len(args):
        if args[i] in ("--peer", "-p") and i + 1 < len(args):
            try:
                peer_id = int(args[i + 1])
            except ValueError:
                pass
            i += 2
        elif args[i] in ("--limit", "-n") and i + 1 < len(args):
            try:
                limit = int(args[i + 1])
            except ValueError:
                pass
            i += 2
        else:
            i += 1

    conn = get_db()
    if peer_id:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE peer_id=? AND sent=0 ORDER BY remind_at LIMIT ?",
            (peer_id, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE sent=0 ORDER BY remind_at LIMIT ?",
            (limit,)
        ).fetchall()
    conn.close()

    if not rows:
        print("⏰ Активных напоминаний нет.")
        return

    now = now_local()
    active = []
    overdue = []
    for r in rows:
        remind_dt = datetime.strptime(r['remind_at'], "%Y-%m-%d %H:%M")
        if remind_dt < now:
            overdue.append((r, remind_dt))
        else:
            active.append((r, remind_dt))

    lines = []
    if active:
        lines.append(f"⏰ Напоминания ({len(active)}):")
        for r, remind_dt in active:
            lines.append(f"  #{r['id']} [{human_delta(remind_dt)}] {r['text'][:70]}")
    if overdue:
        if active:
            lines.append("")
        lines.append(f"⚠️ Просроченные ({len(overdue)}) — удали: «удали напоминание #N»:")
        for r, remind_dt in overdue:
            lines.append(f"  #{r['id']} [{remind_dt.strftime('%d.%m в %H:%M')}] {r['text'][:70]}")
    if not lines:
        lines = ["⏰ Активных напоминаний нет."]
    print("\n".join(lines))


def cmd_delete(args):
    if not args:
        print("Ошибка: укажи ID напоминания")
        sys.exit(1)
    try:
        rid = int(args[0].lstrip("#"))
    except ValueError:
        print(f"Ошибка: некорректный ID «{args[0]}»")
        sys.exit(1)

    conn = get_db()
    row = conn.execute("SELECT * FROM reminders WHERE id=?", (rid,)).fetchone()
    if not row:
        print(f"Напоминание #{rid} не найдено.")
        conn.close()
        return
    conn.execute("DELETE FROM reminders WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    print(f"🗑️ Напоминание #{rid} удалено: {row['text'][:60]}")


def cmd_check(_args):
    """Вызывается cron каждую минуту. Отправляет просроченные напоминания."""
    from datetime import timedelta
    conn = get_db()
    now_str = now_local().strftime("%Y-%m-%d %H:%M")

    # Авто-очистка: пометить sent=1 для напоминаний старше 24ч
    stale_threshold = (now_local() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M")
    stale = conn.execute(
        "SELECT id, text FROM reminders WHERE sent=0 AND remind_at < ?",
        (stale_threshold,)
    ).fetchall()
    for r in stale:
        conn.execute("UPDATE reminders SET sent=1 WHERE id=?", (r["id"],))
        print(f"[{now_str}] Auto-expired #{r['id']}: {r['text'][:40]}")
    if stale:
        conn.commit()

    due = conn.execute(
        "SELECT * FROM reminders WHERE sent=0 AND remind_at <= ?",
        (now_str,)
    ).fetchall()

    if not due:
        conn.close()
        return

    token = get_vk_token()
    if not token:
        sys.stderr.write("No VK token found, cannot send reminders\n")
        conn.close()
        sys.exit(1)

    for r in due:
        msg = f"⏰ Напоминание #{r['id']}\n{r['text']}"
        ok = vk_send(r['peer_id'], msg, token)
        if ok:
            conn.execute("UPDATE reminders SET sent=1 WHERE id=?", (r['id'],))
            conn.commit()
            print(f"[{now_str}] Sent #{r['id']} → {r['peer_id']}: {r['text'][:50]}")
        else:
            sys.stderr.write(f"Failed to send reminder #{r['id']}\n")

    conn.close()


def cmd_setup_cron(_args):
    """Добавляет cron-запись для проверки напоминаний каждую минуту."""
    script = os.path.abspath(__file__)
    cron_line = f"* * * * * python3 {script} check >> /var/log/openclaw-reminders.log 2>&1"
    try:
        import subprocess
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        existing = result.stdout if result.returncode == 0 else ""
        if script in existing:
            print("✅ Cron для напоминаний уже настроен.")
            return
        new_cron = existing.rstrip("\n") + "\n" + cron_line + "\n"
        proc = subprocess.run(["crontab", "-"], input=new_cron, text=True, capture_output=True)
        if proc.returncode == 0:
            print(f"✅ Cron настроен:\n{cron_line}")
        else:
            print(f"⚠️ Добавь вручную (crontab -e):\n{cron_line}")
    except Exception as e:
        print(f"⚠️ Добавь вручную (crontab -e):\n{cron_line}\nОшибка: {e}")


COMMANDS = {
    "add": cmd_add,
    "list": cmd_list,
    "delete": cmd_delete,
    "check": cmd_check,
    "setup-cron": cmd_setup_cron,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Использование: reminders.py [{'/'.join(COMMANDS)}] ...")
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
