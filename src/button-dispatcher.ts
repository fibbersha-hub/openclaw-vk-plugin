// ============================================================================
// Button Dispatcher — intercepts VK button presses, runs scripts directly
// Bypasses LLM for data operations — no hallucinations possible
// ============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execAsync = promisify(exec);
const APP_DIR = process.env.APP_DIR || "/opt/myapp";
const TOOLS_DIR = `${APP_DIR}/scripts`;
const PERSONAS_DIR = `${APP_DIR}/personas`;
const NOTES_DIR = "/opt/openclaw-notes";
const SAGE_DIR  = "/opt/openclaw-sage";
const SAGE_PY   = "/opt/browser-bridge/sage.py";
const EXEC_TIMEOUT = 30_000;
const SAGE_TIMEOUT = 660_000; // 11 min — bridge query-all can take ~5-7 min
const MINIAPP_URL = process.env.MINIAPP_URL || "https://YOUR_DOMAIN/mudrets/";

// In-memory map: peerId → active sage session_id (cleared on new question / menu)
const sageActiveSessions = new Map<number, string>();

/** POSIX shell-safe quoting: wraps string in single quotes, escapes embedded single quotes */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ============================================================================
// Button → Script mapping
// ============================================================================

interface ButtonAction {
  script?: string;           // Shell command to execute
  scriptFn?: (text: string, peerId: number) => string | null;  // Dynamic script built from user message + peerId
  imageFn?: (text: string) => string | null;  // Returns image generation prompt for Pollinations.ai
  ttsFn?: (text: string) => string | null;    // Returns text to synthesize via ElevenLabs TTS
  postFn?: (text: string) => string | null;   // Returns topic for VK post generation via LLM
  persona?: string;          // Persona file to load (for LLM modes)
  response?: string;         // Static response text
  keyboard?: string[][];     // Next keyboard buttons (text buttons)
  linkKeyboard?: Array<{ label: string; url?: string; app_id?: number; owner_id?: number; hash?: string }>;  // Link or app buttons
  passToLLM?: boolean;       // Pass to LLM instead of exec
}

/** Extract image generation prompt from natural language text */
function extractImagePrompt(text: string): string {
  return text
    .replace(/^(нарисуй|дорисуй|сгенерируй|создай|генерируй|сделай|нарисовать)\s*(картинку?|изображение|рисунок|фото|арт|фотографию|картинку дня)?\s*/i, '')
    .replace(/^(картинку?|изображение|рисунок|фото)\s+(мне\s+)?/i, '')
    .trim() || text;
}

const MAIN_MENU: string[][] = [
  ["📦 Завсклад", "📤 Публикация"],
  ["🖨️ Печать", "✍️ Копирайтер"],
  ["🎬 Сценарист", "📈 SEO"],
  ["📅 Контент-менеджер", "🎨 Дизайнер"],
  ["🖼️ Оформитель", "📊 Инфографик"],
  ["🔎 Анализ фото", "🔍 Аналитик VK"],
  ["📜 Хронист", "📝 Заметки"],
  ["⏰ Напоминания", "✅ Дела"],
  ["🧙 Великий Мудрец"],
  ["💬 Чат"],
];

const WAREHOUSE_MENU: string[][] = [
  ["📋 Все площадки"],
  ["🟠 Ozon", "💜 VK Market"],
  ["🟢 Avito", "🔵 СРМ"],
  ["📉 Кончаются", "🔄 Обновить"],
  ["🔙 Меню"],
];

const OZON_MENU: string[][] = [
  ["📦 Товары Ozon", "💰 Цены Ozon"],
  ["🛒 Заказы Ozon", "📊 Остатки Ozon"],
  ["🔙 Завсклад"],
];

const VK_MARKET_MENU: string[][] = [
  ["📦 Товары VK", "🛒 Заказы VK"],
  ["🔙 Завсклад"],
];

const AVITO_MENU: string[][] = [
  ["📦 Фид Avito"],
  ["🔙 Завсклад"],
];

const MFM_MENU: string[][] = [
  ["📦 Товары СРМ"],
  ["🔙 Завсклад"],
];

const CONTENT_MENU: string[][] = [
  ["📝 Ещё вариант", "📋 Другая платформа"],
  ["📌 Опубликовать", "🔙 Меню"],
];

const PUBLISHER_MENU: string[][] = [
  ["📤 Все площадки", "🟠 Ozon цены"],
  ["💜 VK публикация", "🟢 СРМ публикация"],
  ["📊 Сравнить цены", "🔙 Меню"],
];

const PRINT_MENU: string[][] = [
  ["📋 Очередь", "📉 Кончаются"],
  ["📊 ABC/XYZ", "➕ Добавить в печать"],
  ["✅ Готово", "🔙 Меню"],
];

const ANALYST_MENU: string[][] = [
  ["👥 Аудитория", "🕵️ Конкуренты"],
  ["📊 Отчёт", "➕ Добавить конкурента"],
  ["🔍 Найти группы"],
  ["🔙 Меню"],
];

const NOTES_MENU: string[][] = [
  ["📋 Список заметок"],
  ["🗑️ Удалить заметку"],
  ["🔙 Меню"],
];

const TODOS_MENU: string[][] = [
  ["✅ Дела"],
  ["🔙 Меню"],
];

const REMINDERS_MENU: string[][] = [
  ["📋 Напоминания"],
  ["📊 Дайджест"],
  ["🔙 Меню"],
];

const SAGE_MENU: string[][] = [
  ["🔮 Новый вопрос"],
  ["📚 Мои обсуждения", "🗄️ Архив"],
  ["📄 Отчёт текст", "📊 Отчёт таблица", "📈 График"],
  ["⚙️ Режим Мудреца", "🔙 Меню"],
];

const SAGE_REPORT_MENU: string[][] = [
  ["📄 Отчёт текст", "📊 Отчёт таблица", "📈 График"],
  ["🔙 Великий Мудрец"],
];

const SAGE_MODE_MENU: string[][] = [
  ["🤖 Авто-режим (рекомендуется)"],
  ["🔬 Мульти-режим (все модели, медленнее)"],
  ["🔙 Великий Мудрец"],
];

// ============================================================================
// Button actions registry
// ============================================================================

