# Image Gen — Генерация изображений через ModelsLab

## Описание
Генерация картинок из текстового описания через ModelsLab API (10000+ моделей: Flux, SDXL, Stable Diffusion). Бесплатный лимит: 100 картинок в день. Встроенный счётчик расхода — НИКОГДА не превышает лимит.

## Когда использовать
- Пользователь просит нарисовать, сгенерировать, создать картинку
- Нужна иллюстрация для поста, карточки товара, обложки
- Запрос типа "нарисуй", "сгенерируй изображение", "сделай картинку"
- Нужен баннер, аватарка, фон, обложка

## Когда НЕ использовать
- Если пользователь просит промпт для Midjourney — просто напиши текст промпта, НЕ генерируй
- Если нужно понять что на фото — используй Mistral/Pixtral, не этот скил

## Команды

### Генерация картинки
```bash
python3 /opt/studio-3d/tools/imagegen.py generate "описание картинки на английском"
```

### Генерация с параметрами
```bash
python3 /opt/studio-3d/tools/imagegen.py generate "a medieval castle on a cliff, dark fantasy, detailed" --model flux --width 1024 --height 1024 --steps 30
```

### Доступные модели
```bash
python3 /opt/studio-3d/tools/imagegen.py models
```

### Проверить оставшийся лимит
```bash
python3 /opt/studio-3d/tools/imagegen.py limit
```

### История генераций за сегодня
```bash
python3 /opt/studio-3d/tools/imagegen.py history
```

## Параметры генерации

| Параметр | Значения | По умолчанию | Описание |
|----------|----------|-------------|----------|
| --model | flux, sdxl, sd3, realistic, anime | flux | Модель генерации |
| --width | 512-1024 | 1024 | Ширина |
| --height | 512-1024 | 1024 | Высота |
| --steps | 21, 31, 41 | 31 | Качество (больше = лучше, но дольше) |
| --negative | текст | стандартный | Что НЕ рисовать |
| --samples | 1-4 | 1 | Сколько вариантов |
| --seed | число | случайный | Для воспроизводимости |

## Популярные модели

| Короткое имя | Model ID | Для чего |
|--------------|----------|----------|
| flux | flux | Универсальная, лучшее качество |
| sdxl | sdxl | Классика, стабильная |
| sd3 | sd3 | Stable Diffusion 3 |
| realistic | realistic-vision-v51 | Фотореализм |
| anime | anything-v5 | Аниме-стиль |

## Лимиты

**АБСОЛЮТНОЕ ПРАВИЛО: Не превышать 100 генераций в день!**

- Бесплатный лимит: **100 картинок/день** (обнуляется в полночь UTC)
- Скрипт автоматически отслеживает расход
- При достижении 90 картинок — предупреждение
- При 100 — блокировка до следующего дня
- Перед генерацией ВСЕГДА проверяй лимит: `imagegen.py limit`

## Примеры запросов пользователей → команды

"Нарисуй замок" →
```bash
python3 /opt/studio-3d/tools/imagegen.py generate "a medieval stone castle on a hill, dramatic sky, fantasy art, highly detailed" --model flux
```

"Сделай обложку для VK сообщества" →
```bash
python3 /opt/studio-3d/tools/imagegen.py generate "VK community cover, dark fantasy theme, tabletop gaming terrain, miniatures, epic, wide banner" --model flux --width 1024 --height 512
```

"4 варианта логотипа" →
```bash
python3 /opt/studio-3d/tools/imagegen.py generate "minimalist logo, fantasy shield with dragon, clean vector style, white background" --model flux --samples 4
```
