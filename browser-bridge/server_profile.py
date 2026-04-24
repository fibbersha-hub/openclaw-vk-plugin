#!/usr/bin/env python3
"""
OpenClaw Server Profile Detector
Reads /proc/meminfo and /proc/cpuinfo, determines system tier,
returns recommended LLM list and limits for Великий Мудрец.

Tiers:
  NANO    < 1.5 GB RAM   — no browser sessions, proxy only
  MICRO   1.5–3 GB RAM   — 2 LLMs (DeepSeek + ChatGPT)
  BASIC   3–5 GB RAM     — 3 LLMs (DeepSeek + ChatGPT + Claude)
  STANDARD 5–7 GB RAM   — 5 LLMs (all except Qwen)
  FULL    7+ GB RAM      — all 6 LLMs

Each Chromium session with a loaded LLM page ≈ 550–650 MB RSS.
OS + Node.js bridge + VK bot ≈ 1.2 GB baseline.
"""

import os
import sys
import json

# ── LLM priority order (best quality → fallback) ─────────────
LLM_PRIORITY = [
    "deepseek",    # ~550 MB — free, very capable, fast
    "chatgpt",     # ~600 MB — best general knowledge
    "claude",      # ~580 MB — best reasoning
    "perplexity",  # ~520 MB — best for current events
    "mistral",     # ~500 MB — fast, good code
    "qwen",        # ~520 MB — good multilingual
]

MB_PER_SESSION  = 600   # conservative estimate per Chromium session
MB_OS_BASELINE  = 1200  # OS + Node.js + VK bot + groq-proxy

TIERS = {
    "NANO":     {"ram_min": 0,    "ram_max": 1500,  "max_llms": 0, "label": "Nano (≤1.5 GB)"},
    "MICRO":    {"ram_min": 1500, "ram_max": 3000,  "max_llms": 2, "label": "Micro (1.5–3 GB)"},
    "BASIC":    {"ram_min": 3000, "ram_max": 5000,  "max_llms": 3, "label": "Basic (3–5 GB)"},
    "STANDARD": {"ram_min": 5000, "ram_max": 7000,  "max_llms": 5, "label": "Standard (5–7 GB)"},
    "FULL":     {"ram_min": 7000, "ram_max": 999999,"max_llms": 6, "label": "Full (7+ GB)"},
}


def read_meminfo():
    """Returns dict of key→kB from /proc/meminfo."""
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                key = parts[0].rstrip(":")
                info[key] = int(parts[1])
    return info


def read_cpuinfo():
    """Returns number of logical CPU cores."""
    try:
        return os.cpu_count() or 1
    except Exception:
        return 1


def get_profile(use_available=False):
    """
    Returns a dict with full server profile.
    use_available=True  → tier based on currently free RAM (runtime check)
    use_available=False → tier based on total RAM (install-time check)
    """
    mem = read_meminfo()
    total_mb    = mem.get("MemTotal", 0) // 1024
    available_mb = mem.get("MemAvailable", 0) // 1024
    free_mb     = mem.get("MemFree", 0) // 1024
    cached_mb   = mem.get("Cached", 0) // 1024
    cpu_cores   = read_cpuinfo()

    check_mb = available_mb if use_available else total_mb

    # Determine tier
    tier_key = "NANO"
    for key, t in TIERS.items():
        if t["ram_min"] <= check_mb < t["ram_max"]:
            tier_key = key
            break

    tier = TIERS[tier_key]
    max_llms = tier["max_llms"]

    # Effective LLM list (top N by priority)
    active_llms = LLM_PRIORITY[:max_llms]

    # Usable headroom: how many MORE sessions could fit
    usable_for_sessions = max(0, available_mb - MB_OS_BASELINE)
    headroom_sessions   = usable_for_sessions // MB_PER_SESSION

    return {
        "tier":           tier_key,
        "tier_label":     tier["label"],
        "total_mb":       total_mb,
        "available_mb":   available_mb,
        "cpu_cores":      cpu_cores,
        "max_llms":       max_llms,
        "active_llms":    active_llms,
        "skipped_llms":   LLM_PRIORITY[max_llms:],
        "headroom_sessions": headroom_sessions,
        "check_mode":     "available" if use_available else "total",
    }


def get_runtime_limit():
    """
    Runtime check: how many LLMs can we safely query RIGHT NOW
    given current available memory.
    Returns list of LLM names to query.
    """
    profile = get_profile(use_available=True)

    # If env var overrides max_llms — respect it
    env_max = os.environ.get("SAGE_MAX_LLMS")
    if env_max:
        try:
            env_max = int(env_max)
            profile["max_llms"]    = min(env_max, len(LLM_PRIORITY))
            profile["active_llms"] = LLM_PRIORITY[:profile["max_llms"]]
            profile["skipped_llms"] = LLM_PRIORITY[profile["max_llms"]:]
        except ValueError:
            pass

    return profile


def print_profile():
    """Pretty-print profile for installer/diagnostics."""
    p = get_profile(use_available=False)
    print(f"\n{'═'*50}")
    print(f"  OpenClaw Server Profile")
    print(f"{'═'*50}")
    print(f"  Tier:      {p['tier']} — {p['tier_label']}")
    print(f"  RAM:       {p['total_mb']} MB total / {p['available_mb']} MB available")
    print(f"  CPU:       {p['cpu_cores']} core(s)")
    print(f"  Max LLMs:  {p['max_llms']} of {len(LLM_PRIORITY)}")
    if p["active_llms"]:
        print(f"  Active:    {', '.join(p['active_llms'])}")
    else:
        print(f"  Active:    none (browser bridge not recommended)")
    if p["skipped_llms"]:
        print(f"  Skipped:   {', '.join(p['skipped_llms'])} (not enough RAM)")
    print(f"{'═'*50}\n")


if __name__ == "__main__":
    if "--json" in sys.argv:
        p = get_profile("--available" in sys.argv)
        print(json.dumps(p, indent=2))
    else:
        print_profile()
