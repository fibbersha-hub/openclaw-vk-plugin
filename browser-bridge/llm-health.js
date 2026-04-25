'use strict';
// === LLM Health Tracker ===
// Tracks per-LLM failure state, auto-disables on known patterns,
// auto-re-enables after cooldown, exposes status for external consumers.

const fs = require('fs');
const https = require('https');

// ── Known failure patterns ────────────────────────────────────────────────────
// Each pattern: { test(errorMsg, url), reason, disableMs, label }
const KNOWN_PATTERNS = [
  {
    label:     'SESSION_EXPIRED',
    test:      (err, url) => url && (url.includes('sign_in') || url.includes('login-source') ||
                              url.includes('login') || url.includes('/auth')),
    reason:    'Сессия истекла — нужен ручной вход',
    disableMs: 4 * 3600_000,   // 4h — needs manual re-login
    manual:    true,            // notify + require manual reset
  },
  {
    label:     'RATE_LIMITED',
    test:      (err) => /rate.?limit|too many requests|429|daily.?limit|quota.?exceeded|usage.?limit/i.test(err),
    reason:    'Дневной лимит исчерпан',
    disableMs: 6 * 3600_000,   // 6h cooldown
    manual:    true,
  },
  {
    label:     'CDP_OVERLOAD',
    test:      (err) => /dispatchMouseEvent timed out|protocol.*timeout|Target closed/i.test(err),
    reason:    'CDP перегружен — временная пауза',
    disableMs: 15 * 60_000,    // 15 min auto-recovery
    manual:    false,
  },
  {
    label:     'NAV_TIMEOUT',
    test:      (err) => /Navigation timeout|net::ERR_|ERR_CONNECTION/i.test(err),
    reason:    'Страница не загрузилась',
    disableMs: 10 * 60_000,    // 10 min auto-recovery
    manual:    false,
  },
  {
    label:     'CONSECUTIVE_FAILURES',
    test:      () => false,    // triggered by counter, not pattern
    reason:    'Три ошибки подряд',
    disableMs: 30 * 60_000,    // 30 min auto-recovery
    manual:    false,
  },
];

const CONSECUTIVE_LIMIT = 3;  // failures before CONSECUTIVE_FAILURES kicks in

// ── State ─────────────────────────────────────────────────────────────────────
// { [llmKey]: { failures, disabled, disabledUntil, reason, label, disabledAt, totalFailures, manual } }
const _state = {};

function _ensure(llmKey) {
  if (!_state[llmKey]) {
    _state[llmKey] = { failures: 0, disabled: false, disabledUntil: 0,
                       reason: '', label: 'OK', disabledAt: 0,
                       totalFailures: 0, manual: false };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call after a successful LLM query.
 * Resets consecutive failure counter; clears auto-recovery disables.
 */
function trackSuccess(llmKey) {
  _ensure(llmKey);
  const s = _state[llmKey];
  s.failures = 0;
  // Only auto-clear non-manual disables
  if (s.disabled && !s.manual) {
    s.disabled = false;
    s.label = 'OK';
    s.reason = '';
  }
}

/**
 * Call after a failed LLM query.
 * @param {string} llmKey  - e.g. 'chatgpt'
 * @param {string} errMsg  - error message from caught exception
 * @param {string} [url]   - current page URL (for session detection)
 * @returns {{ newlyDisabled: bool, pattern: object|null }}
 */
function trackFailure(llmKey, errMsg, url = '') {
  _ensure(llmKey);
  const s = _state[llmKey];
  s.failures++;
  s.totalFailures++;

  // Match against known patterns
  for (const p of KNOWN_PATTERNS) {
    if (p.label === 'CONSECUTIVE_FAILURES') continue; // handled below
    if (p.test(errMsg, url)) {
      _disable(llmKey, p);
      return { newlyDisabled: true, pattern: p };
    }
  }

  // Consecutive failures threshold
  if (s.failures >= CONSECUTIVE_LIMIT) {
    const p = KNOWN_PATTERNS.find(x => x.label === 'CONSECUTIVE_FAILURES');
    _disable(llmKey, p);
    return { newlyDisabled: true, pattern: p };
  }

  return { newlyDisabled: false, pattern: null };
}

function _disable(llmKey, pattern) {
  const s = _state[llmKey];
  s.disabled = true;
  s.disabledUntil = Date.now() + pattern.disableMs;
  s.disabledAt = Date.now();
  s.reason = pattern.reason;
  s.label = pattern.label;
  s.manual = pattern.manual || false;
  s.failures = 0; // reset so next enable starts fresh
}

/**
 * Returns true if LLM is currently disabled.
 * Auto-clears expired non-manual disables.
 */
function isDisabled(llmKey) {
  _ensure(llmKey);
  const s = _state[llmKey];
  if (!s.disabled) return false;
  // Auto-re-enable if cooldown expired (non-manual only)
  if (!s.manual && Date.now() > s.disabledUntil) {
    s.disabled = false;
    s.label = 'OK';
    s.reason = '';
    return false;
  }
  return true;
}

/**
 * Manually re-enable a specific LLM (admin command).
 */
function resetLLM(llmKey) {
  _ensure(llmKey);
  const s = _state[llmKey];
  s.disabled = false;
  s.failures = 0;
  s.label = 'OK';
  s.reason = '';
  s.manual = false;
}

/**
 * Returns full status object for all tracked LLMs.
 */
function getStatus() {
  const now = Date.now();
  const result = {};
  for (const [key, s] of Object.entries(_state)) {
    // Auto-resolve expired non-manual disables before reporting
    if (s.disabled && !s.manual && now > s.disabledUntil) {
      s.disabled = false;
      s.label = 'OK';
      s.reason = '';
    }
    result[key] = {
      disabled:      s.disabled,
      label:         s.label,
      reason:        s.reason,
      manual:        s.manual,
      failures:      s.failures,
      totalFailures: s.totalFailures,
      disabledUntil: s.disabled ? s.disabledUntil : null,
      disabledMinutesLeft: s.disabled ? Math.round((s.disabledUntil - now) / 60000) : null,
    };
  }
  return result;
}

/**
 * Returns list of enabled LLM keys from a given list.
 */
function filterEnabled(llmKeys) {
  return llmKeys.filter(spec => {
    const key = spec.split(':')[0]; // handle 'deepseek:r1' → 'deepseek'
    return !isDisabled(key);
  });
}

// ── VK Notification ───────────────────────────────────────────────────────────
let _vkToken = null;
let _vkUserId = null;
let _lastNotifyTimes = {};
const NOTIFY_COOLDOWN_MS = 15 * 60_000; // don't spam same event within 15 min

function setVKCredentials(token, userId) {
  _vkToken = token;
  _vkUserId = userId;
}

function sendVKNotify(message, key = 'default') {
  if (!_vkToken || !_vkUserId) return;
  // Throttle same key
  if (_lastNotifyTimes[key] && Date.now() - _lastNotifyTimes[key] < NOTIFY_COOLDOWN_MS) return;
  _lastNotifyTimes[key] = Date.now();

  const text = encodeURIComponent(message);
  const url = `https://api.vk.com/method/messages.send?user_id=${_vkUserId}&message=${text}&random_id=${Date.now()}&access_token=${_vkToken}&v=5.131`;
  https.get(url, (res) => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try { const j = JSON.parse(d); if (j.error) console.warn('[health] VK notify error:', j.error.error_msg); }
      catch (_) {}
    });
  }).on('error', () => {});
}

module.exports = { trackSuccess, trackFailure, isDisabled, resetLLM, getStatus, filterEnabled, setVKCredentials, sendVKNotify };
