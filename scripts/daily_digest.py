#!/usr/bin/env python3
"""
Ежедневный дайджест — сводка дня через VK API
Включает: погода, день недели, заметки, напоминания, заказы Ozon на сегодня, список дел.

Расписание:
  Рабочий день (пн-пт, не праздник) → 07:00 UTC+5 (2:00 UTC)
  Выходной / праздник               → 10:00 UTC+5 (5:00 UTC)

Производственный календарь: isdayoff.ru (бесплатно, без ключа)
Кэш: /opt/openclaw-notes/calendar_YYYY_MM.json (обновляется раз в месяц)

Использование:
  daily_digest.py --peer PEER_ID [--workday-only] [--holiday-only]
  daily_digest.py setup-cron --peer PEER_ID
  daily_digest.py is-workday        ← выводит WORKDAY или HOLIDAY и код 0/1
"""

import sys
import os
import json
import sqlite3
import urllib.request
import urllib.parse
import urllib.error
import random
import re
import subprocess
from datetime import datetime, timedelta, timezone

TZ_OFFSET = timedelta(hours=5)

def now_local() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) + TZ_OFFSET

NOTES_DB     = os.environ.get("NOTES_DB",     "/opt/openclaw-notes/notes.db")
REMINDERS_DB = os.environ.get("REMINDERS_DB", "/opt/openclaw-notes/reminders.db")
TODOS_DB     = os.environ.get("TODOS_DB",     "/opt/openclaw-notes/todos.db")
OPENCLAW_CFG = os.environ.get("OPENCLAW_CFG", "/root/.openclaw/openclaw.json")
STUDIO_CFG   = os.environ.get("STUDIO_CFG", "/opt/myapp/config/config.env")
CALENDAR_DIR = "/opt/openclaw-notes"

# ── Производственный календарь (isdayoff.ru) ────────────────────────────────

def _calendar_path(year: int, month: int) -> str:
    return os.path.join(CALENDAR_DIR, f"calendar_{year:04d}_{month:02d}.json")


def _fetch_month_calendar(year: int, month: int) -> list:
    """
    Возвращает список 0/1 для каждого дня месяца.
    0 = рабочий день, 1 = выходной/праздник.
    Источник: isdayoff.ru
    """
    url = f"https://isdayoff.ru/api/getdata?year={year}&month={month:02d}&cc=ru&pre=0"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            text = r.read().decode().strip()
        days = [int(c) for c in text if c in "01"]
        return days
    except Exception as e:
        sys.stderr.write(f"[calendar] fetch error: {e}\n")
        return []


def get_month_calendar(year: int, month: int) -> list:
    """Возвращает кэшированный или свежезагруженный календарь месяца."""
    path = _calendar_path(year, month)
    now  = now_local()

    # Читаем кэш
    if os.path.exists(path):
        try:
            with open(path) as f:
                cached = json.load(f)
            cached_at = datetime.fromisoformat(cached.get("fetched_at", "2000-01-01"))
            # Обновляем: раз в месяц или если кэш старше 32 дней
            if (now - cached_at).days < 32:
                return cached["days"]
        except Exception:
            pass

    # Загружаем свежий
    days = _fetch_month_calendar(year, month)
    if days:
        try:
            with open(path, "w") as f:
                json.dump({"fetched_at": now.isoformat(), "year": year, "month": month, "days": days}, f)
        except Exception:
            pass
        return days

    # Fallback: считаем по дням недели (без учёта праздников)
    import calendar
    _, ndays = calendar.monthrange(year, month)
    result = []
    for d in range(1, ndays + 1):
        wd = datetime(year, month, d).weekday()
        result.append(1 if wd >= 5 else 0)
    return result


def is_workday(dt: datetime = None) -> bool:
    """True если dt — рабочий день по производственному календарю РФ."""
    if dt is None:
        dt = now_local()
    days = get_month_calendar(dt.year, dt.month)
    idx  = dt.day - 1
    if idx >= len(days):
        return dt.weekday() < 5
    return days[idx] == 0


