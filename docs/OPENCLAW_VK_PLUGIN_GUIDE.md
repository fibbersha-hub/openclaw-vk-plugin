# OpenClaw VK Plugin — Полная документация

> Составлено на основе исходного кода плагина (TypeScript, ESM)  
> VK API v5.199 · OpenClaw Channel Plugin SDK  
> Версия: 2026-04-18

---

## Оглавление

1. [Описание плагина](#1-описание-плагина)
2. [Структура файлов](#2-структура-файлов)
3. [Установка и сборка](#3-установка-и-сборка)
4. [Конфигурация](#4-конфигурация)
5. [Конфигурация аккаунта — все параметры](#5-конфигурация-аккаунта--все-параметры)
6. [DM-политики](#6-dm-политики)
7. [Per-group конфигурация бесед](#7-per-group-конфигурация-бесед)
8. [Форматирование: Markdown → VK](#8-форматирование-markdown--vk)
9. [Клавиатуры — автопарсинг кнопок](#9-клавиатуры--автопарсинг-кнопок)
10. [Входящие медиа](#10-входящие-медиа)
11. [События Long Poll](#11-события-long-poll)
12. [VK API Client — полный список методов](#12-vk-api-client--полный-список-методов)
13. [Коды ошибок VK API](#13-коды-ошибок-vk-api)
14. [Rate Limiting](#14-rate-limiting)
15. [Загрузка медиафайлов — схема](#15-загрузка-медиафайлов--схема)
16. [Примеры использования](#16-примеры-использования)

---

## 1. Описание плагина

**OpenClaw VK Plugin** — полноценный Channel Plugin для платформы OpenClaw, интегрирующий ВКонтакте.

| Параметр | Значение |
|----------|----------|
| Plugin ID | `vk` |
| Язык | TypeScript (ESM) |
| VK API | v5.199 |
| Методов VK API | **120+** |
| Транспорт | Bots Long Poll API |
| Rate limit | 3 req/s (встроенный rate limiter) |
| execute() батчинг | Да, до 25 вызовов за 1 запрос |
| Автоклавиатура | Да, парсинг из текста LLM |
| Markdown → VK | Да, автоконвертация |
| Входящие медиа | Да — фото, видео, аудио, документы, войсы, стикеры, ссылки |
| Тип чатов | direct (личка), group (беседы) |

### Что умеет плагин

- Принимать и отправлять сообщения в личку и беседы
- Публиковать посты на стену сообщества
- Управлять VK Market (магазин): создавать/редактировать/удалять товары
- Загружать фото и документы на серверы VK
- Публиковать истории (Stories)
- Управлять сообществом: бан/разбан, теги, онлайн-статус
- Создавать опросы, читать статистику
- Работать с виджетами приложений сообщества
- Управлять обсуждениями (Board), Donut-подписчиками
- Батчить API-вызовы через `execute()`

---

## 2. Структура файлов

```
openclaw-vk-plugin/
├── src/
│   ├── channel.ts          # ChannelPlugin определение (точка входа плагина)
│   ├── api.ts              # VkApi клиент — 120+ методов VK API
│   ├── types.ts            # TypeScript типы (VkMessage, VkKeyboard, VkMarketItem...)
│   ├── runtime.ts          # VkLongPollRuntime — Long Poll цикл
│   ├── accounts.ts         # Разрешение аккаунтов из конфига
│   ├── formatter.ts        # markdownToVk(), chunkText()
│   ├── keyboard.ts         # extractButtons(), buildKeyboard(), simpleKeyboard()
│   ├── media.ts            # extractMedia() — обработка вложений
│   ├── button-dispatcher.ts# Диспетчер нажатий кнопок
│   └── plugin-sdk.ts       # Интерфейс ChannelPlugin
├── dist/                   # Скомпилированный JS (после npm run build)
├── docs/                   # Документация
├── personas/               # Шаблоны персон/ролей агента
├── skills/                 # Навыки (скилы) плагина
├── studio-tools/           # CLI-инструменты студии (vk_parser.py и т.д.)
├── package.json
├── tsconfig.json
└── openclaw.plugin.json    # Метаданные плагина
```

---

## 3. Установка и сборка

### 3.1 Требования

- Node.js 18+
- npm 9+
- OpenClaw (основное приложение)

### 3.2 Установка

```bash
# Клонировать репозиторий
git clone <repo-url> /opt/openclaw-vk-plugin
cd /opt/openclaw-vk-plugin

# Установить зависимости
npm install

# Собрать
npm run build
```

### 3.3 Подключить к OpenClaw

В файле `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/opt/openclaw-vk-plugin"]
    }
  },
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "vk1.a.YOUR_COMMUNITY_TOKEN",
          "groupId": "YOUR_GROUP_ID"
        }
      }
    }
  }
}
```

### 3.4 Проверка

```bash
# Запуск OpenClaw
openclaw start

# Проверить статус VK-аккаунта
openclaw channels vk status

# Разрешить пользователя (паринг)
openclaw channels vk allow 460657784
```

---

## 4. Конфигурация

Полная структура конфига:

```json
{
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "vk1.a.COMMUNITY_TOKEN",
          "groupId": "225425795",
          "enabled": true,
          "dmPolicy": "pairing",
          "allowFrom": ["460657784", "27733429"],
          "apiVersion": "5.199",
          "longPollWait": 25,
          "formatMarkdown": true,
          "autoKeyboard": true,
          "groups": {
            "2000000001": {
              "systemPrompt": "Ты помощник студии Ульвар...",
              "requireMention": false,
              "toolsAllow": ["web_search", "exec"],
              "toolsDeny": ["dangerous_tool"]
            }
          }
        }
      }
    }
  }
}
```

---

## 5. Конфигурация аккаунта — все параметры

### VkAccountConfig

| Параметр | Тип | Обязательный | По умолчанию | Описание |
|----------|-----|-------------|-------------|----------|
| `token` | `string` | ✅ | — | Community Access Token (`vk1.a.…`) |
| `groupId` | `string` | ✅ | — | ID сообщества (без знака минус) |
| `enabled` | `boolean` | ❌ | `true` | Включить/выключить аккаунт |
| `dmPolicy` | `DmPolicy` | ❌ | `"pairing"` | Политика личных сообщений |
| `allowFrom` | `string[]` | ❌ | `[]` | Белый список VK User ID |
| `apiVersion` | `string` | ❌ | `"5.199"` | Версия VK API |
| `longPollWait` | `number` | ❌ | `25` | Таймаут Long Poll в секундах (макс. 90) |
| `formatMarkdown` | `boolean` | ❌ | — | Конвертировать Markdown ответов в VK-формат |
| `autoKeyboard` | `boolean` | ❌ | — | Автоматически создавать клавиатуры из текста LLM |
| `groups` | `Record<string, VkGroupChatConfig>` | ❌ | — | Настройки per-беседа |

---

## 6. DM-политики

Тип `DmPolicy` — контролирует кто может писать боту в личку:

| Политика | Описание |
|----------|----------|
| `"open"` | Все пользователи могут писать без ограничений |
| `"pairing"` | Только пользователи, одобренные через `openclaw channels vk allow` |
| `"allowlist"` | Только пользователи из `allowFrom` в конфиге |
| `"closed"` | Никто не может писать в личку |
| `"disabled"` | Личные сообщения полностью отключены |

**Одобрение пользователя (pairing):**
```bash
openclaw channels vk allow 460657784
# → Отправляет пользователю: "✅ You have been approved to use this bot."
```

При попытке неавторизованного пользователя написать — сообщение игнорируется.

---

## 7. Per-group конфигурация бесед

### VkGroupChatConfig

| Параметр | Тип | Описание |
|----------|-----|----------|
| `systemPrompt` | `string` | Системный промпт для этой беседы (переопределяет глобальный) |
| `toolsAllow` | `string[]` | Полный список разрешённых инструментов (переопределяет дефолт) |
| `toolsAlsoAllow` | `string[]` | Добавить инструменты к дефолтному списку |
| `toolsDeny` | `string[]` | Запрещённые инструменты |
| `allowFrom` | `string[]` | Список VK User ID кто может использовать бота в этой беседе |
| `requireMention` | `boolean` | Отвечать только при упоминании @бот |

**Ключ беседы** — `peer_id` в строковом формате. Для бесед VK: `2000000001`, `2000000002` и т.д.

---

## 8. Форматирование: Markdown → VK

Файл: [src/formatter.ts](../src/formatter.ts)

Функция `markdownToVk(text)` — автоматически конвертирует Markdown из LLM-ответов в формат VK.

### Правила конвертации

| Markdown | VK результат | Примечание |
|----------|-------------|-----------|
| `**bold**`, `__bold__` | `**bold**` | VK поддерживает нативно с 2024 |
| `*italic*`, `_italic_` | `*italic*` | VK поддерживает нативно |
| `` `code` `` | `` `code` `` | Monospace — без изменений |
| ` ```lang\ncode\n``` ` | ` ```\ncode\n``` ` | Убирается название языка |
| `~~strike~~` | `~~strike~~` | VK поддерживает |
| `# Заголовок` | `**Заголовок**` | Все уровни заголовков → жирный |
| `---` / `***` | `————————————————` | Разделитель |
| `[text](url)` | `text (url)` | URL отображается явно |
| `![alt](url)` | `[Изображение: alt] url` | |
| `- item` / `* item` | `• item` | Маркированный список |
| `1. item` | `1) item` | Нумерованный список |
| `> quote` | `« quote »` | Цитата |
| `- [x] done` | `✅ done` | Чек-бокс (выполнено) |
| `- [ ] todo` | `☐ todo` | Чек-бокс (не выполнено) |
| `\| col1 \| col2 \|` | `**col1** \| **col2**` | Таблица (упрощённая) |

### chunkText(text, maxLen?)

Делит текст на части с учётом лимита VK 4096 символов.  
Разбивает по абзацам → строкам → пробелам (в порядке приоритета).

```typescript
const chunks = chunkText(longText); // maxLen = 4096 по умолчанию
for (const chunk of chunks) {
  await api.messagesSend({ peer_id, message: chunk, random_id: ... });
}
```

---

## 9. Клавиатуры — автопарсинг кнопок

Файл: [src/keyboard.ts](../src/keyboard.ts)

### 9.1 Лимиты VK

| Параметр | Значение |
|----------|----------|
| Максимум строк | 10 |
| Кнопок в строке | 4 |
| Длина метки кнопки | 40 символов (обрезается с `…`) |
| Максимум кнопок (inline) | 10 |

### 9.2 Автопарсинг из текста LLM

`extractButtons(text)` — парсит текст ответа LLM и создаёт клавиатуру.

**Три паттерна (в порядке приоритета):**

**1. Скобочные кнопки** `[Текст]` или `[Текст](payload)`:
```
Выберите действие:
[Показать каталог](catalog)
[Проверить остатки](stock)
[Позвонить]
```
→ Кнопки типа `text`, цвет `primary`. Текст очищается от паттернов.

**2. Нумерованный список** (2-10 вариантов, последовательная нумерация):
```
1. Вариант А
2. Вариант Б
3. Вариант В
```
→ Кнопки типа `text`, цвет `secondary`. Исходный текст сохраняется.

**3. Слэш-команды** `/команда — описание`:
```
/help — Показать справку
/status — Статус системы
/catalog — Открыть каталог
```
→ Кнопки типа `text` с `/команда`, цвет `primary`.

### 9.3 Построение клавиатуры вручную

```typescript
import { buildKeyboard, simpleKeyboard, removeKeyboard } from "./keyboard.js";

// Простая клавиатура из строк
const kb = simpleKeyboard(["Да", "Нет", "Отмена"], {
  oneTime: true,
  color: "primary",
});

// Полный контроль
const kb2 = buildKeyboard([
  { action: { type: "text", label: "Каталог" }, color: "primary" },
  { action: { type: "text", label: "Остатки" }, color: "secondary" },
  { action: { type: "open_link", label: "Открыть сайт", link: "https://ulvar.ru" } },
], false); // oneTime = false

// Убрать клавиатуру
const noKb = removeKeyboard(); // JSON строка → передаётся в keyboard параметр
```

### 9.4 Цвета кнопок

| Цвет | VK | Визуально |
|------|-----|----------|
| `"primary"` | Синий | Основное действие |
| `"secondary"` | Белый/серый | Второстепенное |
| `"positive"` | Зелёный | Подтверждение |
| `"negative"` | Красный | Опасное действие |

### 9.5 Типы кнопок

| Тип | Параметры | Описание |
|-----|-----------|----------|
| `text` | `label`, `payload?` | Обычная кнопка, отправляет текст |
| `callback` | `label`, `payload?` | Callback кнопка (без сообщения в чат) |
| `open_link` | `label`, `link` | Открыть URL |
| `vkpay` | `hash` | VK Pay |
| `open_app` | `label`, `app_id`, `owner_id?`, `hash?` | Открыть Mini App |
| `location` | `payload?` | Отправить геолокацию |

---

## 10. Входящие медиа

Файл: [src/media.ts](../src/media.ts)

`extractMedia(message)` — извлекает вложения из входящего сообщения.

### Поддерживаемые типы

| VK тип | Возвращаемый тип | MIME |
|--------|-----------------|------|
| `photo` | `image` | `image/jpeg` |
| `doc` (gif) | `image` | `image/gif` |
| `doc` (image) | `image` | по расширению |
| `doc` (видео) | `video` | по расширению |
| `doc` (аудио) | `audio` | по расширению |
| `doc` (другие) | `document` | по расширению |
| `audio` | `audio` | `audio/mpeg` |
| `video` | `video` | `video/mp4` |
| `sticker` | `image` | `image/png` |
| `audio_message` | `voice` | `audio/ogg` |
| `link` | `link` | `text/html` |

Лимит размера: **5 МБ** (параметр `MAX_MEDIA_SIZE`).

Для фото — выбирается наилучшее разрешение (приоритет типов: `w > z > y > r > q > p > o > x > m > s`).

---

## 11. События Long Poll

Файл: [src/types.ts](../src/types.ts) — тип `VkEventType`

Плагин подписывается на события через Bots Long Poll API.

### Основные события

| Событие | Описание |
|---------|----------|
| `message_new` | Новое сообщение (основное событие) |
| `message_reply` | Ответ на сообщение |
| `message_edit` | Редактирование сообщения |
| `message_event` | Нажатие callback-кнопки |
| `message_typing_state` | Индикатор ввода |
| `message_allow` | Пользователь разрешил сообщения |
| `message_deny` | Пользователь запретил сообщения |

### События контента

| Событие | Описание |
|---------|----------|
| `wall_post_new` | Новая запись на стене |
| `wall_repost` | Репост |
| `photo_new` | Новое фото |
| `video_new` | Новое видео |
| `poll_vote_new` | Голос в опросе |

### События сообщества

| Событие | Описание |
|---------|----------|
| `group_join` | Пользователь вступил |
| `group_leave` | Пользователь вышел |
| `user_block` | Пользователь заблокирован |
| `user_unblock` | Пользователь разблокирован |
| `group_officers_edit` | Изменение прав администраторов |
| `group_change_settings` | Изменение настроек сообщества |

### Donut-события

| Событие | Описание |
|---------|----------|
| `donut_subscription_create` | Новая подписка Donut |
| `donut_subscription_prolonged` | Продление подписки |
| `donut_subscription_cancelled` | Отмена подписки |
| `donut_money_withdraw` | Вывод донатов |

### Reconnect-логика

| `failed` код | Действие |
|-------------|---------|
| `1` | Обновить ts, продолжить |
| `2` | Получить новый key (getLongPollServer) |
| `3` | Получить новый key + ts (getLongPollServer) |

---

## 12. VK API Client — полный список методов

Файл: [src/api.ts](../src/api.ts) — класс `VkApi`

Создание клиента:
```typescript
const api = new VkApi({
  token: "vk1.a.COMMUNITY_TOKEN",
  groupId: "225425795",
  version: "5.199",       // опционально
  log: console.log,       // опционально
});
```

Прямой вызов любого метода:
```typescript
const result = await api.call("any.method", { param: "value" });
```

### 12.1 Messages (Сообщения)

| Метод | Параметры | Описание |
|-------|-----------|----------|
| `messagesSend(params)` | `SendMessageParams` | Отправить сообщение |
| `messagesEdit(params)` | peer_id, message_id, message?, attachment?, keyboard? | Редактировать сообщение |
| `messagesDelete(params)` | message_ids?, cmids?, peer_id?, spam?, delete_for_all? | Удалить сообщения |
| `messagesGetHistory(params)` | peer_id, offset?, count?(max 200), start_message_id?, rev? | История переписки |
| `messagesGetConversations(params?)` | offset?, count?(max 200), filter? | Список диалогов |
| `messagesSetActivity(params)` | peer_id, type("typing"\|"audiomessage") | Индикатор "печатает" |
| `messagesPin(params)` | peer_id, message_id?\|conversation_message_id? | Закрепить сообщение |
| `messagesUnpin(params)` | peer_id | Открепить сообщение |
| `messagesMarkAsRead(params)` | peer_id, start_message_id? | Отметить как прочитанное |
| `messagesSearch(params)` | q, peer_id?, count?, offset? | Поиск по сообщениям |
| `messagesSendEventAnswer(params)` | event_id, user_id, peer_id, event_data | Ответ на callback-кнопку |
| `messagesCreateChat(params)` | user_ids[], title | Создать беседу |
| `messagesGetConversationMembers(params)` | peer_id | Участники беседы |
| `messagesGetHistoryAttachments(params)` | peer_id, media_type, count?, start_from? | Медиа в переписке |
| `messagesSendReaction(params)` | peer_id, cmid, reaction_id | Добавить реакцию |
| `messagesDeleteReaction(params)` | peer_id, cmid | Удалить реакцию |

**SendMessageParams (ключевые поля):**

| Поле | Тип | Описание |
|------|-----|----------|
| `peer_id` | `number` | ID диалога (пользователь, беседа, сообщество) |
| `peer_ids` | `number[]` | Множественная отправка |
| `random_id` | `number` | Уникальный ID (защита от дублей, обязательный) |
| `message` | `string` | Текст (до 4096 символов) |
| `attachment` | `string` | Вложения: `photo-225425795_123,doc-225425795_456` |
| `keyboard` | `string` | JSON клавиатуры |
| `template` | `string` | JSON карусели |
| `sticker_id` | `number` | ID стикера |
| `intent` | `string` | `"default"\|"promo_newsletter"\|"bot_ad_invite"\|"bot_ad_promo"` |

**peer_id диапазоны:**
- `> 0` — пользователь (user_id)
- `< 0` — сообщество (−group_id)
- `> 2000000000` — беседа (2000000000 + chat_id)

### 12.2 Photos (Фотографии)

| Метод | Описание |
|-------|----------|
| `photosGetMessagesUploadServer(params?)` | URL для загрузки фото в сообщение |
| `photosSaveMessagesPhoto(params)` | Сохранить фото сообщения |
| `photosGetWallUploadServer(params?)` | URL для загрузки фото на стену |
| `photosSaveWallPhoto(params)` | Сохранить фото стены |
| `photosGetMarketUploadServer(params)` | URL для загрузки фото товара |
| `photosSaveMarketPhoto(params)` | Сохранить фото товара |
| `photosGetOwnerCoverPhotoUploadServer(params?)` | URL для загрузки обложки сообщества |
| `photosSaveOwnerCoverPhoto(params)` | Сохранить обложку |
| **`uploadPhotoForMessage(filePath, peerId?)`** | ⚡ Высокоуровневый: загрузить фото для сообщения (3 шага автоматически) |
| **`uploadPhotoForWall(filePath)`** | ⚡ Высокоуровневый: загрузить фото для стены |
| **`uploadPhotoForMarket(filePath, mainPhoto?)`** | ⚡ Высокоуровневый: загрузить фото для товара |
| **`uploadCoverPhoto(filePath)`** | ⚡ Высокоуровневый: загрузить обложку сообщества |

### 12.3 Documents (Документы)

| Метод | Описание |
|-------|----------|
| `docsGetMessagesUploadServer(params)` | URL загрузки документа в сообщение |
| `docsGetWallUploadServer(params?)` | URL загрузки документа на стену |
| `docsSave(params)` | Сохранить загруженный документ |
| `docsGet(params?)` | Список документов сообщества |
| **`uploadDocForMessage(filePath, peerId, title?)`** | ⚡ Высокоуровневый |
| **`uploadDocForWall(filePath, title?)`** | ⚡ Высокоуровневый |

Типы документов (параметр `type` в `docsGetMessagesUploadServer`): `"doc"` | `"audio_message"` | `"graffiti"`.

### 12.4 Video (Видео)

| Метод | Описание |
|-------|----------|
| `videoSave(params)` | Подготовить загрузку видео |
| `videoGet(params?)` | Список видео сообщества |
| **`uploadVideo(filePath, name?, description?)`** | ⚡ Высокоуровневый |

### 12.5 Wall (Стена)

| Метод | Описание |
|-------|----------|
| `wallPost(params)` | Опубликовать пост |
| `wallEdit(params)` | Редактировать пост |
| `wallDelete(params)` | Удалить пост |
| `wallGet(params?)` | Посты стены (filter: owner\|others\|all\|suggests\|postponed) |
| `wallGetById(params)` | Получить посты по ID |
| `wallPin(params)` | Закрепить пост |
| `wallUnpin(params)` | Открепить пост |
| `wallCreateComment(params)` | Написать комментарий |
| `wallGetComments(params)` | Комментарии к посту |
| `wallSearch(params)` | Поиск по стене |
| `wallRepost(params)` | Репост (`object`: `"wall-GROUP_ID_POST_ID"`) |

**WallPostParams (ключевые поля):**

| Поле | Описание |
|------|----------|
| `owner_id` | Отрицательный ID для сообщества (−225425795) |
| `message` | Текст поста |
| `attachments` | Вложения через запятую: `photo-225425795_123,video-225425795_456` |
| `from_group` | `1` = от имени сообщества |
| `publish_date` | Unix timestamp для отложенной публикации |
| `mark_as_ads` | `1` = пометить как рекламу |
| `close_comments` | `1` = закрыть комментарии |

### 12.6 Market (Магазин)

| Метод | Описание |
|-------|----------|
| `marketAdd(params)` | Создать товар |
| `marketEdit(params)` | Редактировать товар |
| `marketDelete(params)` | Удалить товар |
| `marketRestore(params)` | Восстановить удалённый товар |
| `marketGet(params?)` | Список товаров магазина |
| `marketGetById(params)` | Товары по ID |
| `marketSearch(params)` | Поиск по магазину |
| `marketGetCategories(params?)` | Категории товаров |
| `marketAddAlbum(params)` | Создать коллекцию |
| `marketEditAlbum(params)` | Редактировать коллекцию |
| `marketDeleteAlbum(params)` | Удалить коллекцию |
| `marketGetAlbums(params?)` | Список коллекций |
| `marketAddToAlbum(params)` | Добавить товар в коллекцию |
| `marketRemoveFromAlbum(params)` | Убрать из коллекции |
| `marketGetGroupOrders(params?)` | Заказы магазина |
| `marketGetOrderById(params)` | Конкретный заказ |
| `marketEditOrder(params)` | Обновить статус/трек-номер заказа |
| `marketCreateComment(params)` | Комментарий к товару |
| `marketGetComments(params)` | Комментарии к товару |

**MarketAddParams (обязательные поля):**

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | `string` | Название (4-100 символов) |
| `description` | `string` | Описание (мин. 10 символов) |
| `category_id` | `number` | ID категории |
| `main_photo_id` | `number` | ID главной фотографии |
| `price` | `number` | Цена в копейках (1000 = 10 руб) |

**Статусы заказа** (`marketEditOrder.status`): `0`=открыт, `1`=оплачен, `2`=в процессе, `3`=отправлен, `4`=доставлен, `5`=отменён, `6`=отклонён.

### 12.7 Stories (Истории)

| Метод | Описание |
|-------|----------|
| `storiesGetPhotoUploadServer(params?)` | URL загрузки фото-истории |
| `storiesGetVideoUploadServer(params?)` | URL загрузки видео-истории |
| `storiesSave(params)` | Сохранить загруженную историю |
| `storiesGet(params?)` | Список историй |
| `storiesGetViewers(params)` | Просмотры истории |
| **`uploadPhotoStory(filePath, addToNews?)`** | ⚡ Высокоуровневый |

### 12.8 Groups (Сообщество)

| Метод | Описание |
|-------|----------|
| `groupsGetById(params?)` | Информация о сообществе |
| `groupsGetMembers(params?)` | Участники (sort, filter: friends\|unsure\|managers\|donut) |
| `groupsEdit(params)` | Редактировать настройки сообщества |
| `groupsBan(params)` | Заблокировать пользователя |
| `groupsUnban(params)` | Разблокировать пользователя |
| `groupsGetBanned(params?)` | Список заблокированных |
| `groupsIsMember(params)` | Проверить членство пользователя |
| `groupsEnableOnline(params?)` | Включить онлайн-статус |
| `groupsDisableOnline(params?)` | Выключить онлайн-статус |
| `groupsGetOnlineStatus(params?)` | Текущий онлайн-статус |
| `groupsGetTokenPermissions()` | Права текущего токена |
| `groupsGetSettings(params?)` | Настройки сообщества |
| `groupsTagAdd(params)` | Создать тег |
| `groupsTagDelete(params)` | Удалить тег |
| `groupsGetTagList(params?)` | Список тегов |
| `groupsGetLongPollServer(params?)` | Параметры Long Poll сервера |

### 12.9 Users, Likes, Polls, Stats

| Метод | Описание |
|-------|----------|
| `usersGet(params)` | Информация о пользователях (user_ids, fields, name_case) |
| `likesAdd(params)` | Поставить лайк |
| `likesDelete(params)` | Убрать лайк |
| `likesGetList(params)` | Список пользователей, поставивших лайк |
| `pollsCreate(params)` | Создать опрос |
| `pollsGetById(params)` | Получить опрос |
| `pollsGetVoters(params)` | Проголосовавшие |
| `statsGet(params)` | Статистика сообщества за период |
| `statsGetPostReach(params)` | Охват записей |

### 12.10 Дополнительные модули

| Метод | Описание |
|-------|----------|
| `leadFormsGet(params)` | Лид-форма |
| `leadFormsList(params?)` | Список лид-форм |
| `leadFormsGetLeads(params)` | Заявки лид-формы |
| `appWidgetsUpdate(params)` | Обновить виджет приложения сообщества |
| `boardGetTopics(params?)` | Темы обсуждений |
| `boardAddTopic(params)` | Создать тему |
| `boardCreateComment(params)` | Комментарий в обсуждении |
| `donutIsDon(params)` | Является ли пользователь Donut-подписчиком |
| `donutGetFriends(params?)` | Друзья-подписчики Donut |
| `notificationsSendMessage(params)` | Уведомление (только для пользователей приложения) |
| `prettyCardsCreate(params)` | Создать красивую карточку |
| `prettyCardsGet(params?)` | Список красивых карточек |
| `utilsResolveScreenName(params)` | Разрешить имя → object_id |
| `utilsGetShortLink(params)` | Создать короткую ссылку vk.cc/... |
| `utilsGetServerTime()` | Серверное время VK (Unix timestamp) |

### 12.11 execute() — Батчинг

```typescript
// Выполнить произвольный VKScript
const result = await api.execute<unknown[]>(`
  return [
    API.groups.getById({"group_id": "225425795"}),
    API.market.get({"owner_id": -225425795, "count": 10}),
    API.wall.get({"owner_id": -225425795, "count": 5})
  ];
`);

// Автоматический батчинг массива вызовов
const results = await api.executeBatch([
  { method: "groups.getById", params: { group_id: "225425795" } },
  { method: "market.get", params: { owner_id: -225425795, count: 10 } },
  // ... до 25 вызовов в одном батче
]);
```

Лимит: **25 API-вызовов** за 1 запрос `execute()`. При `executeBatch()` > 25 — автоматически разбивается на несколько батчей.

---

## 13. Коды ошибок VK API

| Код | Константа | Описание | Действие |
|-----|-----------|----------|---------|
| 1 | `UNKNOWN` | Неизвестная ошибка | Retry (до 2 раз) |
| 2 | `APP_DISABLED` | Приложение отключено | — |
| 3 | `UNKNOWN_METHOD` | Неизвестный метод | Проверить имя метода |
| 5 | `AUTH_FAILED` | Неверный токен | Заменить токен |
| 6 | `TOO_MANY_REQUESTS` | Rate limit | Auto-retry через 350мс |
| 7 | `PERMISSION_DENIED` | Нет прав | Проверить scope токена |
| 8 | `INVALID_REQUEST` | Неверный запрос | Проверить параметры |
| 9 | `FLOOD_CONTROL` | Flood control | Auto-retry через 1000мс |
| 10 | `INTERNAL` | Внутренняя ошибка VK | Retry |
| 14 | `CAPTCHA_NEEDED` | Требуется капча | — |
| 15 | `ACCESS_DENIED` | Доступ закрыт | — |
| 100 | `PARAM_ERROR` | Неверный параметр | Проверить параметры |
| 104 | `NOT_FOUND` | Не найдено | — |
| 901 | `MESSAGES_DENY_SEND` | Пользователь запретил сообщения | — |
| 911 | `MESSAGES_KEYBOARD_INVALID` | Неверная клавиатура | Проверить JSON |
| 914 | `MESSAGES_TOO_LONG` | Сообщение слишком длинное | Разбить через chunkText() |
| 1405 | `MARKET_TOO_MANY_ITEMS` | Слишком много товаров в магазине | — |

**Обработка ошибок:**

```typescript
import { VkApiCallError, VkErrorCode } from "./api.js";

try {
  await api.messagesSend({ peer_id: 460657784, random_id: ..., message: "Привет" });
} catch (e) {
  if (e instanceof VkApiCallError) {
    if (e.code === VkErrorCode.MESSAGES_DENY_SEND) {
      // Пользователь запретил сообщения
    }
    console.log(e.method, e.code, e.message);
  }
}
```

---

## 14. Rate Limiting

Плагин имеет встроенный **Rate Limiter** (файл `src/api.ts`).

| Параметр | Значение |
|----------|----------|
| Лимит | 3 запроса / секунда |
| Алгоритм | Sliding window (1 сек) |
| При error_code=6 | Retry через 350 мс |
| При error_code=9 | Retry через 1000 мс |
| При error_code=1 | Retry через 1000 мс |
| Максимум retry | 2 попытки |
| Очередь | Автоматическая, FIFO |

Rate limiter прозрачен — все методы `api.*` автоматически проходят через него. Ничего настраивать не нужно.

---

## 15. Загрузка медиафайлов — схема

Все загрузки в VK — **трёхшаговый процесс**:

```
1. GET  photos.getXxxUploadServer → { upload_url }
2. POST {upload_url} (multipart/form-data) → { server, photo/file, hash }
3. POST photos.saveXxxPhoto({ server, photo, hash }) → [{ id, owner_id, ... }]
```

После сохранения формируется **attachment string**: `{type}{owner_id}_{id}`

### Примеры attachment строк

| Тип | Формат | Пример |
|-----|--------|--------|
| Фото | `photo{owner_id}_{photo_id}` | `photo-225425795_123456` |
| Документ | `doc{owner_id}_{doc_id}` | `doc-225425795_789` |
| Видео | `video{owner_id}_{video_id}` | `video-225425795_321` |
| Аудио | `audio{owner_id}_{audio_id}` | `audio123456_789` |
| Опрос | `poll{owner_id}_{poll_id}` | `poll-225425795_456` |

Несколько вложений — через запятую: `photo-225425795_123,doc-225425795_456`

### Поля формы по типу

| Метод загрузки | Поле формы |
|----------------|-----------|
| photos (message/wall) | `photo` |
| photos (market) | `file` |
| photos (cover) | `photo` |
| docs | `file` |
| video | `video_file` |
| stories | `file` |

---

## 16. Примеры использования

### 16.1 Отправить сообщение с кнопками

```typescript
import { VkApi } from "./src/api.js";
import { simpleKeyboard } from "./src/keyboard.js";

const api = new VkApi({ token: "vk1.a...", groupId: "225425795" });

const kb = simpleKeyboard(["📦 Каталог", "📊 Остатки", "❓ Помощь"], {
  oneTime: false,
  color: "primary",
});

await api.messagesSend({
  peer_id: 460657784,
  random_id: Math.floor(Math.random() * 2147483647),
  message: "Выберите раздел:",
  keyboard: JSON.stringify(kb),
});
```

### 16.2 Опубликовать пост с фото

```typescript
// Загрузить фото
const photo = await api.uploadPhotoForWall("/opt/photos/product.jpg");

// Опубликовать
const { post_id } = await api.wallPost({
  owner_id: -225425795,
  from_group: 1,
  message: "Новинка! Башня стражи — 3D-печатный террейн для D&D 🏰\n\nМатериал: PETG | Цена: 850₽",
  attachments: `photo${photo.owner_id}_${photo.id}`,
});
console.log("Post ID:", post_id);
```

### 16.3 Добавить товар в VK Market

```typescript
// Загрузить главное фото
const photo = await api.uploadPhotoForMarket("/opt/photos/tower_main.jpg", true);

// Создать товар
const { market_item_id } = await api.marketAdd({
  owner_id: -225425795,
  name: "Башня стражи (3D-печать, PETG)",
  description: "3D-печатная башня стражи для настольных игр D&D, Warhammer, Pathfinder. Материал: PETG. Высокая детализация. Вес: 106г.",
  category_id: 1,                    // Получить из marketGetCategories()
  price: 85000,                       // 850,00 руб. в копейках
  main_photo_id: photo.id,
  sku: "Т_0001",
});
console.log("Market Item ID:", market_item_id);
```

### 16.4 Batch-запрос через execute()

```typescript
// Одновременно получить info сообщества + товары + последние посты
const [groupInfo, marketItems, wallPosts] = await api.executeBatch([
  { method: "groups.getById", params: { group_id: "225425795", fields: "members_count,status" } },
  { method: "market.get", params: { owner_id: -225425795, count: 10 } },
  { method: "wall.get", params: { owner_id: -225425795, count: 5 } },
]);
```

### 16.5 Ответить на callback-кнопку

```typescript
// В обработчике события message_event
await api.messagesSendEventAnswer({
  event_id: event.object.event_id,
  user_id: event.object.user_id,
  peer_id: event.object.peer_id,
  event_data: {
    type: "show_snackbar",
    text: "✅ Действие выполнено",
  },
});
```

### 16.6 Форматирование ответа LLM

```typescript
import { markdownToVk, chunkText } from "./src/formatter.js";
import { extractButtons } from "./src/keyboard.js";

const llmResponse = `
## Результат анализа

**Топ-3 группы:**
1. Выбор А
2. Выбор Б
3. Выбор В
`;

// Конвертировать markdown
const vkText = markdownToVk(llmResponse);

// Авто-клавиатура
const { text, keyboard } = extractButtons(vkText);

// Разбить если > 4096 символов
const chunks = chunkText(text);
for (const [i, chunk] of chunks.entries()) {
  await api.messagesSend({
    peer_id,
    random_id: Math.random() * 2147483647 | 0,
    message: chunk,
    keyboard: i === chunks.length - 1 && keyboard ? JSON.stringify(keyboard) : undefined,
  });
}
```

---

*Конец документа. Исходный код: [src/](../src/) · VK API Reference: https://dev.vk.com/ru/reference*
