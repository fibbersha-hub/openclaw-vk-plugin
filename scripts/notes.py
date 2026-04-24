#!/usr/bin/env python3
"""
Умные заметки — SQLite хранилище для OpenClaw VK бота
Использование:
  notes.py save "текст заметки" [--tag тег]
  notes.py list [--limit N]
  notes.py search "запрос"
  notes.py delete <id>
  notes.py get <id>
"""

import sys
import os
import sqlite3
import json
import re
from datetime import datetime

DB_PATH = os.environ.get("NOTES_DB", "/opt/openclaw-notes/notes.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            content   TEXT NOT NULL,
            tags      TEXT DEFAULT '',
            created   TEXT NOT NULL,
            updated   TEXT NOT NULL
        )
    """)
    # FTS5 virtual table for full-text search
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
        USING fts5(content, tags, content=notes, content_rowid=id)
    """)
    # Triggers to keep FTS in sync
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, content, tags)
            VALUES ('delete', old.id, old.content, old.tags);
        END
    """)
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, content, tags)
            VALUES ('delete', old.id, old.content, old.tags);
            INSERT INTO notes_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END
    """)
    conn.commit()
    return conn


def cmd_save(args):
    if not args:
        print("Ошибка: укажи текст заметки")
        sys.exit(1)

    # Parse --tag argument
    content_parts = []
    tags = []
    i = 0
    while i < len(args):
        if args[i] in ("--tag", "-t") and i + 1 < len(args):
            tags.append(args[i + 1].strip())
            i += 2
        else:
            content_parts.append(args[i])
            i += 1

    content = " ".join(content_parts).strip()
    if not content:
        print("Ошибка: пустой текст заметки")
        sys.exit(1)

    # Auto-extract hashtags from content (#тег)
    found_tags = re.findall(r'#(\w+)', content)
    tags.extend(found_tags)
    # Remove hashtags from content
    content_clean = re.sub(r'#\w+', '', content).strip()

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    tags_str = " ".join(set(tags))

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO notes (content, tags, created, updated) VALUES (?, ?, ?, ?)",
        (content_clean, tags_str, now, now)
    )
    note_id = cur.lastrowid
    conn.commit()
    conn.close()

    tag_display = f" [{tags_str}]" if tags_str else ""
    print(f"✅ Заметка #{note_id} сохранена{tag_display}\n📝 {content_clean[:100]}")


def cmd_list(args):
    limit = 10
    for i, a in enumerate(args):
        if a in ("--limit", "-n") and i + 1 < len(args):
            try:
                limit = int(args[i + 1])
            except ValueError:
                pass

    conn = get_db()
    rows = conn.execute(
        "SELECT id, content, tags, created FROM notes ORDER BY id DESC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()

    if not rows:
        print("📋 Заметок пока нет. Скажи «запомни...» чтобы сохранить.")
        return

    lines = [f"📋 Последние заметки ({len(rows)}):"]
    for r in rows:
        tag_display = f" [{r['tags']}]" if r['tags'] else ""
        short = r['content'][:80] + ("…" if len(r['content']) > 80 else "")
        lines.append(f"#{r['id']} {r['created']}{tag_display}\n   {short}")

    print("\n".join(lines))


def cmd_search(args):
    if not args:
        print("Ошибка: укажи поисковый запрос")
        sys.exit(1)

    query = " ".join(args).strip()
    conn = get_db()

    # FTS5 search
    try:
        rows = conn.execute("""
            SELECT n.id, n.content, n.tags, n.created,
                   snippet(notes_fts, 0, '**', '**', '...', 20) AS snippet
            FROM notes_fts
            JOIN notes n ON n.id = notes_fts.rowid
            WHERE notes_fts MATCH ?
            ORDER BY rank
            LIMIT 10
        """, (query,)).fetchall()
    except Exception:
        # Fallback to LIKE if FTS fails
        rows = conn.execute("""
            SELECT id, content, tags, created,
                   substr(content, 1, 100) AS snippet
            FROM notes
            WHERE content LIKE ? OR tags LIKE ?
            ORDER BY id DESC
            LIMIT 10
        """, (f"%{query}%", f"%{query}%")).fetchall()

    conn.close()

    if not rows:
        print(f"🔍 По запросу «{query}» ничего не найдено.")
        return

    lines = [f"🔍 Найдено по «{query}» ({len(rows)}):"]
    for r in rows:
        tag_display = f" [{r['tags']}]" if r['tags'] else ""
        lines.append(f"#{r['id']} {r['created']}{tag_display}\n   {r['snippet']}")

    print("\n".join(lines))


def cmd_delete(args):
    if not args:
        print("Ошибка: укажи ID заметки")
        sys.exit(1)

    try:
        note_id = int(args[0].lstrip("#"))
    except ValueError:
        print(f"Ошибка: некорректный ID «{args[0]}»")
        sys.exit(1)

    conn = get_db()
    row = conn.execute("SELECT id, content FROM notes WHERE id=?", (note_id,)).fetchone()
    if not row:
        print(f"Заметка #{note_id} не найдена.")
        conn.close()
        return

    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    conn.close()
    short = row['content'][:60] + ("…" if len(row['content']) > 60 else "")
    print(f"🗑️ Заметка #{note_id} удалена: {short}")


def cmd_get(args):
    if not args:
        print("Ошибка: укажи ID заметки")
        sys.exit(1)

    try:
        note_id = int(args[0].lstrip("#"))
    except ValueError:
        print(f"Ошибка: некорректный ID «{args[0]}»")
        sys.exit(1)

    conn = get_db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    conn.close()

    if not row:
        print(f"Заметка #{note_id} не найдена.")
        return

    tag_display = f"\nТеги: {row['tags']}" if row['tags'] else ""
    print(f"📝 Заметка #{row['id']} ({row['created']}){tag_display}\n\n{row['content']}")


COMMANDS = {
    "save": cmd_save,
    "list": cmd_list,
    "search": cmd_search,
    "delete": cmd_delete,
    "get": cmd_get,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Использование: notes.py [{'/'.join(COMMANDS)}] ...")
        sys.exit(1)

    COMMANDS[sys.argv[1]](sys.argv[2:])
