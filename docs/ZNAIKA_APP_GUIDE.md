# Знайка — Руководство по приложению

> VK Mini App для управления Студией 3D Террейна Ульвар  
> Составлено на основе исходного кода и официальной документации VK API v5.199  
> Версия: 2026-04-18

---

## 1. Что такое Знайка

**Знайка** — приватный VK Mini App (веб-приложение внутри VK), который даёт доступ к инструментам управления студией прямо из мобильного телефона или компьютера через VK.

| Параметр | Значение |
|----------|----------|
| App ID | `54527093` |
| URL приложения | `https://app.ulvar.ru` |
| Ссылка VK | `https://vk.com/app54527093` |
| Сообщество | `https://vk.com/ulvar_terrane` (Group ID: 225425795) |
| Сервер | `85.198.71.249` (Beget KZ) |
| Технология | Python HTTP server + VK Bridge |
| Авторизованные пользователи | Андрей (460657784), Любовь (27733429) |

---

## 2. Архитектура

```
┌─────────────────────────────────────────────────┐
│           VK App (vk.com/app54527093)            │
│          или браузер app.ulvar.ru                 │
│                                                  │
│  VK Bridge  ←→  HTML/JS SPA (6 вкладок)         │
│  (авторизация VK ID)                             │
└──────────────────────┬───────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────┐
│      znaika_web.py (Python HTTP, port 8080)      │
│                                                  │
│  GET /              → HTML App                   │
│  GET /api/{endpoint}?params → run_tool()         │
│                                                  │
│  40+ эндпоинтов — каждый вызывает Python CLI:    │
└──────────────────────┬───────────────────────────┘
                       │ subprocess
                       ▼
┌─────────────────────────────────────────────────┐
│              Python CLI инструменты              │
│  /opt/studio-3d/tools/                          │
│                                                  │
│  vk_parser.py      — 28 команд парсинга VK       │
│  vk_publish.py     — публикация на стену/рынок   │
│  vk_competitors.py — мониторинг конкурентов VK   │
│  catalog.py        — каталог товаров (SQLite)     │
│  ozon.py           — Ozon Seller API             │
│  studio_engine.py  — единый движок               │
└──────────────────────┬───────────────────────────┘
                       │ API
              ┌────────┴────────┐
              ▼                 ▼
         VK API 5.199      Ozon Seller API v3
         (community +      (Client-Id + Api-Key)
          user token)
```

---

## 3. Интерфейс приложения

Знайка — одностраничное приложение с **6 вкладками** в верхней панели.

### 3.1 Вкладки

| Иконка | Название | Описание |
|--------|----------|----------|
| 🔍 | **VK Парсер** | Поиск групп, анализ аудитории, пересечения |
| 📦 | **Каталог** | Просмотр и поиск товаров студии |
| 🟠 | **Ozon** | Остатки, цены, заказы через Ozon API |
| 🕵️ | **Конкуренты** | Мониторинг конкурентов в VK |
| 📝 | **Публикации** | Публикация на стену и в VK Market |
| 📜 | **История** | Последние 10 запросов из localStorage |

### 3.2 Общий UX

- **Авторизация**: VK Bridge автоматически получает `user_id` — неавторизованным отказ
- **Результаты**: Отображаются в монospace-блоке под кнопкой (max-height 400px, scroll)
- **Экспорт**: После каждого успешного запроса появляется кнопка «💾 Экспорт» — сохранение результата в `.txt`
- **История**: Хранится в `localStorage`, последние 50 запросов, показываются последние 10
- **Загрузка**: Индикатор `⏳ Загрузка...` пока запрос выполняется (некоторые запросы до 120 сек)

---

## 4. API Эндпоинты

Каждый эндпоинт: `GET /api/{endpoint}?{params}` → JSON `{"ok": true, "output": "..."}` или `{"ok": false, "error": "..."}`.

Таймаут выполнения инструментов: **120 секунд**.

### 4.1 VK Парсер (`vk_parser.py`)

