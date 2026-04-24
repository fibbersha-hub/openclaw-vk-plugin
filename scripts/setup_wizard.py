#!/usr/bin/env python3
"""
OpenClaw VK Plugin — Setup Wizard
Интерактивный установщик начальной конфигурации.

Запуск:
    python3 scripts/setup_wizard.py

Что делает:
    1. Спрашивает VK-токен сообщества и group ID
    2. Спрашивает Groq ключи (обязательно, можно несколько)
    3. Спрашивает Cerebras, OpenRouter, Mistral (опционально)
    4. Проверяет каждый ключ через реальный API-запрос
    5. Записывает openclaw.json в ~/.openclaw/

Требования: Python 3.8+, pip install requests (обычно уже есть)
"""

import sys
import os
import json
import re
import time

# Fix emoji output on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import requests
except ImportError:
    print("Устанавливаю requests...")
    os.system(f"{sys.executable} -m pip install requests -q")
    import requests

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def ask(prompt: str, default: str = "", required: bool = True) -> str:
    """Задать вопрос. Если required — не принимать пустой ответ."""
    while True:
        if default:
            answer = input(f"{prompt} [{default}]: ").strip()
            if not answer:
                answer = default
        else:
            answer = input(f"{prompt}: ").strip()
        if answer or not required:
            return answer
        print("  ⚠️  Это поле обязательно.")