const BUTTON_ACTIONS: Record<string, ButtonAction> = {
  // === Main menu ===
  "меню": {
    response: "Привет! Я Ульвар 🐺 Выбери специалиста:",
    keyboard: MAIN_MENU,
  },
  "🔙 Меню": {
    response: "Выбери специалиста:",
    keyboard: MAIN_MENU,
  },
  "🔙 меню": {
    response: "Выбери специалиста:",
    keyboard: MAIN_MENU,
  },
  "🔙Меню": {
    response: "Выбери специалиста:",
    keyboard: MAIN_MENU,
  },
  "Меню": {
    response: "Выбери специалиста:",
    keyboard: MAIN_MENU,
  },

  // === Завсклад (direct script calls) ===
  "📦 Завсклад": {
    response: "📦 Завсклад на связи! Что проверить?",
    keyboard: WAREHOUSE_MENU,
  },
  "📋 Все площадки": {
    script: `cd ${APP_DIR} && python3 scripts/platform_status.py`,
    keyboard: WAREHOUSE_MENU,
  },
  "📉 Кончаются": {
    script: `cd ${APP_DIR} && python3 scripts/stock_admin.py low`,
    keyboard: WAREHOUSE_MENU,
  },
  "🔄 Обновить": {
    script: `cd ${APP_DIR} && python3 scripts/sync_all_platforms.py`,
    keyboard: WAREHOUSE_MENU,
  },
  "🔙 Завсклад": {
    response: "📦 Завсклад на связи! Выбери площадку:",
    keyboard: WAREHOUSE_MENU,
  },

  // === Ozon submenu ===
  "🟠 Ozon": {
    response: "🟠 Ozon — что смотрим?",
    keyboard: OZON_MENU,
  },
  "📦 Товары Ozon": {
    script: `cd ${APP_DIR} && python3 scripts/stock_admin.py list`,
    keyboard: OZON_MENU,
  },
  "💰 Цены Ozon": {
    script: `cd ${APP_DIR} && python3 scripts/show_prices.py`,
    keyboard: OZON_MENU,
  },
  "📊 Остатки Ozon": {
    script: `cd ${APP_DIR} && python3 scripts/stock_admin.py status`,
    keyboard: OZON_MENU,
  },
  "🛒 Заказы Ozon": {
    script: `cd ${APP_DIR} && python3 scripts/show_orders.py`,
    keyboard: OZON_MENU,
  },

  // === VK Market submenu ===
  "💜 VK Market": {
    response: "💜 VK Market — что смотрим?",
    keyboard: VK_MARKET_MENU,
  },
  "📦 Товары VK": {
    script: `cd ${APP_DIR} && python3 scripts/show_vk_market.py`,
    keyboard: VK_MARKET_MENU,
  },
  "🛒 Заказы VK": {
    script: `cd ${APP_DIR} && python3 scripts/show_vk_orders.py`,
    keyboard: VK_MARKET_MENU,
  },

  // === Avito submenu ===
  "🟢 Avito": {
    response: "🟢 Avito — XML-фид автозагрузки",
    keyboard: AVITO_MENU,
  },
  "📦 Фид Avito": {
    script: `cd ${APP_DIR} && python3 scripts/show_avito.py`,
    keyboard: AVITO_MENU,
  },

  // === СРМ submenu ===
  "🔵 СРМ": {
    response: "🔵 Свободный рынок миниатюр (minifreemarket.com)",
    keyboard: MFM_MENU,
  },
  "📦 Товары СРМ": {
    script: `cd ${APP_DIR} && python3 scripts/show_mfm.py`,
    keyboard: MFM_MENU,
  },

  // === Публикатор (direct script calls) ===
  "📤 Публикация": {
    response: "📤 Публикатор на связи! Куда публикуем?",
    keyboard: PUBLISHER_MENU,
  },
  "📤 Все площадки": {
    script: `cd ${APP_DIR} && python3 scripts/platform_status.py`,
    keyboard: PUBLISHER_MENU,
  },
  "🟠 Ozon цены": {
    script: `cd ${APP_DIR} && python3 scripts/push_prices_ozon.py`,
    keyboard: PUBLISHER_MENU,
  },
  "💜 VK публикация": {
    script: `cd ${APP_DIR} && python3 scripts/push_prices_vk.py`,
    keyboard: PUBLISHER_MENU,
  },
  "🟢 СРМ публикация": {
    script: `cd ${APP_DIR} && python3 scripts/push_catalog_mfm.py`,
    keyboard: PUBLISHER_MENU,
  },
  "📊 Сравнить цены": {
    script: `cd ${APP_DIR} && python3 scripts/ozon_sync.py stock`,
    keyboard: PUBLISHER_MENU,
  },

  // === Очередь печати (direct script calls) ===
  "🖨️ Печать": {
    response: "🖨️ Менеджер печати на связи! Что смотрим?",
    keyboard: PRINT_MENU,
  },
  "📋 Очередь": {
    script: `cd ${APP_DIR} && python3 scripts/print_queue_cli.py queue`,
    keyboard: PRINT_MENU,
  },
  "📊 ABC/XYZ": {
    script: `cd ${APP_DIR} && python3 scripts/stock_admin.py status`,
    keyboard: PRINT_MENU,
  },
  "➕ Добавить в печать": {
    passToLLM: true,
    persona: "printqueue",
  },
  "✅ Готово": {
    passToLLM: true,
    persona: "printqueue",
  },

  // === Аналитик (direct script calls) ===
  "🔍 Аналитик VK": {
    response: "🔍 Аналитик на связи!\n\n• Аудитория — статистика нашей группы\n• Конкуренты — отчёт по конкурентам\n• Найти группы — поиск похожих групп",
    keyboard: ANALYST_MENU,
  },
  "👥 Аудитория": {
    script: `cd ${APP_DIR} && python3 scripts/vk_parser.py group-stats ${process.env.VK_GROUP_SCREEN_NAME || "your_vk_group"}`,
    keyboard: ANALYST_MENU,
  },
  "🕵️ Конкуренты": {
    script: `cd ${APP_DIR} && python3 scripts/vk_competitors.py report`,
    keyboard: ANALYST_MENU,
  },
  "📊 Отчёт": {
    script: `cd ${APP_DIR} && python3 scripts/vk_competitors.py report`,
    keyboard: ANALYST_MENU,
  },
  "➕ Добавить конкурента": {
    response: "Напиши screen_name группы конкурента:\nНапример: «добавь конкурента ulvar_rival»",
    keyboard: ANALYST_MENU,
  },
  "competitor_add": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const m = text.match(/(?:добавь\s+конкурента?|конкурент\s+добавить|add)\s+(\S+)/i)
        || text.match(/^(\S+)$/);
      if (!m) return null;
      const screenName = m[1].replace(/^@/, "");
      return `cd ${APP_DIR} && python3 scripts/vk_competitors.py add ${shellEscape(screenName)}`;
    },
    keyboard: ANALYST_MENU,
  },
  "🔍 Найти группы": {
    response: "Напиши запрос для поиска групп:\nНапример: «найди группы D&D миниатюры»",
    keyboard: ANALYST_MENU,
  },
  "vk_search_groups": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const query = text
        .replace(/^(найди\s+групп[ыу]|поищи\s+групп[ыу]|search\s+groups?)\s*/i, "")
        .trim();
      if (!query) return null;
      return `cd ${APP_DIR} && python3 scripts/vk_parser.py search-groups ${shellEscape(query)}`;
    },
    keyboard: ANALYST_MENU,
  },

  // === LLM personas (pass to AI with persona context) ===
  "✍️ Копирайтер": {
    passToLLM: true,
    persona: "copywriter",
  },
  "🎬 Сценарист": {
    passToLLM: true,
    persona: "screenwriter",
  },
  "📈 SEO": {
    passToLLM: true,
    persona: "seo",
  },
  "📅 Контент-менеджер": {
    passToLLM: true,
    persona: "content-mgr",
  },
  "🎨 Дизайнер": {
    passToLLM: true,
    persona: "designer",
  },
  "🖼️ Оформитель": {
    passToLLM: true,
    persona: "graphic",
  },
  "📊 Инфографик": {
    passToLLM: true,
    persona: "infographic",
  },
  "🔎 Анализ фото": {
    passToLLM: true,
    persona: "image-analyst",
  },
  // === Хронист (direct script calls for keys) ===
  "📜 Хронист": {
    response: "📜 Хронист на связи! Управление ключами и конфигурацией.",
    keyboard: [
      ["🔑 Все ключи", "✅ Проверить"],
      ["🔄 Заменить ключ", "📊 Лимиты"],
      ["🔙 Меню"],
    ],
  },
  "🔑 Все ключи": {
    script: `cd ${APP_DIR} && python3 scripts/key_manager.py list`,
    keyboard: [["🔑 Все ключи", "✅ Проверить"], ["🔄 Заменить ключ", "📊 Лимиты"], ["🔙 Меню"]],
  },
  "✅ Проверить": {
    script: `cd ${APP_DIR} && python3 scripts/key_manager.py check`,
    keyboard: [["🔑 Все ключи", "✅ Проверить"], ["🔄 Заменить ключ", "📊 Лимиты"], ["🔙 Меню"]],
  },
  "📊 Лимиты": {
    script: `cd ${APP_DIR} && python3 scripts/key_manager.py limits`,
    keyboard: [["🔑 Все ключи", "✅ Проверить"], ["🔄 Заменить ключ", "📊 Лимиты"], ["🔙 Меню"]],
  },
  "🔄 Заменить ключ": {
    passToLLM: true,
    persona: "chronicler",
  },

  "💬 Чат": {
    passToLLM: true,
    persona: "chat",
  },

  // === Заметки (notes — SQLite + FTS5) ===
  "📝 Заметки": {
    response: "📝 Заметки — сохраняй и ищи что угодно.\n\nПримеры:\n• «запомни купить молоко»\n• «найди заметку молоко»\n• «покажи заметки»\n• «удали заметку #3»",
    keyboard: NOTES_MENU,
  },
  "📋 Список заметок": {
    script: `python3 ${NOTES_DIR}/notes.py list`,
    keyboard: NOTES_MENU,
  },
  "🗑️ Удалить заметку": {
    response: "Напиши номер заметки: «удали заметку #N»\nЧтобы узнать номера — нажми 📋 Список заметок.",
    keyboard: NOTES_MENU,
  },

  // Virtual action keys (matched by voice/LLM intents, not shown in keyboard)
  "notes_save": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const content = text
        .replace(/^(запомни|сохрани заметку|сохрани заметку:|запомни:|заметка:|сохрани|добавь заметку|новая заметка)\s*/i, "")
        .trim();
      if (!content) return null;
      return `python3 ${NOTES_DIR}/notes.py save ${shellEscape(content)}`;
    },
  },
  "notes_search": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const query = text
        .replace(/^(найди заметку|найди в заметках|поищи заметку|поищи в заметках|поиск заметок|найди|поищи)\s*/i, "")
        .trim();
      if (!query) return null;
      return `python3 ${NOTES_DIR}/notes.py search ${shellEscape(query)}`;
    },
    keyboard: NOTES_MENU,
  },
  "notes_delete": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/#?(\d+)/);
      if (!match) return null;
      return `python3 ${NOTES_DIR}/notes.py delete ${match[1]}`;
    },
    keyboard: NOTES_MENU,
  },
  "notes_get": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/#?(\d+)/);
      if (!match) return null;
      return `python3 ${NOTES_DIR}/notes.py get ${match[1]}`;
    },
    keyboard: NOTES_MENU,
  },

  // === Список дел (todos) ===
  "✅ Дела": {
    script: `python3 ${NOTES_DIR}/todos.py list`,
    keyboard: TODOS_MENU,
  },
  "todos_add": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const content = text
        .replace(/^(добавь задачу|добавь дело|запланируй|новое дело|задача:|дело:)\s*/i, "")
        .trim();
      if (!content) return null;
      return `python3 ${NOTES_DIR}/todos.py add ${shellEscape(content)}`;
    },
    keyboard: TODOS_MENU,
  },
  "todos_done": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/#?(\d+)/);
      if (!match) return null;
      return `python3 ${NOTES_DIR}/todos.py done ${match[1]}`;
    },
    keyboard: TODOS_MENU,
  },
  "todos_delete": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/#?(\d+)/);
      if (!match) return null;
      return `python3 ${NOTES_DIR}/todos.py delete ${match[1]}`;
    },
    keyboard: TODOS_MENU,
  },

  // === Напоминания ===
  "⏰ Напоминания": {
    response: "⏰ Напоминания — скажи когда и что:\n\n• «напомни через 30 минут купить молоко»\n• «напомни в 18:30 позвонить врачу»\n• «напомни завтра в 9:00 встреча»\n• «покажи напоминания»\n• «удали напоминание #3»",
    keyboard: REMINDERS_MENU,
  },
  "📋 Напоминания": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${NOTES_DIR}/reminders.py list --peer ${peerId}`,
    keyboard: REMINDERS_MENU,
  },
  "🔙 Напоминания": {
    response: "⏰ Напоминания:",
    keyboard: REMINDERS_MENU,
  },

  // Virtual keys for reminders
  "reminder_add": {
    scriptFn: (text: string, peerId: number): string | null =>
      `python3 ${NOTES_DIR}/reminders.py add ${shellEscape(text)} --peer ${peerId}`,
    keyboard: REMINDERS_MENU,
  },
  "reminder_list": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${NOTES_DIR}/reminders.py list --peer ${peerId}`,
    keyboard: REMINDERS_MENU,
  },
  "reminder_delete": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/#?(\d+)/);
      if (!match) return null;
      return `python3 ${NOTES_DIR}/reminders.py delete ${match[1]}`;
    },
    keyboard: REMINDERS_MENU,
  },

  // === Дайджест ===
  "📊 Дайджест": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${NOTES_DIR}/daily_digest.py --peer ${peerId}`,
  },
  "digest_now": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${NOTES_DIR}/daily_digest.py --peer ${peerId}`,
  },
  "digest_setup": {
    scriptFn: (text: string, peerId: number): string | null => {
      const timeMatch = text.match(/(\d{1,2})[:\.](\d{2})/);
      const t = timeMatch ? `${timeMatch[1].padStart(2,"0")}:${timeMatch[2]}` : "09:00";
      return `python3 ${NOTES_DIR}/daily_digest.py setup-cron --peer ${peerId} --time ${t}`;
    },
  },

  // === Генерация изображений (Pollinations.ai — бесплатно, без ключа) ===
  "image_generate": {
    imageFn: (text: string): string | null => {
      const prompt = extractImagePrompt(text);
      return prompt.length > 2 ? prompt : null;
    },
  },

  // === TTS — голосовое сообщение (ElevenLabs) ===
  "tts_generate": {
    ttsFn: (text: string): string | null => {
      // Strip the command word, return the text to speak
      const cleaned = text
        .replace(/^(озвучь|скажи голосом|прочитай вслух|сделай голосовое|запиши голосовое|создай голосовое)\s*/i, '')
        .trim();
      return cleaned.length > 2 ? cleaned : null;
    },
  },

  // === Генератор постов для VK (Groq LLM) ===
  "post_generate": {
    postFn: (text: string): string | null => {
      const topic = text
        .replace(/^(напиши пост|сгенерируй пост|создай пост|придумай пост)\s*(о|про|на тему|для)?\s*/i, '')
        .trim();
      return topic.length > 2 ? topic : null;
    },
  },

  // =========================================================================
  // === 🧙 ВЕЛИКИЙ МУДРЕЦ — Multi-LLM consensus engine ====================
  // =========================================================================

  "🧙 Великий Мудрец": {
    response: "🧙 Открывай мини-приложение — задавай вопросы, смотри историю:",
    linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: parseInt(process.env.VK_MINIAPP_ID || "0"), owner_id: -parseInt(process.env.VK_GROUP_ID || "0") }],
  },

  "🔙 Великий Мудрец": {
    response: "🧙 Великий Мудрец:",
    linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: parseInt(process.env.VK_MINIAPP_ID || "0"), owner_id: -parseInt(process.env.VK_GROUP_ID || "0") }],
  },

  "🔮 Новый вопрос": {
    response: "🔮 Открывай мини-приложение и задавай вопрос:",
    linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: parseInt(process.env.VK_MINIAPP_ID || "0"), owner_id: -parseInt(process.env.VK_GROUP_ID || "0") }],
  },

  "📚 Мои обсуждения": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${SAGE_PY} list ${peerId}`,
    keyboard: SAGE_MENU,
  },

  "🗄️ Архив": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${SAGE_PY} archive_list ${peerId}`,
    keyboard: SAGE_MENU,
  },

  "📄 Отчёт текст": {
    scriptFn: (_text: string, peerId: number): string | null => {
      const sid = sageActiveSessions.get(peerId);
      if (!sid) return null;
      return `python3 ${SAGE_PY} report_text ${sid}`;
    },
    keyboard: SAGE_REPORT_MENU,
  },

  "📊 Отчёт таблица": {
    scriptFn: (_text: string, peerId: number): string | null => {
      const sid = sageActiveSessions.get(peerId);
      if (!sid) return null;
      return `python3 ${SAGE_PY} report_table ${sid}`;
    },
    keyboard: SAGE_REPORT_MENU,
  },

  "📈 График": {
    scriptFn: (_text: string, peerId: number): string | null => {
      const sid = sageActiveSessions.get(peerId);
      if (!sid) return null;
      return `python3 ${SAGE_PY} report_chart ${sid}`;
    },
    keyboard: SAGE_REPORT_MENU,
  },

  "⚙️ Режим Мудреца": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${SAGE_PY} get_mode ${peerId}`,
    keyboard: SAGE_MODE_MENU,
  },

  "🤖 Авто-режим (рекомендуется)": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${SAGE_PY} set_mode ${peerId} auto`,
    keyboard: SAGE_MENU,
  },

  "🔬 Мульти-режим (все модели, медленнее)": {
    scriptFn: (_text: string, peerId: number): string | null =>
      `python3 ${SAGE_PY} set_mode ${peerId} multi`,
    keyboard: SAGE_MENU,
  },

  // Virtual intents for sage
  "sage_ask": {
    response: "🧙 Открывай мини-приложение — там задашь вопрос удобнее:",
    linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: parseInt(process.env.VK_MINIAPP_ID || "0"), owner_id: -parseInt(process.env.VK_GROUP_ID || "0") }],
  },

  "sage_resume": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/(?:продолжи|вернись|открой)\s+#?([a-f0-9]{8})/i);
      if (!match) return null;
      return `python3 ${SAGE_PY} resume ${match[1]}`;
    },
    keyboard: SAGE_MENU,
  },

  "sage_archive_get": {
    scriptFn: (text: string, _peerId: number): string | null => {
      const match = text.match(/(?:из архива|архив)\s+#?([a-f0-9]{8})/i);
      if (!match) return null;
      return `python3 ${SAGE_PY} archive_get ${match[1]}`;
    },
    keyboard: SAGE_MENU,
  },

  "sage_close": {
    scriptFn: (_text: string, peerId: number): string | null => {
      const sid = sageActiveSessions.get(peerId);
      if (!sid) return null;
      sageActiveSessions.delete(peerId);
      return `python3 ${SAGE_PY} close ${sid}`;
    },
    keyboard: SAGE_MENU,
  },
};

