#!/usr/bin/env python3
"""
Проверка доступных LLM моделей и автообновление прокси.
Запускается по cron раз в день.

Что делает:
1. Запрашивает список free моделей с OpenRouter
2. Проверяет доступность текущей дефолтной модели
3. Если модель недоступна — выбирает лучшую замену и обновляет server.mjs
4. Сохраняет актуальный каталог моделей в $MODELS_FILE
5. Обновляет TOOLS.md для OpenClaw
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# --- Config ---
OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY_1", "")
if not OPENROUTER_KEY:
    print("ERROR: OPENROUTER_KEY_1 env var not set", file=sys.stderr)
    sys.exit(1)
PROXY_CONFIG = Path(os.environ.get("PROXY_CONFIG", "/opt/groq-proxy/server.mjs"))
MODELS_FILE  = Path(os.environ.get("MODELS_FILE",  "/opt/openclaw-vk-plugin/data/models.json"))
TOOLS_MD     = Path(os.environ.get("TOOLS_MD",     "/opt/openclaw-vk-plugin/workspace/TOOLS.md"))
LOG_FILE = Path("/var/log/model-checker.log")

# Предпочтительные модели (в порядке приоритета)
PREFERRED_MODELS = [
    "qwen/qwen3.6-plus",           # Qwen 3.6 Plus — мощная, с reasoning
    "nvidia/nemotron-3-super-120b", # 120B параметров
    "qwen/qwen3-coder",            # Хорош для кода
    "qwen/qwen3-next-80b",         # 80B
    "openai/gpt-oss-120b",         # OpenAI OSS 120B
    "minimax/minimax-m2.5",        # MiniMax
    "stepfun/step-3.5-flash",      # Step Flash
    "google/gemma-3-27b-it",       # Gemma 27B
    "nousresearch/hermes-3-llama-3.1-405b",  # 405B!
]

# Категории моделей для OpenClaw
MODEL_CATEGORIES = {
    "general": {
        "desc": "Общие задачи, диалог, ответы",
        "prefer": ["qwen/qwen3.6-plus", "nvidia/nemotron-3-super-120b", "minimax/minimax-m2.5"],
    },
    "code": {
        "desc": "Код, скрипты, техническое",
        "prefer": ["qwen/qwen3-coder", "openai/gpt-oss-120b", "qwen/qwen3-next-80b"],
    },
    "large": {
        "desc": "Сложные задачи, анализ, длинные тексты",
        "prefer": ["nousresearch/hermes-3-llama-3.1-405b", "nvidia/nemotron-3-super-120b", "openai/gpt-oss-120b"],
    },
    "fast": {
        "desc": "Быстрые ответы, простые задачи",
        "prefer": ["stepfun/step-3.5-flash", "google/gemma-3-27b-it", "arcee-ai/trinity-mini"],
    },
}


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def fetch_free_models():
    """Получить все бесплатные модели с OpenRouter."""
    resp = requests.get(
        "https://openrouter.ai/api/v1/models",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
        timeout=30,
    )
    if resp.status_code != 200:
        log(f"OpenRouter API ошибка: {resp.status_code}")
        return []
    data = resp.json()
    models = []
    for m in data.get("data", []):
        mid = m.get("id", "")
        if ":free" in mid:
            models.append({
                "id": mid,
                "name": m.get("name", mid),
                "context_length": m.get("context_length", 0),
                "pricing": m.get("pricing", {}),
                "created": m.get("created", 0),
                "description": m.get("description", "")[:200],
            })
    return sorted(models, key=lambda x: -x["context_length"])


def test_model(model_id):
    """Проверить что модель реально отвечает."""
    try:
        resp = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_id,
                "messages": [{"role": "user", "content": "Say OK"}],
                "max_tokens": 5,
            },
            timeout=30,
        )
        data = resp.json()
        if data.get("choices"):
            return True
        error = data.get("error", {}).get("message", "")
        if "404" in str(resp.status_code) or "No endpoints" in error:
            return False
        # Rate limit — модель существует, просто лимит
        if resp.status_code == 429:
            return True
        return False
    except Exception as e:
        log(f"  Тест {model_id} ошибка: {e}")
        return False


def get_current_default():
    """Прочитать текущую дефолтную модель из server.mjs."""
    if not PROXY_CONFIG.exists():
        return None
    content = PROXY_CONFIG.read_text()
    match = re.search(r'defaultModel:\s*"([^"]+)"', content)
    if match:
        return match.group(1)
    return None


def update_proxy_model(old_model, new_model):
    """Обновить дефолтную модель в server.mjs."""
    if not PROXY_CONFIG.exists():
        log(f"  Файл {PROXY_CONFIG} не найден")
        return False
    content = PROXY_CONFIG.read_text()
    # Заменяем в первом пуле (openrouter)
    new_content = content.replace(f'"{old_model}"', f'"{new_model}"', 1)
    if new_content == content:
        log(f"  Модель {old_model} не найдена в конфиге")
        return False
    PROXY_CONFIG.write_text(new_content)
    log(f"  Модель обновлена: {old_model} → {new_model}")
    return True


def pick_best_model(available_ids):
    """Выбрать лучшую модель из доступных по приоритету."""
    for preferred in PREFERRED_MODELS:
        for avail in available_ids:
            # Fuzzy match: qwen/qwen3.6-plus matches qwen/qwen3.6-plus:free and qwen/qwen3.6-plus-04-02:free
            if avail.startswith(preferred):
                return avail
    # Fallback — первая с наибольшим контекстом
    return available_ids[0] if available_ids else None


def pick_best_for_category(category, available_ids):
    """Выбрать лучшую модель для конкретной категории."""
    cat = MODEL_CATEGORIES.get(category, {})
    for preferred in cat.get("prefer", []):
        for avail in available_ids:
            if avail.startswith(preferred):
                return avail
    return pick_best_model(available_ids)


def save_models_catalog(models, available_ids):
    """Сохранить каталог моделей для OpenClaw."""
    catalog = {
        "updated": datetime.now().isoformat(),
        "total_free": len(models),
        "categories": {},
        "all_models": [{"id": m["id"], "name": m["name"], "ctx": m["context_length"]} for m in models],
    }
    for cat_name, cat_info in MODEL_CATEGORIES.items():
        best = pick_best_for_category(cat_name, available_ids)
        catalog["categories"][cat_name] = {
            "description": cat_info["desc"],
            "recommended": best,
        }

    MODELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MODELS_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    log(f"  Каталог сохранён: {MODELS_FILE} ({len(models)} моделей)")


def update_tools_md(catalog):
    """Добавить/обновить секцию моделей в TOOLS.md."""
    if not TOOLS_MD.exists():
        return

    content = TOOLS_MD.read_text(encoding="utf-8")

    # Формируем секцию
    section = "\n## 🤖 Доступные LLM модели (обновлено автоматически)\n\n"
    section += f"Обновлено: {catalog['updated'][:10]}\n"
    section += f"Бесплатных моделей на OpenRouter: {catalog['total_free']}\n\n"
    section += "Рекомендации по категориям:\n"
    for cat_name, cat_data in catalog["categories"].items():
        section += f"  - **{cat_name}** ({cat_data['description']}): `{cat_data['recommended']}`\n"
    section += "\nПолный каталог: `cat $MODELS_FILE`\n"

    # Удалить старую секцию если есть
    pattern = r"\n## 🤖 Доступные LLM модели.*?(?=\n## |\Z)"
    content = re.sub(pattern, "", content, flags=re.DOTALL)

    # Добавить в конец
    content = content.rstrip() + "\n" + section
    TOOLS_MD.write_text(content, encoding="utf-8")
    log("  TOOLS.md обновлён")


def restart_proxy():
    """Перезапустить прокси-сервис."""
    os.system("systemctl restart groq-proxy")
    log("  groq-proxy перезапущен")


def main():
    log("=== Model Checker запущен ===")

    # 1. Получить список моделей
    models = fetch_free_models()
    if not models:
        log("Не удалось получить список моделей")
        sys.exit(1)
    log(f"Найдено {len(models)} бесплатных моделей")

    available_ids = [m["id"] for m in models]

    # 2. Проверить текущую дефолтную модель
    current = get_current_default()
    log(f"Текущая модель: {current}")

    need_update = False
    if current and current not in available_ids:
        log(f"⚠️ Модель {current} недоступна!")
        # Проверим реально ли недоступна
        if not test_model(current):
            need_update = True
            log(f"  Подтверждено: модель не отвечает")
        else:
            log(f"  Модель отвечает несмотря на отсутствие в списке")

    # 3. Обновить модель если нужно
    if need_update:
        new_model = pick_best_model(available_ids)
        if new_model:
            log(f"Замена: {current} → {new_model}")
            if update_proxy_model(current, new_model):
                restart_proxy()
        else:
            log("Нет подходящей замены!")

    # 4. Сохранить каталог
    save_models_catalog(models, available_ids)

    # 5. Обновить TOOLS.md
    catalog = json.load(open(MODELS_FILE, encoding="utf-8"))
    update_tools_md(catalog)

    log("=== Model Checker завершён ===")


if __name__ == "__main__":
    main()