| Эндпоинт | Параметры | Описание |
|----------|-----------|----------|
| `search_groups` | `q` (запрос), `min` (мин. подписчиков, def 100), `limit` (def 20) | Поиск групп по теме |
| `group_stats` | `group` (URL или short_name) | Статистика группы |
| `audience_portrait` | `group`, `limit` (def 2000) | Пол, возраст, города, семейное положение |
| `active_members` | `group`, `days` (def 30) | Участники с активностью за N дней |
| `similar_groups` | `group` | Похожие группы по аудитории |
| `members` | `group`, `limit` (def 1000) | Список участников |
| `cross` | `groups` (через пробел) | Пересечение аудиторий нескольких групп |
| `birthdays` | `group`, `days` (def 7) | Именинники в ближайшие N дней |
| `clean_bots` | `group` | Анализ ботов/неактивных аккаунтов |
| `segment` | `group` | Сегментация аудитории |
| `new_members` | `group` | Новые участники с прошлого скана |
| `admins` | `group` | Список администраторов |
| `promo_posts` | `group` | Рекламные записи |
| `discussions` | `group` | Обсуждения сообщества |
| `photo_albums` | `group` | Фотоальбомы |
| `wall_monitor` | `group`, `days` (def 1) | Мониторинг записей стены |
| `growth` | `group` | График роста подписчиков |
| `search_users` | `q` | Поиск пользователей |
| `poll_voters` | `group` | Участники голосований |
| `video_viewers` | `group` | Просмотры видео |
| `mentions` | `q` | Упоминания по запросу |
| `stories` | `group` | Истории сообщества |
| `export_vk_ads` | `file` | Экспорт аудитории для VK Ads |

**VK API методы, используемые парсером:**

| Метод VK API | Назначение |
|-------------|-----------|
| `groups.search` | Поиск групп по теме |
| `groups.getMembers` | Получение участников группы |
| `groups.getById` | Информация о группе |
| `groups.get` | Список групп пользователя |
| `users.get` | Информация о пользователях (поля: sex, bdate, city, relation) |
| `wall.get` | Записи со стены |
| `execute` | Пакетный запрос (до 25 API-вызовов) |
| `stats.get` | Статистика сообщества |
| `polls.getVoters` | Проголосовавшие в опросе |
| `video.get` | Список видео |
| `newsfeed.search` | Поиск упоминаний |
| `stories.get` | Истории |

**Токен:** User Token (`vk_user_token`) — методы `groups.getMembers`, `users.get` требуют пользовательской авторизации.  
**Rate limit:** 3 req/s. При `error_code=6` — автоматический retry через 1 сек.

### 4.2 Каталог (`catalog.py`)

| Эндпоинт | Параметры | Описание |
|----------|-----------|----------|
| `catalog_stats` | — | Статистика каталога (всего товаров, ABC распределение, стоимость) |
| `catalog_stock` | — | Товары с ненулевым остатком |
| `catalog_search` | `q` | Поиск по названию, артикулу или Ozon ID |
| `catalog_get` | `id` | Полная карточка товара по Ozon ID |

**Источник данных:** SQLite `catalog.db` (59 товаров, 1053 фото, 11+ таблиц).

### 4.3 Ozon (`ozon.py`)

| Эндпоинт | Параметры | Описание |
|----------|-----------|----------|
| `ozon_stocks` | — | Все остатки (qty по каждому SKU) |
| `ozon_stocks_zero` | — | Товары с нулевым остатком |
| `ozon_stocks_low` | `n` (def 3) | Товары с остатком ≤ N |
| `ozon_prices` | — | Текущие цены |
| `ozon_orders` | `days` (def 7) | Заказы за последние N дней |
| `ozon_orders_stats` | `days` (def 30) | Статистика заказов (выручка по товарам) |
| `ozon_archived` | — | Архивные/скрытые товары |

**Ozon Seller API эндпоинты:**

| API Endpoint | HTTP | Используется в |
|-------------|------|---------------|
| `/v3/product/list` | POST | ozon_stocks |
| `/v4/product/info/attributes` | POST | ozon_stocks |
| `/v2/products/stocks` | POST | ozon_stocks (обновление) |
| `/v1/product/import/prices` | POST | ozon_prices |
| `/v3/posting/fbs/list` | POST | ozon_orders |
| `/v3/product/import` | POST | создание карточек |

**Аутентификация:** Headers `Client-Id: 2597744` + `Api-Key: ...`.

### 4.4 Конкуренты (`vk_competitors.py`)

| Эндпоинт | Параметры | Описание |
|----------|-----------|----------|
| `comp_list` | — | Список всех отслеживаемых конкурентов |
| `comp_scan` | — | Сканирование товаров всех конкурентов |
| `comp_changes` | — | Изменения цен с прошлого скана |
| `comp_compare` | — | Сравнение цен конкурентов с нашими |
| `comp_add` | `group` (URL) | Добавить группу конкурента |

**VK API метод:** `market.get` — получение всех товаров группы.  
**Токен:** Community Token (`vk_access_token`) достаточен.

### 4.5 Публикации (`vk_publish.py`)

| Эндпоинт | Параметры | Описание |
|----------|-----------|----------|
| `wall_preview` | `id` (Ozon ID или артикул) | Предпросмотр публикации без отправки |
| `wall_post` | `id` | Опубликовать товар на стену сообщества |
| `market_add` | `id` | Добавить товар в VK Market (магазин) |
| `market_sync` | — | Синхронизировать остатки всех товаров в VK Market |

**VK API методы:**

