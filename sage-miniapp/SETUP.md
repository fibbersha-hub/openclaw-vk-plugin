# Великий Мудрец — Инструкция установки с нуля

Это пошаговое руководство по развёртыванию **Великого Мудреца** как VK Mini App.

Великий Мудрец — это мультимодельный AI-ассистент: задаёт вопрос сразу нескольким LLM,
собирает их мнения и синтезирует итоговый ответ через Cerebras.

---

## Что получится в итоге

- Пользователь нажимает кнопку "🧙 Великий Мудрец" в VK-чате бота
- Открывается **VK Mini App** (внутри ВКонтакте, не браузер)
- В мини-приложении: задаёшь вопрос → видишь как каждая модель "думает" → получаешь синтез
- Сессии сохраняются, можно возвращаться к прошлым обсуждениям
- Можно прикреплять файлы (PDF, TXT, код и др.)

---

## Требования

### Сервер
- Linux VPS (Ubuntu 20.04+), минимум 1 vCPU / 1 GB RAM
- Домен с SSL (Let's Encrypt через Certbot)
- Python 3.10+, nginx

### VK
- VK-сообщество (группа)
- Community Token с правами: `messages`
- Зарегистрированное VK Mini App (бесплатно на dev.vk.com)

### LLM-ключи (минимальный набор — всё бесплатно)
| Сервис | Где получить | Лимит |
|--------|-------------|-------|
| Groq | console.groq.com | 4 ключа × 62 сек кулдаун |
| OpenRouter | openrouter.ai | 3 ключа, бесплатные модели |
| Cerebras | inference.cerebras.ai | 1M токенов/день (синтез) |

---

## Часть 1: Регистрация VK Mini App

1. Открой [vk.com/editapp?act=create](https://vk.com/editapp?act=create)
2. Тип: **Сайт**
3. Название: любое (например "Знайка" или "Мудрец")
4. URL сайта: `https://ВАШ_ДОМЕН/mudrets/`
5. Сохрани → запомни **App ID** (6-8 цифр)
6. В настройках приложения → **Сообщества** → привяжи своё сообщество
7. Запомни **ID сообщества** (group_id)

> Для кнопки `open_app` в VK нужны: `app_id` и `owner_id = -group_id` (отрицательный)

---

## Часть 2: Подготовка сервера

### 2.1 Клонировать репозиторий

```bash
cd /opt
git clone https://github.com/fibbersha-hub/openclaw-vk-plugin.git openclaw-vk-plugin
```

### 2.2 Создать директорию для mini app

```bash
mkdir -p /opt/sage-miniapp
cp /opt/openclaw-vk-plugin/sage-miniapp/index.html /opt/sage-miniapp/
```

### 2.3 Создать директорию для sage (если нет)

Если у тебя уже установлен OpenClaw с browser-bridge, пропусти этот шаг.

```bash
mkdir -p /opt/browser-bridge
# Сюда нужно положить sage.py — см. Часть 3
```

---

## Часть 3: Настройка sage.py

`sage.py` — ядро Великого Мудреца. Хранит сессии, опрашивает LLM, делает синтез.

### 3.1 Скопировать sage.py

```bash
cp /opt/openclaw-vk-plugin/browser-bridge/sage.py /opt/browser-bridge/sage.py
```

### 3.2 Установить зависимости

```bash
pip3 install requests pdfplumber python-docx openpyxl
```

### 3.3 Создать конфиг LLM-ключей

Создай файл `/root/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "cerebras": {
        "apiKey": "csk-ВАША_КЛЮЧ_CEREBRAS"
      }
    }
  },
  "channels": {
    "vk": {
      "accounts": {
        "main": {
          "allowFrom": [123456789]
        }
      }
    }
  }
}
```

### 3.4 Создать конфиг Groq/OpenRouter для sage

Файл `/opt/browser-bridge/models.json`:

```json
{
  "providers": [
    {
      "name": "Groq #1",
      "type": "groq",
      "apiKey": "gsk_КЛЮЧ_1",
      "model": "llama-3.3-70b-versatile",
      "cooldown": 62
    },
    {
      "name": "Groq #2",
      "type": "groq",
      "apiKey": "gsk_КЛЮЧ_2",
      "model": "llama-3.3-70b-versatile",
      "cooldown": 62
    },
    {
      "name": "OpenRouter #1",
      "type": "openrouter",
      "apiKey": "sk-or-v1-КЛЮЧ",
      "model": "qwen/qwen3-235b-a22b:free",
      "cooldown": 90
    }
  ]
}
```

> Добавь столько ключей, сколько есть. Больше ключей = меньше ожидание = богаче ответ.

### 3.5 Проверить sage.py

```bash
python3 /opt/browser-bridge/sage.py ask 99999 "Что такое блокчейн?"
```

Должен появиться ответ с блоками "думает:" от каждой модели и итоговым синтезом.

---

## Часть 4: Flask API (sage_api.py)

### 4.1 Скопировать файл

```bash
cp /opt/openclaw-vk-plugin/sage-miniapp/sage_api.py /opt/sage-miniapp/sage_api.py
```

### 4.2 Установить зависимости

```bash
pip3 install flask flask-cors
```

### 4.3 Создать systemd-сервис

Файл `/etc/systemd/system/sage-miniapp.service`:

```ini
[Unit]
Description=Sage Mini App API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sage-miniapp
ExecStart=/usr/bin/python3 /opt/sage-miniapp/sage_api.py
Restart=always
RestartSec=5
Environment=PYTHONIOENCODING=utf-8

[Install]
WantedBy=multi-user.target
```

### 4.4 Запустить

```bash
systemctl daemon-reload
systemctl enable sage-miniapp
systemctl start sage-miniapp
systemctl status sage-miniapp
```

### 4.5 Проверить

```bash
curl http://127.0.0.1:5001/health
# Ожидаемый ответ: {"ok": true, "service": "sage-miniapp-api", "version": "2.0"}
```

---

## Часть 5: nginx

### 5.1 Установить SSL-сертификат (если нет)

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d ВАШ_ДОМЕН
```

### 5.2 Создать конфиг nginx

Скопируй и отредактируй шаблон:

```bash
cp /opt/openclaw-vk-plugin/sage-miniapp/ai-ulvar.nginx /etc/nginx/sites-available/ВАШ_ДОМЕН
```

Открой файл и замени `ai.ulvar.ru` на свой домен.

Структура конфига:
```nginx
server {
    server_name ВАШ_ДОМЕН;

    # Frontend mini app
    location /mudrets/ {
        alias /opt/sage-miniapp/;
        index index.html;
        try_files $uri $uri/ /mudrets/index.html;
    }

    # Flask API
    location /sage/ {
        proxy_pass http://127.0.0.1:5001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 310s;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Headers "Content-Type, X-VK-User-Id" always;
        add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;
        if ($request_method = OPTIONS) { return 204; }
    }

    listen 443 ssl;
    # Сертификаты Certbot добавит автоматически
}
```

### 5.3 Подключить и перезапустить

```bash
ln -s /etc/nginx/sites-available/ВАШ_ДОМЕН /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 5.4 Проверить

```bash
curl https://ВАШ_ДОМЕН/sage/health
# Ожидаемый ответ: {"ok": true, ...}
```

Открой в браузере: `https://ВАШ_ДОМЕН/mudrets/`  
Должна открыться страница Великого Мудреца в браузерном режиме (без VK Bridge).

---

## Часть 6: Интеграция с VK-ботом

Это нужно только если у тебя уже работает OpenClaw VK-плагин.

### 6.1 Обновить button-dispatcher.ts

В файле `src/button-dispatcher.ts` найди константу `MINIAPP_URL` и секцию Великого Мудреца,
замени `app_id` и `owner_id` на свои значения:

```typescript
const MINIAPP_URL = "https://ВАШ_ДОМЕН/mudrets/";

// В BUTTON_ACTIONS:
"🧙 Великий Мудрец": {
  response: "🧙 Открывай мини-приложение:",
  linkKeyboard: [{ label: "🧙 Открыть Великого Мудреца", app_id: ВАШ_APP_ID, owner_id: -ВАШ_GROUP_ID }],
},
```

### 6.2 Собрать и задеплоить

```bash
# Локально (Windows):
cd "openclaw-vk-plugin"
npm run build

# Скопировать на сервер:
scp dist/src/button-dispatcher.js root@ВАШ_IP:/opt/openclaw-vk-plugin/dist/src/
scp dist/src/runtime.js root@ВАШ_IP:/opt/openclaw-vk-plugin/dist/src/

# На сервере:
systemctl restart openclaw.service
```

### 6.3 Обновить URL в кабинете VK

1. Открой [vk.com/editapp?id=ВАШ_APP_ID](https://vk.com/editapp?id=ВАШ_APP_ID)
2. В поле **URL** укажи: `https://ВАШ_ДОМЕН/mudrets/`
3. Сохрани

---

## Часть 7: Проверка полного цикла

1. Открой VK, найди сообщество
2. Напиши боту любое сообщение → появится меню
3. Нажми "🧙 Великий Мудрец"
4. Должна открыться кнопка → нажми её
5. Должно открыться мини-приложение **внутри VK** (не браузер)
6. Задай вопрос → получи ответ с блоками "думает:"

---

## Устранение проблем

### "Ошибка запроса" в mini app

Проверь лог Flask:
```bash
journalctl -u sage-miniapp -f
```

Частые причины:
- Нет ключей LLM → ответы пустые → sage.py падает
- peer_id=99999 (dev) с `multi` режимом → устанавливается автоматически в `auto` в sage_api.py

### Мини-приложение не открывается внутри VK

- Проверь что URL в кабинете разработчика совпадает с реальным путём
- Проверь что приложение привязано к нужному сообществу
- Убедись что `app_id` и `owner_id` в коде верные

### "Произошла неизвестная ошибка" при открытии

- VK Bridge (`VKWebAppInit`) вызывается вне VK → исправлено в `index.html` через `isInsideVK()` проверку
- Если запускаешь в браузере — это нормально, в браузере работает без Bridge

### sage.py не находит Cerebras ключ

Проверь что ключ записан в `/root/.openclaw/openclaw.json`:
```json
{
  "models": {
    "providers": {
      "cerebras": {
        "apiKey": "csk-..."
      }
    }
  }
}
```

---

## Файловая структура итоговой установки

```
/opt/
├── sage-miniapp/
│   ├── index.html          # Frontend VK Mini App
│   ├── sage_api.py         # Flask REST API (порт 5001)
│
├── browser-bridge/
│   ├── sage.py             # Великий Мудрец — ядро
│   └── models.json         # Конфиг LLM-провайдеров
│
└── openclaw-vk-plugin/     # Если используешь VK-бота
    └── dist/src/
        ├── button-dispatcher.js
        └── runtime.js

/root/.openclaw/
└── openclaw.json           # Ключи LLM + config бота

/etc/nginx/sites-available/
└── ВАШ_ДОМЕН              # nginx конфиг

/etc/systemd/system/
└── sage-miniapp.service    # systemd для Flask API
```

---

## Быстрые команды

```bash
# Статус
systemctl status sage-miniapp

# Логи
journalctl -u sage-miniapp -f

# Перезапуск после изменений
systemctl restart sage-miniapp

# Проверить API
curl http://127.0.0.1:5001/health

# Тест sage.py напрямую
python3 /opt/browser-bridge/sage.py ask 99999 "привет"
```