// ============================================================================
// Voice intent matching — maps natural speech to button actions
// Checked when exact button match fails (e.g. from transcribed voice)
// ============================================================================

interface VoiceIntent {
  /** All phrases must be present in lowercased text (AND logic) */
  contains: string[];
  /** At least one phrase must be present (OR logic within this field) */
  any?: string[];
  /** Target button action key */
  action: string;
}

const VOICE_INTENTS: VoiceIntent[] = [
  // --- Ozon orders ---
  { contains: ["заказ"],           any: ["озон", "ozon"],                        action: "🛒 Заказы Ozon" },
  { contains: ["покажи заказы"],   any: [],                                      action: "🛒 Заказы Ozon" },
  // --- Ozon prices ---
  { contains: ["цен"],             any: ["озон", "ozon"],                        action: "💰 Цены Ozon" },
  // --- Ozon stock ---
  { contains: ["остат"],          any: ["озон", "ozon"],                         action: "📊 Остатки Ozon" },
  { contains: ["склад"],          any: ["озон", "ozon"],                         action: "📊 Остатки Ozon" },
  // --- Ozon products ---
  { contains: ["товар"],          any: ["озон", "ozon"],                         action: "📦 Товары Ozon" },
  { contains: ["каталог"],        any: ["озон", "ozon"],                         action: "📦 Товары Ozon" },
  // --- Low stock ---
  { contains: ["кончает"],        any: [],                                       action: "📉 Кончаются" },
  { contains: ["заканчивает"],    any: [],                                       action: "📉 Кончаются" },
  { contains: ["мало"],           any: ["остат", "товар", "склад"],              action: "📉 Кончаются" },
  // --- All platforms ---
  { contains: ["все площадк"],    any: [],                                       action: "📋 Все площадки" },
  { contains: ["все платформ"],   any: [],                                       action: "📋 Все площадки" },
  { contains: ["статус"],         any: ["площадк", "платформ", "магазин"],       action: "📋 Все площадки" },
  // --- Print queue ---
  { contains: ["очередь"],        any: ["печат"],                                action: "📋 Очередь" },
  { contains: ["очередь печат"],  any: [],                                       action: "📋 Очередь" },
  // --- VK orders ---
  { contains: ["заказ"],          any: ["вк", "вконтакте", "маркет"],            action: "🛒 Заказы VK" },
  // --- VK products ---
  { contains: ["товар"],          any: ["вк", "вконтакте", "маркет"],            action: "📦 Товары VK" },
  // --- Avito feed ---
  { contains: ["авито"],          any: ["фид", "товар", "объявл"],               action: "📦 Фид Avito" },
  // --- Sync/update ---
  { contains: ["обнови"],         any: ["склад", "остат", "данн"],               action: "🔄 Обновить" },
  { contains: ["синхронизир"],    any: [],                                       action: "🔄 Обновить" },
  // --- Prices publish ---
  { contains: ["обнови"],         any: ["цен", "прайс"],                         action: "🟠 Ozon цены" },
  { contains: ["загруз"],         any: ["цен", "прайс"],                         action: "🟠 Ozon цены" },
  // --- ABC/XYZ ---
  { contains: ["abc"],            any: [],                                       action: "📊 ABC/XYZ" },
  { contains: ["абс"],            any: [],                                       action: "📊 ABC/XYZ" },
  // --- Audience/competitors ---
  { contains: ["аудитори"],       any: [],                                       action: "👥 Аудитория" },
  { contains: ["конкурент"],      any: [],                                       action: "🕵️ Конкуренты" },
  // --- VK Analytics ---
  { contains: ["найди групп"],      any: [],                                       action: "vk_search_groups" },
  { contains: ["поищи групп"],      any: [],                                       action: "vk_search_groups" },
  { contains: ["добавь конкурент"], any: [],                                       action: "competitor_add" },
  { contains: ["скань конкурент"],  any: [],                                       action: "🕵️ Конкуренты" },
  // --- API keys ---
  { contains: ["ключ"],           any: ["покажи", "список", "все"],              action: "🔑 Все ключи" },
  { contains: ["лимит"],          any: ["ключ", "api"],                          action: "📊 Лимиты" },
  // --- Notes ---
  { contains: ["запомни"],        any: [],                                       action: "notes_save" },
  { contains: ["сохрани заметку"],any: [],                                       action: "notes_save" },
  { contains: ["добавь заметку"], any: [],                                       action: "notes_save" },
  { contains: ["найди заметку"],  any: [],                                       action: "notes_search" },
  { contains: ["найди в заметках"],any: [],                                      action: "notes_search" },
  { contains: ["поищи заметку"],  any: [],                                       action: "notes_search" },
  { contains: ["поищи в заметках"],any: [],                                      action: "notes_search" },
  { contains: ["покажи заметки"], any: [],                                       action: "📋 Список заметок" },
  { contains: ["список заметок"], any: [],                                       action: "📋 Список заметок" },
  { contains: ["мои заметки"],    any: [],                                       action: "📋 Список заметок" },
  { contains: ["удали заметку"],  any: [],                                       action: "notes_delete" },
  { contains: ["удалить заметку"],any: [],                                       action: "notes_delete" },
  { contains: ["заметку"],        any: ["покажи", "открой", "что в"],            action: "notes_get" },
  // --- Todos ---
  { contains: ["добавь задачу"],   any: [],                                       action: "todos_add" },
  { contains: ["добавь дело"],     any: [],                                       action: "todos_add" },
  { contains: ["запланируй"],      any: [],                                       action: "todos_add" },
  { contains: ["список дел"],      any: [],                                       action: "✅ Дела" },
  { contains: ["что на сегодня"],  any: [],                                       action: "✅ Дела" },
  { contains: ["мои дела"],        any: [],                                       action: "✅ Дела" },
  { contains: ["выполнено"],       any: ["задач", "#"],                           action: "todos_done" },
  { contains: ["сделано"],         any: ["задач", "#"],                           action: "todos_done" },
  { contains: ["удали задачу"],    any: [],                                       action: "todos_delete" },
  // --- Reminders ---
  { contains: ["напомни"],        any: [],                                       action: "reminder_add" },
  { contains: ["напоминание"],    any: ["поставь", "добавь", "создай"],          action: "reminder_add" },
  { contains: ["напоминани"],     any: ["покажи", "список", "все", "мои"],       action: "reminder_list" },
  { contains: ["напоминан"],      any: ["удали", "убери", "отмени"],             action: "reminder_delete" },
  { contains: ["удали напоминан"],any: [],                                       action: "reminder_delete" },
  // --- Digest ---
  { contains: ["дайджест"],       any: [],                                       action: "digest_now" },
  { contains: ["сводк"],          any: ["покажи", "дай", "что"],                 action: "digest_now" },
  { contains: ["дайджест"],       any: ["настрой", "поставь", "включи"],         action: "digest_setup" },
  // --- Великий Мудрец ---
  { contains: ["великий мудрец"], any: [],                                       action: "🧙 Великий Мудрец" },
  { contains: ["мудрец"],         any: ["спроси", "задай", "вопрос"],            action: "sage_ask" },
  { contains: ["продолжи"],       any: ["обсуждени", "#"],                       action: "sage_resume" },
  { contains: ["вернись"],        any: ["обсуждени", "#"],                       action: "sage_resume" },
  // --- Режим Мудреца ---
  { contains: ["режим"],          any: ["мудрец", "sage"],                       action: "⚙️ Режим Мудреца" },
  { contains: ["авто режим"],     any: [],                                       action: "🤖 Авто-режим (рекомендуется)" },
  { contains: ["мульти режим"],   any: [],                                       action: "🔬 Мульти-режим (все модели, медленнее)" },
  { contains: ["включи авто"],    any: ["мудрец", "модел", "режим"],             action: "🤖 Авто-режим (рекомендуется)" },
  { contains: ["включи мульти"],  any: ["мудрец", "модел", "режим"],             action: "🔬 Мульти-режим (все модели, медленнее)" },
  { contains: ["все модели"],     any: ["мудрец", "включи", "хочу"],             action: "🔬 Мульти-режим (все модели, медленнее)" },
  { contains: ["из архива"],      any: [],                                       action: "sage_archive_get" },
  { contains: ["закрой обсуждени"],any: [],                                      action: "sage_close" },
  { contains: ["в архив"],        any: ["обсуждени", "отправь"],                 action: "sage_close" },
  // --- Image generation (Pollinations.ai) ---
  { contains: ["нарисуй"],        any: [],                                       action: "image_generate" },
  { contains: ["дорисуй"],        any: [],                                       action: "image_generate" },
  { contains: ["нарисовать"],     any: [],                                       action: "image_generate" },
  { contains: ["сгенерируй"],     any: ["картин", "изображен", "рисун", "фото", "арт"], action: "image_generate" },
  { contains: ["создай"],         any: ["картинку", "изображение", "рисунок", "фото", "арт"], action: "image_generate" },
  { contains: ["генерируй"],      any: ["картин", "изображен"],                  action: "image_generate" },
  { contains: ["сделай"],         any: ["картинку", "изображение", "рисунок"],   action: "image_generate" },
  { contains: ["картинку"],       any: ["хочу", "покажи", "нужна"],              action: "image_generate" },
  // --- TTS / Voice (ElevenLabs) ---
  { contains: ["озвучь"],         any: [],                                       action: "tts_generate" },
  { contains: ["скажи голосом"],  any: [],                                       action: "tts_generate" },
  { contains: ["прочитай вслух"], any: [],                                       action: "tts_generate" },
  { contains: ["голосовое"],      any: ["сделай", "запиши", "создай"],           action: "tts_generate" },
  // --- Post generation (Groq LLM) ---
  { contains: ["напиши пост"],    any: [],                                       action: "post_generate" },
  { contains: ["сгенерируй пост"],any: [],                                       action: "post_generate" },
  { contains: ["создай пост"],    any: [],                                       action: "post_generate" },
  { contains: ["придумай пост"],  any: [],                                       action: "post_generate" },
];

