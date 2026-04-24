#!/usr/bin/env python3
# === Великий Мудрец — Session Manager ===
# Manages discussion sessions: save, list, archive, report generation
# Storage: SQLite at /opt/openclaw-sage/sage.db
# Usage:
#   sage.py ask <peer_id> <question>        — query all LLMs + synthesize
#   sage.py list <peer_id>                  — list sessions for user
#   sage.py resume <session_id>             — get session messages for context
#   sage.py archive_list <peer_id>          — list archived sessions
#   sage.py archive_get <session_id>        — get archived session summary
#   sage.py report_text <session_id>        — export session as text doc
#   sage.py report_table <session_id>       — export as markdown table
#   sage.py report_chart <session_id>       — generate consensus chart PNG
#   sage.py close <session_id>             — archive active session
#   sage.py delete <session_id>             — delete session
#   sage.py get_mode <peer_id>              — show current mode
#   sage.py set_mode <peer_id> <auto|multi> — switch mode

import sys
import os
import json
import sqlite3
import textwrap
import urllib.request
import urllib.error
from datetime import datetime

DB_PATH = "/opt/openclaw-sage/sage.db"
REPORTS_DIR = "/opt/openclaw-sage/reports"
REPORT_GEN  = "/opt/browser-bridge/report-generator.js"
BRIDGE_URL = "http://127.0.0.1:7788"
CEREBRAS_KEY = os.environ.get("CEREBRAS_KEY", "")
CEREBRAS_MODEL = "llama3.1-8b"
MAX_CHARS_PER_LLM = 400
MAX_SESSIONS_SHOWN = 8

# ── Режимы работы ─────────────────────────────────────────────────────────────
# auto  — авто-выбор лучшей модели под тип задачи (по умолчанию)
# multi — несколько моделей одного провайдера (медленнее, дороже по ресурсам)

# Ключевые слова для определения типа задачи
_TASK_KEYWORDS = {
    "code": [
        "код", "скрипт", "функци", "класс", "алгоритм", "программ",
        "python", "javascript", "typescript", "sql", "bash", "shell",
        "баг", "ошибк", "debug", "деплой", "deploy", "api", "библиотек",
        "реализ", "напиши код", "написать функцию", "рефактор",
    ],
    "math": [
        "вычисли", "реши", "уравнение", "математик",
        "формул", "интеграл", "производн", "матриц", "вектор",
        "вероятность", "статистик", "расчёт", "посчитай", "докажи теорему",
    ],
    "reasoning": [
        "почему", "объясни логик", "докажи", "аргумент",
        "парадокс", "противоречие", "умозаключение", "критическ",
        "проанализируй", "сравни", "оцени преимущества", "выведи",
    ],
    "creative": [
        "напиши рассказ", "придумай", "история", "стихотворение",
        "сценарий", "текст для", "слоган", "заголовок для поста",
        "контент", "идеи для", "копирайт",
    ],
    "search": [
        "новости", "сегодня", "актуальн", "последн новост",
        "что случилось", "кто выиграл", "текущий курс", "свежий",
        "когда произошло",
    ],
}

# Авто-режим: какие LLM (с моделями) лучше для каждого типа задачи
_AUTO_HINTS = {
    "code":      ["deepseek:r1", "qwen:coder", "mistral:codestral", "chatgpt", "claude", "perplexity"],
    "math":      ["deepseek:r1", "qwen:qwq",   "chatgpt",           "mistral", "claude", "perplexity"],
    "reasoning": ["deepseek:r1", "qwen:qwq",   "chatgpt",           "claude",  "mistral","perplexity"],
    "creative":  ["chatgpt",     "claude",      "qwen",              "mistral", "deepseek","perplexity"],
    "search":    ["perplexity",  "chatgpt",     "deepseek",          "qwen",    "claude",  "mistral"],
    "general":   ["deepseek",    "chatgpt",     "claude",            "perplexity","mistral","qwen"],
}

# Мульти-режим: все доступные модели у всех провайдеров
_MULTI_LLMS = [
    "deepseek",     # V3 — быстрый, общий
    "deepseek:r1",  # R1 — reasoning, медленнее
    "chatgpt",      # GPT-4o
    "qwen",         # Qwen-Max
    "qwen:qwq",     # QwQ-32B — reasoning
    "claude",       # Claude Haiku
    "perplexity",   # Sonar
    "mistral",      # Mistral Large
]

