#!/usr/bin/env python3
"""
Sage Watchdog — self-healing monitor for Великий Мудрец stack
Runs every 5 min via cron. Checks health, restarts dead services, sends VK notifications.

Cron entry:  */5 * * * * /usr/bin/python3 /opt/browser-bridge/sage-watchdog.py >> /var/log/sage-watchdog.log 2>&1
"""
import json, os, sys, subprocess, time, urllib.request, urllib.parse
from datetime import datetime

BRIDGE_URL    = 'http://127.0.0.1:7788'
SAGE_API_URL  = 'http://127.0.0.1:5001'
BRIDGE_JS     = '/opt/browser-bridge/browser-llm-bridge.js'
BRIDGE_LOG    = '/var/log/browser-llm-bridge.log'
BRIDGE_PID    = '/var/run/browser-bridge/bridge.pid'
STATE_FILE    = '/tmp/sage-watchdog-state.json'   # persists across runs
OPENCLAW_CFG  = '/root/.openclaw/openclaw.json'
VK_OWNER_ID   = os.environ.get('VK_OWNER_ID', 'YOUR_VK_USER_ID')
NOTIFY_COOLDOWN = 15 * 60  # seconds between same-type notifications

# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def load_state():
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {}

def save_state(s):
    json.dump(s, open(STATE_FILE, 'w'))

def get_vk_token():
    try:
        cfg = json.load(open(OPENCLAW_CFG))
        return cfg['plugins']['entries']['vk']['config']['accounts']['default']['token']
    except Exception:
        return None

def send_vk(message, key='default', state=None):
    """Send VK message with cooldown throttle."""
    if state is None:
        state = load_state()
    last = state.get(f'notify_{key}', 0)
    if time.time() - last < NOTIFY_COOLDOWN:
        return False
    token = get_vk_token()
    if not token:
        log('No VK token found, skipping notification')
        return False
    url = (f"https://api.vk.com/method/messages.send"
           f"?user_id={VK_OWNER_ID}"
           f"&message={urllib.parse.quote(message)}"
           f"&random_id={int(time.time())}"
           f"&access_token={token}"
           f"&v=5.131")
    try:
        resp = json.loads(urllib.request.urlopen(url, timeout=10).read())
        if resp.get('error'):
            log(f"VK notify error: {resp['error'].get('error_msg', resp['error'])}")
            return False
        state[f'notify_{key}'] = time.time()
        save_state(state)
        log(f"VK notified [{key}]")
        return True
    except Exception as e:
        log(f"VK notify failed: {e}")
        return False

def http_get(url, timeout=5):
    try:
        return json.loads(urllib.request.urlopen(url, timeout=timeout).read())
    except Exception:
        return None

def http_post(url, body, timeout=10):
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except Exception:
        return None

# ── Service Checks ─────────────────────────────────────────────────────────────

def check_bridge():
    """Returns True if bridge is alive and responding."""
    r = http_get(f'{BRIDGE_URL}/health', timeout=5)
    return r is not None and r.get('status') == 'ok'

def check_sage_api():
    """Returns True if sage-miniapp Flask API is alive."""
    r = http_get(f'{SAGE_API_URL}/health', timeout=5)
    return r is not None and r.get('ok') is True

def restart_bridge():
    """Kill old bridge process and start new one."""
    log("Restarting bridge...")
    # Kill old
    try:
        pid = int(open(BRIDGE_PID).read().strip())
        os.kill(pid, 15)
        time.sleep(2)
    except Exception:
        subprocess.run(['pkill', '-f', 'browser-llm-bridge.js'], capture_output=True)
        time.sleep(2)
    # Start new
    proc = subprocess.Popen(
        ['node', BRIDGE_JS],
        stdout=open(BRIDGE_LOG, 'a'),
        stderr=subprocess.STDOUT,
        start_new_session=True
    )
    os.makedirs(os.path.dirname(BRIDGE_PID), exist_ok=True)
    open(BRIDGE_PID, 'w').write(str(proc.pid))
    time.sleep(4)
    alive = check_bridge()
    log(f"Bridge restart {'OK' if alive else 'FAILED'} (PID {proc.pid})")
    return alive