function matchVoiceIntent(text: string): ButtonAction | null {
  const lower = text.toLowerCase();
  for (const intent of VOICE_INTENTS) {
    const allMatch = intent.contains.every((kw) => lower.includes(kw));
    if (!allMatch) continue;
    const anyMatch = !intent.any?.length || intent.any.some((kw) => lower.includes(kw));
    if (anyMatch) return BUTTON_ACTIONS[intent.action] ?? null;
  }
  return null;
}

// ============================================================================
// LLM intent classification — fallback when keyword matching fails
// Uses Groq fast model to classify free-form text into a known script action
// ============================================================================

/** Phrases that signal the user wants LLM to respond freely, not run a script */
const LLM_OVERRIDE_PHRASES = [
  "сам реши", "сам придумай", "напиши", "придумай", "сгенерируй",
  "объясни", "расскажи", "помоги", "посоветуй", "что думаешь",
  "напиши текст", "составь", "предложи", "как лучше",
];

/** Compact intent map: id → {description, actionKey} */
const LLM_INTENT_MAP: Record<string, { desc: string; key: string }> = {
  "orders_ozon":    { desc: "заказы на Ozon (покупки, отправки, клиенты)",           key: "🛒 Заказы Ozon" },
  "prices_ozon":    { desc: "цены на Ozon (прайс, стоимость товаров)",               key: "💰 Цены Ozon" },
  "stock_ozon":     { desc: "остатки/склад Ozon (сколько товаров, наличие)",         key: "📊 Остатки Ozon" },
  "products_ozon":  { desc: "список товаров Ozon (каталог, артикулы)",               key: "📦 Товары Ozon" },
  "orders_vk":      { desc: "заказы VK Маркет",                                     key: "🛒 Заказы VK" },
  "products_vk":    { desc: "товары VK Маркет",                                     key: "📦 Товары VK" },
  "avito_feed":     { desc: "фид/товары Avito",                                     key: "📦 Фид Avito" },
  "low_stock":      { desc: "что заканчивается на складе (мало, кончается)",         key: "📉 Кончаются" },
  "all_platforms":  { desc: "статус всех площадок / магазинов сразу",               key: "📋 Все площадки" },
  "publish_all":    { desc: "опубликовать/синхронизировать все площадки",            key: "📤 Все площадки" },
  "publish_ozon":   { desc: "обновить цены/товары на Ozon",                         key: "🟠 Ozon цены" },
  "publish_vk":     { desc: "опубликовать в VK Market",                             key: "💜 VK публикация" },
  "compare_prices": { desc: "сравнить цены между площадками",                       key: "📊 Сравнить цены" },
  "sync":           { desc: "обновить/синхронизировать склад или данные",            key: "🔄 Обновить" },
  "print_queue":    { desc: "очередь печати (что печатаем, статус принтера)",        key: "📋 Очередь" },
  "abc_xyz":        { desc: "ABC/XYZ анализ продаж",                                key: "📊 ABC/XYZ" },
  "audience":       { desc: "аудитория ВКонтакте (статистика группы)",              key: "👥 Аудитория" },
  "competitors":    { desc: "конкуренты ВКонтакте (анализ групп)",                  key: "🕵️ Конкуренты" },
  "keys_list":      { desc: "список API ключей",                                    key: "🔑 Все ключи" },
  "keys_limits":    { desc: "лимиты API ключей",                                    key: "📊 Лимиты" },
  "todos_add":        { desc: "добавить задачу / дело в список дел",                    key: "todos_add" },
  "todos_done":       { desc: "отметить задачу выполненной по номеру",                 key: "todos_done" },
  "todos_list":       { desc: "показать список дел / задач",                            key: "✅ Дела" },
  "notes_save":       { desc: "запомнить / сохранить заметку (текст для запоминания)", key: "notes_save" },
  "notes_search":     { desc: "найти заметку / поиск по заметкам",                    key: "notes_search" },
  "notes_list":       { desc: "показать все заметки / список заметок",                key: "📋 Список заметок" },
  "notes_delete":     { desc: "удалить заметку по номеру",                            key: "notes_delete" },
  "reminder_add":     { desc: "поставить / создать напоминание (с указанием времени)", key: "reminder_add" },
  "reminder_list":    { desc: "показать / список напоминаний",                        key: "reminder_list" },
  "reminder_delete":  { desc: "удалить / отменить напоминание по номеру",             key: "reminder_delete" },
  "digest_now":       { desc: "дайджест / сводка дня (заметки + напоминания)",        key: "digest_now" },
  "sage_ask":         { desc: "задать вопрос великому мудрецу / опросить все ИИ",      key: "sage_ask" },
  "sage_list":        { desc: "показать мои обсуждения / история мудреца",             key: "📚 Мои обсуждения" },
  "sage_resume":      { desc: "продолжить обсуждение с мудрецом по id",                key: "sage_resume" },
};

