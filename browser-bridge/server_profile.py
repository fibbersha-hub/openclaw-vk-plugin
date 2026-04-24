#!/usr/bin/env python3
"""
OpenClaw Server Profile Detector
Reads /proc/meminfo, determines batch_size for concurrent LLM queries.

Key concept: ALL 6 LLMs are always queried — just in batches when RAM is limited.
  batch_size = how many LLMs can be queried simultaneously without OOM risk.

Tiers (based on total RAM):
  NANO     < 1.5 GB  — no browser bridge possible (Chromium won't fit)
  MICRO    1.5–3 GB  — batch_size=1  (one LLM at a time, 6 rounds)
  BASIC    3–5 GB    — batch_size=2  (2 LLMs per round, 3 rounds)
  STANDARD 5–7 GB    — batch_size=3  (3 LLMs per round, 2 rounds)
  FULL     7+ GB     — batch_size=6  (all at once, 1 round)

Each active Chromium query peak ≈ 550–650 MB RSS (measured on live server).
OS + Node.js bridge + VK bot ≈ 1 200 MB baseline.
"""

import os
import sys
import json

# ── All LLMs in priority order ────────────────────────────────
ALL_LLMS = [
    "deepseek",    # ~550 MB peak — fast, capable, free
    "chatgpt",     # ~600 MB peak — best general knowledge
    "claude",      # ~580 MB peak — best reasoning
    "perplexity",  # ~520 MB peak — best for current events/news
    "mistral",     # ~500 MB peak — fast, good at code
    "qwen",        # ~520 MB peak — good multilingual
]

MB_PER_ACTIVE_QUERY = 600  # extra RAM per concurrent LLM query (conservative)
MB_OS_BASELINE      = 1200 # OS + Node.js bridge + VK bot + idle sessions

TIERS = {
    # name:  (ram_min_mb, ram_max_mb, batch_size, label)
    "NANO":     (0,    1500,  0, "Nano — только прокси (Groq/OpenRouter)"),
    "MICRO":    (1500, 3000,  1, "Micro — по одному (6 раундов)"),
    "BASIC":    (3000, 5000,  2, "Basic — по 2 (3 раунда)"),
    "STANDARD": (5000, 7000,  3, "Standard — по 3 (2 раунда)"),
    "FULL":     (7000, 99999, 6, "Full — все сразу (1 раунд)"),
}


def read_meminfo():
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])
    except FileNotFoundError:
        pass  # non-Linux (Windows dev machine) — return empty
    return info


def get_profile(use_available=False):
    """
    Returns full server profile dict.
    use_available=True  → batch_size based on currently free RAM
    use_available=False → batch_size based on total RAM (install-time)
    """
    mem       = read_meminfo()
    total_mb  = mem.get("MemTotal",    0) // 1024
    avail_mb  = mem.get("MemAvailable",0) // 1024
    cpu_cores = os.cpu_count() or 1

    check_mb = avail_mb if use_available else total_mb

    # Determine tier
    tier_key = "NANO"
    for key, (rmin, rmax, _, _) in TIERS.items():
        if rmin <= check_mb < rmax:
            tier_key = key
            break

    _, _, batch_size, tier_label = TIERS[tier_key]

    # Env override: SAGE_BATCH_SIZE or SAGE_MAX_LLMS (legacy)
    env_batch = os.environ.get("SAGE_BATCH_SIZE") or os.environ.get("SAGE_MAX_LLMS")
    if env_batch:
        try:
            batch_size = max(0, min(int(env_batch), len(ALL_LLMS)))
        except ValueError:
            pass

    # Env override: SAGE_LLMS — explicit list overrides everything
    env_llms = os.environ.get("SAGE_LLMS", "")
    if env_llms:
        llms_override = [l.strip() for l in env_llms.split(",") if l.strip()]
        llms_to_query = llms_override
        batch_size = len(llms_to_query) if batch_size == 0 else batch_size
    else:
        llms_to_query = list(ALL_LLMS)

    # Build batches
    batches = []
    if batch_size > 0:
        batches = [llms_to_query[i:i+batch_size]
                   for i in range(0, len(llms_to_query), batch_size)]

    return {
        "tier":         tier_key,
        "tier_label":   tier_label,
        "total_mb":     total_mb,
        "available_mb": avail_mb,
        "cpu_cores":    cpu_cores,
        "batch_size":   batch_size,
        "llms_to_query":llms_to_query,
        "batches":      batches,
        "n_batches":    len(batches),
        "check_mode":   "available" if use_available else "total",
    }


def print_profile():
    p = get_profile(use_available=False)
    n = len(p["llms_to_query"])
    bs = p["batch_size"]
    nb = p["n_batches"]
    print(f"\n{'═'*52}")
    print(f"  OpenClaw Server Profile")
    print(f"{'═'*52}")
    print(f"  Тир:     {p['tier']} — {p['tier_label']}")
    print(f"  RAM:     {p['total_mb']} MB total / {p['available_mb']} MB available")
    print(f"  CPU:     {p['cpu_cores']} ядер")
    if bs == 0:
        print(f"  Режим:   браузерный мост недоступен (нужно ≥1.5 ГБ)")
    elif bs >= n:
        print(f"  Режим:   все {n} LLM одновременно (1 раунд)")
    else:
        print(f"  Режим:   очередь — {bs} LLM за раз, {nb} раунд(а)")
        for i, batch in enumerate(p["batches"], 1):
            print(f"    Раунд {i}: {', '.join(batch)}")
    print(f"{'═'*52}\n")


if __name__ == "__main__":
    if "--json" in sys.argv:
        p = get_profile("--available" in sys.argv)
        print(json.dumps(p, indent=2))
    else:
        print_profile()
