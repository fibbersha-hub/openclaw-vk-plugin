#!/usr/bin/env python3
"""
Список дел — SQLite хранилище задач
Использование:
  todos.py add "текст задачи"
  todos.py list
  todos.py done ID
  todos.py delete ID
"""

import sys
import os
import sqlite3
from datetime import datetime

DB_PATH = os.environ.get("TODOS_DB", "/opt/openclaw-notes/todos.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS todos (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            text     TEXT NOT NULL,
            done     INTEGER DEFAULT 0,
            created  TEXT NOT NULL,
            done_at  TEXT
        )
    """)
    conn.commit()
    return conn


def cmd_add(args):
    content_parts = []
    i = 0
    while i < len(args):
        content_parts.append(args[i])
        i += 1

    content = " ".join(content_parts).strip()
    # Strip common prefixes
    import re
    content = re.sub(
        r'^(добавь задачу|добавь дело|запланируй|задача:|дело:)\s*',
        '', content, flags=re.I
    ).strip()

    if not content:
        print("Ошибка: укажи текст задачи")
        sys.exit(1)

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO todos (text, created) VALUES (?, ?)",
        (content, now)
    )
    tid = cur.lastrowid
    conn.commit()
    conn.close()
    print(f"✅ Задача #{tid} добавлена\n📋 {content[:100]}")


def cmd_done(args):
    if not args:
        print("Ошибка: укажи ID задачи")
        sys.exit(1)
    try:
        tid = int(args[0].lstrip("#"))
    except ValueError:
        print(f"Ошибка: некорректный ID «{args[0]}»")
        sys.exit(1)

    conn = get_db()
    row = conn.execute("SELECT * FROM todos WHERE id=?", (tid,)).fetchone()
    if not row:
        print(f"Задача #{tid} не найдена.")
        conn.close()
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    conn.execute("UPDATE todos SET done=1, done_at=? WHERE id=?", (now, tid))
    conn.commit()
    conn.close()
    print(f"✅ Задача #{tid} выполнена: {row['text'][:70]}")


def cmd_list(args):
    show_done = "--all" in args
    conn = get_db()
    if show_done:
        rows = conn.execute(
            "SELECT * FROM todos ORDER BY done ASC, id DESC LIMIT 30"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM todos WHERE done=0 ORDER BY id ASC LIMIT 30"
        ).fetchall()
    conn.close()

    if not rows:
        print("📋 Список дел пуст. Скажи «добавь задачу...» чтобы добавить.")
        return

    pending = [r for r in rows if not r['done']]
    done = [r for r in rows if r['done']]

    lines = []
    if pending:
        lines.append(f"📋 Дела ({len(pending)} шт):")
        for r in pending:
            lines.append(f"  #{r['id']} {r['text'][:80]}")
    if done and show_done:
        lines.append(f"\n✅ Выполнено ({len(done)}):")
        for r in done:
            lines.append(f"  #{r['id']} {r['text'][:60]}")
    print("\n".join(lines))


def cmd_delete(args):
    if not args:
        print("Ошибка: укажи ID задачи")
        sys.exit(1)
    try:
        tid = int(args[0].lstrip("#"))
    except ValueError:
        print(f"Ошибка: некорректный ID «{args[0]}»")
        sys.exit(1)

    conn = get_db()
    row = conn.execute("SELECT * FROM todos WHERE id=?", (tid,)).fetchone()
    if not row:
        print(f"Задача #{tid} не найдена.")
        conn.close()
        return
    conn.execute("DELETE FROM todos WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    print(f"🗑️ Задача #{tid} удалена: {row['text'][:60]}")


COMMANDS = {
    "add":    cmd_add,
    "done":   cmd_done,
    "list":   cmd_list,
    "delete": cmd_delete,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Использование: todos.py [{'/'.join(COMMANDS)}] ...")
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
