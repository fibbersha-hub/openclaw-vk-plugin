# Бесплатные LLM-провайдеры — получение ключей

> Все провайдеры ниже **работают с российских IP** (проверено апрель 2026, без VPN).  
> Исключение: Google Gemini — заблокирован в РФ.

---

## Быстрый старт — рекомендуемый набор

Для полноценной работы рекомендуем получить минимум:

| Провайдер | Зачем | Приоритет |
|-----------|-------|-----------|
| **Groq** × 2–4 ключа | Основная модель (llama-3.3-70b) + транскрибация голоса (Whisper) | 🔴 Обязательно |
| **Cerebras** | Primary fast model (qwen-3-235b, 1M токен/день) | 🟠 Рекомендуется |
| **OpenRouter** | Fallback, 24+ бесплатных модели | 🟡 Желательно |
| **Mistral** | Vision (анализ фото через Pixtral) | 🟡 Желательно |

---

## Groq

**Модели:** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `gemma2-9b-it`, `whisper-large-v3`  
**Лимиты:** 14,400 запросов/день, 6,000 токенов/минуту (на ключ)  
**Почему несколько ключей:** лимит на ключ, не на аккаунт — 4 ключа = 4× запасы

### Получить ключ

1. [console.groq.com](https://console.groq.com) → Sign Up
2. Можно войти через Google или GitHub
3. После входа: **API Keys → Create API Key**
4. Название: `openclaw-1` (произвольное)
5. Скопируйте ключ (`gsk_...`) — показывается **один раз**

### Несколько ключей (рекомендуется 4)

Создайте несколько аккаунтов (разные email) или несколько ключей в одном аккаунте.

В `openclaw.json`:
```json
{
  "models": {
    "providers": {
      "groq":   { "type": "openai", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "gsk_KEY1", "models": ["llama-3.3-70b-versatile"] },
      "groq-2": { "type": "openai", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "gsk_KEY2", "models": ["llama-3.3-70b-versatile"] },
      "groq-3": { "type": "openai", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "gsk_KEY3", "models": ["llama-3.3-70b-versatile"] },
      "groq-4": { "type": "openai", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "gsk_KEY4", "models": ["llama-3.3-70b-versatile"] }
    }
  }
}
```

> Плагин автоматически ротирует ключи при 429 (rate limit).

---

## Cerebras

**Модели:** `qwen-3-235b-a22b-instruct-2507`, `llama3.1-8b`, `llama-4-scout-17b`  
**Лимиты:** 1,000,000 токенов/день  
**Особенность:** самая быстрая генерация (inference на чипах Cerebras CS-3)

### Получить ключ

1. [cloud.cerebras.ai](https://cloud.cerebras.ai) → Sign Up
2. Войти через Google или GitHub
3. **API Keys → Create new key**
4. Скопируйте ключ (`csk-...`)

> ⚠️ При запросах с Python добавляйте `User-Agent: Mozilla/5.0` — иначе 403.

В `openclaw.json`:
```json
{
  "models": {
    "providers": {
      "cerebras": {
        "type": "openai",
        "baseUrl": "https://api.cerebras.ai/v1",
        "apiKey": "csk_YOUR_KEY",
        "models": ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"]
      }
    }
  }
}
```

---

## OpenRouter

**Модели (бесплатные):** Llama 3.3 70b, Gemma 3, Qwen3, Mistral, NVIDIA Nemotron, DeepSeek и др. (~24+ free модели)  
**Лимиты:** 20 запросов/минуту (free tier)  
**Особенность:** единый ключ для доступа к множеству моделей

### Получить ключ

1. [openrouter.ai](https://openrouter.ai) → Sign Up
2. Войти через Google или GitHub (email тоже работает)
3. **Keys → Create Key**
4. Лимит кредитов: оставьте `$0` (free tier без кредитов)
5. Скопируйте ключ (`sk-or-v1-...`)

### Список бесплатных моделей

```bash
curl https://openrouter.ai/api/v1/models | python3 -c "
import json,sys
models = json.load(sys.stdin)['data']
free = [m for m in models if float(m.get('pricing',{}).get('prompt',1))==0]
for m in free: print(m['id'])
"
```

В `openclaw.json`:
```json
{
  "models": {
    "providers": {
      "openrouter": {
        "type": "openai",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "sk-or-v1-YOUR_KEY",
        "models": ["meta-llama/llama-3.3-70b-instruct:free"]
      }
    }
  }
}
```

---

## Mistral AI

**Модели:** `mistral-small-latest`, `codestral-latest`, `pixtral-12b-2409` (vision)  
**Лимиты:** 2 RPM (запроса в минуту) на free tier  
**Особенность:** Pixtral — бесплатная vision-модель для анализа изображений

### Получить ключ

1. [console.mistral.ai](https://console.mistral.ai) → Sign Up
2. Подтвердить email
3. **API Keys → Create new key**
4. Скопируйте ключ (`dtIi...` или `...`)

> ⚠️ Free tier — 2 RPM. Для активного использования нужно несколько ключей или платный тариф.

В `openclaw.json`:
```json
{
  "models": {
    "providers": {
      "mistral": {
        "type": "openai",
        "baseUrl": "https://api.mistral.ai/v1",
        "apiKey": "YOUR_MISTRAL_KEY",
        "models": ["mistral-small-latest", "pixtral-12b-2409"]
      }
    }
  }
}
```

---

## Together.ai

**Модели:** FLUX.1 [schnell] (изображения), Llama 3.3, Qwen, DeepSeek  
**Лимиты:** первые 3 месяца бесплатно (FLUX schnell), затем платно  
**Особенность:** лучшее качество изображений (FLUX)

### Получить ключ

1. [api.together.xyz](https://api.together.xyz) → Sign Up
2. Подтвердить email
3. **Settings → API Keys → Create**
4. Скопируйте ключ

> ⚠️ Бесплатный доступ к FLUX ограничен 3 месяцами с регистрации.

---

## Hugging Face

**Модели:** сотни открытых моделей через Inference API  
**Лимиты:** низкие на free tier, нестабильная доступность  
**Особенность:** хорошо для экспериментов, не для production

### Получить ключ

1. [huggingface.co](https://huggingface.co) → Sign Up
2. Подтвердить email
3. **Settings → Access Tokens → New token**
4. Тип: **Read** (достаточно для Inference API)

---

## Pollinations.ai (изображения)

**Ключ не нужен.** Бесплатно, без регистрации, без ограничений.

```python
# Пример запроса
url = "https://image.pollinations.ai/prompt/fantasy%20castle?model=flux-realism&width=1024&height=1024"
# GET → возвращает JPEG
```

**Модели:** `flux-realism`, `flux`, `turbo`

---

## Итоговый конфиг openclaw.json

```json
{
  "models": {
    "default": "groq/llama-3.3-70b-versatile",
    "providers": {
      "cerebras": {
        "type": "openai",
        "baseUrl": "https://api.cerebras.ai/v1",
        "apiKey": "csk_YOUR_KEY",
        "models": ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"]
      },
      "groq": {
        "type": "openai",
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKey": "gsk_KEY1",
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
      },
      "groq-2": {
        "type": "openai",
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKey": "gsk_KEY2",
        "models": ["llama-3.3-70b-versatile"]
      },
      "openrouter": {
        "type": "openai",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "sk-or-v1-YOUR_KEY",
        "models": ["meta-llama/llama-3.3-70b-instruct:free"]
      },
      "mistral": {
        "type": "openai",
        "baseUrl": "https://api.mistral.ai/v1",
        "apiKey": "YOUR_MISTRAL_KEY",
        "models": ["mistral-small-latest", "pixtral-12b-2409"]
      }
    }
  }
}
```

---

## Провайдеры и RU IP (апрель 2026)

| Провайдер | RU IP | Примечание |
|-----------|-------|-----------|
| Groq | ✅ | Все 4 ключа проверены |
| Cerebras | ✅ | Нужен `User-Agent: Mozilla/5.0` |
| OpenRouter | ✅ | Работает напрямую |
| Mistral | ✅ | Работает напрямую |
| Together.ai | ✅ | Работает напрямую |
| HuggingFace | ✅ | Работает напрямую |
| Pollinations.ai | ✅ | Без ключа |
| Google Gemini | ❌ | Заблокирован (US санкции) |
| Anthropic Claude | ❌ | Заблокирован в РФ |
| OpenAI | ❌ | Заблокирован в РФ |

---

## Вопросы

📧 **fibber.sha@yandex.ru**