const LLM_INTENT_PROMPT = `Ты классификатор намерений для бота управления магазином.
Тебе дают сообщение пользователя. Определи: хочет ли он запустить одну из известных команд?

Доступные команды:
${Object.entries(LLM_INTENT_MAP).map(([id, { desc }]) => `- ${id}: ${desc}`).join("\n")}

Ответь ТОЛЬКО одним словом — id команды из списка выше, или "none" если сообщение не относится ни к одной команде.
Никаких пояснений, только id или "none".`;

export async function classifyIntentWithLLM(
  text: string,
  groqKeys: string[],
  log: (msg: string) => void,
): Promise<ButtonAction | null> {
  // Check for explicit LLM override phrases
  const lower = text.toLowerCase();
  if (LLM_OVERRIDE_PHRASES.some((p) => lower.includes(p))) {
    log(`[intent] LLM override phrase detected — skipping classification`);
    return null;
  }

  if (groqKeys.length === 0) return null;

  for (const key of groqKeys) {
    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: LLM_INTENT_PROMPT },
            { role: "user", content: text },
          ],
          max_tokens: 20,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (resp.status === 429) { continue; } // rotate key
      if (!resp.ok) { continue; }

      const data = await resp.json() as any;
      const intentId = data?.choices?.[0]?.message?.content?.trim().toLowerCase().replace(/[^a-z_]/g, "");

      if (!intentId || intentId === "none" || !LLM_INTENT_MAP[intentId]) {
        log(`[intent] LLM → none (${intentId})`);
        return null;
      }

      const mapped = LLM_INTENT_MAP[intentId]!;
      const action = BUTTON_ACTIONS[mapped.key];
      if (!action) return null;

      log(`[intent] LLM → "${intentId}" → ${mapped.key}`);
      return action;
    } catch (err: any) {
      log(`[intent] LLM error: ${err.message}`);
    }
  }

  return null;
}