# ── Погода ───────────────────────────────────────────────────────────────────

WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude=51.7727&longitude=55.0988"
    "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m"
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
    "&timezone=Asia%2FYekaterinburg"
    "&forecast_days=1"
)

WMO_CODES = {
    0:  "☀️ Ясно",         1:  "🌤️ Преим. ясно",    2:  "⛅ Перем. облачность",
    3:  "☁️ Пасмурно",    45: "🌫️ Туман",           48: "🌫️ Изморозь",
    51: "🌦️ Лёгкая морось",53: "🌦️ Морось",         55: "🌧️ Сильная морось",
    61: "🌧️ Небольшой дождь",63:"🌧️ Дождь",         65: "🌧️ Сильный дождь",
    71: "❄️ Небольшой снег",73:"❄️ Снег",            75: "❄️ Сильный снег",
    77: "🌨️ Снежная крупа",80:"🌦️ Ливень",          81: "🌧️ Сильный ливень",
    82: "⛈️ Очень сильный ливень",85:"🌨️ Снежный ливень",86:"🌨️ Сильный снежный ливень",
    95: "⛈️ Гроза",        96: "⛈️ Гроза с градом", 99: "⛈️ Сильная гроза с градом",
}

def get_weather_wttr() -> str:
    """Резервный источник — wttr.in (работает стабильнее с KZ IP)."""
    WTTR_DESC = {
        "Sunny": "☀️ Солнечно", "Clear": "☀️ Ясно",
        "Partly cloudy": "🌤️ Перем. облачность", "Cloudy": "☁️ Облачно",
        "Overcast": "☁️ Пасмурно", "Mist": "🌫️ Туман", "Fog": "🌫️ Туман",
        "Light rain": "🌦️ Небольшой дождь", "Moderate rain": "🌧️ Дождь",
        "Heavy rain": "🌧️ Сильный дождь", "Light snow": "❄️ Небольшой снег",
        "Moderate snow": "❄️ Снег", "Heavy snow": "❄️ Сильный снег",
        "Thundery outbreaks": "⛈️ Гроза", "Blizzard": "🌨️ Метель",
        "Light sleet": "🌨️ Мокрый снег", "Patchy rain possible": "🌦️ Местами дождь",
        "Patchy snow possible": "🌨️ Местами снег",
    }
    url = "https://wttr.in/%D0%9E%D1%80%D0%B5%D0%BD%D0%B1%D1%83%D1%80%D0%B3?format=j1"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    c = data["current_condition"][0]
    w = data["weather"][0]
    temp  = int(c["temp_C"])
    feels = int(c["FeelsLikeC"])
    wind  = int(c["windspeedKmph"])
    desc_en = c["weatherDesc"][0]["value"]
    desc  = WTTR_DESC.get(desc_en, desc_en)
    t_max = int(w["maxtempC"])
    t_min = int(w["mintempC"])
    line  = f"{desc}, {temp:+}°C (ощущается {feels:+}°C)"
    det   = f"Днём {t_min:+}…{t_max:+}°C, ветер {wind} км/ч"
    return f"{line}\n  {det}"


