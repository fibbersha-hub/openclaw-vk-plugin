# OpenClaw VK Plugin — Журнал разработки

---

## 2026-04-15 — Сессия 1: Интеграция LLM-провайдеров и публикация

### Исследование Qwen
- Исследована возможность прямого подключения Qwen (DashScope) к OpenClaw
- Qwen нативно поддерживается в OpenClaw (расширение `extensions/qwen/`)
- Зарегистрирован аккаунт на Qwen Cloud, получен API-ключ
- **Выяснено: бесплатного тира на DashScope International НЕТ** — все модели платные с первого токена
- Решение: Qwen используется бесплатно через OpenRouter (`qwen/qwen3.6-plus:free`)
- Ключ Qwen удалён, карта отвязана

### Исследование бесплатных LLM-провайдеров
- Составлена полная карта бесплатных провайдеров для OpenClaw
- **Cerebras** — зарегистрирован, ключ `csk-****...`, 1M tok/день, 30 RPM
- **Mistral** — зарегистрирован, ключ `dtIi...`, 2 RPM, codestral + pixtral (vision)
- NVIDIA Build — не удалось (требует телефон не из РФ)
- Google AI Studio — отклонён пользователем

### Добавление провайдеров на сервер (YOUR_SERVER_IP)
- Сервер находится в Казахстане (не YOUR_OLD_SERVER_IP!) — прокси не нужен
- Пароль SSH: `****` (хранится локально)
- Обнаружено: OpenClaw конфиг в `~/.openclaw/openclaw.json` (не через groq-proxy)
- Добавлены провайдеры в `openclaw.json` и `models.json`:
  - **Cerebras** — `qwen-3-235b-a22b-instruct-2507` (primary default)
  - **Mistral** — `mistral-small-latest`, `codestral-latest`, `pixtral-12b-2409`
- Исправлена проблема с Groq: промпт 52K токенов при лимите 12K TPM
- Дефолтная модель переключена на Cerebras (нет лимита TPM)
- Исправлен 404 от Cerebras: модель `llama3.3-70b` не существует → заменена на `qwen-3-235b-a22b-instruct-2507`
- Конфиг `failover` не поддерживается в схеме → убран

### Создание AGENTS.md и TOOLS.md
- Создан `AGENTS.md` с правилами выбора модели по типу задачи
- Создан `TOOLS.md` с описанием инструментов магазина и AI-инструментов
- Оба файла задеплоены на сервер в `~/.openclaw/workspace/`

### Публикация на GitHub
- Репозиторий: https://github.com/fibbersha-hub/openclaw-vk-plugin
- Создан Issue в основном репо OpenClaw: openclaw/openclaw#67529
- README обновлён: бейджи, контекст про VK (100M+ MAU)
- Topics: openclaw, openclaw-plugin, openclaw-channel, vk, vk-api, vkontakte, typescript, bot, ai-agent, long-poll

### Исследование OpenClaw
- Проведено глубокое исследование GitHub-репозитория openclaw/openclaw
- Исследованы все подсистемы: 25 каналов, 50+ провайдеров, 110+ плагинов, 60+ навыков, 22+ инструментов
- Создан `OPENCLAW_FULL_MAP.md` — полная техническая карта системы (~860 строк)
- Создан `OPENCLAW_GUIDE.html` — интерактивный гид для администратора

---

## 2026-04-16 — Сессия 2: Интеграция бесплатных сервисов

### Включение встроенных фич
Активированы в `openclaw.json`:
- **Browser** (Chromium) — автоматизация браузера, скриншоты, клики
- **Cron** — задачи по расписанию (maxConcurrentRuns: 1, retry: 3 попытки)
- **Memory** — builtin backend с citations: auto
- **Session isolation** — dmScope: per-peer (отдельная сессия для каждого пользователя)
- **Control UI** — веб-панель управления
- **OpenAI-совместимый HTTP API** — chatCompletions + responses endpoints

### Установка системных пакетов
На сервере установлены:
- **Chromium** (`/snap/bin/chromium`) — для browser-инструмента
- **ripgrep** (`/usr/bin/rg`) — для навыка session-logs
- **ffmpeg** (`/usr/bin/ffmpeg`) — для навыка video-frames

### Навыки (Skills): 9 из 52 готовы
| Навык | Описание |
|-------|----------|
| weather | Погода (wttr.in / Open-Meteo) |
| healthcheck | Аудит безопасности хоста |
| skill-creator | Создание новых навыков |
| taskflow | Workflow-автоматизация |
| taskflow-inbox-triage | Сортировка входящих задач |
| tmux | Управление tmux-сессиями |
| node-connect | Диагностика подключения устройств |
| session-logs | Поиск по логам сессий (НОВЫЙ — после установки rg) |
| video-frames | Извлечение кадров из видео (НОВЫЙ — после установки ffmpeg) |

### Подключение бесплатных API-сервисов

#### Brave Search
- URL: https://brave.com/search/api/
- Ключ: `****` (хранится в openclaw.json)
- Лимит: $5/мес бесплатных кредитов (≈1000 запросов/мес)
- Установлен spending limit $5.00
- Конфиг: `plugins.entries.brave.config.webSearch.apiKey`

#### Tavily
- URL: https://app.tavily.com
- Ключ: `****` (хранится в openclaw.json)
- Лимит: 1000 кредитов/мес бесплатно
- Конфиг: `plugins.entries.tavily.config.webSearch.apiKey`

#### Firecrawl
- URL: https://firecrawl.dev
- Ключ: `****` (хранится в openclaw.json)
- Лимит: 500 страниц/мес бесплатно
- Конфиг: `plugins.entries.firecrawl.config.webSearch.apiKey` + `webFetch.apiKey`

#### ElevenLabs (TTS — озвучка)
- URL: https://elevenlabs.io
- Ключ: `****` (хранится в openclaw.json)
- Лимит: ~10,000 символов/мес (~10 минут озвучки)
- Конфиг: `env.vars.ELEVENLABS_API_KEY` + `plugins.entries.elevenlabs.enabled: true`

### Исправления конфигурации
- `tools.web.search` — legacy формат, перенесён в `plugins.entries.<plugin>.config.webSearch`
- `session.reset.dailyAt` — неизвестный ключ, удалён
- `gateway.controlUi: true` — должен быть объект `{enabled: true}`
- `hooks.enabled: true` требует `hooks.token` — hooks убраны из конфига
- `plugins.entries.elevenlabs.config.apiKey` — invalid, заменён на env var

### Документация
- `OPENCLAW_FULL_MAP.md` — полная техническая карта (20 разделов)
- `OPENCLAW_FULL_MAP.html` — HTML-версия с тёмной темой
- `OPENCLAW_GUIDE.html` — интерактивный гид для администратора (15 разделов, мини-тест, комментарии)

---

## Текущее состояние системы

### Сервер
- **IP**: YOUR_SERVER_IP (Казахстан)
- **SSH**: root / `****`
- **Service**: `openclaw.service` (systemd, active)
- **Версия**: OpenClaw 2026.4.11

### LLM-провайдеры (5)
| Provider | Модель | Роль | Лимит |
|----------|--------|------|-------|
| Cerebras | `qwen-3-235b-a22b-instruct-2507` | **Primary** | 1M tok/день |
| Groq (×2 ключа) | `llama-3.3-70b-versatile` | Fast fallback | 2000 req/день |
| OpenRouter | `qwen/qwen3.6-plus-preview:free` | Сложные задачи | 600 req/день |
| Mistral | `mistral-small`, `codestral`, `pixtral` | Код + Vision | 2 RPM |
| Codex | `gpt-5.4`, `gpt-5.4-mini` | Если доступен | — |

### Инструменты интернета (4 провайдера)
| Сервис | Лимит/мес |
|--------|-----------|
| Brave Search | 1000 req ($5 кредитов) |
| Tavily | 1000 кредитов |
| Firecrawl | 500 страниц |
| DuckDuckGo | Безлимитный (fallback) |