// ============================================================================
// Multi-command helpers
// ============================================================================

/** Run a shell command, return trimmed output (max 1500 chars) */
async function runScript(cmd: string, log: (msg: string) => void): Promise<string> {
  log(`[dispatch] exec: ${cmd.slice(0, 100)}`);
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: EXEC_TIMEOUT,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let out = (stdout || "").trim();
    if (!out && stderr) out = `⚠️ ${stderr.trim().slice(0, 500)}`;
    if (!out) out = "Команда выполнена.";
    return out.slice(0, 1500);
  } catch (err: any) {
    const msg = err.killed
      ? "Таймаут: команда выполнялась слишком долго"
      : `⚠️ ${(err.message || "").slice(0, 200)}`;
    log(`[dispatch] exec error: ${msg}`);
    return msg;
  }
}

/** Phrases that signal LLM processing is still needed after script execution */
const LLM_NEEDED_PHRASES = [
  "продублируй", "повтори", "прочитай вслух", "перечисли",
  "подтверди", "что записал", "что ты записал", "что ты понял",
  "скажи что", "напиши что", "отправь мне",
];

function needsLLMAfterScripts(text: string): boolean {
  const lower = text.toLowerCase();
  return LLM_NEEDED_PHRASES.some((p) => lower.includes(p));
}

