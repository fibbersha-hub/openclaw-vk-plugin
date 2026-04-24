# OpenClaw VK Plugin — Полное руководство по VK API

> Составлено на основе официальной документации VK API v5.199  
> Источник: dev.vk.com (собрано краулером, апрель 2026)

---

## 1. Типы токенов

### 1.1 Токен сообщества (Community Access Token)

Используется плагином для всей основной работы: сообщения, Long Poll, Callback API.

**Как получить:**
```
VK.com → Сообщество → Управление → Дополнительно → Работа с API → Ключи доступа → Создать ключ
```

**Доступные scope (официальный список):**

| Scope | Бит | Описание |
|-------|-----|----------|
| `stories` | 1 << 0 | Публикация историй |
| `photos` | 1 << 2 | Загрузка фотографий |
| `app_widget` | 1 << 6 | Виджеты приложений сообщества |
| `messages` | 1 << 12 | Сообщения сообщества (**обязательный**) |
| `docs` | 1 << 17 | Загрузка документов |
| `wall` | 1 << 18 | Публикации на стену сообщества |
| `manage` | 1 << 18 | Управление сообществом, статистика, Callback |

> **Важно:** `market` и `wall` в отдельном смысле отсутствуют в токене сообщества. Методы `market.*` требуют User Token.

**Жизненный цикл:** бессрочный, до ручного отзыва или смены прав.

**Формат:** `vk1.a.<token>`

---

### 1.2 Пользовательский токен (User Access Token)

Нужен только для методов `market.*`.

**Изменение с 25 июня 2024:** Implicit Flow и Authorization Code Flow — устарели.  
Официальный способ — VK ID SDK или HTTP-запрос через VK ID.

**Для Standalone-приложений (старый Implicit Flow — поддерживается для ранее выданных токенов):**
```
https://oauth.vk.com/authorize?client_id=APP_ID&display=page
  &redirect_uri=https://oauth.vk.com/blank.html
  &scope=SCOPE&response_type=token&v=5.199
```