### Медиа
| Сервис | Лимит/мес |
|--------|-----------|
| ElevenLabs TTS | ~10 мин озвучки |
| Mistral Pixtral | Понимание фото (2 RPM) |

### Активные функции
- Browser (Chromium) — автоматизация
- Cron — задачи по расписанию
- Memory — долгосрочная память
- Session isolation — per-peer
- Control UI — веб-панель
- OpenAI HTTP API — совместимый endpoint
- 9 навыков (weather, healthcheck, taskflow и др.)

### VK Канал
- Группа: Студия игрового террейна "Ульвар" (ID: YOUR_GROUP_ID)
- Long Poll: активен
- DM Policy: allowlist (2 пользователя: YOUR_VK_USER_ID, YOUR_PARTNER_VK_ID)

---

## 2026-04-16 — Сессия 3: Персоны, кнопки, PostgreSQL, Ozon импорт

### Архитектура персон (кнопочное меню)
- Создана система 14 персон-специалистов
- Каждая персона: свой характер, инструменты, кнопки
- Персоны загружаются по запросу (не в system prompt)
- System prompt сокращён с 24K до 1K chars

### 14 персон:
| Персона | Тип | Что делает |
|---------|-----|-----------|
| 📦 Завсклад | Скрипт | Каталог, остатки, заказы |
| 📤 Публикация | Скрипт | Кросс-постинг на 6 платформ |
| 🖨️ Печать | Скрипт | Очередь печати, ABC/XYZ |
| ✍️ Копирайтер | LLM | Тексты для соцсетей |
| 🎬 Сценарист | LLM | Видео-сценарии, раскадровка |
| 📈 SEO | LLM | Ключевые слова, оптимизация |
| 📅 Контент-менеджер | LLM | Контент-планы, рубрики |
| 🎨 Дизайнер | LLM | Генерация картинок AI |
| 🖼️ Оформитель | LLM | Цвета, шрифты, макеты |
| 📊 Инфографик | LLM | Визуализация данных |
| 🔎 Анализ фото | LLM | Оценка изображений |
| 🔍 Аналитик VK | Скрипт | Парсер VK, конкуренты |
| 📜 Хронист | Скрипт+LLM | Управление API-ключами |
| 💬 Чат | LLM | Свободное общение |

### Button Dispatcher (button-dispatcher.ts)
- Кнопки данных (📦📤🖨️🔍📜) → скрипты напрямую, без LLM
- Кнопки креатива (✍️🎬📈📅🎨🖼️📊🔎💬) → LLM с персоной
- Меню и подменю — мгновенные (без AI)
- Нет галлюцинаций для данных

### SQLite → PostgreSQL миграция
- 17 файлов переведены с sqlite3 на psycopg2
- Batch-конвертер: `scripts/convert_to_pg.py`
- Все скрипты Студии задеплоены на сервер: /opt/studio-3d/
- БД: Docker `ulvar-postgres` на сервере (user: studio_app, db: studio_db)

### Импорт каталога с Ozon
- Ozon API endpoint'ы обновлены: v2→v3 (v2 возвращал 404)
- simplejson конфликт починен
- Скрипт `import_from_ozon.py`: v3/product/list + v3/product/info/list
- **53 товара импортированы** в PostgreSQL с реальными ценами и остатками
- Ozon API roles добавлены: Product + Posting FBS + Admin read-only + Actions
- Ключ: b6c26fb9-..., истекает 26.09.2026

### Хронист (key_manager.py)
- Скрипт управления API-ключами: list, check, set, limits
- 21 сервис: Ozon, VK, Groq×4, OpenRouter×3, Cerebras, Mistral, Brave, Tavily, Firecrawl, ElevenLabs, Telegram
- Проверка работоспособности ключей (тестовые запросы)
- Замена ключей через бота (config.env + openclaw.json)
- Безопасность: ключи маскируются (первые 4 + последние 4 символа)

### GitHub
- Репо: https://github.com/fibbersha-hub/openclaw-vk-plugin
- Issue в OpenClaw: openclaw/openclaw#67529
- Stars: 0 (опубликовано 15.04.2026)

---

## 2026-04-20 — Сессия 4: Голос, OCR, Умные заметки, LLM-интенты

### Голосовые сообщения → текст (Groq Whisper)

**Проблема:** VK отдаёт голосовые сообщения в `att.audio_message`, а не `att.doc`.  
`extractVoice()` в `media.ts` читал `att.doc.url` → всегда `null`.

**Изменения:**
- `src/types.ts` — добавлен интерфейс `VkAudioMessage` (`link_ogg`, `link_mp3`, `duration`); добавлено `audio_message?` в `VkAttachment`; добавлены `groqApiKey?` и `transcribeVoice?` в `VkAccountConfig`
- `src/media.ts` — `extractVoice()` теперь читает `att.audio_message.link_ogg || .link_mp3`; в `buildMediaDescription()` добавлена длительность `[Голосовое, 7с]`
- `src/accounts.ts` — **критический фикс**: `resolveAccount()` возвращал объект без новых полей → добавлены `groqApiKey` и `transcribeVoice`
- `src/runtime.ts` — функция `transcribeVoice(url, mimeType)`: скачивает OGG, вызывает Groq Whisper API, принудительный `language=ru` (без него Whisper распознавал как исландский)
- `openclaw.plugin.json` + `setup-entry.ts` — добавлены поля groqApiKey и transcribeVoice в схему конфига

**Ротация Groq-ключей:**
- `getGroqKeys()` в `runtime.ts`: автообнаружение всех провайдеров `groq*` из `cfg.models.providers`
- При 429 — переход на следующий ключ; все ключи исчерпаны → возврат `null`

### LLM-классификация намерений (4-й уровень диспетчера)

Цепочка обработки сообщений:
1. Точное совпадение с кнопкой
2. Нормализованное совпадение (пробелы/регистр)
3. Keyword-матчинг `VOICE_INTENTS` (20+ паттернов)
4. **LLM-классификация** (Groq llama-3.3-70b, temp=0, max_tokens=20)
5. Свободный чат (LLM без персоны)

**`LLM_OVERRIDE_PHRASES`** — список фраз ("напиши", "придумай", "объясни" и др.), при наличии которых LLM-классификация пропускается и сообщение уходит сразу в свободный чат.

**`LLM_INTENT_MAP`** — 20 именованных интентов: заказы Ozon, цены, остатки, товары VK, Avito, ABC/XYZ, аудитория, конкуренты и др.

### OCR фотографий и скриншотов

- `ocrImage(url, question?)` в `runtime.ts`
- **Tesseract OCR 5.3.4** — локально, бесплатно, `rus+eng`; установлен: `apt install tesseract-ocr tesseract-ocr-rus`
- Если Tesseract вернул < 20 символов → **Pixtral fallback** (Mistral vision API)
- Изображения обрабатываются до передачи LLM; результат OCR + вопрос пользователя = контекст

### Умные заметки с поиском

Новый файл: `scripts/notes.py` → задеплоен `/opt/openclaw-notes/notes.py`

| Команда | Описание |
|---------|----------|
| `notes.py save "текст" [--tag тег]` | Сохранить заметку |
| `notes.py list [--limit N]` | Последние N заметок |
| `notes.py search "запрос"` | FTS5 полнотекстовый поиск |
| `notes.py delete ID` | Удалить |
| `notes.py get ID` | Полный текст |

- SQLite + FTS5 virtual table (`notes_fts`) с триггерами auto-sync
- Автоизвлечение `#хештегов` из текста, очистка контента
- Fallback: LIKE-поиск если FTS5 недоступен
- DB: `/opt/openclaw-notes/notes.db`