def get_weather() -> str:
    # Пробуем Open-Meteo, при ошибке — wttr.in
    try:
        req = urllib.request.Request(WEATHER_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        c     = data["current"]
        d     = data["daily"]
        temp  = round(c["temperature_2m"])
        feels = round(c["apparent_temperature"])
        wind  = round(c["wind_speed_10m"])
        code  = int(c["weather_code"])
        t_max = round(d["temperature_2m_max"][0])
        t_min = round(d["temperature_2m_min"][0])
        precip = round(d["precipitation_sum"][0], 1)
        desc   = WMO_CODES.get(code, "Погода неизвестна")
        line   = f"{desc}, {temp:+}°C (ощущается {feels:+}°C)"
        det    = f"Днём {t_min:+}…{t_max:+}°C, ветер {wind} км/ч"
        if precip > 0:
            det += f", осадки {precip} мм"
        return f"{line}\n  {det}"
    except Exception:
        pass
    # Fallback: wttr.in
    try:
        return get_weather_wttr()
    except Exception as e:
        return f"Погода недоступна ({e})"

# ── День недели + мотивация ──────────────────────────────────────────────────

WEEKDAYS_RU = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

DAILY_PHRASES = [
    ["Понедельник — начало новых побед! 💪",
     "Свежая неделя, свежие возможности! 🚀",
     "Понедельник задаёт тон всей неделе. Сделай его сильным! ⚡"],
    ["Вторник — набираем обороты! 🔥",
     "Продуктивный вторник — ключ к успешной неделе! 🎯",
     "Вторник: всё по плану, всё по делу! ✅"],
    ["Среда — половина пути позади! 🏁",
     "Экватор недели — держи темп! 💫",
     "Среда: время для важных решений! 🧠"],
    ["Четверг — финишная прямая! 🏃",
     "До выходных один шаг — дожми! 💪",
     "Четверг: энергия для рывка! ⚡"],
    ["Пятница! Закончи неделю на высокой ноте 🎵",
     "Последний рабочий день — сделай больше! 🚀",
     "Пятница — время итогов и планов! 📋"],
    ["Суббота — время восстанавливать силы! 🌟",
     "Выходной: заряди батарейки на неделю! 🔋",
     "Суббота: работай над собой, не над задачами 😊"],
    ["Воскресенье — готовься к новым победам! 🎯",
     "Последний день отдыха — используй мудро! ✨",
     "Воскресенье: план на неделю уже в голове? 📝"],
]

HOLIDAY_PHRASES = [
    "Сегодня праздничный день — отдыхай! 🎉",
    "Выходной по производственному календарю. Заслуженный отдых! 🛋️",
    "Праздник! Студия отдыхает 🐺",
]

def get_day_greeting(workday: bool) -> str:
    now  = now_local()
    wd   = now.weekday()
    day  = WEEKDAYS_RU[wd]
    date_str = now.strftime("%d.%m.%Y")

    # Праздник в будний день — особая фраза
    if not workday and wd < 5:
        phrase = random.choice(HOLIDAY_PHRASES)
    else:
        phrase = random.choice(DAILY_PHRASES[wd])

    return f"{day}, {date_str}\n{phrase}"

# ── Заказы Ozon на сегодня ───────────────────────────────────────────────────

def _load_ozon_creds():
    creds = {}
    try:
        with open(STUDIO_CFG) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                creds[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return creds.get("OZON_CLIENT_ID", ""), creds.get("OZON_API_KEY", "")

OZON_STATUSES_NEED_ACTION = {
    "awaiting_packaging": "📦 Нужна сборка",
    "awaiting_deliver":   "🚚 Ждёт отгрузки",
}

def get_today_orders() -> str:
    client_id, api_key = _load_ozon_creds()
    if not client_id or not api_key:
        return "⚙️ Ozon API не настроен"

    headers = {
        "Client-Id": client_id, "Api-Key": api_key,
        "Content-Type": "application/json",
    }
    today     = datetime.utcnow().strftime("%Y-%m-%dT23:59:59.000Z")
    since_30d = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00.000Z")

    try:
        body = json.dumps({"dir": "ASC", "filter": {"since": since_30d, "to": today, "status": ""},
                           "limit": 100, "offset": 0}).encode()
        req = urllib.request.Request(
            "https://api-seller.ozon.ru/v3/posting/fbs/list",
            data=body, headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        return f"Ozon API недоступен ({e})"

    postings    = data.get("result", {}).get("postings", [])
    today_local = now_local().strftime("%Y-%m-%d")

    actionable = []
    for p in postings:
        if p.get("status", "") not in OZON_STATUSES_NEED_ACTION:
            continue
        ship_date = p.get("shipment_date", "")[:10]
        if ship_date and ship_date > today_local:
            continue
        actionable.append(p)

    if not actionable:
        pending = [p for p in postings if p.get("status") in OZON_STATUSES_NEED_ACTION]
        if pending:
            return f"📦 Срочных Ozon заказов нет, но есть {len(pending)} ожидающих"
        return "📦 Срочных заказов Ozon нет"

    lines = [f"📦 Ozon — нужно отгрузить сегодня ({len(actionable)} шт):"]
    for p in actionable[:10]:
        num   = p.get("posting_number", "—")
        status = OZON_STATUSES_NEED_ACTION.get(p.get("status", ""), "")
        items = ", ".join(pr.get("offer_id", "?") for pr in p.get("products", [])[:3])
        ship  = p.get("shipment_date", "")[:10]
        lines.append(f"  {status} {num}")
        lines.append(f"    {items}" + (f" | до {ship}" if ship else ""))
    if len(actionable) > 10:
        lines.append(f"  … и ещё {len(actionable) - 10}")
    return "\n".join(lines)

# ── Очередь печати ───────────────────────────────────────────────────────────

STUDIO_DIR = os.environ.get("APP_DIR", "/opt/myapp")

def get_print_queue() -> str:
    try:
        sys.path.insert(0, STUDIO_DIR)
        from inventory.print_queue import PrintQueueManager
        pqm      = PrintQueueManager()
        printing = pqm.get_queue("printing")
        pending  = pqm.get_queue("pending")
    except Exception as e:
        return f"🖨️ Очередь печати недоступна ({e})"

    lines = []

    if printing:
        lines.append(f"🖨️ Печатается сейчас ({len(printing)}):")
        for r in printing[:3]:
            title = (r.get("title_ru") or r.get("offer_id", "?"))[:35]
            lines.append(f"  ▶ {r['offer_id']}  x{r['qty']}  ~{r['est_hours']:.0f}ч  {title}")

    if not pending:
        if not printing:
            return "🖨️ Очередь печати пуста"
        return "\n".join(lines)

    total_h = sum(r.get("est_hours") or 0 for r in pending)
    stockout = [r for r in pending if r.get("reason") == "stockout"]
    below    = [r for r in pending if r.get("reason") == "below_rop"]

    lines.append(f"🖨️ Очередь печати: {len(pending)} задач (~{total_h:.0f}ч)")
    if stockout:
        lines.append(f"  🔴 Нет в наличии ({len(stockout)} SKU):")
        for r in stockout[:4]:
            title = (r.get("title_ru") or "")[:30]
            lines.append(f"    {r['offer_id']:<12} x{r['qty']}  ~{r['est_hours']:.0f}ч  {title}")
        if len(stockout) > 4:
            lines.append(f"    … и ещё {len(stockout) - 4}")
    if below:
        lines.append(f"  🟡 Ниже точки заказа ({len(below)} SKU):")
        for r in below[:3]:
            title = (r.get("title_ru") or "")[:30]
            lines.append(f"    {r['offer_id']:<12} x{r['qty']}  stock={r['stock']}  {title}")
        if len(below) > 3:
            lines.append(f"    … и ещё {len(below) - 3}")

    return "\n".join(lines)

# ── Список дел ───────────────────────────────────────────────────────────────

def get_todos() -> str:
    try:
        conn = sqlite3.connect(TODOS_DB)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, text FROM todos WHERE done=0 ORDER BY id ASC LIMIT 20"
        ).fetchall()
        conn.close()
    except Exception:
        return ""
    if not rows:
        return "✅ Список дел пуст"
    lines = [f"✅ Дела ({len(rows)} шт):"]
    for r in rows:
        lines.append(f"  #{r['id']} {r['text'][:75]}")
    return "\n".join(lines)

# ── Заметки за сегодня ───────────────────────────────────────────────────────

def get_notes_today() -> str:
    today_str = now_local().strftime("%Y-%m-%d")
    try:
        conn = sqlite3.connect(NOTES_DB)
        conn.row_factory = sqlite3.Row
        today_notes = conn.execute(
            "SELECT id, content, tags FROM notes WHERE created LIKE ? ORDER BY id DESC",
            (f"{today_str}%",)
        ).fetchall()
        total = conn.execute("SELECT COUNT(*) AS c FROM notes").fetchone()["c"]
        conn.close()
    except Exception:
        return ""
    if not today_notes:
        return f"📝 Заметок сегодня нет (всего в базе: {total})"
    lines = [f"📝 Заметки сегодня ({len(today_notes)} из {total}):"]
    for n in today_notes[:5]:
        tag = f" [{n['tags']}]" if n['tags'] else ""
        lines.append(f"  #{n['id']}{tag} {n['content'][:65]}")
    if len(today_notes) > 5:
        lines.append(f"  … и ещё {len(today_notes) - 5}")
    return "\n".join(lines)

# ── Напоминания ──────────────────────────────────────────────────────────────

def get_reminders_today(peer_id: int, hours: int = 24) -> str:
    now      = now_local()
    now_str  = now.strftime("%Y-%m-%d %H:%M")
    deadline = (now + timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M")
    try:
        conn = sqlite3.connect(REMINDERS_DB)
        conn.row_factory = sqlite3.Row
        upcoming = conn.execute(
            "SELECT * FROM reminders WHERE sent=0 AND peer_id=? AND remind_at BETWEEN ? AND ?"
            " ORDER BY remind_at",
            (peer_id, now_str, deadline)
        ).fetchall()
        overdue = conn.execute(
            "SELECT COUNT(*) AS c FROM reminders WHERE sent=0 AND peer_id=? AND remind_at < ?",
            (peer_id, now_str)
        ).fetchone()["c"]
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM reminders WHERE sent=0 AND peer_id=?",
            (peer_id,)
        ).fetchone()["c"]
        conn.close()
    except Exception:
        return ""
    lines = [f"⏰ Напоминания на {hours}ч ({len(upcoming)} шт):"]
    if upcoming:
        for r in upcoming:
            dt = datetime.strptime(r['remind_at'], "%Y-%m-%d %H:%M")
            lines.append(f"  {dt.strftime('%H:%M')} — {r['text'][:65]}")
    else:
        lines.append("  Нет")
    if overdue:
        lines.append(f"  ⚠️ Просрочено: {overdue}")
    if total > len(upcoming):
        lines.append(f"  Всего активных: {total}")
    return "\n".join(lines)

# ── Сборка дайджеста ─────────────────────────────────────────────────────────

def build_digest(peer_id: int, hours: int = 24) -> str:
    SEP     = "━" * 28
    workday = is_workday()
    blocks  = []

    blocks.append(get_day_greeting(workday))
    blocks.append(SEP)
    blocks.append("🌤️ Погода · Оренбург\n  " + get_weather().replace("\n", "\n  "))

    orders = get_today_orders()
    if orders:
        blocks.append(orders)

    print_q = get_print_queue()
    if print_q:
        blocks.append(print_q)

    todos = get_todos()
    if todos:
        blocks.append(todos)

    blocks.append(SEP)

    rem = get_reminders_today(peer_id, hours)
    if rem:
        blocks.append(rem)

    notes = get_notes_today()
    if notes:
        blocks.append(notes)

    blocks.append(SEP)
    blocks.append("Хорошего дня! 🐺" if workday else "Хороших выходных! 🐺")
    return "\n\n".join(blocks)

# ── VK ───────────────────────────────────────────────────────────────────────

def get_vk_token():
    try:
        with open(OPENCLAW_CFG) as f:
            cfg = json.load(f)
        vk  = cfg.get("channels", {}).get("vk", {})
        tok = vk.get("token", "").strip()
        if not tok:
            for acc in vk.get("accounts", {}).values():
                tok = acc.get("token", "").strip()
                if tok:
                    break
        return tok
    except Exception as e:
        sys.stderr.write(f"Config read error: {e}\n")
        return ""


def vk_send(peer_id: int, message: str, token: str) -> bool:
    params = {
        "peer_id":   str(peer_id),
        "message":   message,
        "random_id": str(random.randint(0, 2147483647)),
        "v":         "5.199",
        "access_token": token,
    }
    data = urllib.parse.urlencode(params).encode()
    try:
        req = urllib.request.Request(
            "https://api.vk.com/method/messages.send",
            data=data, method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            return "error" not in result
    except Exception as e:
        sys.stderr.write(f"VK send error: {e}\n")
        return False

# ── Точка входа ──────────────────────────────────────────────────────────────

def main():
    peer_id      = None
    hours        = 24
    workday_only = False
    holiday_only = False
    setup_cron   = False
    check_day    = False

    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg in ("--peer", "-p") and i + 1 < len(sys.argv):
            try: peer_id = int(sys.argv[i + 1])
            except ValueError: pass
            i += 2
        elif arg == "--hours" and i + 1 < len(sys.argv):
            try: hours = int(sys.argv[i + 1])
            except ValueError: pass
            i += 2
        elif arg == "--workday-only":
            workday_only = True; i += 1
        elif arg == "--holiday-only":
            holiday_only = True; i += 1
        elif arg == "setup-cron":
            setup_cron = True; i += 1
        elif arg == "is-workday":
            check_day = True; i += 1
        else:
            i += 1

    # Только проверить тип дня
    if check_day:
        wd = is_workday()
        print("WORKDAY" if wd else "HOLIDAY")
        sys.exit(0 if wd else 1)

    # Настройка cron
    if setup_cron:
        if not peer_id:
            print("Укажи --peer PEER_ID")
            sys.exit(1)
        script = os.path.abspath(__file__)
        # 7:00 UTC+5 = 2:00 UTC — рабочий день
        cron_work    = f"0 2 * * 1-5 python3 {script} --peer {peer_id} --workday-only >> /var/log/openclaw-digest.log 2>&1"
        # 10:00 UTC+5 = 5:00 UTC — выходной/праздник (все дни, скрипт сам проверяет)
        cron_holiday = f"0 5 * * * python3 {script} --peer {peer_id} --holiday-only >> /var/log/openclaw-digest.log 2>&1"
        try:
            result   = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
            existing = result.stdout if result.returncode == 0 else ""
            # Убираем старые записи дайджеста
            lines = [l for l in existing.splitlines() if "daily_digest" not in l]
            lines += [cron_work, cron_holiday]
            new_cron = "\n".join(lines) + "\n"
            proc = subprocess.run(["crontab", "-"], input=new_cron, text=True, capture_output=True)
            if proc.returncode == 0:
                print("✅ Cron дайджеста настроен:")
                print(f"  Рабочий день: {cron_work}")
                print(f"  Выходной:     {cron_holiday}")
            else:
                print(f"⚠️ Ошибка crontab: {proc.stderr}")
        except Exception as e:
            print(f"⚠️ Ошибка: {e}")
            print(f"Добавь вручную:\n{cron_work}\n{cron_holiday}")
        return

    if not peer_id:
        print("Укажи --peer PEER_ID")
        sys.exit(1)

    # Проверяем тип дня
    today_is_workday = is_workday()

    if workday_only and not today_is_workday:
        print(f"[{now_local().strftime('%Y-%m-%d')}] Сегодня выходной — пропускаем рабочий дайджест")
        sys.exit(0)

    if holiday_only and today_is_workday:
        print(f"[{now_local().strftime('%Y-%m-%d')}] Сегодня рабочий день — пропускаем выходной дайджест")
        sys.exit(0)

    token = get_vk_token()
    if not token:
        print("Ошибка: VK токен не найден")
        sys.exit(1)

    digest = build_digest(peer_id, hours)
    ok     = vk_send(peer_id, digest, token)
    ts     = now_local().strftime("%Y-%m-%d %H:%M")
    day_type = "рабочий" if today_is_workday else "выходной"
    if ok:
        print(f"[{ts}] ✅ Дайджест ({day_type}) отправлен → {peer_id}")
    else:
        print(digest)
        sys.exit(1)


if __name__ == "__main__":
    main()
