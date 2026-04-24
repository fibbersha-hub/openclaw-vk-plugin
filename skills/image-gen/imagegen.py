#!/usr/bin/env python3
"""
ModelsLab Image Generator for OpenClaw
Free tier: 100 images/day with built-in limit tracking
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# === Config ===
API_KEY = os.environ.get("MODELSLAB_KEY", "")
if not API_KEY:
    print("ERROR: MODELSLAB_KEY env var not set. Get free key at https://modelslab.com", file=sys.stderr)
    sys.exit(1)
API_URL = "https://modelslab.com/api/v7/images/text-to-image"
DAILY_LIMIT = 100
WARN_AT = 90
DATA_DIR = Path(os.environ.get("IMAGEGEN_DATA_DIR", "/opt/myapp/data/imagegen"))
COUNTER_FILE = DATA_DIR / "daily_counter.json"
HISTORY_FILE = DATA_DIR / "history.jsonl"
OUTPUT_DIR = DATA_DIR / "output"

# === Model aliases ===
MODELS = {
    "flux": {"id": "flux", "name": "Flux (Best quality)", "max_w": 1024, "max_h": 1024},
    "sdxl": {"id": "sdxl", "name": "Stable Diffusion XL", "max_w": 1024, "max_h": 1024},
    "sd3": {"id": "sd3", "name": "Stable Diffusion 3", "max_w": 1024, "max_h": 1024},
    "realistic": {"id": "realistic-vision-v51", "name": "Realistic Vision v5.1", "max_w": 1024, "max_h": 1024},
    "anime": {"id": "anything-v5", "name": "Anything v5 (Anime)", "max_w": 1024, "max_h": 1024},
}

DEFAULT_NEGATIVE = "blurry, distorted, low quality, watermark, text, logo, bad anatomy, deformed, ugly, duplicate, error"


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_counter():
    if COUNTER_FILE.exists():
        data = json.loads(COUNTER_FILE.read_text())
        if data.get("date") == get_today():
            return data
    return {"date": get_today(), "count": 0, "images": 0}


def save_counter(counter):
    COUNTER_FILE.write_text(json.dumps(counter, indent=2))


def check_limit(samples=1):
    """Check if we can generate. Returns (can_generate, remaining, message)"""
    counter = load_counter()
    used = counter["images"]
    remaining = DAILY_LIMIT - used

    if used + samples > DAILY_LIMIT:
        return False, remaining, f"ЛИМИТ ИСЧЕРПАН! Использовано {used}/{DAILY_LIMIT} картинок сегодня. Обнуление в полночь UTC."

    if used >= WARN_AT:
        return True, remaining, f"ВНИМАНИЕ: {used}/{DAILY_LIMIT} картинок использовано. Осталось {remaining}."

    return True, remaining, f"OK: {used}/{DAILY_LIMIT} использовано, осталось {remaining}."


def record_generation(prompt, model, samples, urls):
    counter = load_counter()
    counter["count"] += 1
    counter["images"] += samples
    save_counter(counter)

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "prompt": prompt[:200],
        "model": model,
        "samples": samples,
        "urls": urls,
        "daily_total": counter["images"],
    }
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def generate_image(prompt, model="flux", width=1024, height=1024, steps=31,
                   negative=None, samples=1, seed=None):
    ensure_dirs()

    # Check limit
    can, remaining, msg = check_limit(samples)
    if not can:
        print(f"ERROR: {msg}", file=sys.stderr)
        sys.exit(1)

    # Resolve model
    model_info = MODELS.get(model)
    model_id = model_info["id"] if model_info else model

    # Clamp dimensions
    width = min(width, 1024)
    height = min(height, 1024)

    # Build request
    payload = {
        "key": API_KEY,
        "model_id": model_id,
        "prompt": prompt,
        "negative_prompt": negative or DEFAULT_NEGATIVE,
        "width": width,
        "height": height,
        "samples": min(samples, 4),
        "num_inference_steps": steps,
        "guidance_scale": 7.5,
        "safety_checker": "no",
        "enhance_prompt": "yes",
        "seed": seed,
        "temp": "no",
        "base64": "no",
    }

    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}

    print(f"Генерация: model={model_id}, {width}x{height}, steps={steps}, samples={samples}")
    print(f"Промпт: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    print(f"Лимит: {remaining} картинок осталось на сегодня")
    print("Отправляю запрос...")

    try:
        req = Request(
            API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR: API вернул {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"ERROR: Не удалось подключиться к API: {e}", file=sys.stderr)
        sys.exit(1)

    # Handle response
    status = result.get("status")

    if status == "success":
        urls = result.get("output", [])
        eta = result.get("generationTime", "?")
        print(f"\nУспешно! Время: {eta}с")
        for i, url in enumerate(urls):
            print(f"Картинка {i+1}: {url}")
        record_generation(prompt, model_id, len(urls), urls)
        counter = load_counter()
        print(f"\nИспользовано сегодня: {counter['images']}/{DAILY_LIMIT}")
        return urls

    elif status == "processing":
        fetch_url = result.get("fetch_result")
        eta = result.get("eta", 30)
        request_id = result.get("id", "")
        print(f"Обрабатывается... ETA: {eta}с, ID: {request_id}")

        if fetch_url:
            # Poll for result
            for attempt in range(20):
                time.sleep(max(5, min(eta, 15)))
                try:
                    freq = Request(
                        fetch_url,
                        data=json.dumps({"key": API_KEY}).encode("utf-8") if "fetch" in fetch_url else None,
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urlopen(freq, timeout=60) as fresp:
                        fresult = json.loads(fresp.read().decode("utf-8"))

                    if fresult.get("status") == "success":
                        urls = fresult.get("output", [])
                        print(f"\nГотово!")
                        for i, url in enumerate(urls):
                            print(f"Картинка {i+1}: {url}")
                        record_generation(prompt, model_id, len(urls), urls)
                        counter = load_counter()
                        print(f"\nИспользовано сегодня: {counter['images']}/{DAILY_LIMIT}")
                        return urls

                    elif fresult.get("status") == "failed":
                        print(f"ERROR: Генерация не удалась: {fresult.get('message', 'unknown')}", file=sys.stderr)
                        sys.exit(1)

                    print(f"  Ожидание... (попытка {attempt+1}/20)")
                except Exception as e:
                    print(f"  Ошибка при опросе: {e}")

            print("ERROR: Таймаут ожидания результата (5 минут)", file=sys.stderr)
            sys.exit(1)

    elif status == "error" or status == "failed":
        msg = result.get("message", result.get("messege", "Unknown error"))
        print(f"ERROR: {msg}", file=sys.stderr)
        sys.exit(1)

    else:
        print(f"Неизвестный ответ: {json.dumps(result, indent=2)}")
        sys.exit(1)


def show_limit():
    ensure_dirs()
    counter = load_counter()
    used = counter["images"]
    remaining = DAILY_LIMIT - used
    print(f"Дата: {counter['date']}")
    print(f"Использовано: {used}/{DAILY_LIMIT} картинок")
    print(f"Осталось: {remaining}")
    print(f"Запросов: {counter['count']}")
    if remaining <= 10:
        print(f"⚠️ ВНИМАНИЕ: осталось мало!")
    elif remaining <= 0:
        print(f"🛑 ЛИМИТ ИСЧЕРПАН! Обнуление в полночь UTC.")


def show_history():
    ensure_dirs()
    if not HISTORY_FILE.exists():
        print("История пуста.")
        return
    today = get_today()
    count = 0
    with open(HISTORY_FILE) as f:
        for line in f:
            entry = json.loads(line)
            if entry["timestamp"].startswith(today):
                count += 1
                ts = entry["timestamp"][11:19]
                print(f"[{ts}] {entry['model']} x{entry['samples']} — {entry['prompt'][:80]}")
                for url in entry.get("urls", []):
                    print(f"  → {url}")
    if count == 0:
        print("Сегодня генераций не было.")


def show_models():
    print("Доступные модели:\n")
    print(f"{'Имя':<14} {'Model ID':<25} {'Описание'}")
    print("-" * 65)
    for alias, info in MODELS.items():
        print(f"{alias:<14} {info['id']:<25} {info['name']}")
    print(f"\nМожно указать любой model_id с ModelsLab (10000+ моделей).")
    print(f"Каталог: https://modelslab.com/models")


def main():
    parser = argparse.ArgumentParser(description="ModelsLab Image Generator (100 img/day free)")
    sub = parser.add_subparsers(dest="command")

    # generate
    gen = sub.add_parser("generate", aliases=["gen", "g"], help="Сгенерировать картинку")
    gen.add_argument("prompt", help="Описание картинки (лучше на английском)")
    gen.add_argument("--model", "-m", default="flux", help="Модель: flux, sdxl, sd3, realistic, anime")
    gen.add_argument("--width", "-W", type=int, default=1024, help="Ширина (max 1024)")
    gen.add_argument("--height", "-H", type=int, default=1024, help="Высота (max 1024)")
    gen.add_argument("--steps", "-s", type=int, default=31, help="Шаги: 21/31/41")
    gen.add_argument("--negative", "-n", default=None, help="Что НЕ рисовать")
    gen.add_argument("--samples", type=int, default=1, help="Кол-во вариантов (1-4)")
    gen.add_argument("--seed", type=int, default=None, help="Seed для воспроизводимости")

    # limit
    sub.add_parser("limit", aliases=["l"], help="Проверить лимит")

    # history
    sub.add_parser("history", aliases=["h"], help="История генераций за сегодня")

    # models
    sub.add_parser("models", aliases=["m"], help="Список доступных моделей")

    args = parser.parse_args()

    if args.command in ("generate", "gen", "g"):
        generate_image(
            prompt=args.prompt,
            model=args.model,
            width=args.width,
            height=args.height,
            steps=args.steps,
            negative=args.negative,
            samples=args.samples,
            seed=args.seed,
        )
    elif args.command in ("limit", "l"):
        show_limit()
    elif args.command in ("history", "h"):
        show_history()
    elif args.command in ("models", "m"):
        show_models()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