**Добавлено в диспетчер:**
- Тип `scriptFn: (text, peerId) => string | null` в `ButtonAction`
- Хелпер `shellEscape()` — POSIX-безопасное экранирование аргументов
- `NOTES_MENU` + кнопка 📝 Заметки в главном меню
- Голосовые интенты: «запомни», «найди заметку», «покажи заметки», «удали заметку #N»
- LLM-интенты: `notes_save`, `notes_search`, `notes_list`, `notes_delete`
- Виртуальные ключи `notes_save`, `notes_search`, `notes_delete`, `notes_get` — dynamically build команду из текста пользователя

---

## 2026-04-20 — Сессия 5: Напоминания, Дайджест, Список дел, Погода

### Напоминания (reminders.py)

Новый файл: `scripts/reminders.py` → задеплоен `/opt/openclaw-notes/reminders.py`

**SQLite-схема:** `id, text, peer_id, remind_at, created, sent`

| Команда | Описание |
|---------|----------|
| `reminders.py add "текст" --peer PEER_ID` | Создать напоминание |
| `reminders.py list [--peer PEER_ID]` | Список активных |
| `reminders.py delete ID` | Удалить |
| `reminders.py check` | Отправить просроченные (cron) |
| `reminders.py setup-cron` | Настроить cron автоматически |

**Парсер естественного языка** (без внешних API):
- `через N минут/часов/дней`
- `в HH:MM` (сегодня или завтра если прошло)
- `завтра в HH:MM`
- `в HH:MM завтра`
- Извлечение текста: вырезается временное выражение, остаток = текст напоминания

**Отправка через VK API:**
- Токен читается из `/root/.openclaw/openclaw.json` → `channels.vk.token`
- `vk_send(peer_id, message, token)` — stdlib `urllib`, без зависимостей
- Cron каждую минуту: `* * * * * python3 /opt/openclaw-notes/reminders.py check`

**Добавлено в диспетчер:**
- `peerId` добавлен 4-м аргументом в `dispatchButton(text, log, groqKeys, peerId)`
- `msg.peer_id` передаётся из `runtime.ts`
- `scriptFn` теперь принимает `(text, peerId)` — peerId используется для напоминаний
- `REMINDERS_MENU` + кнопка ⏰ Напоминания в главном меню
- Голосовые интенты: «напомни», «покажи напоминания», «удали напоминание #N»
- LLM-интенты: `reminder_add`, `reminder_list`, `reminder_delete`

### Список дел (todos.py)

Новый файл: `scripts/todos.py` → задеплоен `/opt/openclaw-notes/todos.py`

**SQLite-схема:** `id, text, done, created, done_at`

| Команда | Описание |
|---------|----------|
| `todos.py add "текст"` | Добавить задачу |
| `todos.py done ID` | Отметить выполненной |
| `todos.py list [--all]` | Список (по умолчанию — незавершённые) |
| `todos.py delete ID` | Удалить |

**Добавлено в диспетчер:**
- `TODOS_MENU` + кнопка ✅ Дела в главном меню
- Виртуальные ключи `todos_add`, `todos_done`, `todos_delete`
- Голосовые интенты: «добавь задачу», «список дел», «что на сегодня», «выполнено #N»
- LLM-интенты: `todos_add`, `todos_done`, `todos_list`

### Ежедневный дайджест (daily_digest.py)

Новый файл: `scripts/daily_digest.py` → задеплоен `/opt/openclaw-notes/daily_digest.py`

**Секции дайджеста (порядок отображения):**

| # | Секция | Источник |
|---|--------|----------|
| 1 | День недели + мотивирующая фраза | Python random, 3 фразы × 7 дней |
| 2 | 🌤️ Погода · Оренбург | Open-Meteo API (бесплатно, без ключа) |
| 3 | 📦 Заказы Ozon на сегодня | Ozon FBS API, фильтр по дедлайну и статусу |
| 4 | ✅ Список дел | todos.db — все незавершённые |
| 5 | ⏰ Напоминания на 24ч | reminders.db — per peer_id |
| 6 | 📝 Заметки за сегодня | notes.db — created today |

**Погода (Open-Meteo):**
- Координаты Оренбурга: `lat=51.7727, lon=55.0988`
- Часовой пояс: `Asia/Yekaterinburg` (UTC+5)
- Данные: температура, ощущаемая температура, код погоды (WMO), ветер, мин/макс дня, осадки
- 99 кодов WMO → emoji + русское описание
- Нет API-ключа, нет ограничений

**Заказы Ozon:**
- Фильтр статусов: `awaiting_packaging`, `awaiting_deliver`
- Фильтр дедлайна: `shipment_date <= сегодня` (просроченные + сегодняшние)
- Credentials: читаются из `/opt/studio-3d/config/config.env`
- При нет срочных — показывает общий счётчик ожидающих

**Cron:** `0 9 * * * python3 /opt/openclaw-notes/daily_digest.py --peer PEER_ID`  
Настраивается командой: `daily_digest.py setup-cron --peer ID --time HH:MM`

**Кнопка в меню:** 📊 Дайджест (в подменю напоминаний)  
**Голосовые интенты:** «дайджест», «сводка дня»  
**LLM-интент:** `digest_now`

### Структура файлов на сервере

```
/opt/openclaw-notes/
├── notes.py          — заметки (SQLite + FTS5)
├── notes.db          — база заметок
├── reminders.py      — напоминания + VK-отправка
├── reminders.db      — база напоминаний
├── todos.py          — список дел
├── todos.db          — база задач
└── daily_digest.py   — ежедневный дайджест
```

### Cron на сервере (crontab -l)
```
* * * * * python3 /opt/openclaw-notes/reminders.py check >> /var/log/openclaw-reminders.log 2>&1
0 9 * * * python3 /opt/openclaw-notes/daily_digest.py --peer PEER_ID >> /var/log/openclaw-digest.log 2>&1
```
> ⚠️ PEER_ID нужно обновить на реальный VK ID: `daily_digest.py setup-cron --peer ВАШ_ID`

### Итоговые голосовые и текстовые команды

| Фраза | Действие |
|-------|----------|
| «запомни купить молоко» | Сохранить заметку |
| «запомни текст #работа» | Заметка с тегом |
| «найди заметку молоко» | FTS5 поиск |
| «покажи заметки» | Последние 10 |
| «удали заметку #3» | Удалить |
| «напомни через 30 минут купить молоко» | Напоминание |
| «напомни в 18:30 позвонить врачу» | Напоминание на сегодня/завтра |
| «напомни завтра в 9:00 встреча» | Напоминание на завтра |
| «покажи напоминания» | Список активных |
| «удали напоминание #3» | Удалить |
| «добавь задачу позвонить в банк» | Добавить в список дел |
| «что на сегодня» / «мои дела» | Список дел |
| «выполнено #2» | Отметить задачу сделанной |
| «дайджест» | Сводка дня прямо сейчас |

---

## 2026-04-20 — Сессия 6: Аудит LLM-провайдеров, фикс конфига

### Проверка реальной доступности провайдеров с сервера

**Метод:** реальные `chat/completions` запросы с сервера YOUR_SERVER_IP (KZ).

**Результаты первого теста (Python urllib без UA):**
| Провайдер | Результат |
|-----------|-----------|
| groq (все 4 ключа) | ❌ HTTP 403 |
| cerebras | ❌ HTTP 403 |
| openrouter | ✅ 200 |
| mistral | ✅ 200 |

**Причина 403:** Cloudflare WAF блокирует `User-Agent: Python-urllib/3.x` на Groq и Cerebras.  
`curl` работал сразу (отдал 200), что и выявило проблему.

**Фикс:** добавить `User-Agent: Mozilla/5.0` в заголовки Python-запросов.  
После фикса — все провайдеры работают.

### Найденные проблемы в конфиге

1. **groq-3 и groq-4 не были в openclaw.json** — хранились только в `config.env`, в ротацию не попадали.
2. **Cerebras модель `gpt-oss-120b`** — возвращала 404 (убрана с платформы).

### Изменения в конфиге

