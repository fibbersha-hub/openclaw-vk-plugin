# Интеграция с VK (ВКонтакте) — актуальное состояние 2026

> **Важно:** В 2026 году VK изменил политику выдачи API-доступов.  
> Этот документ описывает что работает сейчас и какие ограничения существуют.

---

## Что изменилось в 2026 году

В апреле 2026 VK прислал уведомление:

> *«Из-за изменения политики дистрибуции API-методов, согласно п. 7.3 оферты, расширенные API-доступы в сервисе больше не выдаются. При этом вы по-прежнему можете подключить авторизацию через VK ID, используя базовые права.»*

### Что это значит на практике

| Функция | Раньше | Сейчас |
|---------|--------|--------|
| Отправка сообщений | ✅ | ✅ Работает |
| Получение сообщений (Long Poll) | ✅ | ✅ Работает |
| Кнопки в сообщениях | ✅ | ✅ Работает |
| Статистика группы | ✅ | ✅ Работает |
| Товары (Market) | ✅ | ✅ Работает |
| Публикации на стене | ✅ | ✅ Работает |
| **Загрузка фото через community token** | ✅ | ❌ Возвращает `photo: "[]"` |
| **Поиск групп (groups.search)** | ✅ | ⚠️ Только user token |
| **Демография аудитории** | ✅ | ⚠️ Только user token |

### Обходное решение для фото

Загрузка фото требует расширенных прав. Обходы:
1. **Ссылка на изображение** — используется для генерации картинок (Pollinations.ai)
2. **User token** — если у вас есть персональный токен с нужными правами
3. **Загрузка через docs** — документы загружаются с community token, но отображаются как файлы

---

## Типы токенов VK

### Community Token (токен сообщества)

**Что это:** токен привязан к конкретному сообществу, не к человеку.

**Получить:**
1. Сообщество → **Управление → Настройки → Работа с API**
2. **Создать ключ**
3. Выбрать права (см. ниже)
4. Подтвердить через SMS

**Права для полной работы плагина:**
```
messages    — отправка и получение сообщений (обязательно)
photos      — загрузка фото (ограничено, см. выше)
docs        — загрузка документов
wall        — публикации на стене
stories     — истории
market      — товары и заказы
manage      — управление сообществом
stats       — статистика
```

**Минимальные права (только чат-бот):**
```
messages
```

> ⚠️ Токен привязан к IP-адресу сервера. При смене сервера нужен новый токен.  
> ⚠️ Показывается один раз. Сохраните сразу.

---

### User Token (пользовательский токен)

**Что это:** токен конкретного пользователя. Нужен для:
- `groups.search` — поиск групп
- `groups.getMembers` — демография аудитории
- Любых методов, недоступных community token

**Получить через OAuth:**