interface ScriptMatch {
  intentKey: string;
  action: ButtonAction;
}

/** Scan ALL VOICE_INTENTS — return every unique script-based match found in text */
function scanAllScriptIntents(text: string): ScriptMatch[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const results: ScriptMatch[] = [];
  for (const intent of VOICE_INTENTS) {
    const allMatch = intent.contains.every((kw) => lower.includes(kw));
    if (!allMatch) continue;
    const anyMatch = !intent.any?.length || intent.any.some((kw) => lower.includes(kw));
    if (!anyMatch) continue;
    const action = BUTTON_ACTIONS[intent.action];
    if (!action) continue;
    // Skip LLM personas and pure static responses (no script to run)
    if (action.passToLLM) continue;
    if (action.response && !action.script && !action.scriptFn) continue;
    if (seen.has(intent.action)) continue;
    seen.add(intent.action);
    results.push({ intentKey: intent.action, action });
  }
  return results;
}

// ============================================================================
// Dispatcher
// ============================================================================

export interface DispatchResult {
  handled: boolean;        // true = we handled it, don't pass to LLM
  text?: string;           // Response text
  keyboard?: string[][];   // Keyboard buttons (text)
  linkKeyboard?: Array<{ label: string; url?: string; app_id?: number; owner_id?: number; hash?: string }>;  // Link or app buttons
  personaFile?: string;    // If set, prepend persona to LLM context
  scriptResults?: string;  // Script outputs to prepend as context when passing to LLM
  imagePrompt?: string;    // If set, runtime generates image via Pollinations.ai
  ttsText?: string;        // If set, runtime generates voice message via ElevenLabs
  postTopic?: string;      // If set, runtime generates VK post text via Groq LLM
}

export interface IncomingDoc {
  url: string;
  filename?: string;
  ext?: string;
}

// Text-injectable file extensions
const SAGE_FILE_EXTS = new Set([
  "txt","md","rst","log",
  "py","js","ts","jsx","tsx","java","cs","cpp","c","h","go","rs","rb","php","swift","kt","scala","r",
  "sh","bash","zsh","bat","ps1",
  "json","yaml","yml","toml","ini","cfg","env",
  "csv","tsv","xml","html","htm","css","sql",
  "pdf","docx","xlsx",
]);

function isSageDoc(doc: IncomingDoc): boolean {
  const ext = (doc.ext ?? doc.filename?.split(".").pop() ?? "").toLowerCase();
  return SAGE_FILE_EXTS.has(ext);
}