```
/root/.openclaw/openclaw.json:
  + providers.groq-3  (gsk_XXXX...XXXX)
  + providers.groq-4  (gsk_XXXX...XXXX)
  - providers.cerebras.models: gpt-oss-120b (удалена, 404)
```

**Итоговые рабочие провайдеры (7):**
| Провайдер | Ключ | Модели |
|-----------|------|--------|
| groq | gsk_XXXX...XXXX | llama-3.3-70b-versatile |
| groq-2 | gsk_XXXX...XXXX | llama-3.3-70b-versatile |
| groq-3 | gsk_XXXX...XXXX | llama-3.3-70b-versatile |
| groq-4 | gsk_XXXX...XXXX | llama-3.3-70b-versatile |
| cerebras | csk-****...*** | qwen-3-235b-a22b-instruct-2507, llama3.1-8b |
| mistral | dtIi...IWWN | mistral-small-latest, pixtral-12b, codestral |
| openrouter | sk-or-v1-**** | 24 free-модели (arcee trinity, gemma-3, llama-3.3, nvidia nemotron, qwen3-coder и др.) |

### Статистика GitHub (данные за 15–19 апреля)
- **131 клонирование**, 76 уникальных пользователей
- 24 просмотра страницы
- Источники трафика: away.vk.com (8), github.com (2), Bing (2)
- Пик 18.04: 81 клон за день (вероятно расшарили в чате)

---

## 2026-04-21 — Сессия 7: Адресация напоминаний «для кого-то»

### Маршрутизация напоминаний другим пользователям

**Задача:** поставить напоминание не себе, а другому пользователю — «напомни для Солнца в 18:00 позвонить»

**Реализация в `reminders.py`:**
- Добавлен `CONTACTS_PATH` → `scripts/contacts.json` (рядом со скриптом)
- `load_contacts()` — загружает JSON `{имя_в_любом_падеже: peer_id}`
- `resolve_recipient(text, sender_peer_id)` — regex `\bдля\s+([а-яёА-ЯЁa-zA-Z]+)`, ищет в contacts, удаляет из текста
- `cmd_add()` вызывает `resolve_recipient()` до разбора аргументов

**Контакты на сервере (`/opt/openclaw-notes/contacts.json`):**
```json
{
  "солнце": YOUR_PARTNER_VK_ID, "солнца": YOUR_PARTNER_VK_ID, "солнцу": YOUR_PARTNER_VK_ID, "солнцем": YOUR_PARTNER_VK_ID,
  "люба": YOUR_PARTNER_VK_ID, "любы": YOUR_PARTNER_VK_ID, "любе": YOUR_PARTNER_VK_ID, "любу": YOUR_PARTNER_VK_ID,
  "любой": YOUR_PARTNER_VK_ID, "любовь": YOUR_PARTNER_VK_ID, "любови": YOUR_PARTNER_VK_ID,
  "шилина": YOUR_PARTNER_VK_ID, "шилиной": YOUR_PARTNER_VK_ID
}
```
Добавлены все падежи вручную после обнаружения, что «для солнца» (родительный падеж) не находил «солнце» (именительный).

**Примеры команд:**
- «напомни для Солнца в 18:00 позвонить» → напоминание уходит на peer_id YOUR_PARTNER_VK_ID
- «напомни для Любы через 2 часа» → то же самое
- «напомни в 20:00 купить хлеб» → отправителю (без «для»)

---

## 2026-04-21 — Сессия 8: Интеграция VK-аналитики (Знайка → OpenClaw)

### Происхождение

VK-аналитика ранее существовала только как документация в `ZNAIKA_APP_GUIDE.md` (проект Знайка). Скриптов на сервере или локально не было — созданы с нуля.

### Созданные скрипты

#### `scripts/vk_parser.py` → `/opt/studio-3d/scripts/vk_parser.py`
Самодостаточный (только stdlib), без внешних зависимостей.

| Команда | Описание |
|---------|---------|
| `group-stats <screen_name>` | Подписчики, посты, товары, ER, последняя активность |
| `audience <screen_name> [--limit N]` | Демография: пол, возраст, топ городов |
| `search-groups <query> [--limit N]` | Поиск групп по теме (сортировка по числу подписчиков) |

**Токен:** читается из `/root/.openclaw/openclaw.json` с приоритетом над `config.env`.  
Причина: токен из `config.env` привязан к IP YOUR_ZNAIKA_IP (Знайка-сервер), а openclaw.json — к YOUR_SERVER_IP.

#### `scripts/vk_competitors.py` → `/opt/studio-3d/scripts/vk_competitors.py`
Мониторинг конкурентов в VK Market.

| Команда | Описание |
|---------|---------|
| `list` | Список отслеживаемых конкурентов |
| `add <screen_name>` | Добавить конкурента |
| `scan` | Обновить данные (цены, количество товаров) |
| `report` | Сравнение: наши цены vs конкуренты (⚠️ если дешевле на 20%+) |

**Хранение:** `/opt/studio-3d/data/competitors.json` + `competitors_cache.json`  
**Наша группа:** ID YOUR_GROUP_ID (Ульвар)

### Интеграция в button-dispatcher.ts

**Меню аналитика (ANALYST_MENU):**
- ✅ Исправлен путь: `cd /opt/studio-3d && python3 scripts/...` (не `TOOLS_DIR`)
- ✅ Добавлена кнопка `➕ Добавить конкурента`
- ✅ Перенесена кнопка `🔍 Найти группы` на отдельный ряд

**Новые виртуальные действия:**
- `competitor_add` — парсит screen_name из текста, вызывает `vk_competitors.py add`
- `vk_search_groups` — вырезает ключевые слова интента, вызывает `vk_parser.py search-groups`

**Голосовые интенты:**
- «найди группы ...» / «поищи группы ...» → `vk_search_groups`
- «добавь конкурента ...» → `competitor_add`
- «скань конкурентов» → `🕵️ Конкуренты`

### Исправленные баги

| Баг | Причина | Фикс |
|-----|---------|------|
| `print_queue_cli.py` — IndentationError | Неверный отступ `from psycopg2...` и `with` блока в `cmd_set_hours`/`cmd_config` | Исправлена индентация |
| `vk_parser.py` — IP-бан VK | `get_token(prefer_user=True)` брал VK_USER_TOKEN (IP YOUR_ZNAIKA_IP) | Убран параметр, всегда `VK_ACCESS_TOKEN` |
| `config.env` перекрывал openclaw.json | `cfg.setdefault(...)` не перезаписывал | Заменён на прямое присваивание |
| `vk_competitors.py` `scan` — кнопка не работала | Диспетчер передавал неверный путь | Добавлен `cd /opt/studio-3d &&` |
| `📋 Очередь` — команда не существует | Вызывался `print_queue_cli.py status` (нет такой) | Заменено на `queue` |

### Тест результатов (production)
```
vk_parser.py group-stats ulvar_terrane
→ ✅ Студия игрового террейна "Ульвар", 7 подписчиков, D&D, minifreemarket.com

vk_competitors.py list
→ ✅ Список пуст (готов к заполнению)

print_queue_cli.py queue
→ ✅ 31 задача, ~294 часа
```

---

## Ключевые файлы на сервере

