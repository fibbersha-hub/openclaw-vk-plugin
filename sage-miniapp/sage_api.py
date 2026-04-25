#!/usr/bin/env python3
"""
Великий Мудрец — Mini App API
Flask REST сервер, обёртка над sage.py
Порт: 5001
"""
import sys
import os
import json
import sqlite3
import uuid
from flask import Flask, request, jsonify, abort
from flask_cors import CORS

sys.path.insert(0, "/opt/browser-bridge")
import sage

app = Flask(__name__)
CORS(app, origins=[
    "https://vk.com",
    "https://*.vk-apps.com",
    "http://localhost:*",
    "http://127.0.0.1:*",
])

# ── Auth ───────────────────────────────────────────────────────────────────────
# Разрешённые VK user_id (те же что в openclaw dmPolicy allowlist)
ALLOWED_USERS_FILE = "/root/.openclaw/openclaw.json"

def get_allowed_users():
    try:
        cfg = json.load(open(ALLOWED_USERS_FILE))
        accounts = cfg.get("channels", {}).get("vk", {}).get("accounts", {})
        users = set()
        for acc in accounts.values():
            for uid in acc.get("allowFrom", []):
                users.add(str(uid))
        return users
    except Exception:
        return set()

def check_auth():
    """Проверяем vk_user_id из заголовка X-VK-User-Id."""
    uid = request.headers.get("X-VK-User-Id", "")
    # dev-режим: открыто вне VK (браузер напрямую)
    if not uid or uid == "dev":
        return "dev"
    allowed = get_allowed_users()
    if allowed and uid not in allowed:
        abort(403)
    return uid


# ── Health ─────────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "sage-miniapp-api", "version": "2.0"})


# ── Sessions ───────────────────────────────────────────────────────────────────
@app.route("/api/sessions")
def list_sessions():
    uid = check_auth()
    conn = sage.get_db()
    rows = conn.execute(
        "SELECT id, title, updated_at, "
        "(SELECT COUNT(*) FROM messages WHERE session_id=s.id) AS cnt "
        "FROM sessions s WHERE peer_id=? AND archived=0 "
        "ORDER BY updated_at DESC LIMIT 20",
        (int(uid) if uid != "dev" else 99999,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sessions/<sid>/messages")
def get_messages(sid):
    check_auth()
    conn = sage.get_db()
    rows = conn.execute(
        "SELECT id, question, synthesis, responses, asked_at "
        "FROM messages WHERE session_id=? ORDER BY id",
        (sid,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["responses"] = json.loads(d["responses"]) if d["responses"] else []
        except Exception:
            d["responses"] = []
        result.append(d)
    return jsonify(result)


@app.route("/api/sessions/<sid>", methods=["DELETE"])
def delete_session(sid):
    check_auth()
    conn = sage.get_db()
    conn.execute("DELETE FROM messages WHERE session_id=?", (sid,))
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/sessions/<sid>/archive", methods=["POST"])
def archive_session(sid):
    check_auth()
    conn = sage.get_db()
    conn.execute("UPDATE sessions SET archived=1 WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Mode ───────────────────────────────────────────────────────────────────────
@app.route("/api/mode")
def get_mode():
    uid = check_auth()
    peer_id = int(uid) if uid != "dev" else 99999
    conn = sage.get_db()
    mode = sage.get_peer_mode(conn, peer_id)
    conn.close()
    return jsonify({"mode": mode})


@app.route("/api/mode", methods=["POST"])
def set_mode():
    uid = check_auth()
    peer_id = int(uid) if uid != "dev" else 99999
    data = request.get_json() or {}
    mode = data.get("mode", "auto")
    if mode not in ("auto", "multi"):
        abort(400)
    conn = sage.get_db()
    conn.execute(
        "INSERT INTO peer_settings (peer_id, sage_mode, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(peer_id) DO UPDATE SET sage_mode=excluded.sage_mode, updated_at=excluded.updated_at",
        (peer_id, mode, sage.now())
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "mode": mode})


# ── Ask (streaming via SSE) ────────────────────────────────────────────────────
import threading
import queue
import time

def _ask_worker(peer_id, question, session_id, file_url, file_name, result_queue):
    """Выполняет запрос к LLM, кладёт прогресс в очередь."""
    import io
    from contextlib import redirect_stdout

    # dev-режим (peer_id=99999) принудительно ставим авто, не multi
    if peer_id == 99999:
        conn = sage.get_db()
        conn.execute(
            "INSERT INTO peer_settings (peer_id, sage_mode, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(peer_id) DO UPDATE SET sage_mode='auto', updated_at=excluded.updated_at",
            (99999, "auto", sage.now())
        )
        conn.commit()
        conn.close()

    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            sage.cmd_ask(peer_id, question, session_id=session_id,
                        file_url=file_url, file_name=file_name)
        output = buf.getvalue()
        # Парсим SESSION_ID из вывода
        new_sid = None
        for line in output.split("\n"):
            if line.startswith("SESSION_ID:"):
                new_sid = line.split(":", 1)[1].strip()
                break
        # Убираем служебную строку SESSION_ID из вывода
        clean = "\n".join(l for l in output.split("\n") if not l.startswith("SESSION_ID:")).strip()
        result_queue.put({"type": "done", "text": clean, "session_id": new_sid})
    except SystemExit:
        output = buf.getvalue()
        result_queue.put({"type": "error", "text": output or "Ошибка при обработке запроса"})
    except Exception as e:
        result_queue.put({"type": "error", "text": str(e)})


@app.route("/api/ask", methods=["POST"])
def ask():
    uid = check_auth()
    peer_id = int(uid) if uid != "dev" else 99999
    data = request.get_json() or {}
    question = (data.get("question") or "").strip()
    session_id = data.get("session_id") or None
    file_url = data.get("file_url") or None
    file_name = data.get("file_name") or None

    if not question:
        abort(400)

    result_queue = queue.Queue()
    t = threading.Thread(
        target=_ask_worker,
        args=(peer_id, question, session_id, file_url, file_name, result_queue),
        daemon=True
    )
    t.start()

    # Ждём результат (таймаут 5 минут для мульти-режима)
    try:
        result = result_queue.get(timeout=300)
    except queue.Empty:
        return jsonify({"error": "Timeout — модели не ответили"}), 504

    if result["type"] == "error":
        return jsonify({"error": result["text"]}), 500

    return jsonify({
        "ok": True,
        "text": result["text"],
        "session_id": result["session_id"],
    })


# ── File upload ────────────────────────────────────────────────────────────────
import tempfile
from werkzeug.utils import secure_filename

UPLOAD_DIR = "/tmp/sage-uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTS = {
    "txt","md","rst","log","py","js","ts","jsx","tsx","java","cs","cpp","c","h",
    "go","rs","rb","php","sh","bash","json","yaml","yml","toml","ini","cfg",
    "csv","tsv","xml","html","htm","css","sql","pdf","docx","xlsx",
}

@app.route("/api/upload", methods=["POST"])
def upload_file():
    check_auth()
    if "file" not in request.files:
        abort(400)
    f = request.files["file"]
    if not f.filename:
        abort(400)
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_EXTS:
        return jsonify({"error": f"Формат .{ext} не поддерживается"}), 415

    # Сохраняем во временный файл
    safe_name = secure_filename(f.filename)
    tmp_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex[:8]}_{safe_name}")
    f.save(tmp_path)

    # Возвращаем file:// URL — sage.py умеет работать с http/https,
    # но для загруженных файлов используем специальную схему sage-upload://
    return jsonify({"url": f"file://{tmp_path}", "name": safe_name})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
