#!/usr/bin/env node
// === DOM Change Tracker v2.0 ===
// Asks DeepSeek a complex question and records every DOM change every 1 second.
// Goal: understand the timeline of LLM response generation.
// v2.0: + human emulation (bezier mouse, typos, idle behavior, WAF bypass)
// Output: /tmp/diagnostic-{timestamp}.json + console log

'use strict';

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { humanMouseMove, humanClick, humanType, humanIdle, handleWAFChallenge, rnd, sleep } = require('./human-emulator');

const CDP_PORT = 9222;
const QUESTION = `Объясни подробно, шаг за шагом, как работает алгоритм быстрой сортировки (QuickSort).
Включи: базовую идею, выбор опорного элемента, разбиение массива, рекурсию, временную сложность в лучшем/среднем/худшем случае, и практический пример на числах [3,6,8,10,1,2,1].`;

const TRACK_INTERVAL = 1000; // 1 second
const MAX_DURATION = 300000; // 5 min max
const OUT_FILE = `/tmp/diagnostic-${Date.now()}.json`;
const SCREENSHOT_DIR = '/tmp/bridge-screenshots';

// ── Helpers ──────────────────────────────────────────────────

function ts() { return new Date().toISOString(); }
function elapsed(start) { return ((Date.now() - start) / 1000).toFixed(1) + 's'; }

function log(tag, msg) {
  const line = `${ts()} [${tag}] ${msg}`;
  console.log(line);
}