1. Создайте Standalone-приложение на [vk.com/editapp?act=create](https://vk.com/editapp?act=create)
   - Тип: **Standalone**
   - Название: произвольное

2. Запомните **App ID** (числовой)

3. Откройте в браузере (замените `APP_ID`):
```
https://oauth.vk.com/authorize?client_id=APP_ID&scope=groups,offline&redirect_uri=https://oauth.vk.com/blank.html&response_type=token&v=5.199
```

4. После авторизации скопируйте `access_token` из URL:
```
https://oauth.vk.com/blank.html#access_token=vk1.a.XXXXXXXX&expires_in=0&user_id=...
```

5. Добавьте в `config.env`:
```bash
VK_USER_TOKEN=vk1.a.XXXXXXXX
```

> ⚠️ User token с `expires_in=0` — **бессрочный** (offline access).  
> ⚠️ Привязан к IP вашего браузера. Если получен с домашнего ПК — работает только оттуда.  
> ⚠️ Не передавайте этот токен никому — он даёт доступ от вашего имени.

---

### VK ID Token (новый метод, 2026)

VK рекомендует переходить на авторизацию через **VK ID** для новых приложений.

**Что даёт:** базовые права (имя, аватар, ID пользователя).  
**Не даёт:** messages, wall, market, photos — для этого нужен community token.

Для бота-ассистента VK ID не нужен — используйте community + user token.

---

## Long Poll API — как работает подключение

Плагин использует **Long Poll** для получения сообщений — не webhook, публичный URL не нужен.

```
1. Bot → VK: groups.getLongPollServer (получаем server/key/ts)
2. Bot → VK: GET {server}?act=a_check&key={key}&ts={ts}&wait=25
3. VK держит соединение до 25 секунд
4. При новом событии → VK возвращает ответ немедленно
5. Bot обрабатывает события, повторяет с новым ts
```

**Включить Long Poll в сообществе:**
1. Сообщество → **Управление → Настройки → Работа с API**
2. **Long Poll API** → Включить
3. Версия API: **5.199** (или последняя)

**Включить сообщения бота:**
1. Сообщество → **Управление → Сообщения**
2. Включить **Сообщения сообщества**
3. Включить **Возможности бота** (позволяет боту отвечать первым)

---

## Поддерживаемые события Long Poll

| Событие | Код | Обрабатывается |
|---------|-----|----------------|
| Новое сообщение | `message_new` | ✅ |
| Callback-кнопка | `message_event` | ✅ |
| Новый участник | `group_join` | ✅ (логируется) |
| Уход участника | `group_leave` | ✅ (логируется) |
| Новый пост на стене | `wall_post_new` | 🧪 |

---

## Ограничения VK API

| Ограничение | Значение |
|-------------|---------|
| Rate limit | 3 запроса/сек на токен |
| `execute()` батчинг | до 25 API-вызовов за 1 запрос |
| Длина сообщения | 4096 символов |
| Кнопок в ряду | до 5 |
| Рядов кнопок | до 10 |
| Фото в сообщении | до 10 |
| Получатели рассылки | до 100 за раз |

Плагин автоматически:
- Разбивает длинные сообщения на части (умный сплит по абзацам)
- Соблюдает rate limit (авто-retry при 429)
- Батчит вызовы через `execute()` где возможно

---

## Методы VK API в плагине (120+)

### Сообщения (messages.*)
```
messages.send          messages.edit          messages.delete
messages.getHistory    messages.getConversations
messages.pin           messages.unpin         messages.markAsRead
messages.search        messages.sendEventAnswer
```

### Фото (photos.*)
```
photos.getMessagesUploadServer   photos.saveMessagesPhoto
photos.getWallUploadServer       photos.saveWallPhoto
photos.getMarketUploadServer     photos.saveMarketPhoto
photos.getOwnerCoverPhotoUploadServer
```
> ⚠️ `saveMessagesPhoto` требует расширенных прав — см. ограничения 2026 выше

### Документы (docs.*)
```
docs.getMessagesUploadServer     docs.save
docs.getWallUploadServer         docs.get
```

### Стена (wall.*)
```
wall.post    wall.edit    wall.delete    wall.get
wall.getById wall.pin     wall.unpin     wall.search
wall.repost  wall.getComments
```

### Товары (market.*)
```
market.add         market.edit        market.delete
market.get         market.getById     market.search
market.addAlbum    market.editAlbum   market.deleteAlbum
market.getAlbums   market.getOrders   market.getOrderItems
```

### Статистика (stats.*)
```
stats.get   stats.getPostReach
```

### Группы (groups.*)
```
groups.getById        groups.getMembers
groups.ban            groups.unban
groups.isMember       groups.search (user token)
```

### Истории (stories.*)
```
stories.getPhotoUploadServer   stories.save
stories.getVideoUploadServer
```

### Опросы (polls.*)
```
polls.create   polls.getVoters   polls.getById
```

### Прочее
```
execute()           — батчинг до 25 вызовов
users.get           — информация о пользователях
utils.resolveScreenName — resolve screen_name → id
```

---

## Конфигурация канала

```json
{
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "vk1.a.YOUR_COMMUNITY_TOKEN",
          "groupId": "YOUR_GROUP_ID",
          "enabled": true,
          "dmPolicy": "allowlist",
          "allowFrom": ["YOUR_VK_USER_ID"],
          "groqApiKey": "gsk_YOUR_GROQ_KEY",
          "transcribeVoice": true,
          "apiVersion": "5.199",
          "longPollWait": 25,
          "formatMarkdown": true,
          "autoKeyboard": true
        }
      }
    }
  }
}
```

### Политики доступа (dmPolicy)

| Политика | Кто может писать |
|----------|----------------|
| `allowlist` | Только ID из `allowFrom` |
| `pairing` | Неизвестные получают код подтверждения |
| `open` | Все желающие |
| `disabled` | Никто |

---

## Вопросы и ошибки

📧 **fibber.sha@yandex.ru**

Укажите: текст ошибки из логов, версию OpenClaw, тип токена (community/user).