| Метод VK API | Назначение |
|-------------|-----------|
| `photos.getMarketUploadServer` | Получить URL для загрузки фото товара |
| `photos.saveMarketPhoto` | Сохранить загруженное фото |
| `wall.post` | Опубликовать запись на стену |
| `market.add` | Создать товар в магазине |
| `market.edit` | Редактировать товар |
| `market.delete` | Удалить товар |
| `market.getGroupOrders` | Получить заказы магазина |

**Токен:** 
- `wall.post` → Community Token + scope `wall`
- `market.add`, загрузка фото → User Token + scope `market` (требует одобрения VK Support)
- Фото на стену → Community Token + scope `photos`

**Загрузка фото — 3 шага (обязательный порядок):**
```
1. GET photos.getMarketUploadServer?group_id=225425795
   → upload_url

2. POST {upload_url}  (multipart/form-data, поле "file")
   → {"server": ..., "photo": ..., "hash": ...}

3. POST photos.saveMarketPhoto?server=...&photo=...&hash=...
   → [{"id": photo_id, ...}]

Затем: market.add с параметром photo_ids={owner_id}_{photo_id}
```

---

## 5. Авторизация и безопасность

### 5.1 VK Bridge

При открытии приложения вызывается `VKWebAppInit` + `VKWebAppGetUserInfo`.  
Полученный `user.id` отображается в шапке. При API-запросах опционально передаётся `?vk_id=...`.

### 5.2 Проверка доступа

```python
ALLOWED_VK_IDS = {460657784, 27733429}  # Андрей + Любовь
```

При передаче `vk_id` и несовпадении — возвращается `{"ok": false, "error": "Доступ запрещён"}`.

> **Важно:** Проверка vk_id опциональна (только если параметр передан). Для усиления безопасности рекомендуется сделать проверку обязательной.

### 5.3 Токены

| Токен | Хранение | Используется |
|-------|----------|-------------|
| Community Token (`vk1.a.8SKO...`) | Конфиг Python-инструментов | wall.post, market.get, messages |
| User Token (`vk1.a._u9t...`) | Конфиг Python-инструментов | users.get, groups.getMembers, market.add |
| Сервисный ключ (`f6c43a1b...`) | ZNAIKA_KEYS.md | Серверные запросы без пользователя |

---

## 6. Установка и запуск

### 6.1 Требования

```
Python 3.8+
pip install requests  # для vk_parser, ozon, vk_publish
```

### 6.2 Запуск сервера

```bash
# Прямой запуск
python3 /opt/studio-3d/tools/znaika_web.py

# Как системный сервис (рекомендуется)
# /etc/systemd/system/znaika.service
[Unit]
Description=Znaika VK Mini App Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/studio-3d
ExecStart=/usr/bin/python3 /opt/studio-3d/tools/znaika_web.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable znaika
systemctl start znaika
systemctl status znaika
```

### 6.3 Nginx (HTTPS для VK Mini App)

VK требует HTTPS для Mini App. Nginx проксирует на порт 8080:

```nginx
server {
    listen 443 ssl;
    server_name app.ulvar.ru;

    ssl_certificate     /etc/nginx/ssl/app.ulvar.ru.crt;
    ssl_certificate_key /etc/nginx/ssl/app.ulvar.ru.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name app.ulvar.ru;
    return 301 https://$host$request_uri;
}
```

### 6.4 VK Mini App настройка

В настройках приложения VK (vk.com/app54527093 → Управление):

| Параметр | Значение |
|----------|----------|
| Тип приложения | VK Mini Apps |
| URL сайта | `https://app.ulvar.ru` |
| Мобильный URL | `https://app.ulvar.ru` |
| Разрешить в группе | ulvar_terrane (225425795) |

---

## 7. Инструменты (Python CLI)

### 7.1 vk_parser.py — 28 команд

```bash
# Поиск групп
python3 vk_parser.py search-groups "D&D миниатюры" --min-members 100 --limit 20

# Портрет аудитории
python3 vk_parser.py audience-portrait ulvar_terrane --limit 2000

# Пересечение аудиторий
python3 vk_parser.py cross ulvar_terrane dnd_russia tabletop_games

# Активные участники
python3 vk_parser.py active-members ulvar_terrane --days 30

# Анализ ботов
python3 vk_parser.py clean-bots ulvar_terrane
```

**Требуемый токен:** User Token с scope `groups` (по умолчанию включён).

### 7.2 vk_publish.py

```bash
# Предпросмотр поста
python3 vk_publish.py wall Т_0069 --dry-run

# Публикация на стену
python3 vk_publish.py wall Т_0069

# Добавить в VK Market
python3 vk_publish.py market-add Т_0069

# Синхронизация остатков
python3 vk_publish.py market-sync
```

**Требуемый токен:** Community Token (wall.post) + User Token (market.add).