async function screenshot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const file = path.join(SCREENSHOT_DIR, `diag-${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log('screenshot', `Saved: ${file}`);
    return file;
  } catch (e) {
    log('screenshot_err', e.message);
    return null;
  }
}

// ── Page state snapshot ──────────────────────────────────────

async function snapshot(page) {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) return null;

    // Full text (no scripts/styles)
    const clone = body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg').forEach(e => e.remove());
    const fullText = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();

    // Count DOM nodes
    const nodeCount = document.querySelectorAll('*').length;

    // Detect streaming indicators
    const indicators = {
      animateSpin:   !!document.querySelector('[class*="animate-spin"], svg.animate-spin'),
      streaming:     !!document.querySelector('[class*="streaming"], [class*="is-streaming"]'),
      loading:       !!document.querySelector('[class*="loading"]:not([class*="page"])'),
      stopButton:    !!document.querySelector('button[aria-label*="stop" i], button[aria-label*="Stop"]'),
      thinking:      !!document.querySelector('[class*="thinking"], [class*="reasoning"], details'),
      cursor:        !!document.querySelector('[class*="cursor"][class*="blink"], [class*="caret"]'),
    };

    // Count message blocks (rough)
    const msgBlocks = document.querySelectorAll(
      '[class*="message"], [class*="chat-item"], [class*="turn"], article'
    ).length;

    // Last 200 chars of visible text (end of conversation)
    const tail = fullText.slice(-200);

    return {
      textLen: fullText.length,
      nodeCount,
      msgBlocks,
      indicators,
      tail,
    };
  });
}

// ── Main ─────────────────────────────────────────────────────

(async () => {
  log('init', `Connecting to Chromium on port ${CDP_PORT}...`);
  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${CDP_PORT}`,
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 60000,
  });
  log('init', 'Connected');

  log('nav', 'Opening new tab (inherits session cookies from profile)...');
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
  );

  // Navigate to DeepSeek
  await page.goto('https://chat.deepseek.com', { waitUntil: 'networkidle2', timeout: 30000 });

  const url = page.url();
  log('nav', `Using tab: ${url}`);
  if (url.includes('sign_in') || url.includes('login')) {
    log('ERROR', 'Not logged in! Please login via VNC first.');
    await browser.disconnect();
    process.exit(1);
  }

  // Screenshot: initial page state
  await screenshot(page, '01-loaded');

  // ── Human: idle movement after page load (reading behavior) ──
  log('human', 'Idle movement: simulating page-read behavior (3s)...');
  await humanIdle(page, 3000);

  // ── WAF check ──
  log('waf', 'Checking for WAF challenge...');
  const wafHandled = await handleWAFChallenge(page);
  if (wafHandled) {
    log('waf', 'WAF handled, waiting for page to stabilize...');
    await sleep(3000);
    await screenshot(page, '02-after-waf');
  } else {
    log('waf', 'No WAF challenge detected');
    await screenshot(page, '02-no-waf');
  }

  // ── Find input ──
  log('input', 'Looking for input field...');
  const inputSelectors = [
    'textarea#chat-input',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  let inputSel = null;
  let inputEl = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !inputEl) {
    for (const sel of inputSelectors) {
      const el = await page.$(sel);
      if (el && await el.isVisible().catch(() => false)) {
        inputEl = el;
        inputSel = sel;
        break;
      }
    }
    if (!inputEl) await sleep(500);
  }
  if (!inputEl) { log('ERROR', 'Input not found'); process.exit(1); }
  log('input', `Input found: ${inputSel}`);

  // Screenshot: before typing
  await screenshot(page, '03-before-type');

  // ── Baseline snapshot ──
  const baseline = await snapshot(page);
  log('baseline', `textLen=${baseline.textLen} nodes=${baseline.nodeCount} msgs=${baseline.msgBlocks}`);

  // ── Human: click input naturally, then type with emulation ──
  log('human', `Clicking input via human-click (bezier approach)...`);
  await humanClick(page, inputSel);

  log('human', `Typing question via humanType (${QUESTION.length} chars, ~4% typo rate)...`);
  await humanType(page, QUESTION, {
    typoRate: 0.04,
    minDelay: 35,
    maxDelay: 160,
    burstChars: 6,
    burstPause: 350,
  });

  // Screenshot: after typing (before submit)
  await screenshot(page, '04-typed');

  // ── Human: brief pause before pressing Enter (think → confirm) ──
  const preSubmitPause = rnd(400, 900);
  log('human', `Pre-submit pause: ${preSubmitPause}ms`);
  await sleep(preSubmitPause);

  const startTime = Date.now();
  log('send', 'Pressing Enter...');
  await page.keyboard.press('Enter');
  log('send', 'Question sent. Starting 1-second tracking...');

  // Screenshot: immediately after submit
  await screenshot(page, '05-submitted');

  // ── Track every 1 second + human idle during wait ──
  const events = [];
  let prev = await snapshot(page);
  let stableCount = 0;
  let done = false;
  let tick = 0;
  let lastIdleAt = Date.now();
  let nextIdleIn = rnd(8000, 20000); // randomized per-cycle

  while (!done && Date.now() - startTime < MAX_DURATION) {
    await new Promise(r => setTimeout(r, TRACK_INTERVAL));
    tick++;

    const curr = await snapshot(page);
    if (!curr) continue;

    const dt = elapsed(startTime);
    const textDelta = curr.textLen - prev.textLen;
    const nodeDelta = curr.nodeCount - prev.nodeCount;
    const changed = textDelta !== 0 || nodeDelta !== 0 ||
      JSON.stringify(curr.indicators) !== JSON.stringify(prev.indicators) ||
      curr.msgBlocks !== prev.msgBlocks;

    const event = {
      tick,
      t: dt,
      textLen: curr.textLen,
      textDelta,
      nodeCount: curr.nodeCount,
      nodeDelta,
      msgBlocks: curr.msgBlocks,
      indicators: curr.indicators,
      changed,
      tail: curr.tail.slice(-80),
    };
    events.push(event);

    // Console output
    const indStr = Object.entries(curr.indicators)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',') || '-';

    log(
      changed ? 'CHANGE' : 'stable',
      `t=${dt} | textΔ=${textDelta > 0 ? '+' : ''}${textDelta} nodeΔ=${nodeDelta > 0 ? '+' : ''}${nodeDelta} msgs=${curr.msgBlocks} indicators=[${indStr}] | tail="${curr.tail.slice(-60)}"`
    );

    // Human idle: randomized interval between each micro-movement
    if (Date.now() - lastIdleAt > nextIdleIn) {
      const viewport = page.viewport() || { width: 1280, height: 800 };
      const action = rnd(0, 2);
      if (action === 0) {
        log('human', `Idle micro-wiggle (nextIdleIn was ${nextIdleIn}ms)`);
        await humanMouseMove(page,
          rnd(200, viewport.width - 200),
          rnd(150, viewport.height - 150),
          { steps: rnd(4, 13), delay: rnd(6, 20) }
        );
      } else if (action === 1) {
        log('human', 'Idle scroll (reader behavior)');
        await page.mouse.wheel({ deltaY: rnd(-100, 100) });
      } else {
        log('human', 'Idle center-move');
        await humanMouseMove(page,
          viewport.width / 2 + rnd(-100, 100),
          viewport.height / 2 + rnd(-60, 60),
          { steps: rnd(3, 8), delay: rnd(10, 22) }
        );
      }
      lastIdleAt = Date.now();
      nextIdleIn = rnd(8000, 22000); // new random threshold for next action
    }

    // Stable detection: 2 consecutive seconds with no change AND no active indicators
    const activeIndicators = Object.values(curr.indicators).some(v => v);
    if (!changed && !activeIndicators) {
      stableCount++;
      if (stableCount >= 2) {
        log('DONE', `Page stable for 2s with no active indicators — response complete`);
        done = true;
      }
    } else {
      stableCount = 0;
    }

    // Screenshot at key moments
    if (tick === 3) await screenshot(page, `06-tick3`);
    if (tick === 10) await screenshot(page, `07-tick10`);
    if (done) await screenshot(page, `08-done`);

    prev = curr;
  }

  // ── Final parse ──
  log('parse', 'Extracting final response...');
  const finalText = await page.evaluate((sentMsg) => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[class*="thinking"], details, [class*="reasoning"]').forEach(e => e.remove());
    clone.querySelectorAll('script,style,noscript,svg').forEach(e => e.remove());

    const blocks = Array.from(clone.querySelectorAll(
      '[class*="message"], [class*="assistant"], [class*="markdown"], [class*="ds-markdown"], p, div'
    ))
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(t => t.length > 50 && !t.toLowerCase().startsWith(sentMsg.toLowerCase().slice(0, 40)));

    return blocks.length > 0 ? blocks[blocks.length - 1] : '';
  }, QUESTION.trim().slice(0, 60));

  const totalTime = elapsed(startTime);
  log('parse', `Response (${finalText.length} chars): "${finalText.slice(0, 200)}..."`);
  log('stats', `Total time: ${totalTime} | Ticks: ${tick} | Events recorded: ${events.length}`);

  // Screenshot: final state
  await screenshot(page, '09-final');

  // ── Save JSON report ──
  const report = {
    version: '2.0-human-emulated',
    question: QUESTION,
    startedAt: new Date(startTime).toISOString(),
    totalTime,
    ticks: tick,
    baseline,
    events,
    finalResponseLen: finalText.length,
    finalResponsePreview: finalText.slice(0, 500),
    wafHandled,
    screenshotDir: SCREENSHOT_DIR,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  log('report', `Saved to ${OUT_FILE}`);

  await page.close();
  await browser.disconnect();
  log('done', 'Tracker finished');
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