# Мульти-режим с учётом типа задачи (оптимизируем порядок)
_MULTI_HINTS = {
    "code":      ["deepseek:r1","deepseek","qwen:coder","qwen","mistral:codestral","chatgpt","claude","perplexity"],
    "math":      ["deepseek:r1","deepseek","qwen:qwq","qwen","chatgpt","mistral","claude","perplexity"],
    "reasoning": ["deepseek:r1","deepseek","qwen:qwq","qwen","chatgpt","claude","mistral","perplexity"],
    "creative":  ["chatgpt","claude","qwen","qwen:qwq","mistral","deepseek","deepseek:r1","perplexity"],
    "search":    ["perplexity","chatgpt","deepseek","deepseek:r1","qwen","claude","mistral","qwen:qwq"],
    "general":   _MULTI_LLMS,
}

_TASK_LABELS = {
    "code":      "код",
    "math":      "математика",
    "reasoning": "логика/анализ",
    "creative":  "творчество",
    "search":    "поиск/новости",
    "general":   "общий",
}

_MODE_LABELS = {
    "auto":  "🤖 Авто",
    "multi": "🔬 Мульти",
}

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)


# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id          TEXT PRIMARY KEY,
            peer_id     INTEGER NOT NULL,
            title       TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            archived    INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT NOT NULL REFERENCES sessions(id),
            question    TEXT NOT NULL,
            responses   TEXT NOT NULL,
            synthesis   TEXT NOT NULL,
            asked_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS peer_settings (
            peer_id    INTEGER PRIMARY KEY,
            sage_mode  TEXT NOT NULL DEFAULT 'auto',
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_peer ON sessions(peer_id, archived, updated_at);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    """)
    conn.commit()
    return conn


def new_id():
    import uuid
    return uuid.uuid4().hex[:8]


def now():
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Режим и тип задачи ───────────────────────────────────────────────────────

def get_peer_mode(conn, peer_id):
    """Получить текущий режим пользователя (auto по умолчанию)."""
    row = conn.execute(
        "SELECT sage_mode FROM peer_settings WHERE peer_id=?", (peer_id,)
    ).fetchone()
    return row["sage_mode"] if row else "auto"


def set_peer_mode(conn, peer_id, mode):
    """Сохранить режим пользователя."""
    conn.execute(
        "INSERT INTO peer_settings (peer_id, sage_mode, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(peer_id) DO UPDATE SET sage_mode=excluded.sage_mode, updated_at=excluded.updated_at",
        (peer_id, mode, now())
    )
    conn.commit()


def detect_task_type(question):
    """Определить тип задачи по ключевым словам."""
    q = question.lower()
    scores = {t: 0 for t in _TASK_KEYWORDS}
    for task, keywords in _TASK_KEYWORDS.items():
        for kw in keywords:
            if kw in q:
                scores[task] += 1
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def build_llm_list(mode, task_type):
    """Построить список LLM-спецификаций для запроса.

    auto  — 6 моделей, выбранных под тип задачи
    multi — 8 моделей, включая несколько моделей одного провайдера
    """
    if mode == "multi":
        return _MULTI_HINTS.get(task_type, _MULTI_LLMS)
    return _AUTO_HINTS.get(task_type, _AUTO_HINTS["general"])


def llm_display_name(spec):
    """Преобразует 'deepseek:r1' → 'DeepSeek R1', 'chatgpt' → 'ChatGPT' и т.д."""
    names = {
        "deepseek": "DeepSeek V3",
        "deepseek:r1": "DeepSeek R1",
        "chatgpt": "ChatGPT",
        "claude": "Claude",
        "perplexity": "Perplexity",
        "mistral": "Mistral",
        "mistral:codestral": "Codestral",
        "qwen": "Qwen-Max",
        "qwen:qwq": "QwQ-32B",
        "qwen:coder": "Qwen-Coder",
    }
    return names.get(spec, spec)


# ── Bridge HTTP ───────────────────────────────────────────────────────────────

def bridge_post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BRIDGE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def cerebras_chat(messages, max_tokens=700):
    payload = json.dumps({
        "model": CEREBRAS_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(
        "https://api.cerebras.ai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CEREBRAS_KEY}",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    if "error" in result:
        raise RuntimeError(result["error"].get("message", str(result["error"])))
    return result["choices"][0]["message"]["content"]


def truncate(text, max_chars):
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    last_dot = max(cut.rfind(". "), cut.rfind(".\n"))
    if last_dot > max_chars * 0.6:
        return cut[:last_dot + 1]
    return cut + "…"


# ── Core: ask ─────────────────────────────────────────────────────────────────

def cmd_ask(peer_id, question, session_id=None):
    peer_id = int(peer_id)

    # Определяем режим и тип задачи
    conn = get_db()
    mode = get_peer_mode(conn, peer_id)
    conn.close()

    task_type = detect_task_type(question)
    llm_list  = build_llm_list(mode, task_type)

    mode_label = _MODE_LABELS.get(mode, mode)
    task_label = _TASK_LABELS.get(task_type, task_type)

    if mode == "multi":
        print(f"⏳ Мульти-режим активен — опрашиваю {len(llm_list)} моделей. Это займёт 10-15 минут...")
    else:
        print(f"⏳ Авто-режим: задача «{task_label}» — подбираю лучшие модели...")

    # Query LLMs via bridge
    try:
        result = bridge_post("/query-all", {"llms": llm_list, "message": question})
        responses = result.get("responses", [])
    except Exception as e:
        print(f"❌ Ошибка связи с браузером: {e}")
        sys.exit(1)

    # Collect valid responses
    extracts = []
    errors = []
    for r in responses:
        # display name: bridge returns enhanced name like "DeepSeek (R1)" or use our map
        raw_llm = r.get("llm", "?")
        # Find spec from position
        spec_idx = next((i for i, s in enumerate(llm_list) if s == raw_llm or s.split(":")[0] == raw_llm.lower()), -1)
        display = llm_display_name(llm_list[spec_idx]) if spec_idx >= 0 else raw_llm
        if r.get("error"):
            errors.append(f"{display}: недоступен")
            continue
        text = r.get("text", "")
        if len(text) < 10:
            errors.append(f"{display}: пустой ответ")
            continue
        extracts.append({"llm": display, "text": truncate(text, MAX_CHARS_PER_LLM)})

    if not extracts:
        print("❌ Ни одна модель не ответила. Попробуй позже.")
        sys.exit(1)

    # Synthesize with Cerebras
    llm_block = "\n\n".join(f"### {e['llm']}:\n{e['text']}" for e in extracts)
    system_prompt = (
        f"Ты — Великий Мудрец, синтезатор знаний. Тебе дали ответы {len(extracts)} разных ИИ на один вопрос. "
        "Твоя задача:\n"
        "1. Найти консенсус между ответами\n"
        "2. Отметить расхождения если они есть\n"
        "3. Дать чёткий итоговый вывод (3-5 предложений)\n"
        "Отвечай на русском. Будь конкретен и лаконичен."
    )
    user_prompt = f"Вопрос: {question}\n\nОтветы ИИ:\n\n{llm_block}\n\nДай синтез."

    try:
        synthesis = cerebras_chat([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ])
    except Exception as e:
        synthesis = f"[Синтез недоступен: {e}]\n\n" + "\n\n".join(
            f"**{ex['llm']}:** {ex['text']}" for ex in extracts
        )

    # Save to DB
    conn = get_db()
    if not session_id:
        session_id = new_id()
        title = question[:60] + ("…" if len(question) > 60 else "")
        ts = now()
        conn.execute(
            "INSERT INTO sessions (id, peer_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
            (session_id, peer_id, title, ts, ts)
        )
    else:
        conn.execute("UPDATE sessions SET updated_at=? WHERE id=?", (now(), session_id))

    conn.execute(
        "INSERT INTO messages (session_id, question, responses, synthesis, asked_at) VALUES (?,?,?,?,?)",
        (session_id, question, json.dumps(extracts), synthesis, now())
    )
    conn.commit()
    conn.close()

    # Format output
    ok_llms = ", ".join(e["llm"] for e in extracts)
    err_part = f"\n⚠️ Не ответили: {', '.join(errors)}" if errors else ""
    print(f"SESSION_ID:{session_id}")
    print(f"🧙 Великий Мудрец опросил {len(extracts)} ИИ · {mode_label} · задача: {task_label}")
    print(f"Опрошены: {ok_llms}{err_part}\n")
    print(f"**Синтез:**\n{synthesis}")


# ── List sessions ─────────────────────────────────────────────────────────────

def cmd_list(peer_id):
    peer_id = int(peer_id)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, updated_at, "
        "(SELECT COUNT(*) FROM messages WHERE session_id=s.id) AS cnt "
        "FROM sessions s WHERE peer_id=? AND archived=0 "
        "ORDER BY updated_at DESC LIMIT ?",
        (peer_id, MAX_SESSIONS_SHOWN)
    ).fetchall()
    conn.close()

    if not rows:
        print("📭 Нет активных обсуждений.\n\nНажми 🔮 Новый вопрос чтобы начать.")
        return

    lines = ["📚 **Активные обсуждения:**\n"]
    for i, r in enumerate(rows, 1):
        date = r["updated_at"][:10]
        lines.append(f"{i}. [{r['id']}] {r['title']}\n   📅 {date} · 💬 {r['cnt']} вопросов")
    lines.append("\n💡 «продолжи #<id>» — вернуться к обсуждению")
    lines.append("«архив» — посмотреть сохранённые")
    print("\n".join(lines))


# ── Resume session ────────────────────────────────────────────────────────────

def cmd_resume(session_id):
    conn = get_db()
    session = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session:
        print(f"❌ Обсуждение #{session_id} не найдено.")
        conn.close()
        return

    msgs = conn.execute(
        "SELECT question, synthesis, asked_at FROM messages WHERE session_id=? ORDER BY id",
        (session_id,)
    ).fetchall()
    conn.close()

    lines = [f"🧙 Обсуждение: **{session['title']}**\n"]
    for i, m in enumerate(msgs, 1):
        date = m["asked_at"][11:16]
        lines.append(f"❓ [{i}] {m['question'][:80]}")
        lines.append(f"💡 {m['synthesis'][:200]}…\n")
    lines.append(f"SESSION_ID:{session_id}")
    lines.append("Обсуждение продолжено. Задавай следующий вопрос.")
    print("\n".join(lines))


# ── Archive ───────────────────────────────────────────────────────────────────

def cmd_archive_list(peer_id):
    peer_id = int(peer_id)
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, updated_at, "
        "(SELECT COUNT(*) FROM messages WHERE session_id=s.id) AS cnt "
        "FROM sessions s WHERE peer_id=? AND archived=1 "
        "ORDER BY updated_at DESC LIMIT ?",
        (peer_id, MAX_SESSIONS_SHOWN)
    ).fetchall()
    conn.close()

    if not rows:
        print("📭 Архив пуст.")
        return

    lines = ["🗄️ **Архив обсуждений:**\n"]
    for i, r in enumerate(rows, 1):
        date = r["updated_at"][:10]
        lines.append(f"{i}. [{r['id']}] {r['title']}\n   📅 {date} · 💬 {r['cnt']} вопросов")
    lines.append("\n💡 «из архива #<id>» — получить данные из обсуждения")
    print("\n".join(lines))


def cmd_archive_get(session_id):
    conn = get_db()
    session = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session:
        print(f"❌ Обсуждение #{session_id} не найдено.")
        conn.close()
        return

    msgs = conn.execute(
        "SELECT question, synthesis, asked_at FROM messages WHERE session_id=? ORDER BY id",
        (session_id,)
    ).fetchall()
    conn.close()

    lines = [f"🗄️ **Из архива:** {session['title']}\n"]
    for i, m in enumerate(msgs, 1):
        date = m["asked_at"][:10]
        lines.append(f"**Вопрос {i}** ({date}):\n{m['question']}")
        lines.append(f"**Синтез:**\n{m['synthesis'][:300]}…\n")
    print("\n".join(lines))


def cmd_close(session_id):
    conn = get_db()
    conn.execute("UPDATE sessions SET archived=1, updated_at=? WHERE id=?", (now(), session_id))
    conn.commit()
    conn.close()
    print(f"✅ Обсуждение #{session_id} перемещено в архив.")


def cmd_delete(session_id):
    conn = get_db()
    conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
    conn.commit()
    conn.close()
    print(f"🗑️ Обсуждение #{session_id} удалено.")


# ── Reports ───────────────────────────────────────────────────────────────────

def _run_report_generator(command, session_id):
    """Delegate to report-generator.js (Chart.js + Handlebars + Mermaid)."""
    import subprocess
    result = subprocess.run(
        ["node", REPORT_GEN, command, session_id, DB_PATH, REPORTS_DIR],
        capture_output=True, text=True, timeout=60
    )
    output = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    if result.returncode != 0 and not output:
        return f"❌ Ошибка генерации: {err[:300]}"
    if err:
        # Log stderr but don't show to user unless no stdout
        pass
    return output


def cmd_report_text(session_id):
    """Plain text report — still generated in Python (no JS needed)."""
    conn = get_db()
    session = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session:
        print(f"❌ Сессия {session_id} не найдена.")
        conn.close()
        return
    msgs = conn.execute(
        "SELECT * FROM messages WHERE session_id=? ORDER BY id", (session_id,)
    ).fetchall()
    conn.close()

    fname = f"{REPORTS_DIR}/sage_{session_id}_{datetime.utcnow().strftime('%Y%m%d')}.txt"
    sep = "═" * 50
    lines = [
        "ВЕЛИКИЙ МУДРЕЦ — Отчёт об обсуждении", sep,
        f"Тема: {session['title']}", f"ID: {session_id}",
        f"Создано: {session['created_at'][:10]}", f"Обновлено: {session['updated_at'][:10]}",
        f"Вопросов: {len(msgs)}", sep, "",
    ]
    for i, m in enumerate(msgs, 1):
        responses = json.loads(m["responses"])
        lines += [f"── Вопрос {i} ({m['asked_at'][:16]}) ──", m["question"], "", "Ответы ИИ:"]
        for r in responses:
            lines += [f"  [{r['llm']}]", f"  {r['text']}", ""]
        lines += ["Синтез Мудреца:", m["synthesis"], "", "─" * 50, ""]

    os.makedirs(REPORTS_DIR, exist_ok=True)
    with open(fname, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"REPORT_FILE:{fname}")
    print(f"📄 Текстовый отчёт готов\n")
    print("\n".join(lines[:60]))


def cmd_report_table(session_id):
    """Markdown table + HTML report via Handlebars."""
    # Generate Markdown table (Python, instant)
    conn = get_db()
    session = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
    if not session:
        print(f"❌ Сессия {session_id} не найдена.")
        conn.close()
        return
    msgs = conn.execute(
        "SELECT * FROM messages WHERE session_id=? ORDER BY id", (session_id,)
    ).fetchall()
    conn.close()

    os.makedirs(REPORTS_DIR, exist_ok=True)
    md_fname = f"{REPORTS_DIR}/sage_{session_id}_table.md"
    lines = [
        f"# 🧙 Великий Мудрец — {session['title']}", "",
        "| # | Вопрос | DeepSeek | ChatGPT | Claude | Mistral | Perplexity | Qwen | Синтез |",
        "|---|--------|----------|---------|--------|---------|------------|------|--------|",
    ]
    for i, m in enumerate(msgs, 1):
        rm_raw = {r["llm"].lower(): r["text"][:80].replace("|", "\\|").replace("\n", " ")
                  for r in json.loads(m["responses"])}
        def _col(name): return rm_raw.get(name.lower(), "—")
        syn = m["synthesis"][:100].replace("|", "\\|").replace("\n", " ")
        q   = m["question"][:60].replace("|", "\\|")
        row = [str(i), q,
               _col("deepseek"), _col("chatgpt"), _col("claude"),
               _col("mistral"), _col("perplexity"), _col("qwen"), syn]
        lines.append("| " + " | ".join(row) + " |")
    with open(md_fname, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"REPORT_FILE:{md_fname}")

    # Also generate beautiful HTML via report-generator.js
    html_out = _run_report_generator("html", session_id)
    print(html_out)

    print(f"\n📊 Таблица готова")
    print("\n".join(lines))


def cmd_report_chart(session_id):
    """Chart.js bar PNG + Mermaid pie PNG via report-generator.js."""
    conn = get_db()
    session = conn.execute("SELECT id FROM sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if not session:
        print(f"❌ Сессия {session_id} не найдена.")
        return

    # Chart.js bar chart
    out = _run_report_generator("chart", session_id)
    print(out)

    # Mermaid pie diagram
    try:
        out2 = _run_report_generator("mermaid", session_id)
        print(out2)
    except Exception as e:
        print(f"⚠️ Диаграмма: {e}")


# ── Режим ────────────────────────────────────────────────────────────────────

def cmd_get_mode(peer_id):
    peer_id = int(peer_id)
    conn = get_db()
    mode = get_peer_mode(conn, peer_id)
    conn.close()

    lines = [
        f"⚙️ **Режим Великого Мудреца:** {_MODE_LABELS.get(mode, mode)}",
        "",
        "🤖 **Авто-режим** (сейчас активен)" if mode == "auto" else "🤖 **Авто-режим**",
        "  Мудрец сам выбирает лучшие модели под твой вопрос.",
        "  Код → DeepSeek R1 + Qwen-Coder + Codestral",
        "  Логика → DeepSeek R1 + QwQ-32B",
        "  Общий → 6 разных моделей",
        "  Время: 3-7 минут",
        "",
        "🔬 **Мульти-режим** (сейчас активен)" if mode == "multi" else "🔬 **Мульти-режим**",
        "  Опрашивает ВСЕ модели всех провайдеров — в том числе",
        "  по 2 модели у DeepSeek и Qwen (обычную + reasoning).",
        "  Даёт более полный ответ, но требует больше времени",
        "  и ресурсов сервера.",
        "  Время: 10-15 минут",
    ]
    print("\n".join(lines))


def cmd_set_mode(peer_id, mode):
    peer_id = int(peer_id)
    if mode not in ("auto", "multi"):
        print(f"❌ Неизвестный режим: {mode}. Доступны: auto, multi")
        sys.exit(1)

    conn = get_db()
    set_peer_mode(conn, peer_id, mode)
    conn.close()

    if mode == "auto":
        print(
            "✅ Включён **Авто-режим**\n\n"
            "Мудрец будет сам выбирать оптимальные модели под каждый вопрос.\n"
            "Код → DeepSeek R1, логика → QwQ-32B, и т.д.\n"
            "Время ответа: 3-7 минут."
        )
    else:
        print(
            "✅ Включён **Мульти-режим**\n\n"
            "Мудрец будет опрашивать все доступные модели,\n"
            "включая несколько моделей одного провайдера.\n"
            "⚠️ Это требует больше времени (10-15 минут)\n"
            "и больше ресурсов сервера."
        )


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: sage.py <command> [args...]")
        sys.exit(1)

    cmd = args[0]

    if cmd == "ask" and len(args) >= 3:
        session_id = args[3] if len(args) > 3 else None
        cmd_ask(args[1], args[2], session_id)
    elif cmd == "list" and len(args) >= 2:
        cmd_list(args[1])
    elif cmd == "resume" and len(args) >= 2:
        cmd_resume(args[1])
    elif cmd == "archive_list" and len(args) >= 2:
        cmd_archive_list(args[1])
    elif cmd == "archive_get" and len(args) >= 2:
        cmd_archive_get(args[1])
    elif cmd == "close" and len(args) >= 2:
        cmd_close(args[1])
    elif cmd == "delete" and len(args) >= 2:
        cmd_delete(args[1])
    elif cmd == "report_text" and len(args) >= 2:
        cmd_report_text(args[1])
    elif cmd == "report_table" and len(args) >= 2:
        cmd_report_table(args[1])
    elif cmd == "report_chart" and len(args) >= 2:
        cmd_report_chart(args[1])
    elif cmd == "get_mode" and len(args) >= 2:
        cmd_get_mode(args[1])
    elif cmd == "set_mode" and len(args) >= 3:
        cmd_set_mode(args[1], args[2])
    else:
        print(f"Неизвестная команда: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