### 7.3 vk_competitors.py

```bash
# Добавить конкурента
python3 vk_competitors.py add https://vk.com/competitor_group

# Сканировать всех
python3 vk_competitors.py scan

# Изменения цен
python3 vk_competitors.py changes

# Сравнить с нашими ценами
python3 vk_competitors.py compare
```

### 7.4 catalog.py

```bash
python3 catalog.py stats           # Статистика каталога
python3 catalog.py stock           # Товары в наличии
python3 catalog.py search "башня"  # Поиск
python3 catalog.py get Т_0001      # Карточка товара
```

### 7.5 ozon.py

```bash
python3 ozon.py stocks             # Все остатки
python3 ozon.py stocks-zero        # Нулевые
python3 ozon.py stocks-low 5       # Остаток ≤ 5
python3 ozon.py prices             # Цены
python3 ozon.py orders 7           # Заказы за 7 дней
python3 ozon.py orders-stats 30    # Статистика за 30 дней
```

---

## 8. Матрица функций и токенов

| Функция | Токен | VK API Метод / Сервис |
|---------|-------|----------------------|
| Поиск групп | User Token | `groups.search` |
| Портрет аудитории | User Token | `groups.getMembers` + `users.get` |
| Анализ ботов | User Token | `groups.getMembers` + `users.get` |
| Пересечение | User Token | `groups.getMembers` × N |
| Стена сообщества | Community Token | `wall.get` |
| Публикация на стену | Community Token (scope: wall) | `wall.post` |
| Загрузка фото | Community Token (scope: photos) | `photos.getMarketUploadServer` + `photos.saveMarketPhoto` |
| Добавить в Market | User Token (**scope: market***) | `market.add` |
| Список товаров конкурента | Community/User Token | `market.get` |
| Заказы магазина | Community/User Token | `market.getGroupOrders` |
| Ozon остатки | Ozon API Key | Ozon Seller API |
| Каталог | — (SQLite local) | — |

> `*` Scope `market` (1<<27 = 134217728) требует одобрения VK Support.  
> Написано письмо на devsupport@corp.vk.com. Ожидается ответ.

---

## 9. Ограничения и известные проблемы

### 9.1 market.add недоступен

**Проблема:** `market.add` требует User Token с scope `market` (134217728). Этот scope для приложений VK ID (созданных после апреля 2024) требует явного одобрения VK Support.

**Статус:** Письмо отправлено. До одобрения — функции `market_add` и `market_sync` не работают.

**Обходной путь:** Добавление товаров через веб-интерфейс VK Market вручную.

### 9.2 Rate limits

| Сервис | Лимит | Поведение при превышении |
|--------|-------|------------------------|
| VK API | 3 req/s | error_code=6, retry через 1 сек |
| Ozon API | 1 req/s (подписка FBO) | HTTP 429 |
| Groq API | 30 req/min, 6000 tok/min | HTTP 429 |

### 9.3 Таймаут запросов

Некоторые команды (audience_portrait для 2000 участников, cross для нескольких групп) выполняются 30-120 секунд. Это нормально — VK API имеет rate limit 3 req/s.

### 9.4 Токены

| Токен | Срок действия | Примечание |
|-------|--------------|-----------|
| Community Token | Бессрочный | До ручного отзыва |
| User Token (`vk1.a._u9t...`) | Бессрочный (expires_in=0) | Получен через Implicit Flow |
| Сервисный ключ | Бессрочный | Можно обновить в настройках приложения |

---

## 10. Планируемые улучшения

| Функция | Приоритет | Зависимость |
|---------|-----------|------------|
| Обязательная проверка vk_id | P0 | — |
| market.add и market_sync | P0 | Одобрение VK Support |
| Telegram-уведомления о заказах | P1 | — |
| Синхронизация остатков Ozon ↔ VK | P1 | User Token market scope |
| Массовая публикация на стену | P2 | — |
| AI-генерация описаний (Groq) | P2 | Groq API Key |
| Полная Android-версия | P3 | SYSTEM_SPEC.md |

---

## 11. Быстрый старт — чеклист

```
[ ] Сервер запущен: systemctl status znaika
[ ] Доступен: curl https://app.ulvar.ru → HTML (статус 200)
[ ] VK: приложение vk.com/app54527093 доступно авторизованным пользователям
[ ] Community Token проверен: groups.getById?group_ids=225425795&access_token=...
[ ] User Token проверен: users.get?user_ids=460657784&access_token=...
[ ] Ozon API проверен: python3 ozon.py stats
[ ] Каталог: python3 catalog.py stats → 59 товаров
[ ] VK Parser: python3 vk_parser.py group-stats ulvar_terrane
```

---

*Конец документа. Для изменений — редактировать ZNAIKA_KEYS.md (ключи) и znaika_web.py (сервер).*