```
/root/.openclaw/openclaw.json          — основной конфиг
/root/.openclaw/agents/main/agent/models.json — модели и провайдеры
/root/.openclaw/workspace/AGENTS.md    — инструкции агента
/root/.openclaw/workspace/TOOLS.md     — инструменты магазина
/root/.openclaw/workspace/SOUL.md      — личность бота
/root/.openclaw/workspace/IDENTITY.md  — имя и аватар
/root/.openclaw/workspace/USER.md      — профиль пользователя

/opt/openclaw-vk-plugin/               — VK плагин (Node.js)
├── dist/src/runtime.js                — Long Poll, Whisper, OCR
├── dist/src/button-dispatcher.js      — 4-уровневый диспетчер
├── dist/src/accounts.js               — resolveAccount (groqApiKey фикс)
└── dist/src/media.js                  — extractVoice (audio_message фикс)

/opt/openclaw-notes/                   — Личный ассистент (Python, SQLite)
├── notes.py + notes.db                — Умные заметки + FTS5
├── reminders.py + reminders.db        — Напоминания + VK-отправка
├── todos.py + todos.db                — Список дел
└── daily_digest.py                    — Ежедневный дайджест

/opt/studio-3d/                        — Скрипты магазина
├── scripts/show_orders.py             — Заказы Ozon FBS
├── scripts/stock_admin.py             — Остатки
├── scripts/key_manager.py             — Управление API-ключами
├── scripts/vk_parser.py               — VK: group-stats, audience, search-groups
├── scripts/vk_competitors.py          — VK Market: мониторинг конкурентов
├── scripts/print_queue_cli.py         — Очередь печати (ABC/XYZ аналитика)
├── data/competitors.json              — Список конкурентов (initially empty)
└── config/config.env                  — OZON_CLIENT_ID, OZON_API_KEY

/opt/openclaw-notes/                   — Личный ассистент
└── contacts.json                      — Контакты для адресации напоминаний
```

---

## 2026-04-22 — Сессия 7: Полный аудит системы, фиксы стабильности

### Задачи сессии
Полный функциональный тест всей системы + устранение найденных багов.

### Исправленные баги

| # | Баг | Решение |
|---|-----|---------|
| 1 | `groups.search` падал с community token (`Group authorization failed`) | `vk_parser.py`: `get_token(user=True)` для search-groups и audience |
| 2 | Голос транскрибировался неточно (Whisper turbo) | `runtime.ts`: модель `whisper-large-v3-turbo` → `whisper-large-v3` |
| 3 | Длинные голосовые: выполнялась только первая команда | `button-dispatcher.ts`: Multi-command pipeline — `scanAllScriptIntents()` + `Promise.all` |
| 4 | Погода выдавала ошибку в дайджесте (Open-Meteo timeout из KZ) | `daily_digest.py`: добавлен fallback на wttr.in (timeout 10s → wttr.in → "недоступна") |
| 5 | "25 числа" не парсилось в reminders.py | Добавлен паттерн `(\d{1,2})[\-го]*\s*числа` + поддержка "текущего" месяца в `_parse_date_ru()` |
| 6 | Кнопка "📤 Все площадки" падала (`cross_publish.py` требует `improved_products.json`) | Кнопка переключена на `platform_status.py` |
| 7 | Сталые напоминания (>24h) зависали в статусе `sent=0` | `reminders.py cmd_check()`: auto-cleanup сталых с пометкой `sent=1` |
| 8 | Cron `vk_competitors.py` указывал на `/tools/` (не существует) | `crontab`: путь исправлен на `/opt/studio-3d/scripts/vk_competitors.py` |

### Multi-command pipeline (детали)

`button-dispatcher.ts` — новая логика Level 3:

1. `scanAllScriptIntents()` — проходит ВСЕ `VOICE_INTENTS`, собирает все совпавшие actions (исключая `passToLLM` и чисто-статические)
2. Если найдено несколько команд → `Promise.all` (параллельное выполнение)
3. Если найдена 1 команда и нет LLM-фраз → обычное выполнение
4. Если нужен LLM (несколько команд ИЛИ есть `LLM_NEEDED_PHRASES`) → `{ handled: false, scriptResults: ctx }`
5. `runtime.ts`: при `dispatch.scriptResults` — результаты скриптов дописываются в начало сообщения для LLM как контекст

### Ежедневный дайджест для Любы (YOUR_PARTNER_VK_ID)

Добавлены cron-задачи:
```
0 2 * * 1-5  daily_digest.py --peer YOUR_PARTNER_VK_ID --workday-only   # будни
0 5 * * *    daily_digest.py --peer YOUR_PARTNER_VK_ID --holiday-only   # выходные
```

### Напоминания — улучшения

- `cmd_list()`: разделение активных и просроченных (просроченные с маркером ⚠️)
- `human_delta()`: даты >30 дней теперь показывают год (`05.03.2027 в 10:00`)
- Новые паттерны времени: `"25 числа"`, `"через N часов и N минут"`

### Генерация изображений — Pollinations.ai

**Сервис:** https://image.pollinations.ai  
**Стоимость:** Полностью бесплатно, без регистрации, без API-ключа  
**Модель:** FLUX Realism (1024×1024)  
**Задержка:** ~30-60 секунд на изображение

**Архитектура:**
- `button-dispatcher.ts`: новый тип `imageFn` в `ButtonAction`, `imagePrompt` в `DispatchResult`
- Новый action `image_generate` с `imageFn` (извлекает промпт из текста)
- Voice intents: "нарисуй", "сгенерируй картинку/изображение/рисунок", "создай картинку"
- `runtime.ts`: метод `generateAndSendImage(prompt, peerId)`:
  1. Сообщает "Генерирую..."
  2. GET `https://image.pollinations.ai/prompt/{encoded}?model=flux-realism&nologo=true&seed={random}`
  3. Скачивает JPEG
  4. Загружает в VK через `api.uploadPhotoForMessage`
  5. Отправляет с вложением `photo{owner}_{id}`

**Примеры фраз:**
- «нарисуй замок в тумане»
- «нарисуй терраин для D&D с башней»
- «сгенерируй картинку болота ночью»
- «создай изображение горного пейзажа»

**URL формат:**
```
https://image.pollinations.ai/prompt/{URL_encoded_prompt}?width=1024&height=1024&model=flux-realism&nologo=true&seed={random}
```

### Генерация изображений — финальная архитектура (после отладки)

**Проблема с загрузкой фото в VK:**
- VK `photos.getMessagesUploadServer` возвращает `photo: "[]"` для community-токена
- VK изменил политику API (письмо от VK ID): расширенные API-доступы больше не выдаются
- `docs.getMessagesUploadServer` тоже зависал без ответа с community-токеном

**Итоговое решение:** отправляем прямую ссылку на изображение Pollinations.ai — открывается в браузере одним тапом.

```
runtime.ts: generateAndSendImage(prompt, peerId)
  1. HEAD-запрос к Pollinations.ai (проверяем что ответил)
  2. messagesSend: текст = "🖼️ {prompt}\n\n{imageUrl}"
```

**Quality prompt prefix** (добавляется автоматически к каждому запросу):
```
masterpiece, highly detailed, photorealistic, sharp focus, 8k, professional photography,
correct human anatomy, natural proportions, no deformities, no extra limbs,
no missing limbs, no artifacts, no distortion, no watermark, cinematic lighting
```

**Поддерживаемые фразы** (voice intents):
- нарисуй / дорисуй / нарисовать
- сгенерируй картинку/изображение/рисунок/фото/арт
- создай картинку/изображение/рисунок/фото/арт
- сделай картинку/изображение/рисунок
- хочу/нужна картинку

### Contacts.json — финальный состав

Файл `/opt/openclaw-notes/contacts.json` — маппинг имён → peer_id.
- Люба / Любовь / Солнышко / Шилина → peer_id Любы
- Андрей / Любимый (так назвала Люба) / Шилин → peer_id Андрея

### Системная проверка (результаты)

| Компонент | Статус |
|-----------|--------|
| openclaw.service | ✅ active |
| platform_status.py (Ozon/VK/Avito/CRM) | ✅ 53/50/0/49 товаров |
| print_queue_cli.py | ✅ 31 задача, ~294ч |
| vk_parser.py group-stats | ✅ |
| notes / todos / reminders | ✅ (1/3/4) |
| weather (Open-Meteo) | ✅ +11°C |
| Groq 4 ключа | ✅ OK |
| daily_digest → YOUR_VK_USER_ID | ✅ отправлен |
| daily_digest → YOUR_PARTNER_VK_ID | ✅ cron добавлен |
| show_orders.py / stock_admin.py | ✅ |
| show_vk_market.py / show_vk_orders.py | ✅ |
| show_prices.py / key_manager.py | ✅ |
| cron vk_competitors | ✅ путь исправлен |