export async function dispatchButton(
  messageText: string,
  log: (msg: string) => void,
  groqKeys?: string[],
  peerId?: number,
  incomingDoc?: IncomingDoc,
): Promise<DispatchResult> {
  const text = messageText.trim().replace(/\s+/g, ' ');

  // Level 1: exact button match
  // Level 2: normalized (no spaces / lowercase)
  let action: ButtonAction | null | undefined =
    BUTTON_ACTIONS[text]
    || BUTTON_ACTIONS[text.replace(/\s+/g, '')]
    || BUTTON_ACTIONS[text.toLowerCase()];

  // Level 3: multi-command scan — find ALL script intents in text
  if (!action) {
    const scriptMatches = scanAllScriptIntents(text);
    const needsLLM = needsLLMAfterScripts(text);

    if (scriptMatches.length === 1 && !needsLLM) {
      // Single script, no LLM needed — use normal execution path below
      action = scriptMatches[0].action;
    } else if (scriptMatches.length > 0) {
      // Multiple scripts OR single script + LLM request — execute all, then decide
      const outputs = await Promise.all(
        scriptMatches.map(async ({ intentKey, action: a }) => {
          let cmd: string | null = null;
          if (a.scriptFn) cmd = a.scriptFn(text, peerId ?? 0);
          else if (a.script) cmd = a.script;
          if (!cmd) return null;
          const out = await runScript(cmd, log);
          log(`[multi-dispatch] ${intentKey} → ${out.slice(0, 60)}`);
          return out;
        })
      );
      const valid = outputs.filter(Boolean) as string[];
      if (valid.length === 0) return { handled: false };

      if (!needsLLM) {
        // Pure multi-script: combine and return
        const lastKb = scriptMatches[scriptMatches.length - 1].action.keyboard;
        return {
          handled: true,
          text: valid.join("\n\n").slice(0, 3800),
          keyboard: lastKb,
        };
      }

      // Scripts + LLM: pass results as context
      const ctx = [
        `[Автоматически выполнено ${valid.length} ${valid.length === 1 ? "команда" : "команды"}:]`,
        ...valid,
        `[Оригинальный запрос: "${text.slice(0, 300)}"]`,
      ].join("\n\n");
      return { handled: false, scriptResults: ctx };
    }
  }

  // Level 3.5: Sage free-text input — if user has active sage session, treat as new question
  if (!action && peerId && sageActiveSessions.has(peerId)) {
    const lower = text.toLowerCase();
    // Don't intercept menu navigation commands
    const isMenuCmd = lower.startsWith("🔙") || lower === "меню" || lower === "menu"
      || lower.startsWith("мои обсуждения") || lower.startsWith("архив")
      || lower.startsWith("отчёт") || lower.startsWith("график");
    if (!isMenuCmd && text.length > 3) {
      action = BUTTON_ACTIONS["sage_ask"];
      log(`[sage] free-text question in active session ${sageActiveSessions.get(peerId)}`);
    }
  }

  // Level 4: LLM intent classification (async, only if keys available)
  if (!action && groqKeys?.length) {
    action = await classifyIntentWithLLM(text, groqKeys, log);
  }

  if (!action) {
    // Not recognized — pass to LLM as free chat
    return { handled: false };
  }

  // Pass to LLM with persona context
  if (action.passToLLM && action.persona) {
    const personaPath = `${PERSONAS_DIR}/${action.persona}.md`;
    return {
      handled: false,
      personaFile: personaPath,
    };
  }

  // Static response (menus, greetings)
  if (action.response && !action.script) {
    return {
      handled: true,
      text: action.response,
      keyboard: action.keyboard,
      linkKeyboard: action.linkKeyboard,
    };
  }

  // Dynamic script built from user text
  if (action.scriptFn) {
    const dynamicScript = action.scriptFn(text, peerId ?? 0);
    if (!dynamicScript) {
      return {
        handled: true,
        text: "⚠️ Не понял запрос. Попробуй точнее, например: «запомни купить молоко» или «найди заметку молоко».",
        keyboard: action.keyboard ?? NOTES_MENU,
      };
    }
    // Sage commands take much longer (bridge query-all)
    const isSageCmd = dynamicScript.includes(SAGE_PY);
    const timeout = isSageCmd ? SAGE_TIMEOUT : EXEC_TIMEOUT;
    log(`[dispatcher] exec (dynamic): ${dynamicScript.slice(0, 120)}`);
    try {
      const { stdout, stderr } = await execAsync(dynamicScript, {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      let output = (stdout || "").trim();
      if (!output && stderr) output = `Ошибка: ${stderr.trim().slice(0, 500)}`;
      if (!output) output = "Команда выполнена.";

      // Sage: extract SESSION_ID line and save to active sessions map
      if (isSageCmd && peerId) {
        const sidMatch = output.match(/^SESSION_ID:([a-f0-9]{8})/m);
        if (sidMatch) {
          sageActiveSessions.set(peerId, sidMatch[1]);
          log(`[sage] active session set: peer=${peerId} sid=${sidMatch[1]}`);
        }
        // Sage: extract REPORT_FILE line (for future file sending)
        const rptMatch = output.match(/^REPORT_FILE:(.+)$/m);
        if (rptMatch) {
          log(`[sage] report generated: ${rptMatch[1].trim()}`);
        }
        // Strip technical lines from user-visible output
        output = output.replace(/^SESSION_ID:[^\n]*\n?/m, "").replace(/^REPORT_FILE:[^\n]*\n?/m, "").trim();
      }

      if (output.length > 3800) output = output.slice(0, 3800) + "\n\n... (обрезано)";
      return { handled: true, text: output, keyboard: action.keyboard };
    } catch (err: any) {
      const errMsg = err.killed
        ? "Таймаут: команда выполнялась слишком долго"
        : `Ошибка: ${(err.message || "").slice(0, 300)}`;
      log(`[dispatcher] exec error: ${errMsg}`);
      return { handled: true, text: `⚠️ ${errMsg}`, keyboard: action.keyboard };
    }
  }

  // Image generation (Pollinations.ai)
  if (action.imageFn) {
    const prompt = action.imageFn(text);
    if (!prompt) {
      return {
        handled: true,
        text: "🎨 Что нарисовать? Например: «нарисуй замок в тумане» или «нарисуй терраин для D&D».",
      };
    }
    log(`[dispatcher] image gen: "${prompt.slice(0, 60)}"`);
    return { handled: true, imagePrompt: prompt };
  }

  // TTS generation (ElevenLabs) — FROZEN: upload flow not verified
  if (action.ttsFn) {
    return { handled: true, text: "🔒 Голосовые сообщения пока в разработке." };
  }

  // Post generation (Groq LLM) — FROZEN: GROQ_API_KEY not configured
  if (action.postFn) {
    return { handled: true, text: "🔒 Генерация постов пока в разработке." };
  }

  // Execute script directly
  if (action.script) {
    log(`[dispatcher] exec: ${action.script}`);
    try {
      const { stdout, stderr } = await execAsync(action.script, {
        timeout: EXEC_TIMEOUT,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });

      let output = (stdout || "").trim();
      if (!output && stderr) {
        output = `Ошибка: ${stderr.trim().slice(0, 500)}`;
      }
      if (!output) {
        output = "Команда выполнена, но не вернула данных.";
      }

      // Truncate if too long for VK (4096 chars)
      if (output.length > 3800) {
        output = output.slice(0, 3800) + "\n\n... (данные обрезаны, слишком длинный ответ)";
      }

      return {
        handled: true,
        text: output,
        keyboard: action.keyboard,
      };
    } catch (err: any) {
      const errMsg = err.killed
        ? "Таймаут: команда выполнялась слишком долго"
        : `Ошибка: ${(err.message || "").slice(0, 300)}`;
      log(`[dispatcher] exec error: ${errMsg}`);
      return {
        handled: true,
        text: `⚠️ ${errMsg}`,
        keyboard: action.keyboard,
      };
    }
  }

  return { handled: false };
}

// ============================================================================
// Keyboard builder (VK format)
// ============================================================================

export function buildSimpleKeyboard(buttons: string[][]): string {
  return JSON.stringify({
    one_time: false,
    inline: false,
    buttons: buttons.map(row =>
      row.map(label => ({
        action: {
          type: "text",
          label: label.slice(0, 40),  // VK limit
        },
        color: label.includes("Меню") ? "negative"
          : label.includes("Чат") ? "positive"
          : "primary",
      }))
    ),
  });
}

export function buildLinkKeyboard(links: Array<{ label: string; url?: string; app_id?: number; owner_id?: number; hash?: string }>): string {
  return JSON.stringify({
    one_time: true,
    inline: false,
    buttons: links.map((item) => {
      if (item.app_id) {
        return [{
          action: {
            type: "open_app",
            label: item.label.slice(0, 40),
            app_id: item.app_id,
            owner_id: item.owner_id ?? 0,
            hash: item.hash ?? "",
          },
        }];
      }
      return [{
        action: {
          type: "open_link",
          label: item.label.slice(0, 40),
          link: item.url ?? "",
        },
      }];
    }),
  });
}
