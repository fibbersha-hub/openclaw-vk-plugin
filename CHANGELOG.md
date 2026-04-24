# OpenClaw VK Plugin — Журнал изменений

---

## [2026-04-24] — Великий Мудрец: полная реализация

### Новые файлы

#### `browser-bridge/sage.py`
Менеджер сессий Великого Мудреца (SQLite + multi-LLM).

- SQLite DB: `/opt/openclaw-sage/sage.db`, отчёты: `/opt/openclaw-sage/reports/`
- Таблицы: `sessions` (id, peer_id, title, created_at, updated_at, archived), `messages` (session_id, question, responses JSON, synthesis, asked_at)
- Команды:
  - `ask <peer_id> <question>` — опрашивает все LLM через bridge, синтез через Cerebras, сохраняет в сессию
  - `list <peer_id>` — список активных сессий пользователя
  - `resume <session_id>` — сводка сессии для возврата к обсуждению
  - `archive_list <peer_id>` — список архивных сессий
  - `archive_get <session_id>` — содержимое архивной сессии
  - `close <session_id>` — архивировать сессию
  - `delete <session_id>` — удалить сессию
  - `report_text <session_id>` — текстовый отчёт (plain text)
  - `report_table <session_id>` — Markdown таблица + HTML через report-generator.js
  - `report_chart <session_id>` — Chart.js PNG + Mermaid PNG через report-generator.js
- Выводит `SESSION_ID:<8-char-hex>` для отслеживания активной сессии в dispatcher
- Выводит `REPORT_FILE:<path>` для каждого сгенерированного файла
- Cerebras: модель `llama3.1-8b`, User-Agent: Mozilla/5.0 (обязателен на KZ IP)
- Исправление: LLM-колонки в таблице — case-insensitive lookup (`rm_raw.get(name.lower(), "—")`)

#### `browser-bridge/report-generator.js`
Генератор красивых отчётов на Node.js.