def ask_yn(prompt: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    answer = input(f"{prompt} [{hint}]: ").strip().lower()
    if not answer:
        return default
    return answer in ("y", "yes", "да", "д")


def section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def ok(msg: str) -> None:
    print(f"  ✅  {msg}")


def warn(msg: str) -> None:
    print(f"  ⚠️   {msg}")


def err(msg: str) -> None:
    print(f"  ❌  {msg}")


# ──────────────────────────────────────────────────────────────────────────────
# Key testers
# ──────────────────────────────────────────────────────────────────────────────

def test_groq(api_key: str) -> bool:
    """Проверить Groq ключ: один минимальный запрос."""
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": "llama-3.1-8b-instant", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        if resp.status_code == 401:
            err(f"Groq: неверный ключ (401 Unauthorized)")
        elif resp.status_code == 429:
            warn("Groq: лимит запросов (429) — ключ рабочий, но исчерпан на сегодня")
            return True  # Key is valid, just rate-limited
        else:
            err(f"Groq: HTTP {resp.status_code} — {resp.text[:100]}")
        return False
    except Exception as e:
        err(f"Groq: ошибка соединения — {e}")
        return False


def test_cerebras(api_key: str) -> bool:
    try:
        resp = requests.post(
            "https://api.cerebras.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0",
            },
            json={"model": "llama3.1-8b", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        if resp.status_code == 401:
            err("Cerebras: неверный ключ (401)")
        elif resp.status_code == 429:
            warn("Cerebras: лимит (429) — ключ рабочий")
            return True
        else:
            err(f"Cerebras: HTTP {resp.status_code}")
        return False
    except Exception as e:
        err(f"Cerebras: ошибка — {e}")
        return False


def test_openrouter(api_key: str) -> bool:
    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": "meta-llama/llama-3.3-70b-instruct:free",
                  "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        if resp.status_code == 401:
            err("OpenRouter: неверный ключ (401)")
        elif resp.status_code == 429:
            warn("OpenRouter: лимит (429) — ключ рабочий")
            return True
        else:
            err(f"OpenRouter: HTTP {resp.status_code}")
        return False
    except Exception as e:
        err(f"OpenRouter: ошибка — {e}")
        return False


def test_mistral(api_key: str) -> bool:
    try:
        resp = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": "mistral-small-latest",
                  "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            timeout=15,
        )
        if resp.status_code == 200:
            return True
        if resp.status_code == 401:
            err("Mistral: неверный ключ (401)")
        elif resp.status_code == 429:
            warn("Mistral: лимит (429) — ключ рабочий")
            return True
        else:
            err(f"Mistral: HTTP {resp.status_code}")
        return False
    except Exception as e:
        err(f"Mistral: ошибка — {e}")
        return False


def test_vk_token(token: str, group_id: str) -> bool:
    try:
        resp = requests.get(
            "https://api.vk.com/method/groups.getById",
            params={"group_id": group_id, "access_token": token, "v": "5.199"},
            timeout=10,
        )
        data = resp.json()
        if "response" in data:
            name = data["response"][0].get("name", "?")
            ok(f"VK: подключено к «{name}»")
            return True
        error = data.get("error", {})
        err(f"VK: {error.get('error_msg', 'unknown error')} (code {error.get('error_code')})")
        return False
    except Exception as e:
        err(f"VK: ошибка — {e}")
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Build config
# ──────────────────────────────────────────────────────────────────────────────

def build_config(vk_token, group_id, user_id, groq_keys, cerebras_key,
                 openrouter_key, mistral_key, dm_policy) -> dict:
    providers = {}

    for i, key in enumerate(groq_keys, 1):
        name = "groq" if i == 1 else f"groq-{i}"
        providers[name] = {
            "type": "openai",
            "baseUrl": "https://api.groq.com/openai/v1",
            "apiKey": key,
            "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] if i == 1
                      else ["llama-3.3-70b-versatile"],
        }

    if cerebras_key:
        providers["cerebras"] = {
            "type": "openai",
            "baseUrl": "https://api.cerebras.ai/v1",
            "apiKey": cerebras_key,
            "models": ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"],
        }

    if openrouter_key:
        providers["openrouter"] = {
            "type": "openai",
            "baseUrl": "https://openrouter.ai/api/v1",
            "apiKey": openrouter_key,
            "models": ["meta-llama/llama-3.3-70b-instruct:free"],
        }

    if mistral_key:
        providers["mistral"] = {
            "type": "openai",
            "baseUrl": "https://api.mistral.ai/v1",
            "apiKey": mistral_key,
            "models": ["mistral-small-latest", "pixtral-12b-2409"],
        }

    account = {
        "token": vk_token,
        "groupId": group_id,
        "enabled": True,
        "dmPolicy": dm_policy,
        "formatMarkdown": True,
        "autoKeyboard": True,
        "transcribeVoice": bool(groq_keys),
        "apiVersion": "5.199",
        "longPollWait": 25,
    }
    if user_id:
        account["allowFrom"] = [user_id]
    if groq_keys:
        account["groqApiKey"] = groq_keys[0]

    return {
        "channels": {
            "vk": {
                "accounts": {
                    "default": account
                }
            }
        },
        "models": {
            "default": "groq/llama-3.3-70b-versatile",
            "providers": providers,
        },
    }


# ──────────────────────────────────────────────────────────────────────────────
# Main wizard
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║        OpenClaw VK Plugin — Мастер начальной настройки       ║")
    print("║                    Setup Wizard v1.0                         ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()
    print("Этот скрипт поможет настроить openclaw.json для работы с VK-ботом.")
    print("Все ключи проверяются через реальный API-запрос перед сохранением.")
    print()

    # ── VK ──────────────────────────────────────────────────────────────────

    section("1/4  VK Community Token")
    print("  Получить: Сообщество → Управление → Настройки → Работа с API")
    print("  → Создать ключ (нужны права: messages, photos, docs, wall)")
    print("  Токен начинается с vk1.a.")
    print()

    while True:
        vk_token = ask("VK Community Token")
        section_label = "Проверяю токен VK..."
        print(f"  {section_label}", end=" ", flush=True)

        group_id = ask("Числовой ID сообщества (без минуса)")
        user_id = ask("Ваш VK User ID (кто может писать боту)", required=False)
        dm_policy = "allowlist" if user_id else "open"

        print(f"\n  Проверяю подключение к группе {group_id}...", end=" ", flush=True)
        if test_vk_token(vk_token, group_id):
            break
        if not ask_yn("\n  Попробовать ввести другой токен?", default=True):
            warn("Сохраняю без проверки VK")
            break

    # ── Groq ─────────────────────────────────────────────────────────────────

    section("2/4  Groq API Keys (обязательно — основная модель + Whisper)")
    print("  Получить: console.groq.com → API Keys → Create API Key")
    print("  Рекомендуется 2-4 ключа (лимит per-key, не per-account)")
    print("  Ключ начинается с gsk_")
    print()

    groq_keys = []
    while True:
        key = ask(f"Groq ключ #{len(groq_keys) + 1} (Enter — пропустить)",
                  required=(len(groq_keys) == 0))
        if not key:
            break
        print(f"  Проверяю ключ...", end=" ", flush=True)
        if test_groq(key):
            ok(f"Groq #{len(groq_keys) + 1} — OK")
            groq_keys.append(key)
        else:
            if not ask_yn("  Добавить этот ключ несмотря на ошибку?", default=False):
                continue
            groq_keys.append(key)

        if len(groq_keys) >= 4:
            print("  Достаточно 4 ключей.")
            break

        if not ask_yn(f"  Добавить ещё один Groq ключ? (уже: {len(groq_keys)})", default=(len(groq_keys) < 2)):
            break

    if not groq_keys:
        warn("Groq ключи не добавлены. Голосовые сообщения не будут работать.")

    # ── Optional providers ───────────────────────────────────────────────────

    section("3/4  Дополнительные провайдеры (опционально)")

    cerebras_key = ""
    if ask_yn("Добавить Cerebras? (cloud.cerebras.ai, 1M токен/день)", default=True):
        print("  Ключ начинается с csk_")
        key = ask("Cerebras API key", required=False)
        if key:
            print("  Проверяю...", end=" ", flush=True)
            if test_cerebras(key):
                ok("Cerebras — OK")
                cerebras_key = key
            else:
                if ask_yn("  Сохранить ключ несмотря на ошибку?", default=False):
                    cerebras_key = key

    openrouter_key = ""
    if ask_yn("Добавить OpenRouter? (openrouter.ai, 24+ бесплатных моделей)", default=True):
        print("  Ключ начинается с sk-or-v1-")
        key = ask("OpenRouter API key", required=False)
        if key:
            print("  Проверяю...", end=" ", flush=True)
            if test_openrouter(key):
                ok("OpenRouter — OK")
                openrouter_key = key
            else:
                if ask_yn("  Сохранить ключ несмотря на ошибку?", default=False):
                    openrouter_key = key

    mistral_key = ""
    if ask_yn("Добавить Mistral? (console.mistral.ai, vision-модель Pixtral)", default=False):
        key = ask("Mistral API key", required=False)
        if key:
            print("  Проверяю...", end=" ", flush=True)
            if test_mistral(key):
                ok("Mistral — OK")
                mistral_key = key
            else:
                if ask_yn("  Сохранить ключ несмотря на ошибку?", default=False):
                    mistral_key = key

    # ── Save ─────────────────────────────────────────────────────────────────

    section("4/4  Сохранение конфигурации")

    config = build_config(
        vk_token, group_id, user_id, groq_keys,
        cerebras_key, openrouter_key, mistral_key, dm_policy,
    )

    # Determine save path
    openclaw_dir = os.path.expanduser("~/.openclaw")
    default_path = os.path.join(openclaw_dir, "openclaw.json")
    save_path = ask("Путь для сохранения openclaw.json", default=default_path, required=True)

    save_dir = os.path.dirname(save_path)
    if save_dir and not os.path.exists(save_dir):
        os.makedirs(save_dir, exist_ok=True)
        ok(f"Создана директория: {save_dir}")

    # Backup if exists
    if os.path.exists(save_path):
        backup = save_path + ".bak"
        import shutil
        shutil.copy2(save_path, backup)
        warn(f"Существующий файл сохранён в: {backup}")

    with open(save_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    ok(f"Конфигурация сохранена: {save_path}")

    # ── Summary ──────────────────────────────────────────────────────────────

    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║                        Итог настройки                        ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()
    print(f"  VK Group ID    : {group_id}")
    print(f"  DM Policy      : {dm_policy}" + (f" (только {user_id})" if user_id else ""))
    print(f"  Groq ключей    : {len(groq_keys)}")
    print(f"  Cerebras       : {'✅' if cerebras_key else '—'}")
    print(f"  OpenRouter     : {'✅' if openrouter_key else '—'}")
    print(f"  Mistral        : {'✅' if mistral_key else '—'}")
    print()

    if groq_keys:
        ok("Голосовые сообщения (Whisper) — включены")
    else:
        warn("Голосовые сообщения — отключены (нет Groq ключа)")

    ok("Генерация изображений (Pollinations.ai) — включена (ключ не нужен)")

    print()
    print("  Следующий шаг:")
    print("    openclaw gateway run --verbose")
    print()
    print("  Если нужны дополнительные инструкции:")
    print("    docs/LLM_KEYS_GUIDE.md     — получение бесплатных ключей")
    print("    docs/VK_INTEGRATION_2026.md — настройка VK токенов")
    print()
    print("  Вопросы и ошибки: fibber.sha@yandex.ru")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n  Прервано пользователем.")
        sys.exit(0)
