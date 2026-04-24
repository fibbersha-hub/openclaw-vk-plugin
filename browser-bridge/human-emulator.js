// === Human Behavior Emulator v1.0 ===
// Realistic mouse movements, typing with typos/corrections, random pauses
// Used by browser-llm-bridge and diagnostic-tracker

'use strict';

// ── Helpers ──────────────────────────────────────────────────

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rndFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Mouse: bezier curve movement ─────────────────────────────
// Moves mouse from current pos to target along a curved path

function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

async function humanMouseMove(page, toX, toY, opts = {}) {
  const steps = opts.steps || rnd(15, 35);
  const baseDelay = opts.delay || rnd(4, 12); // ms per step

  // Get current mouse position (approximate center if unknown)
  const viewport = page.viewport() || { width: 1280, height: 800 };
  const fromX = opts.fromX || viewport.width / 2;
  const fromY = opts.fromY || viewport.height / 2;

  // Control points for bezier curve (slight arc)
  const cp1x = fromX + (toX - fromX) * 0.3 + rnd(-80, 80);
  const cp1y = fromY + (toY - fromY) * 0.3 + rnd(-80, 80);
  const cp2x = fromX + (toX - fromX) * 0.7 + rnd(-60, 60);
  const cp2y = fromY + (toY - fromY) * 0.7 + rnd(-60, 60);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(bezier(t, fromX, cp1x, cp2x, toX));
    const y = Math.round(bezier(t, fromY, cp1y, cp2y, toY));
    await page.mouse.move(x, y);
    // Vary speed: slower at start and end (easing)
    const easing = Math.sin(t * Math.PI) * 0.8 + 0.2;
    await sleep(Math.round(baseDelay / easing));
  }
}

// ── Mouse: click with human-like approach ────────────────────

async function humanClick(page, selector, opts = {}) {
  const el = await page.$(selector);
  if (!el) throw new Error(`humanClick: element not found: ${selector}`);

  const box = await el.boundingBox();
  if (!box) throw new Error(`humanClick: no bounding box for: ${selector}`);

  // Target slightly off-center (humans don't click exact center)
  const targetX = box.x + box.width * rndFloat(0.3, 0.7);
  const targetY = box.y + box.height * rndFloat(0.3, 0.7);

  await humanMouseMove(page, targetX, targetY, opts);
  await sleep(rnd(50, 180)); // pause before click
  await page.mouse.click(targetX, targetY, { delay: rnd(40, 120) });
  await sleep(rnd(80, 200)); // pause after click
}

// ── Typing: realistic with typos and corrections ─────────────

const COMMON_TYPOS = {
  'a': 's', 'b': 'v', 'c': 'x', 'd': 's', 'e': 'r', 'f': 'd',
  'g': 'f', 'h': 'j', 'i': 'u', 'j': 'k', 'k': 'l', 'l': 'k',
  'm': 'n', 'n': 'm', 'o': 'p', 'p': 'o', 'q': 'w', 'r': 'e',
  's': 'a', 't': 'r', 'u': 'y', 'v': 'b', 'w': 'q', 'x': 'z',
  'y': 'u', 'z': 'x',
};

async function humanType(page, text, opts = {}) {
  const typoRate   = opts.typoRate   ?? 0.04;  // 4% chance of typo per char
  const fixDelay   = opts.fixDelay   ?? 300;   // ms before fixing typo
  const minDelay   = opts.minDelay   ?? 40;    // min ms between keystrokes
  const maxDelay   = opts.maxDelay   ?? 180;   // max ms between keystrokes
  const burstChars = opts.burstChars ?? 5;     // chars before possible pause
  const burstPause = opts.burstPause ?? 400;   // ms for burst pause

  let charCount = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    charCount++;

    // Occasional burst pause (thinking mid-sentence)
    if (charCount % rnd(burstChars, burstChars * 3) === 0) {
      await sleep(rnd(burstPause, burstPause * 2));
    }

    // Typo chance
    if (Math.random() < typoRate && COMMON_TYPOS[char.toLowerCase()]) {
      const typo = COMMON_TYPOS[char.toLowerCase()];
      const typoChar = char === char.toUpperCase() ? typo.toUpperCase() : typo;

      // Type wrong character
      await page.keyboard.type(typoChar);
      await sleep(rnd(fixDelay, fixDelay * 2));

      // Realize mistake — delete it
      await page.keyboard.press('Backspace');
      await sleep(rnd(80, 200));
    }

    // Type correct character
    await page.keyboard.type(char);
    await sleep(rnd(minDelay, maxDelay));

    // Extra pause after punctuation/space (natural rhythm)
    if (' .,!?;:'.includes(char)) {
      await sleep(rnd(50, 150));
    }
  }
}

// ── Random idle behavior (while waiting for response) ────────
// Simulates: scrolling, micro mouse movements, occasional scroll

async function humanIdle(page, durationMs) {
  const deadline = Date.now() + durationMs;
  const viewport = page.viewport() || { width: 1280, height: 800 };

  while (Date.now() < deadline) {
    const action = rnd(0, 4);

    if (action === 0) {
      // Micro mouse wiggle
      const x = rnd(200, viewport.width - 200);
      const y = rnd(200, viewport.height - 200);
      await humanMouseMove(page, x, y, { steps: rnd(5, 15), delay: rnd(8, 20) });
    } else if (action === 1) {
      // Scroll slightly
      const delta = rnd(-150, 150);
      await page.mouse.wheel({ deltaY: delta });
    } else if (action === 2) {
      // Move toward center (like reading)
      await humanMouseMove(page, viewport.width / 2 + rnd(-100, 100), viewport.height / 2 + rnd(-50, 50));
    }
    // else: do nothing (just wait)

    await sleep(rnd(800, 3000));
  }
}

// ── WAF bypass: handle "One more step" challenge ─────────────

async function handleWAFChallenge(page) {
  // Check for WAF overlay
  const wafText = await page.evaluate(() => {
    const body = document.body.innerText || '';
    return body.includes('One more step') || body.includes('Checking your browser');
  });

  if (!wafText) return false; // no WAF

  console.log('[human] WAF challenge detected, attempting to bypass...');

  // Move mouse around naturally first
  const viewport = page.viewport() || { width: 1280, height: 800 };
  await humanMouseMove(page, viewport.width / 2 + rnd(-50, 50), viewport.height / 2 + rnd(-30, 30));
  await sleep(rnd(500, 1200));

  // Look for checkbox or button in WAF overlay
  const selectors = [
    'input[type="checkbox"]',
    'button:not([disabled])',
    '[class*="challenge"]',
    '[class*="verify"]',
    '[id*="challenge"]',
    'iframe',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      const box = await el.boundingBox();
      if (box) {
        console.log(`[human] Found WAF element: ${sel}, clicking...`);
        await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(rnd(300, 700));
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(rnd(2000, 4000));
        return true;
      }
    }
  }

  // If WAF has iframe (Cloudflare/AWS style) — wait and let it auto-resolve
  console.log('[human] WAF auto-resolve attempt, waiting 5s...');
  await humanIdle(page, 5000);
  return true;
}

module.exports = { humanMouseMove, humanClick, humanType, humanIdle, handleWAFChallenge, rnd, rndFloat, sleep };