- **Usage**: `node report-generator.js <command> <session_id> <db_path> <out_dir>`
- **Команды**: `chart | html | pdf | mermaid | all`
- **DB**: обращается к SQLite через `sqlite3 -json` CLI (без npm sqlite3)
- **chart** — Chart.js бар-чарт 900×500, тёмная тема (#1a1a2e), цвета по LLM:
  - DeepSeek #4A90D9, ChatGPT #74AA9C, Claude #D97700, Perplexity #A855F7, Mistral #E8734A, Qwen #14B8A6
  - Ось X: вопросы, ось Y: кол-во символов ответа (прокси "объём экспертизы")
- **html** — Handlebars шаблон + Showdown (markdown→HTML), тёмный CSS дизайн:
  - CSS custom properties, gradient header, карточки LLM, блок синтеза
- **pdf** — md-to-pdf CLI (fallback: chromium-browser --print-to-pdf)
- **mermaid** — Mermaid пай-диаграмма консенсуса (% упоминаний каждого LLM):
  - Запуск с temp puppeteer config `{args: ['--no-sandbox', ...]}` (для root на Linux)
- Зависимости (установлены на сервере):
  - Локальные: `chartjs-node-canvas`, `chart.js`, `handlebars`, `showdown`
  - Глобальные: `@mermaid-js/mermaid-cli` (mmdc), `md-to-pdf`

### Изменённые файлы

#### `src/button-dispatcher.ts`
Добавлен Великий Мудрец в VK бот.

- Константы:
  ```typescript
  const SAGE_DIR  = "/opt/openclaw-sage";
  const SAGE_PY   = "/opt/browser-bridge/sage.py";
  const EXEC_TIMEOUT = 30_000;
  const SAGE_TIMEOUT = 660_000;  // 11 минут для LLM-запросов
  const sageActiveSessions = new Map<number, string>();
  ```
- Кнопка `🧙 Великий Мудрец` добавлена в MAIN_MENU
- SAGE_MENU:
  ```
  [["🔮 Новый вопрос"],
   ["📚 Мои обсуждения", "🗄️ Архив"],
   ["📄 Отчёт текст", "📊 Отчёт таблица", "📈 График"],
   ["🔙 Меню"]]
  ```
- Кнопки и действия: `🧙 Великий Мудрец`, `🔮 Новый вопрос`, `📚 Мои обсуждения`, `🗄️ Архив`, `📄 Отчёт текст`, `📊 Отчёт таблица`, `📈 График`, `sage_ask`, `sage_resume`, `sage_archive_get`, `sage_close`
- **Level 3.5 — свободный текст как вопрос**: если у peer есть активная сессия в `sageActiveSessions`, любой текст (не кнопка меню) автоматически идёт как `sage_ask`
- **SESSION_ID parsing**: после выполнения sage команды парсит `SESSION_ID:` из вывода, сохраняет в `sageActiveSessions.set(peerId, id)`
- **REPORT_FILE parsing**: парсит `REPORT_FILE:` из вывода, отправляет файл как VK-вложение (фото/документ)
- Таймаут для sage команд: `isSageCmd ? SAGE_TIMEOUT : EXEC_TIMEOUT`
- Интенты добавлены в VOICE_INTENTS и LLM_INTENT_MAP

#### `browser-bridge/browser-llm-bridge.js` (v1.2)
Исправления стабильности Puppeteer + фильтрация UI-шума.

- `protocolTimeout: 120000` в `puppeteer.connect()` — предотвращает таймаут `Input.dispatchMouseEvent`
- `.catch(() => {})` на `humanMouseMove` и `mouse.click` — graceful игнор ошибок мыши
- **isGenerating check** с DONE_TEXTS фильтром:
  ```javascript
  const DONE_TEXTS = ['completed', 'done', 'завершено', 'finished'];
  // Если текст элемента содержит DONE_TEXT — считаем генерацию завершённой
  ```
- Qwen `generatingSelectors` сужены до специфичных классов: `[class*="qwen"][class*="loading"]`, `[class*="qwen"][class*="streaming"]`, `[class*="qwen"][class*="generating"]`, `button.stop-btn` — убирает false-positive на "Thinking completed"
- Расширен `UI_NOISE` (фильтрация мусора в ответах):
  - "send me a morning briefing", "plan a trip" — Perplexity suggestion chips
  - "want to be notified when claude responds" — Claude prompt
  - "мотивационный телеграмм бот", "профессиональный дилетант" — Qwen suggestion chips

#### `browser-bridge/multi-llm-analyst.js`
- `CEREBRAS_MODEL`: `llama-3.3-70b` → `llama3.1-8b` (правильное имя модели)
- Добавлен `User-Agent: Mozilla/5.0 (X11; Linux x86_64)...` в Cerebras запросы (обязателен на KZ IP)
- Активные LLM: deepseek, chatgpt, perplexity, claude, mistral, qwen
- Каждый ответ обрезается до 400 символов перед отправкой в Cerebras (~730 токенов итого)

### Баги исправлены

| Баг | Причина | Фикс |
|-----|---------|------|
| Cerebras: model not found | Неверное имя `llama-3.3-70b` | `llama3.1-8b` |
| Cerebras: пустой синтез на KZ IP | Python-urllib блокируется без User-Agent | Добавлен `User-Agent: Mozilla/5.0` |
| Perplexity: `Input.dispatchMouseEvent timed out` | Puppeteer default protocol timeout 30s | `protocolTimeout: 120000` |
| Qwen: `generating=true` навсегда | `[class*="animate"]` матчил не-генерирующие элементы | Сужены до `[class*="qwen"][class*="loading/streaming/generating"]` |
| Qwen: "Thinking completed" блокирует | `[class*="thinking"]` матчил завершённое состояние | DONE_TEXTS check пропускает если "completed" в тексте |
| Mermaid: `--no-sandbox` на root | mmdc запускает Chromium без sandbox — ошибка под root | Temp puppeteer config file с `args: ['--no-sandbox']` |
| Таблица отчёта: все "—" | LLM-имена в БД lowercase, lookup был case-sensitive | `rm_raw.get(name.lower(), "—")` |

### Протестировано

Все форматы отчётов протестированы на тестовой сессии `test1234`:

| Файл | Размер | Статус |
|------|--------|--------|
| `sage_test1234_20260424.txt` | 2.1K | ✅ |
| `sage_test1234_chart.png` | 21K | ✅ Chart.js бар-чарт |
| `sage_test1234_diagram.png` | 40K | ✅ Mermaid пай-диаграмма |
| `sage_test1234_report.html` | 6.8K | ✅ Тёмный дизайн |
| `sage_test1234_table.md` | 1.2K | ✅ |

### Деплой

```
/opt/browser-bridge/sage.py
/opt/browser-bridge/report-generator.js
/opt/browser-bridge/browser-llm-bridge.js
/opt/openclaw-vk-plugin/dist/src/  (скомпилированный button-dispatcher)
```

Сервис перезапущен: `systemctl restart openclaw.service`

---

## [до 2026-04-24] — История до ведения журнала

Проект OpenClaw VK Plugin существовал до начала ведения этого журнала.
Основные компоненты на момент начала ведения журнала:
- `browser-bridge/browser-llm-bridge.js` — Puppeteer bridge к 7 LLM в браузере
- `browser-bridge/multi-llm-analyst.js` — параллельный опрос LLM + Cerebras синтез
- `src/button-dispatcher.ts` — обработчик кнопок VK бота
- Поддерживаемые LLM: DeepSeek, ChatGPT, Perplexity, Claude, Mistral, Qwen (Gemini заблокирован в KZ, Grok rate limit)