def restart_sage_api():
    """Restart sage-miniapp systemd service."""
    log("Restarting sage-miniapp...")
    r = subprocess.run(['systemctl', 'restart', 'sage-miniapp'], capture_output=True)
    time.sleep(3)
    alive = check_sage_api()
    log(f"sage-miniapp restart {'OK' if alive else 'FAILED'}")
    return alive

# ── LLM Status Check ──────────────────────────────────────────────────────────

def check_llm_status(state):
    """Check disabled LLMs, notify if new ones found."""
    status = http_get(f'{BRIDGE_URL}/llm-status', timeout=5)
    if not status:
        return

    prev_disabled = set(state.get('disabled_llms', []))
    now_disabled  = {k for k, v in status.items() if v.get('disabled')}
    newly_disabled = now_disabled - prev_disabled
    newly_recovered = prev_disabled - now_disabled

    if newly_disabled:
        lines = []
        for llm in newly_disabled:
            s = status[llm]
            mins = s.get('disabledMinutesLeft', '?')
            label = s.get('label', '?')
            reason = s.get('reason', '?')
            auto = '' if s.get('manual') else f' (авто через {mins} мин)'
            lines.append(f"  • {llm}: {label} — {reason}{auto}")
        msg = "⚠️ Великий Мудрец: новые отключения LLM\n" + "\n".join(lines)
        send_vk(msg, f'disabled_{"_".join(sorted(newly_disabled))}', state)
        log(f"Newly disabled: {newly_disabled}")

    if newly_recovered:
        msg = "✅ Великий Мудрец: LLM восстановлены\n" + "\n".join(f"  • {x}" for x in newly_recovered)
        send_vk(msg, f'recovered_{"_".join(sorted(newly_recovered))}', state)
        log(f"Recovered: {newly_recovered}")

    state['disabled_llms'] = list(now_disabled)

    # Summary if many disabled
    if len(now_disabled) >= 3:
        msg = (f"⚠️ Великий Мудрец: {len(now_disabled)} из {len(status)} LLM отключены\n"
               f"Отключены: {', '.join(sorted(now_disabled))}\n"
               f"Работают: {', '.join(sorted(set(status) - now_disabled))}")
        send_vk(msg, 'many_disabled', state)

# ── Known Issue Auto-Debug ─────────────────────────────────────────────────────

def check_bridge_log_patterns():
    """Scan recent bridge logs for known issues needing auto-debug."""
    issues = []
    try:
        # Read last 200 lines of log
        result = subprocess.run(['tail', '-n', '200', BRIDGE_LOG], capture_output=True, text=True)
        lines = result.stdout.lower()

        if 'session' not in lines and 'login-source' in lines:
            issues.append('session_expired_detected')
        if lines.count('dispatchmouseevent timed out') > 3:
            issues.append('cdp_overload_repeated')
        if 'unhandled' in lines and 'error' in lines:
            issues.append('unhandled_exception')
    except Exception:
        pass
    return issues

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    log("=== Sage Watchdog run ===")
    state = load_state()

    # 1. Check bridge
    bridge_alive = check_bridge()
    log(f"Bridge: {'OK' if bridge_alive else 'DOWN'}")
    if not bridge_alive:
        restarted = restart_bridge()
        msg = ("✅ Великий Мудрец: бридж автоматически перезапущен" if restarted
               else "❌ Великий Мудрец: бридж НЕ запустился — нужна ручная диагностика")
        send_vk(msg, 'bridge_restart', state)

    # 2. Check sage-miniapp
    sage_alive = check_sage_api()
    log(f"sage-miniapp: {'OK' if sage_alive else 'DOWN'}")
    if not sage_alive:
        restarted = restart_sage_api()
        msg = ("✅ Великий Мудрец: API автоматически перезапущен" if restarted
               else "❌ Великий Мудрец: API не запустился — нужна диагностика")
        send_vk(msg, 'sage_restart', state)

    # 3. Check LLM health statuses (only if bridge alive)
    if bridge_alive or check_bridge():
        check_llm_status(state)

    # 4. Scan logs for patterns
    issues = check_bridge_log_patterns()
    if issues:
        log(f"Known issues detected: {issues}")

    save_state(state)
    log("=== Done ===")

if __name__ == '__main__':
    main()