### Аудит нереализованных возможностей

#### 🔴 Не работает / не настроено
| Компонент | Проблема |
|-----------|---------|
| `cross_publish.py` | Требует `improved_products.json` — нужен запуск `improve_texts.py` сначала |
| `improve_texts.py` | Кредиты на генерацию изображений исчерпаны (Flux, SDXL, Realistic) |
| `gen_preview.py` | Зависит от improve_texts.py |
| `show_avito.py` | XML-фид пуст — нужна настройка Avito (авторизация, загрузка XML на Avito) |
| `vk_competitors.py` | Список конкурентов пуст — нужно добавить: `vk_competitors.py add <screen_name>` |
| Контакты Андрея | Ждём ответа Любы как она хочет называть Андрея |

#### 🟡 Реализовано, но не подключено к боту
| Компонент | Статус |
|-----------|--------|
| `research_competitors.py` | Скрипт есть, в кнопках не задействован |
| `push_prices_ozon.py` | Загрузка цен на Ozon — скрипт есть, кнопки нет |
| `push_prices_vk.py` | Загрузка цен в VK — скрипт есть, кнопки нет |
| `push_catalog_mfm.py` / `sync_mfm_listings.py` | MFM синхронизация — скрипты есть, кнопок нет |
| `daily_sync.py` / `ozon_sync.py` | Авто-синхронизация каталога — скрипты есть |
| `add_shipping_note.py` | Добавление примечания к заказу — не в меню |
| ElevenLabs TTS | Ключ настроен, но озвучка ответов не активирована |
| Browser (Chromium) | Включён в конфиге, не используется активно |
| Brave Search / Tavily / Firecrawl | Ключи настроены, LLM использует при веб-поиске |
| OpenAI-совместимый HTTP API | Активен (порт OpenClaw), не используется внешне |

#### 🟢 Работает и подключено
| Компонент | Статус |
|-----------|--------|
| Голос → Whisper → команды | ✅ |
| Multi-command pipeline | ✅ |
| OCR фото (Tesseract + Pixtral) | ✅ |
| Заметки / Дела / Напоминания | ✅ |
| Ежедневный дайджест | ✅ (Андрей + Люба) |
| Погода с fallback | ✅ |
| Ozon заказы/остатки/цены | ✅ |
| VK Market товары/заказы | ✅ |
| Очередь печати (ABC/XYZ) | ✅ |
| Статус платформ | ✅ |
| Управление ключами | ✅ |
| VK статистика группы | ✅ |
| VK поиск групп (user token) | ✅ |
| 7 LLM-провайдеров с ротацией | ✅ |
| Session isolation per-peer | ✅ |
| Генерация изображений (Pollinations.ai) | ✅ ссылкой |

### Доступность бесплатных API с российского IP (тест 2026-04-22)

| Провайдер | RU IP | Метод проверки |
|-----------|-------|----------------|
| Groq | ✅ Работает | HTTP 401 (нет ключа), реальный запрос OK |
| Cerebras | ✅ Работает | HTTP 403 без UA, с UA Mozilla — OK |
| OpenRouter | ✅ Работает | HTTP 200 |
| Mistral | ✅ Работает | HTTP 401 (нет ключа) |
| Together.ai | ✅ Работает | HTTP 401 (нет ключа) |
| HuggingFace | ✅ Работает | HTTP 200 |
| Pollinations.ai | ✅ Работает | HTTP 200, изображение получено |
| Google Gemini | ❌ Заблокирован | HTTP 403, санкции US |

**Вывод:** все наши провайдеры доступны с RU IP без VPN.

### Репозиторий GitHub

Запушен коммит `feat: complete personal assistant system + image generation`:
- 33 файла, +8557 строк
- Добавлены: scripts/, personas/, skills/, JOURNAL.md, AGENTS.md, TOOLS.md, документация
- Репо: https://github.com/fibbersha-hub/openclaw-vk-plugin

---

## 2026-04-23 — Сессия 9: Расширение защиты от инъекций, публикация, GitHub

### Защита от prompt injection — полный аудит и три уровня

Инициировано после скриншота из Telegram-чата с предупреждением о prompt injection атаках на VK-ботов.

**L1 — Allowlist (до сессии уже был, доработан через security_wizard.py):**
- `dmPolicy: "allowlist"` — только VK ID из `allowFrom` могут писать
- Добавлен `scripts/security_wizard.py` — интерактивный мастер настройки L1/L2/L3

**L2 — Injection Filter v1 → v2:**

Первоначальная реализация — простые regex-паттерны. После запроса "расширить максимально" переработана в систему оценки:

| Tier | Вес | Примеры паттернов |
|------|-----|-------------------|
| CRITICAL | 100 | LLM-токены `<\|im_start\|>`, shell subshell `$(...)`, path traversal `../../` |
| HIGH | 80 | "игнорируй инструкции", "jailbreak", "DAN mode", "без ограничений" |
| MEDIUM | 60 | смена роли "ты теперь", "act as", извлечение промта "покажи system prompt" |
| SUSPICIOUS | 40 | гипотетический фрейм, социнженерия "я разработчик системы", `process.env` |
| LOW | 20 | "без цензуры", "bypass filter", `eval(`, base64-манипуляции |

4 детектора обфускации:
- `detectHomoglyphs()` — смешение латиница/кириллица (+50)
- `detectInvisibleChars()` — невидимые Unicode-символы (+60)
- `detectBase64Payload()` — base64 decode + проверка на injection (+70)
- `detectTokenSmuggling()` — избыток спецсимволов (+50)

Per-peer tracking: `SuspicionRecord` — накопление страйков, бан 1ч с удвоением при повторе.

**L3 — System Prompt Hardening:**
- Каждое сообщение к LLM предваряется `[SYSTEM SECURITY NOTICE: ...]`
- Запрещает модели менять роль, выполнять инструкции из входящих сообщений, раскрывать внутренние данные

**Дополнительные уязвимости (8 штук) → закрыты:**

| # | Уязвимость | Фикс |
|---|-----------|------|
| 1 | OCR/Voice indirect injection | `detectInjection()` до добавления в body; тег `[IMAGE_TEXT:]`/`[VOICE_INPUT:]` |
| 2 | LLM exec tool abuse | `ToolsDeny: ["exec", "browser"]` всегда |
| 3 | Browser indirect injection | `ToolsDeny: ["browser"]` всегда |
| 4 | Rate limit DoS | `checkRateLimit()` — 15 сообщений/минуту на peer |
| 5 | Context flood | `MAX_INPUT_LENGTH = 3000` chars |
| 6 | Response leakage (ключи в ответе) | `sanitizeOutboundResponse()` — 11 паттернов |
| 7 | Untrusted OCR/voice as commands | Контент тегируется как внешние данные |
| 8 | Context flooding через LLM | `MAX_BODY_TO_LLM = 4000` chars, обрезка |

**Перекрёстная проверка (2 раунда):**
- Раунд 1: 8 уязвимостей найдено и закрыто
- Раунд 2 (новая модель): добавлены паттерны Mistral key + Anthropic key в outbound sanitizer; pixtral-12b-2409 → pixtral-large-2411; intent classifier переключён на llama-3.1-8b-instant

### Смена основной модели и расширение списка провайдеров

**Добавлены новые модели из Groq API (live-запрос на сервер):**
- `meta-llama/llama-4-scout-17b-16e-instruct` — новая модель Llama 4
- `openai/gpt-oss-120b` — открытая модель OpenAI 120B
- `openai/gpt-oss-20b` — открытая модель OpenAI 20B
- `qwen/qwen3-32b` — Qwen3 32B
- `groq/compound`, `groq/compound-mini` — Groq Compound

**Добавлены из Cerebras API:**
- `gpt-oss-120b` — GPT-OSS 120B на Cerebras
- `zai-glm-4.7` — ZAI GLM 4.7

