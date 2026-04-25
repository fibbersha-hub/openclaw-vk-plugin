# AGENTS.md — Инструкции агента Ульвар

Read SOUL.md at session start. Read TOOLS.md for tool details.
Use shell/exec for VK, Ozon, catalog tasks. Never use browser for VK.

---

## LLM Провайдеры и лимиты

У тебя 5 провайдеров. ИСПОЛЬЗУЙ ИХ УМНО — выбирай модель под задачу.

### Groq (2 ключа, прямой доступ)
- **Модель**: `llama-3.3-70b-versatile`
- **Лимит**: 1000 req/день на ключ, 30 RPM, 6K TPM
- **Скорость**: ~300 tok/s — САМЫЙ БЫСТРЫЙ
- **Для чего**: Быстрые ответы, чат, FAQ, простые задачи
- **Provider ID**: `groq`, `groq-2`

### OpenRouter (1 ключ, прямой доступ)
- **Модель**: `qwen/qwen3.6-plus-preview:free`
- **Лимит**: 200 req/день, 20 RPM
- **Для чего**: Сложные задачи, длинные тексты
- **Бесплатные модели**: `qwen/qwen3-coder:free` (код 480B), `deepseek/deepseek-r1:free` (reasoning), `qwen/qwen3-235b-a22b:free`
- **Provider ID**: `openrouter`

### Cerebras (1 ключ, прямой доступ) — PRIMARY DEFAULT
- **Модель**: `qwen-3-235b-a22b-instruct-2507`
- **Лимит**: 30 RPM, **1M токенов/день**
- **Скорость**: Очень быстрый
- **Для чего**: Основная модель для всех задач
- **Provider ID**: `cerebras`

### Mistral (1 ключ, прямой доступ)
- **Модели**: `mistral-small-latest`, `codestral-latest` (код), `pixtral-12b-2409` (картинки)
- **Лимит**: **2 RPM** (очень мало!)
- **Для чего**: ТОЛЬКО картинки (Pixtral) и специальный код (Codestral)
- **Provider ID**: `mistral`

---

## Правила выбора модели

| Задача | Provider | Модель |
|--------|----------|--------|
| Чат, FAQ, простой вопрос | Cerebras (default) | `qwen-3-235b` |
| Код, скрипты, дебаг | OpenRouter | `qwen/qwen3-coder:free` |
| Анализ, планирование | OpenRouter | `deepseek/deepseek-r1:free` |
| Длинный текст | Cerebras | `qwen-3-235b` |
| Картинки/фото | Mistral | `pixtral-12b-2409` |

### Fallback: Cerebras → OpenRouter → Groq → Mistral

### АБСОЛЮТНОЕ ПРАВИЛО: Только бесплатные модели и тиры!

---

## Доступные инструменты

### Файлы и данные
- `read` / `write` / `edit` — чтение, запись, редактирование файлов
- `apply_patch` — патчи файлов
- `pdf` — чтение PDF документов
- `exec` — выполнение shell-команд на сервере

### Интернет
- `web_search` — поиск через DuckDuckGo (бесплатно)
- `web_fetch` — чтение веб-страниц по URL
- `browser` — управление Chromium (navigate, click, screenshot, eval JS)

### Коммуникация
- `message` — отправка в любой канал (VK, Telegram и др.)

### Медиа
- `image` — анализ изображений (через Mistral/Pixtral, 2 req/min!)
- `tts` — синтез речи (если подключен провайдер)

### Автоматизация
- `cron` — задачи по расписанию (создание, управление, удаление)

### Память
- `memory_search` — гибридный поиск по памяти (vector + keyword)
- `memory_get` — чтение конкретного файла/записи

### Сессии
- `session_status` — статус текущей сессии
- `sessions_spawn` — запуск суб-агентов
- `sessions_list` / `sessions_history` — навигация по сессиям

---

## Доступные навыки (Skills)

### Готовые к использованию
- **weather** — погода в любом городе (`curl wttr.in`)
- **healthcheck** — аудит безопасности сервера
- **skill-creator** — создание новых навыков
- **taskflow** — workflow-автоматизация (многошаговые задачи)
- **taskflow-inbox-triage** — сортировка входящих задач
- **tmux** — управление tmux-сессиями
- **node-connect** — диагностика подключения устройств

---

## Создание новых инструментов

Когда обнаруживаешь повторяющийся паттерн (3+ раз одна и та же задача):

1. **Определи паттерн** — что делается, с какими данными
2. **Выбери модель** — по таблице выше
3. **Создай скрипт** в `/opt/studio-3d/tools/` (Python)
4. **Задокументируй** — добавь в TOOLS.md
5. **Сообщи оператору** — что создал новый инструмент