**С 10 апреля 2026:** Standalone-приложения создаются только через [Сервис авторизации VK ID](https://id.vk.com/business/go).

**Scope для market:**

| Атрибут | Значение | Описание |
|---------|----------|----------|
| `market` | 134 217 728 (1 << 27) | Доступ к товарам |
| `offline` | 65 536 (1 << 16) | Бессрочный токен |
| `wall` | 8 192 (1 << 13) | Стена (не работает с Authorization Code Flow) |
| `photos` | 4 (1 << 2) | Фотографии |

> **Важно:** Scope `market` для приложений, созданных в VK ID сервисе, требует одобрения поддержки.  
> Пишите на `devsupport@corp.vk.com` с указанием App ID и Group ID.

---

### 1.3 Сервисный ключ (Service Token)

- Выдаётся автоматически при регистрации приложения
- Бессрочный, можно обновить в настройках
- Только для серверных запросов (не передавать клиенту)
- Получение: **Настройки приложения → Сервисный ключ**

---

## 2. Bots Long Poll API

Рекомендован для разработки и небольших нагрузок. Очередь событий хранится на стороне VK.

### 2.1 Настройка

```
Управление → Дополнительно → Работа с API → Long Poll API → Включено
Управление → Дополнительно → Работа с API → Long Poll API → Типы событий → выбрать нужные
```

Через API:
- `groups.getLongPollServer` — получить server/key/ts
- `groups.getLongPollSettings` — получить настройки
- `groups.setLongPollSettings` — установить настройки

### 2.2 Подключение

```
GET {server}?act=a_check&key={key}&ts={ts}&wait=25
```

Параметры:
- `key` — секретный ключ сессии
- `ts` — номер последнего события
- `wait` — таймаут (макс. 90 сек, рекомендуется 25)

### 2.3 Формат ответа

```json
{
  "ts": "4",
  "updates": [
    {
      "type": "message_new",
      "event_id": "c68dfb983247...",
      "v": "5.199",
      "object": { ... },
      "group_id": 123456
    }
  ]
}
```

### 2.4 Ошибки Long Poll

| Код | Описание | Действие |
|-----|----------|----------|
| `failed: 1` | История устарела | Продолжать с новым `ts` из ответа |
| `failed: 2` | Ключ истёк | Получить новый `key` через `groups.getLongPollServer` |
| `failed: 3` | Информация утрачена | Получить новые `key` и `ts` |

### 2.5 Ключевые типы событий

| Тип | Описание |
|-----|----------|
| `message_new` | Новое сообщение |
| `message_reply` | Ответ на сообщение бота |
| `message_edit` | Редактирование сообщения |
| `message_allow` | Пользователь разрешил сообщения |
| `message_deny` | Пользователь запретил сообщения |
| `message_event` | Событие callback-кнопки |
| `group_join` | Вступление в сообщество |
| `group_leave` | Выход из сообщества |
| `wall_post_new` | Новая запись на стене |
| `photo_new` | Новая фотография |

---

## 3. Callback API

Для продакшен-окружений. VK присылает события на ваш сервер.

### 3.1 Настройка

```
Управление → Дополнительно → Работа с API → Callback API → указать URL
```

- Можно подключить до **10 серверов**
- Каждому серверу — отдельный набор событий и версия API
- Сервер должен вернуть строку `ok` и статус HTTP 200

### 3.2 Подтверждение сервера

При добавлении сервера VK отправляет запрос с `type: "confirmation"`.  
Ваш сервер должен вернуть строку подтверждения (из настроек сообщества или `groups.getCallbackConfirmationCode`).

### 3.3 Секретный ключ

В настройках Callback API можно указать `secret` — строку, которая будет приходить в каждом событии для верификации.

### 3.4 API-методы управления

```
groups.addCallbackServer     — добавить сервер
groups.deleteCallbackServer  — удалить сервер
groups.editCallbackServer    — редактировать
groups.getCallbackConfirmationCode — код подтверждения
groups.getCallbackServers    — список серверов
groups.getCallbackSettings   — настройки событий
groups.setCallbackSettings   — установить события
```

---

## 4. Сообщения

### 4.1 Отправка сообщения

Метод: `messages.send`

**Ключевые параметры:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `peer_id` | int | Получатель (user_id, -group_id, 2e9+chat_id) |
| `user_ids` | list | До 100 получателей (для рассылок) |
| `message` | string | Текст, макс. 4096 символов |
| `attachment` | string | Вложения: `photo{owner}_{id}`, `doc{owner}_{id}`, etc. |
| `keyboard` | json | Клавиатура (см. раздел 5) |
| `template` | json | Карусель (carousel) |
| `random_id` | int32 | Уникальный ID для защиты от дублей (**обязателен**) |
| `forward` | json | Пересылаемые сообщения / ответ |
| `sticker_id` | int | ID стикера |

**Лимиты:**
- До **20 запросов/сек** с токеном сообщества
- Группировка: до **100 получателей** в `user_ids`
- execute(): до **25 вызовов** в одном запросе

### 4.2 Peer ID диапазоны

| Диапазон | Тип |
|----------|-----|
| 1 — 1 900 000 000 | Переписка с пользователем |
| -1 000 000 000 — -1 | Переписка с сообществом |
| 2 000 000 001 — 2 100 000 000 | Групповой чат (2e9 + chat_id) |
| 200 000 000 000+ | LongID пользователи (новые) |

### 4.3 Загрузка фото в сообщение

```
1. photos.getMessagesUploadServer(group_id=GROUP_ID)
   → upload_url

2. POST upload_url, field: photo, format: multipart/form-data
   → {server, photo, hash}

3. photos.saveMessagesPhoto(server, photo, hash)
   → [{id, owner_id, ...}]

4. messages.send(attachment="photo{owner_id}_{id}")
```

**Ограничения фото:**
- Форматы: JPG, PNG, GIF
- Макс. размер: 50 МБ
- Сумма сторон ≤ 14 000 px

### 4.4 Редактирование и удаление

```
messages.edit(peer_id, conversation_message_id, ...)
messages.delete(peer_id, cmids=[...], delete_for_all=1)
messages.pin(peer_id, conversation_message_id)
```

---

## 5. Клавиатуры

### 5.1 Структура

```json
{
  "one_time": false,
  "inline": false,
  "buttons": [
    [
      {
        "action": {
          "type": "text",
          "label": "Кнопка 1",
          "payload": "{\"key\": \"value\"}"
        },
        "color": "primary"
      }
    ]
  ]
}
```

### 5.2 Типы клавиатур

| Тип | `inline` | Кнопок | Рядов |
|-----|----------|--------|-------|
| Клавиатура чата | `false` | до 40 | до 10 (по 5 в ряд) |
| Inline-клавиатура | `true` | до 10 | до 6 (по 5 в ряд) |

### 5.3 Типы кнопок

| Тип | Описание | Обязательные поля |
|-----|----------|-------------------|
| `text` | Отправляет текст | `label` (макс. 40 символов) |
| `callback` | Не отправляет сообщение, генерирует событие `message_event` | `label` |
| `location` | Диалог геолокации | — |
| `vkpay` | VK Pay платёж | `hash` |
| `open_app` | Открыть мини-приложение | `app_id`, `label` |
| `open_link` | Открыть URL | `link`, `label` |

### 5.4 Цвета кнопок (для `text` и `callback`)

| Константа | Цвет (светлая тема) | Применение |
|-----------|---------------------|------------|
| `primary` | #5181B8 (синий) | Основное действие |
| `secondary` | #E5EBF1 (серый) | Обычная кнопка |
| `negative` | #E64646 (красный) | Опасное/отмена |
| `positive` | #4BB34B (зелёный) | Подтверждение |

### 5.5 Callback-кнопки

При нажатии генерируется событие `message_event`:
```json
{
  "type": "message_event",
  "object": {
    "user_id": 12345,
    "peer_id": 12345,
    "event_id": "...",
    "payload": {"key": "value"},
    "conversation_message_id": 1
  }
}
```

Ответить на событие: `messages.sendMessageEventAnswer`

---

## 6. VK Market API

> Все методы `market.*` работают **только с User Token**.  
> Scope `market` (134217728) требует одобрения VK Support для новых приложений.

### 6.1 Объект товара (market-item)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | int | ID товара |
| `owner_id` | int | ID владельца (отрицательный для сообщества) |
| `title` | string | Название |
| `description` | string | Описание |
| `price.amount` | string | Цена в сотых долях (например "10000" = 100.00 ₽) |
| `price.currency.name` | string | Валюта (RUB) |
| `availability` | int | 0=доступен, 1=удалён, 2=недоступен |
| `sku` | string | Артикул (до 50 символов) |
| `thumb_photo` | string | URL обложки |
| `photos` | array | Все фото (при `extended=1`) |
| `category.id` | int | ID категории |
| `dimensions` | object | width/height/length в мм |
| `weight` | int | Вес в граммах |

### 6.2 Основные методы Market

| Метод | Описание |
|-------|----------|
| `market.get` | Список товаров сообщества |
| `market.getById` | Товары по ID |
| `market.add` | Добавить товар |
| `market.edit` | Редактировать товар |
| `market.delete` | Удалить товар |
| `market.restore` | Восстановить удалённый |
| `market.search` | Поиск товаров |
| `market.getAlbums` | Список подборок |
| `market.addAlbum` | Создать подборку |
| `market.editAlbum` | Редактировать подборку |
| `market.deleteAlbum` | Удалить подборку |
| `market.addToAlbum` | Добавить в подборку |
| `market.removeFromAlbum` | Убрать из подборки |
| `market.getGroupOrders` | Заказы сообщества |
| `market.getOrderById` | Заказ по ID |
| `market.editOrder` | Обновить статус заказа |
| `market.getProductPhotoUploadServer` | URL загрузки фото товара |
| `market.saveProductPhoto` | Сохранить фото товара |

### 6.3 Загрузка фото для товара

**Метод 1 (новый, рекомендуется):**
```
1. market.getProductPhotoUploadServer(group_id=GROUP_ID)
   → {"upload_url": "https://pu.vk.com/..."}

2. POST upload_url, field: file, format: multipart/form-data
   Форматы: JPG, PNG, GIF
   Минимум: 400×400 px, макс. 50 МБ

3. market.saveProductPhoto(upload_response=<json из шага 2>)
   → photo_id для использования в market.add / market.edit
```

**Загрузка фото для подборки товаров:**
```
1. photos.getMarketAlbumUploadServer(group_id=GROUP_ID)
   → upload_url
   Минимум: 1280×720 px

2. POST upload_url, field: file
   → {server, photo, gid, hash}

3. photos.saveMarketAlbumPhoto(group_id, server, photo, hash)
   → фото сохранено
```

### 6.4 Параметры market.add / market.edit

| Параметр | Описание |
|----------|----------|
| `owner_id` | -GROUP_ID (отрицательный) |
| `name` | Название товара |
| `description` | Описание |
| `category_id` | ID категории (market.getCategories) |
| `price` | Цена в рублях (число) |
| `old_price` | Старая цена (зачёркнутая) |
| `deleted` | 1 = скрыт |
| `main_photo_id` | ID главной фотографии |
| `photo_ids` | Дополнительные фото (список ID) |
| `sku` | Артикул |
| `weight` | Вес в граммах |
| `dimensions_width/height/length` | Габариты в мм |

---

## 7. Загрузка файлов (общая схема)

Для всех типов медиа — трёхэтапный процесс:

```
1. Получить URL загрузки (метод getUploadServer)
2. POST файл на URL (multipart/form-data)
3. Сохранить результат (метод save*)
```

| Тип файла | Получить URL | Поле | Сохранить |
|-----------|-------------|------|-----------|
| Фото в альбом | `photos.getUploadServer` | `file1..file5` | `photos.save` |
| Фото на стену | `photos.getWallUploadServer` | `photo` | `photos.saveWallPhoto` |
| Фото в сообщение | `photos.getMessagesUploadServer` | `photo` | `photos.saveMessagesPhoto` |
| Фото товара | `market.getProductPhotoUploadServer` | `file` | `market.saveProductPhoto` |
| Фото подборки | `photos.getMarketAlbumUploadServer` | `file` | `photos.saveMarketAlbumPhoto` |
| Документ | `docs.getWallUploadServer` / `docs.getMessagesUploadServer` | `file` | `docs.save` |
| Аудиосообщение | запрос к специальному URL | `file` | сохраняется автоматически |

---

## 8. LongID — переход на Int64

VK переходит на Int64 для всех идентификаторов.

**Затронутые поля:** `user_id`, `group_id`, `owner_id`, `peer_id`, `author_id`

**Диапазоны peer_id после перехода:**

```javascript
// Пользователи (старые):
peer_id >= 1 && peer_id < 1.9e9

// Пользователи (новые LongID):
peer_id >= 200e9 && peer_id < 100e10

// Чаты (без изменений):
peer_id > 2e9 && peer_id < 2e9 + 1e8

// Сообщества (отрицательные):
peer_id >= -1e9 && peer_id < -1
```

**Рекомендации для плагина:**
- `groupId` передаётся как строка — совместимо ✅
- ID в параметрах API-запросов безопасны (JavaScript Number = 2⁵³)
- База данных: использовать `BIGINT` / `Int64` для хранения ID

---

## 9. Формат API-запросов

**Базовый URL:** `https://api.vk.com/method/`  
**Версия API:** `v=5.199`

**Формат запроса:**
```
GET/POST https://api.vk.com/method/{MethodName}?param1=val1&access_token=TOKEN&v=5.199
```

**execute() — батчинг до 25 вызовов:**
```javascript
// В одном запросе
execute?code=return [API.messages.send({...}), API.wall.post({...})];
```

**Лимиты:**
- Токен сообщества: 20 запросов/сек
- User token: 3 запроса/сек (с auto-retry)

---

## 10. Коды ошибок

| Код | Описание | Действие |
|-----|----------|----------|
| `1` | Неизвестная ошибка | Повторить |
| `5` | Авторизация не пройдена | Проверить токен |
| `6` | Слишком много запросов | Throttle + retry |
| `7` | Нет прав для действия | Проверить scope |
| `9` | Flood control | Пауза + retry |
| `10` | Внутренняя ошибка сервера | Retry с backoff |
| `14` | Требуется капча | Обработка captcha |
| `15` | Доступ запрещён | Проверить права |
| `17` | Требуется валидация | Redirect на validate_url |
| `18` | Страница удалена/заблокирована | Проверить статус |
| `100` | Неверный параметр | Проверить запрос |
| `901` | Сообщения запрещены | Пользователь запретил |
| `911` | Неверный формат клавиатуры | Проверить JSON клавиатуры |
| `936` | Контактные данные не найдены | — |

**Стратегия retry:**
- Экспоненциальный backoff с джиттером
- Макс. 3–5 попыток
- Для кода 6 (flood): обязательная пауза 1–3 сек

---

## 11. Конфигурация OpenClaw VK Plugin

```json
{
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "vk1.a.COMMUNITY_TOKEN",
          "groupId": "YOUR_GROUP_ID",
          "enabled": true,
          "dmPolicy": "allowlist",
          "allowFrom": ["USER_VK_ID"],
          "apiVersion": "5.199",
          "longPollWait": 25,
          "formatMarkdown": true,
          "autoKeyboard": true,
          "groups": {
            "2000000001": {
              "systemPrompt": "Промпт для беседы 1",
              "requireMention": true,
              "toolsAllow": ["web-search"]
            }
          }
        }
      }
    }
  }
}
```

### Политики DM

| Политика | Поведение |
|----------|-----------|
| `pairing` | Неизвестные пользователи получают код сопряжения |
| `allowlist` | Только ID из `allowFrom` |
| `open` | Любой может писать |
| `disabled` | Входящие отключены |

---

## 12. Чеклист перед запуском

- [ ] Токен сообщества создан (минимум scope: `messages`)
- [ ] Long Poll API включён в настройках сообщества (API version 5.199)
- [ ] Возможности ботов включены: Управление → Сообщения → Настройки для бота
- [ ] `groupId` — число без знака минус
- [ ] Конфигурация применена в `openclaw.json`
- [ ] Проверка токена: `curl "https://api.vk.com/method/groups.getById?group_id=GROUP_ID&access_token=TOKEN&v=5.199"`
- [ ] Тестовое сообщение успешно получено

---

*Версия: 2026-04-19 | VK API v5.199 | Источник: dev.vk.com*