**Добавлены из OpenRouter API (бесплатные):**
- `openai/gpt-oss-120b:free`
- `nvidia/nemotron-3-super-120b-a12b:free`
- `qwen/qwen3-next-80b-a3b-instruct:free`
- `google/gemma-4-31b-it:free`
- `qwen/qwen3-coder:free`

**Mistral (актуальные модели):**
- `pixtral-large-2411` (vision, заменил pixtral-12b-2409)
- `open-mistral-nemo` (бесплатный)

**Новый primary:** `cerebras/qwen-3-235b-a22b-instruct-2507`
**Цепочка fallback (8 уровней):** groq/gpt-oss-120b → groq-2/gpt-oss-120b → groq/llama-4-scout → cerebras/gpt-oss-120b → groq-3/llama-3.3-70b → openrouter/gpt-oss-120b → groq-4/gpt-oss-20b → mistral

**Подтверждено:** Anthropic API доступен с KZ IP (HTTP 401 = нет ключа, не блокировка).

### Настройка wizard'ов

Созданы два интерактивных скрипта:
- `scripts/setup_wizard.py` — полная интерактивная настройка (тестирует ключи, пишет openclaw.json)
- `scripts/security_wizard.py` — настройка L1/L2/L3 безопасности с бэкапом конфига

### Публикация

**Выпуск публикаций** о плагине:

Постили о плагине в Telegram-канале и сообществах. Также написали тексты для VK, Reddit, Hacker News (у пользователя нет логина — отложено).

**Документация обновлена:**
- `docs/LLM_KEYS_GUIDE.md` — гид по бесплатным LLM-провайдерам (проверено с RU IP, апрель 2026)
- `docs/OZON_INTEGRATION.md` — интеграция Ozon Seller API
- `docs/VK_INTEGRATION_2026.md` — политика VK 2026 (изменения API)

**GitHub Actions:** темы репозитория настроены через API.

**GitHub stats (на момент сессии):** 131 клон за 5 дней, источники: away.vk.com, github.com, Bing.

### Очистка чувствительных данных из git-истории

Три прохода `git filter-branch`:
1. IP-адреса + VK user ID → заглушки
2. Group ID 225425795 → YOUR_GROUP_ID
3. IP 85.198.71.249 (старый сервер) → YOUR_OLD_SERVER_IP

Результат: git-история очищена, force push на GitHub.

---

## 2026-04-23 — Сессия 10: Интеграция gstack v1.6.1.0

### Изучение репозитория garrytan/gstack

Проведено полное изучение репозитория [garrytan/gstack](https://github.com/garrytan/gstack):
- 74 директории, версия 1.6.1.0 (MIT лицензия)
- Автор: Garry Tan (CEO Y Combinator)
- 23 специализированных скилла для полного цикла разработки

**Ключевые находки:**

1. **Встроенная OpenClaw интеграция** — в репо есть директория `openclaw/` с готовыми артефактами для нашей платформы
2. **4 нативных методологических скилла** для OpenClaw:
   - `gstack-openclaw-office-hours` — 6 форсирующих вопросов ДО написания кода
   - `gstack-openclaw-ceo-review` — 11-секционный аудит плана, 4 режима (expansion/hold/reduce/selective)
   - `gstack-openclaw-investigate` — железный закон: NO FIX WITHOUT ROOT CAUSE
   - `gstack-openclaw-retro` — недельная инженерная ретроспектива
3. **6-уровневая защита от prompt injection в браузере** (L1-L6: content security → ML BERT → Haiku → canary token → ensemble)
4. **Архитектура:** долгоживущий Chromium daemon (100-200ms vs 3-5s холодный старт), Bun runtime, compiled binary ~58MB

**dispatch routing** из `openclaw/agents-gstack-section.md`:
| Tier | Когда | Действие |
|------|-------|---------|
| SIMPLE | <10 строк кода | Напрямую |
| MEDIUM | Multi-file | gstack-lite discipline |
| HEAVY | Конкретный скилл (/cso, /review) | Читать SKILL.md |
| FULL | Фича, проект | /office-hours → /ceo-review → implement |
| PLAN | Планирование без кода | /office-hours → /ceo-review → save plan |

### Интеграция

**Установлено глобально (Windows):**
```
~/.claude/skills/gstack/  — v1.6.1.0, 74 директории
```

**Установлено на сервере:**
```
/root/.claude/skills/gstack/  — v1.6.1.0, полный клон
```

**Добавлено в репозиторий openclaw-vk-plugin:**
- `CLAUDE.md` — гид разработчика: архитектура, security layers, gstack discipline, таблица скиллов
- `AGENTS.md` — добавлена секция gstack dispatch routing + ссылки на 4 нативных скилла
- `.claude/skills/gstack.md` — индекс всех 11 text-based скиллов + 4 browser-based
- `.claude/review-checklist.md` — чеклист безопасности перед каждым коммитом

**Обновлён AGENTS.md на сервере** (`/root/.openclaw/workspace/AGENTS.md`):
- Добавлена таблица invoke → путь к файлу скилла
- Бот теперь умеет запускать `/office-hours`, `/ceo-review`, `/investigate`, `/retro`

### GitHub

Запушены два коммита:
1. `security: add Mistral/Anthropic key patterns to outbound sanitizer, update models`
   - OUTBOUND_SENSITIVE: Mistral + Anthropic паттерны
   - OCR: pixtral-large-2411
   - Intent classifier: 8B instant модель

2. `integrate gstack v1.6.1.0 methodology (MIT)`
   - CLAUDE.md, AGENTS.md, .claude/

**Репо:** https://github.com/fibbersha-hub/openclaw-vk-plugin

---

## 2026-04-25 — Сессия N: Великий Мудрец Mini App v2

### Цель
Перевести Великого Мудреца из VK-чата в полноценное VK Mini App. Кнопка в чате должна открывать мини-приложение, а не выполнять запрос прямо в чате.

---

### 1. Тесты файловой функции (browser-bridge/test_file_feature.py)

**Проблема:** Разделы 6-8 падали с `SystemExit` — mock `bridge_post` возвращал `{"responses": []}`, что вызывало `sys.exit(1)` в `cmd_ask`.

**Исправления:**
- Секции 6, 7, 8: моки возвращают валидные объекты ответа вместо пустого `responses: []`
- Секция 8 (DB test): использовалось `.pdf` с plain-text данными → pdfplumber падал → заменено на `.txt`
- Итог: **35/35 тестов проходят**

---

### 2. Инъекция файлов в LLM (sage.py + runtime.ts)

**Проблема:** При отправке файла с вопросом бот отвечал "файл не найден" — агент получал только `[Документ: имя]`, не содержимое.

**Решение в `sage.py`:**
- Добавлена команда `get_file_text <url> [filename]` — скачивает файл, печатает `[ФАЙЛ: name]\n\ncontент`
- Добавлена поддержка `file://` URL в `fetch_file()` (для загруженных через mini app файлов)
- Добавлен `_load_cerebras_key()` — читает ключ из `~/.openclaw/openclaw.json` если нет env var

**Решение в `runtime.ts`:**
- Перед отправкой в LLM вызывается `sage.py get_file_text <url>` и результат инъектируется в начало тела сообщения

---

### 3. Формат ответа Великого Мудреца

**Новый формат вывода** (изменён `sage.py`):
```
[Имя модели] думает:
[Ответ модели]

...

Я же в свою очередь хочу подытожить:
[Синтез Cerebras]
```

- Убрана строка "Опрошены: ..."
- Убран префикс "**Синтез:**"
- Добавлены блоки "думает:" для каждой модели в system prompt синтеза

---

### 4. Великий Мудрец Mini App v2 — сборка

**Зарегистрированное VK Mini App:**
- app_id: `54527093`
- Название: "Знайка"
- group_id: `225425795`

#### Flask API (`sage-miniapp/sage_api.py`)
REST-сервер на порту 5001, обёртка над `sage.py`:
- `GET /health`
- `GET /api/sessions` — список сессий пользователя
- `GET /api/sessions/<sid>/messages` — сообщения сессии
- `DELETE /api/sessions/<sid>` — удалить сессию
- `POST /api/sessions/<sid>/archive` — в архив
- `GET /api/mode`, `POST /api/mode` — режим Мудреца (auto/multi)
- `POST /api/ask` — задать вопрос (через threading, таймаут 5 мин)
- `POST /api/upload` — загрузить файл

**Auth:** заголовок `X-VK-User-Id`; пустой/dev uid — dev-режим без проверки.  
**Dev-режим (peer_id=99999):** принудительно ставит `auto` режим, чтобы не зависнуть в multi.

#### Frontend (`sage-miniapp/index.html`)
- Дизайн взят из Chimera paper.html (Space Grotesk + Space Mono, bg #f0ede8, accent #2d6a4f)
- Chat UI: пузыри вопросов, блоки "думает:" от каждой LLM, блок синтеза
- `isInsideVK()` — проверяет URL-параметры перед вызовом VKWebAppInit
- Табы: Спросить / Сессии
- API-вызовы по относительному пути (тот же домен)

#### nginx (`sage-miniapp/ai-ulvar.nginx`)
- `/mudrets/` → alias `/opt/sage-miniapp/` (фронтенд)
- `/sage/` → proxy_pass `127.0.0.1:5001` (Flask API)

#### systemd
- Сервис `sage-miniapp.service` — Flask API на порту 5001

---

### 5. Кнопки VK: open_link → open_app

**Проблема:** Кнопка "🧙 Великий Мудрец" использовала `type: "open_link"` — открывала внешний браузер, а не мини-приложение VK.

**Решение (`button-dispatcher.ts`):**

Интерфейс `linkKeyboard` расширен — теперь поддерживает как `url` (open_link), так и `app_id` (open_app):
```typescript
linkKeyboard?: Array<{ label: string; url?: string; app_id?: number; owner_id?: number; hash?: string }>
```

Sage-кнопки изменены на `open_app`:
```typescript
linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: 54527093, owner_id: -225425795 }]
```

`buildLinkKeyboard()` теперь автоматически выбирает тип:
- Есть `app_id` → генерирует `type: "open_app"` с `app_id`, `owner_id`, `hash`
- Есть `url` → генерирует `type: "open_link"` (поведение прежнее)

**Затронутые кнопки:**
- `🧙 Великий Мудрец`
- `🔙 Великий Мудрец`
- `🔮 Новый вопрос`
- `sage_ask` (voice intent)

---

### 6. Деплой

| Файл | Путь на сервере |
|------|----------------|
| `dist/src/button-dispatcher.js` | `/opt/openclaw-vk-plugin/dist/src/button-dispatcher.js` |
| `dist/src/runtime.js` | `/opt/openclaw-vk-plugin/dist/src/runtime.js` |

Сервис `openclaw.service` перезапущен, статус: **active (running)**.

---

### 7. Требует ручного действия

Обновить URL мини-приложения в кабинете разработчика VK:  
[vk.com/editapp?id=54527093](https://vk.com/editapp?id=54527093)  
`https://app.ulvar.ru` → `https://ai.ulvar.ru/mudrets/`

---

### Итог

| Компонент | Статус |
|-----------|--------|
| Mini App frontend | ✅ `https://ai.ulvar.ru/mudrets/` |
| Flask API (sage-miniapp.service) | ✅ порт 5001 |
| open_app кнопка в VK-чате | ✅ app_id=54527093 |
| openclaw.service | ✅ перезапущен |
| URL в VK Developer Console | ⚠️ нужно обновить вручную |

**Репо:** https://github.com/fibbersha-hub/openclaw-vk-plugin

---

## Сессия 2026-04-25/26 — Восстановление и система самоконтроля

### 1. Диагностика: почему Великий Мудрец выдавал ошибки 504

Корневая причина — три уровня проблем:

| Уровень | Проблема |
|---------|---------|
| Perplexity | Сессия слетела, вкладка попала на страницу логина `?login-source=oneTapHome` |
| `Promise.allSettled` | Ждёт ВСЕ LLMs — один зависший = весь `/query-all` висит 3 мин |
| 6 LLMs параллельно | CDP `dispatchMouseEvent timed out` — браузер перегружается |

Диагностика показала: сессии Claude, ChatGPT и Perplexity **живые**, проблема только в параллельной перегрузке CDP при 5+ одновременных страницах.

---

### 2. Фиксы производительности

#### sage.py — авто-режим сокращён до 3 LLMs
```
Было: 6 LLMs (2 батча × 90s = 3-4 мин) → не укладывалось в 5-мин таймаут
Стало: 3 LLM (1 батч = 60-90s) → ответ приходит вовремя
```

Подбор по типу задачи:
- code: deepseek:r1, qwen:coder, chatgpt
- reasoning: deepseek:r1, claude, chatgpt
- creative: chatgpt, claude, qwen
- general: deepseek, chatgpt, claude

#### browser-llm-bridge.js — pLimit(3)
Заменили `Promise.allSettled(all)` на `pLimit(tasks, 3)` — максимум 3 вкладки одновременно. Снимает перегрузку CDP.

---

### 3. Система самоконтроля: llm-health.js

Новый модуль отслеживает состояние каждого LLM. Детектирует известные паттерны ошибок и автоматически отключает проблемные LLMs на период кулдауна.

| Паттерн | Сигнал | Откл. | Восстановление |
|---------|--------|-------|----------------|
| SESSION_EXPIRED | URL: login-source, sign_in, /auth | 4 ч | Ручное |
| RATE_LIMITED | "rate limit", "429", "daily limit" | 6 ч | Ручное |
| CDP_OVERLOAD | "dispatchMouseEvent timed out" | 15 мин | Авто |
| NAV_TIMEOUT | "Navigation timeout", ERR_CONNECTION | 10 мин | Авто |
| CONSECUTIVE_FAILURES | 3 ошибки подряд | 30 мин | Авто |

Новые HTTP эндпоинты на порту 7788:
- GET /llm-status — статус всех LLMs
- POST /llm-reset {"llm":"chatgpt"} — ручное восстановление

VK-уведомления владельцу при каждом новом отключении и восстановлении (кулдаун 15 мин).

---

### 4. Умная фильтрация в sage.py

Перед каждым запросом sage.py проверяет /llm-status и убирает отключённые LLMs из списка. Если все предпочтительные отключены — fallback на любые доступные из общего пула.

---

### 5. Watchdog + cron

Файл: /opt/browser-bridge/sage-watchdog.py
Cron: каждые 5 минут

Что делает:
1. Проверяет бридж (порт 7788) и sage-miniapp (порт 5001)
2. Авто-рестарт если сервис упал
3. VK-уведомление о рестарте или неудаче
4. Сверяет статус disabled LLMs — уведомляет о новых событиях
5. Сканирует bridge-лог на известные паттерны

---

### 6. Ежедневный дайджест для Любы

Файл: /opt/browser-bridge/sage-daily-digest.py
Cron: 0 9 * * * (9:00 UTC = 15:00 Алматы)
Получатель: VK user 27733429

Содержит:
- Сводку активности Великого Мудреца за день
- Список рабочих / отключённых LLMs
- Топ тем запросов

---

### 7. Деплой

| Файл | Статус |
|------|--------|
| browser-bridge/llm-health.js | деплой |
| browser-bridge/browser-llm-bridge.js | обновлён, перезапущен |
| browser-bridge/sage.py | обновлён |
| browser-bridge/sage-watchdog.py | деплой |
| cron watchdog каждые 5 мин | установлен |
| sage-miniapp.service | перезапущен |

Репо: https://github.com/fibbersha-hub/openclaw-vk-plugin (commit 578a21d)
