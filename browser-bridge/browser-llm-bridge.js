#!/usr/bin/env node
// === Browser LLM Bridge v1.2 ===
// HTTP bridge: receives {llm, message} → opens Chromium tab → returns LLM response
// Connects to existing Chromium on port 9222 (with user sessions preserved)
// Port: 7788
// v1.2: + human emulation (bezier mouse, typos, WAF bypass, idle behavior)

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const health = require('./llm-health');
// Load VK credentials for notifications
try {
  const cfg = JSON.parse(require('fs').readFileSync('/root/.openclaw/openclaw.json','utf8'));
  const vkToken = cfg?.plugins?.entries?.vk?.config?.accounts?.default?.token;
  // Read owner ID from allowFrom[0] — first allowed user is the owner
  const vkUserId = cfg?.plugins?.entries?.vk?.config?.accounts?.default?.allowFrom?.[0] || '';
  if (vkToken && vkUserId) health.setVKCredentials(vkToken, vkUserId);
} catch(_) {}
const { humanMouseMove, humanType, humanIdle, handleWAFChallenge, rnd, rndFloat, sleep: humanSleep } = require('./human-emulator');
// ── Concurrency limiter (max N tasks in parallel) ─────────────────────────────
const QUERY_CONCURRENCY = 3; // max parallel LLMs — prevents CDP overload
async function pLimit(taskFns, concurrency) {
  const results = new Array(taskFns.length);
  let next = 0;
  async function worker() {
    while (next < taskFns.length) {
      const i = next++;
      try { results[i] = { status: 'fulfilled', value: await taskFns[i]() }; }
      catch (e) { results[i] = { status: 'rejected', reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, taskFns.length) }, worker));
  return results;
}


const CDP_PORT = 9222;
const BRIDGE_PORT = 7788;
const REQUEST_TIMEOUT = 180000; // 3 min max per request
const POLL_INTERVAL = 3000;     // check every 3s
const MIN_STABLE_POLLS = 2;     // 2 stable polls = done
const MIN_TEXT_LEN = 3;         // minimum chars for valid response
const LOG_FILE = '/var/log/browser-llm-bridge.log';
const SCREENSHOT_DIR = '/tmp/bridge-screenshots';

// ============================================================
// LOGGER — timestamps + file + stdout
// ============================================================
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(level, tag, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `${ts} [${level}] [${tag}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

const L = {
  info:  (tag, ...a) => log('INFO ', tag, ...a),
  warn:  (tag, ...a) => log('WARN ', tag, ...a),
  error: (tag, ...a) => log('ERROR', tag, ...a),
  debug: (tag, ...a) => log('DEBUG', tag, ...a),
  step:  (tag, ...a) => log('STEP ', tag, ...a),
};

// ============================================================
// LLM ADAPTER CONFIGS (ported from Prometheus content.js v2.3)
// ============================================================
const ADAPTERS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    newChatUrl: 'https://chat.deepseek.com/r/new',
    inputSelectors: [
      'textarea#chat-input',
      'textarea[placeholder]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendSelectors: [
      'button[aria-label="Send"]',
      'div[role="button"][aria-label*="send" i]',
      'button[type="submit"]',
    ],
    responseSelectors: [
      '.ds-markdown',
      '.markdown-body',
      '[class*="markdown"]',
      '[class*="message"][class*="assistant"]',
      '[class*="response"]',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="streaming"]',
      '[class*="typing-indicator"]',
      '[class*="animate-spin"]',
      'button[aria-label*="stop" i]',
    ],
    thinkingSelectors: [
      '[class*="thinking"]',
      'details',
      '[class*="reasoning"]',
    ],
    enterToSend: true,
    // Model switching: V3 (default) vs R1 (DeepThink/reasoning)
    models: {
      default: { label: 'DeepSeek V3', isDefault: true },
      r1: {
        label: 'DeepSeek R1',
        // Toggle button for DeepThink (R1) mode in input toolbar
        activateSelectors: [
          'div[class*="_deepThink_"]',
          'div[class*="deepThink"]',
          'button[class*="think"]',
          'label[class*="think"]',
          '[data-cy="deep-think-button"]',
          '[aria-label*="DeepThink" i]',
          '[aria-label*="R1" i]',
          // text-based fallback handled in switchToModel
        ],
        activateText: 'DeepThink',  // text match fallback
        // How to detect it's already active
        activeCheckSelectors: [
          'div[class*="_deepThink_"][class*="_selected_"]',
          'div[class*="_deepThink_"][class*="active"]',
          'div[class*="deepThink"][class*="active"]',
          'button[class*="think"][class*="active"]',
        ],
      },
    },
  },

  gemini: {
    name: 'Gemini',
    url: 'https://gemini.google.com/app?hl=ru',
    inputSelectors: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]',
      'button[jsname="Qx7uuf"]',
      'button[aria-label*="send" i]',
      'button[data-mat-icon-name="send"]',
    ],
    responseSelectors: [
      'model-response .markdown',
      'model-response',
      '[class*="model-response"]',
      '[class*="response-content"]',
      'message-content',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="pending"]',
      'thinking-thoughts',
      '[aria-label*="Gemini is thinking"]',
      '[class*="streaming"]',
    ],
    thinkingSelectors: [
      'thinking-thoughts',
      '[class*="thinking"]',
    ],
    enterToSend: false,
  },

  chatgpt: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    newChatUrl: 'https://chatgpt.com/',
    inputSelectors: [
      '#prompt-textarea',
      'div[id="prompt-textarea"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ],
    responseSelectors: [
      '[data-message-author-role="assistant"] .markdown.prose',
      '[data-message-author-role="assistant"]',
      'div.agent-turn .markdown',
    ],
    generatingSelectors: [
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop streaming"]',
      'button[data-testid="stop-button"]',
      '[class*="result-streaming"]',
      'svg.animate-spin',
    ],
    thinkingSelectors: [],
    enterToSend: true,
    postProcess: (text) => text
      .replace(/【\d+[:\d]*†[^】]*】/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  },

  perplexity: {
    name: 'Perplexity',
    url: 'https://www.perplexity.ai',
    inputSelectors: [
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Спросите"]',
      'textarea[placeholder*="follow"]',
      'textarea',
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Submit"]',
      'button[type="submit"]',
      'button[aria-label*="search" i]',
    ],
    responseSelectors: [
      '[class*="prose"]:not(button):not(input)',
      '[data-testid*="answer"]',
      'div[class*="Answer"] p',
      '[class*="answer"] p',
      '[class*="markdown"] p',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="animate"]',
      '[class*="streaming"]',
      '[class*="pending"]',
    ],
    thinkingSelectors: [],
    enterToSend: true,
  },

  grok: {
    name: 'Grok',
    url: 'https://grok.com',
    inputSelectors: [
      'div.tiptap.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendSelectors: [
      'button[aria-label="Send"]',
      'button[aria-label="Grok something"]',
      'button[type="submit"]',
    ],
    responseSelectors: [
      '[class*="response-content-markdown"]',
      '[class*="response"][class*="markdown"]',
      '.markdown-body',
      '[class*="markdown"]',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="streaming"]',
      '[class*="typing"]',
      '[class*="animate-pulse"]',
      'button[aria-label*="stop" i]',
      'svg.animate-spin',
    ],
    thinkingSelectors: [
      '[class*="thinking"]',
    ],
    enterToSend: true,
  },

  claude: {
    name: 'Claude',
    url: 'https://claude.ai/new',
    inputSelectors: [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][translate="no"]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendSelectors: [
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
      'fieldset button:last-of-type',
    ],
    responseSelectors: [
      '.font-claude-message .markdown',
      '.font-claude-message',
      '[data-is-streaming] .break-words',
      '.prose',
    ],
    generatingSelectors: [
      '[data-is-streaming="true"]',
      '[data-is-streaming]:not([data-is-streaming="false"])',
      'button[aria-label="Stop Response"]',
      '[class*="streaming"]',
      'svg.animate-spin',
    ],
    thinkingSelectors: [
      '[class*="thinking"]',
      '[class*="extended-thinking"]',
    ],
    enterToSend: true,
  },

  qwen: {
    name: 'Qwen',
    url: 'https://chat.qwen.ai',
    inputSelectors: [
      'textarea.message-input-textarea',
      'textarea[data-testid]',
      '#chat-input',
      'textarea',
    ],
    sendSelectors: [
      'button.send-button:not(.disabled)',
      'button[data-testid="chat-input-send-button"]',
      'button[class*="send"]:not(.disabled)',
      'button[type="submit"]',
    ],
    responseSelectors: [
      '.response-message-content',
      '.custom-qwen-markdown',
      '.qwen-markdown',
      '.qwen-chat-message-assistant',
    ],
    generatingSelectors: [
      '[class*="qwen"][class*="loading"]',
      '[class*="qwen"][class*="streaming"]',
      '[class*="qwen"][class*="generating"]',
      'button.stop-btn',
    ],
    thinkingSelectors: [
      '.qwen-chat-thinking-tool-status-card-wraper',
      '.qwen-chat-tool-status-card',
      '[class*="thinking"]',
    ],
    enterToSend: true,
    // Model switching via dropdown picker
    models: {
      default: { label: 'Qwen-Max', isDefault: true },
      qwq: {
        label: 'QwQ-32B',
        pickerSelectors: [
          '[class*="model-select"]',
          '[class*="model-picker"]',
          '[class*="model-selector"]',
          'button[class*="model"]',
          '[data-testid="model-selector"]',
          '[class*="ModelSelector"]',
        ],
        optionSelectors: [
          '[data-model-id*="qwq"]',
          '[data-value*="qwq"]',
          '[data-model*="qwq"]',
        ],
        optionText: 'QwQ',
      },
      coder: {
        label: 'Qwen-Coder',
        pickerSelectors: [
          '[class*="model-select"]',
          '[class*="model-picker"]',
          '[class*="model-selector"]',
          'button[class*="model"]',
          '[data-testid="model-selector"]',
        ],
        optionSelectors: [
          '[data-model-id*="coder"]',
          '[data-value*="coder"]',
          '[data-model*="coder"]',
        ],
        optionText: 'Coder',
      },
    },
  },

  yandexgpt: {
    name: 'YandexGPT',
    url: 'https://ya.ru/ai/gpt',
    inputSelectors: [
      'textarea[placeholder]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendSelectors: [
      'button[type="submit"]',
      'button[aria-label*="send" i]',
      'button[aria-label*="отправить" i]',
    ],
    responseSelectors: [
      '[class*="message"][class*="assistant"]',
      '[class*="response"]',
      '[class*="answer"]',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="typing"]',
      '[class*="generating"]',
    ],
    thinkingSelectors: [],
    enterToSend: true,
  },

  mistral: {
    name: 'Mistral',
    url: 'https://chat.mistral.ai',
    inputSelectors: [
      'textarea[placeholder]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendSelectors: [
      'button[aria-label*="send" i]',
      'button[type="submit"]',
    ],
    responseSelectors: [
      '.markdown-container-style',
      '[class*="markdown-container"]',
      '[class*="break-words"] [class*="markdown"]',
    ],
    generatingSelectors: [
      '[class*="loading"]',
      '[class*="streaming"]',
      '[class*="typing"]',
    ],
    thinkingSelectors: [],
    enterToSend: true,
    // Model switching via dropdown
    models: {
      default: { label: 'Mistral Large', isDefault: true },
      codestral: {
        label: 'Codestral',
        pickerSelectors: [
          '[class*="model-selector"]',
          '[class*="ModelSelector"]',
          'button[class*="model"]',
          '[data-testid="model-selector"]',
          'select[name*="model"]',
        ],
        optionSelectors: [
          '[data-model*="codestral"]',
          '[value*="codestral"]',
          'option[value*="codestral"]',
        ],
        optionText: 'Codestral',
      },
    },
  },
};

// ============================================================
// CONTEXT LIMITS per LLM (messages, chars before forced new thread)
// ============================================================
const CONTEXT_LIMITS = {
  chatgpt:    { maxMessages: 20, maxChars: 40000 },  // context overflow causes slowdown
  grok:       { maxMessages: 15, maxChars: 30000 },  // known overflow issues
  deepseek:   { maxMessages: 30, maxChars: 60000 },  // web chat length limit
  gemini:     { maxMessages: 40, maxChars: 80000 },  // 1M token window, but web UI lags
  perplexity: { maxMessages: 15, maxChars: 25000 },  // context degrades noticeably
  claude:     { maxMessages: 40, maxChars: 80000 },  // large context window
  qwen:       { maxMessages: 25, maxChars: 50000 },  // slows down with large context
  mistral:    { maxMessages: 30, maxChars: 60000 },
  yandexgpt:  { maxMessages: 20, maxChars: 40000 },
};

// ============================================================
// THREAD MANAGER — remembers chat URLs per LLM
// ============================================================
// thread_id → { url, llm, created_at, messageCount, totalChars }
const threads = new Map();

function generateThreadId() {
  return Math.random().toString(36).slice(2, 10);
}

function isThreadOverLimit(threadId, llmKey) {
  if (!threads.has(threadId)) return false;
  const t = threads.get(threadId);
  const limits = CONTEXT_LIMITS[llmKey];
  if (!limits) return false;
  if (t.messageCount >= limits.maxMessages) {
    L.warn('context', `Thread ${threadId} hit message limit (${t.messageCount}/${limits.maxMessages}) for ${llmKey} — rotating`);
    return true;
  }
  if (t.totalChars >= limits.maxChars) {
    L.warn('context', `Thread ${threadId} hit char limit (${t.totalChars}/${limits.maxChars}) for ${llmKey} — rotating`);
    return true;
  }
  return false;
}

// ============================================================
// BROWSER MANAGER
// ============================================================
let browser = null;

async function connectBrowser() {
  if (browser && browser.isConnected()) {
    L.debug('browser', 'Already connected');
    return browser;
  }
  L.step('browser', `Connecting to Chromium at CDP port ${CDP_PORT}...`);
  browser = await puppeteer.connect({
    browserURL: `http://localhost:${CDP_PORT}`,
    defaultViewport: { width: 1280, height: 800 },
    protocolTimeout: 120000,  // 2 min — prevents dispatchMouseEvent timeout during long polls
  });
  L.info('browser', 'Connected to Chromium OK');
  return browser;
}

async function screenshot(page, label) {
  try {
    const file = path.join(SCREENSHOT_DIR, `${Date.now()}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    L.debug('screenshot', `Saved: ${file}`);
  } catch (e) {
    L.warn('screenshot', `Failed: ${e.message}`);
  }
}

// ============================================================
// LLM QUERY ENGINE
// ============================================================
// ============================================================
// MODEL SWITCHER — click model selector before sending message
// Falls back gracefully to default model if switch fails.
// ============================================================
async function switchToModel(page, adapter, modelKey) {
  if (!adapter.models || !modelKey || modelKey === 'default') return;
  const model = adapter.models[modelKey];
  if (!model || model.isDefault) return;

  L.info(adapter.name, `Switching to model: ${model.label}`);

  // Strategy A: toggle button (DeepSeek style — a toggle in the input toolbar)
  if (model.activateSelectors) {
    // Check if already active
    if (model.activeCheckSelectors) {
      for (const sel of model.activeCheckSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            L.info(adapter.name, `Already in ${model.label}`);
            return;
          }
        } catch (_) {}
      }
    }
    // Click toggle button
    for (const sel of model.activateSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await new Promise(r => setTimeout(r, 600));
          L.info(adapter.name, `Switched to ${model.label} via toggle`);
          return;
        }
      } catch (_) {}
    }
    // Text-based fallback
    if (model.activateText) {
      const found = await page.evaluate((text) => {
        const btns = [...document.querySelectorAll('button, div[role="button"], label')];
        const match = btns.find(el => el.textContent.trim().includes(text));
        if (match) { match.click(); return true; }
        return false;
      }, model.activateText).catch(() => false);
      if (found) {
        await new Promise(r => setTimeout(r, 600));
        L.info(adapter.name, `Switched to ${model.label} by text match`);
        return;
      }
    }
  }

  // Strategy B: dropdown picker (Qwen, Mistral style)
  if (model.pickerSelectors) {
    let pickerOpened = false;
    for (const sel of model.pickerSelectors) {
      try {
        const picker = await page.$(sel);
        if (picker) {
          await picker.click();
          await new Promise(r => setTimeout(r, 600));
          pickerOpened = true;
          break;
        }
      } catch (_) {}
    }
    if (pickerOpened) {
      // Try selector-based option
      if (model.optionSelectors) {
        for (const optSel of model.optionSelectors) {
          try {
            const opt = await page.$(optSel);
            if (opt) {
              await opt.click();
              await new Promise(r => setTimeout(r, 500));
              L.info(adapter.name, `Switched to ${model.label} via picker`);
              return;
            }
          } catch (_) {}
        }
      }
      // Text-based option fallback
      if (model.optionText) {
        const found = await page.evaluate((text) => {
          const items = [...document.querySelectorAll(
            'li, [role="option"], [role="menuitem"], div[class*="option"], div[class*="item"]'
          )];
          const match = items.find(el => el.textContent.includes(text));
          if (match) { match.click(); return true; }
          return false;
        }, model.optionText).catch(() => false);
        if (found) {
          await new Promise(r => setTimeout(r, 500));
          L.info(adapter.name, `Switched to ${model.label} by text option`);
          return;
        }
      }
    }
  }

  L.warn(adapter.name, `Could not switch to ${model.label} — using default model`);
}


async function queryLLM(llmKey, message, threadId = null, newThread = false, modelKey = null) {
  const adapter = ADAPTERS[llmKey];
  if (!adapter) throw new Error(`Unknown LLM: ${llmKey}`);

  L.info(adapter.name, `Starting query: "${message.slice(0, 60)}..." thread=${threadId || 'new'}`);
  const b = await connectBrowser();
  const page = await b.newPage();

  // Set realistic User-Agent
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
  );

  // Log all console messages from page
  page.on('console', msg => L.debug(adapter.name + ':console', msg.type(), msg.text().slice(0, 200)));
  page.on('pageerror', err => L.warn(adapter.name + ':pageerror', err.message.slice(0, 200)));

  try {
    // Auto-rotate thread if context limit exceeded
    if (threadId && !newThread && isThreadOverLimit(threadId, llmKey)) {
      L.warn(adapter.name, `Context limit reached for thread ${threadId} — starting fresh thread`);
      newThread = true;
      threadId = null;
    }

    // Determine URL: existing thread, new thread, or default
    let targetUrl = adapter.url;
    if (!newThread && threadId && threads.has(threadId)) {
      targetUrl = threads.get(threadId).url;
      L.info(adapter.name, `Continuing thread ${threadId} at ${targetUrl}`);
    } else if (newThread && adapter.newChatUrl) {
      targetUrl = adapter.newChatUrl;
      L.info(adapter.name, `Starting new chat at ${targetUrl}`);
    }

    L.step(adapter.name, `Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const finalUrl = page.url();
    const pageTitle = await page.title();
    L.info(adapter.name, `Page loaded — URL: ${finalUrl} | Title: ${pageTitle}`);
    await screenshot(page, `${llmKey}-loaded`);

    // Check for login redirect
    if (finalUrl.includes('sign_in') || finalUrl.includes('login') || finalUrl.includes('auth')) {
      L.warn(adapter.name, `Login page detected! URL: ${finalUrl}`);
      await screenshot(page, `${llmKey}-login-required`);
      throw new Error(`[${adapter.name}] Not logged in — redirected to ${finalUrl}`);
    }

    // Human: brief idle after page load (simulates reading)
    await humanIdle(page, rnd(1500, 3000));

    // Cookie consent auto-dismiss (before WAF check)
    await dismissCookieConsent(page, adapter.name);

    // WAF challenge check
    const wafHandled = await handleWAFChallenge(page);
    if (wafHandled) {
      L.info(adapter.name, 'WAF challenge handled, waiting 3s...');
      await sleep(3000);
    }

    // Switch to requested model (if specified)
    if (modelKey) {
      await switchToModel(page, adapter, modelKey).catch(e =>
        L.warn(adapter.name, `Model switch failed: ${e.message}`)
      );
    }

    // Dump page structure for debugging
    const inputsFound = await page.evaluate(() => {
      const els = [
        ...document.querySelectorAll('textarea'),
        ...document.querySelectorAll('[contenteditable="true"]'),
        ...document.querySelectorAll('input[type="text"]'),
      ];
      return els.map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className.slice(0, 80),
        placeholder: el.getAttribute('placeholder') || '',
        visible: !!(el.offsetParent),
      })).slice(0, 10);
    });
    L.debug(adapter.name, `Input elements found on page:`, inputsFound);

    // Wait for input to appear
    L.step(adapter.name, `Looking for input field with ${adapter.inputSelectors.length} selectors...`);
    const found = await findElement(page, adapter.inputSelectors, 15000);
    if (!found) {
      await screenshot(page, `${llmKey}-no-input`);
      throw new Error(`[${adapter.name}] Input field not found`);
    }
    const { el: inputEl, sel: inputSel } = found;
    L.info(adapter.name, `Input field found: ${inputSel}`);
    await screenshot(page, `${llmKey}-input-found`);

    // Human: click input with bezier mouse approach
    L.step(adapter.name, `Human-click on input (${inputSel})`);
    const inputBox = await inputEl.boundingBox();
    if (inputBox) {
      const tx = inputBox.x + inputBox.width * rndFloat(0.3, 0.7);
      const ty = inputBox.y + inputBox.height * rndFloat(0.3, 0.7);
      await humanMouseMove(page, tx, ty).catch(() => {});
      await humanSleep(rnd(50, 150));
      await page.mouse.click(tx, ty, { delay: rnd(40, 100) }).catch(() => {});
      await humanSleep(rnd(100, 250));
    } else {
      await inputEl.click();
    }

    // Human: type with realistic speed and occasional typos
    L.step(adapter.name, `Human-typing message (${message.length} chars)`);
    await humanType(page, message, {
      typoRate: 0.035,
      minDelay: 35,
      maxDelay: 170,
      burstChars: 6,
      burstPause: 380,
    });
    await sleep(rnd(300, 700));
    await screenshot(page, `${llmKey}-typed`);

    // Send
    if (adapter.enterToSend) {
      L.step(adapter.name, 'Sending via Enter key');
      await page.keyboard.press('Enter');
    } else {
      L.step(adapter.name, 'Looking for send button...');
      const sendFound = await findElement(page, adapter.sendSelectors, 5000);
      if (sendFound) {
        const { el: sendBtn, sel: sendSel } = sendFound;
        L.info(adapter.name, `Send button found: ${sendSel}, clicking`);
        await sendBtn.click();
      } else {
        L.warn(adapter.name, 'Send button not found, fallback to Enter');
        await page.keyboard.press('Enter');
      }
    }
    await screenshot(page, `${llmKey}-sent`);

    L.info(adapter.name, 'Message sent, waiting for response...');

    // Poll for response
    const response = await pollForResponse(page, adapter, llmKey, message);
    L.info(adapter.name, `Response received (${response.length} chars): "${response.slice(0, 100)}..."`);
    await screenshot(page, `${llmKey}-response`);

    // Save current URL as thread, track context usage
    const currentUrl = page.url();
    const tid = threadId || generateThreadId();
    const existing = threads.get(tid) || { messageCount: 0, totalChars: 0 };
    threads.set(tid, {
      url: currentUrl,
      llm: llmKey,
      created_at: existing.created_at || Date.now(),
      messageCount: existing.messageCount + 1,
      totalChars: existing.totalChars + message.length + response.length,
    });
    const tInfo = threads.get(tid);
    L.info(adapter.name, `Thread saved: ${tid} → msgs=${tInfo.messageCount}, chars=${tInfo.totalChars}`);

    // Build display name: "DeepSeek R1", "Qwen-Coder", etc.
    const modelInfo = modelKey && adapter.models && adapter.models[modelKey];
    const displayName = modelInfo && !modelInfo.isDefault
      ? `${adapter.name} (${modelInfo.label.replace(adapter.name, '').trim() || modelKey})`
      : adapter.name;
    health.trackSuccess(llmKey);
    return { llm: displayName, text: response, thread_id: tid };

  } catch (e) {
    L.error(adapter.name, `Query failed: ${e.message}`);
    await screenshot(page, `${llmKey}-error`).catch(() => {});
    // Track failure + detect known patterns
    const curUrl = (() => { try { return page.url(); } catch(_) { return ''; } })();
    const { newlyDisabled, pattern } = health.trackFailure(llmKey, e.message, curUrl);
    if (newlyDisabled && pattern) {
      const autoStr = pattern.manual
        ? 'Нужно ручное восстановление.'
        : `Авто-восстановление через ${Math.round(pattern.disableMs/60000)} мин.`;
      const msg = `⚠️ Великий Мудрец: ${adapter.name} отключён
Причина: ${pattern.reason}
Статус: ${pattern.label}
${autoStr}`;
      health.sendVKNotify(msg, `disable_${llmKey}`);
      L.warn(adapter.name, `DISABLED: ${pattern.label} — ${pattern.reason}`);
    }
    throw e;
  } finally {
    await page.close().catch(() => {});
    L.debug(adapter.name, 'Tab closed');
  }
}

// ============================================================
// COOKIE CONSENT HANDLER — dismiss GDPR/cookie banners
// ============================================================
async function dismissCookieConsent(page, name = '') {
  // First try Escape to close any modal
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);

  // Close X buttons on modals/dialogs
  const closeClicked = await page.evaluate(() => {
    const closeSelectors = [
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      'button[aria-label="Dismiss"]', '[data-testid="close-button"]',
      'button.close', '[class*="modal"] button[class*="close"]',
      '[class*="dialog"] button[class*="close"]',
      'button[class*="CloseButton"]', 'button[class*="closeButton"]',
    ];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent) { el.click(); return true; }
    }
    // Also try X buttons (svg close icons in visible modals)
    const xBtns = [...document.querySelectorAll('button')].filter(b => {
      const t = (b.innerText || b.textContent || '').trim();
      return t === '×' || t === '✕' || t === '✗' || t === 'X';
    });
    if (xBtns[0] && xBtns[0].offsetParent) { xBtns[0].click(); return true; }
    return false;
  });
  if (closeClicked) { await sleep(500); }

  const acceptSelectors = [
    'button[id*="accept"]',
    'button[class*="accept"]',
    'button[aria-label*="accept" i]',
    'button[aria-label*="Accept" i]',
    '[data-testid*="accept"]',
    'button:not([disabled])[class*="cookie"]',
  ];
  const acceptTexts = ['accept all', 'accept all cookies', 'agree', 'i agree', 'allow all', 'ok', 'got it'];

  try {
    // Try selector-based accept
    for (const sel of acceptSelectors) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        const txt = (await el.evaluate(e => e.innerText || '').catch(() => '')).toLowerCase().trim();
        if (acceptTexts.some(t => txt.includes(t))) {
          L.info(name || 'cookie', `Dismissing cookie consent: "${txt}"`);
          await el.click().catch(() => {});
          await sleep(800);
          return true;
        }
      }
    }

    // Text-based search
    const clicked = await page.evaluate((texts) => {
      const buttons = [...document.querySelectorAll('button, [role="button"], a')];
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').toLowerCase().trim();
        if (texts.some(t => txt.includes(t))) {
          btn.click();
          return txt;
        }
      }
      return null;
    }, acceptTexts);

    if (clicked) {
      L.info(name || 'cookie', `Cookie consent dismissed via text match: "${clicked}"`);
      await sleep(800);
      return true;
    }
  } catch (e) {
    L.debug(name || 'cookie', `Cookie dismiss error: ${e.message}`);
  }
  return false;
}

// Returns { el, sel } or null
async function findElement(page, selectors, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let attempt = 0;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isVisible().catch(() => true);
          if (visible) {
            L.debug('findElement', `Found "${sel}" (attempt ${attempt})`);
            return { el, sel };
          }
        }
      } catch (_) {}
    }
    attempt++;
    if (attempt % 5 === 0) {
      L.debug('findElement', `Still searching... attempt ${attempt}, selectors: ${selectors.slice(0, 3).join(', ')}`);
    }
    await sleep(300);
  }
  L.warn('findElement', `Not found after ${attempt} attempts. Selectors tried: ${selectors.join(', ')}`);
  return null;
}

// ============================================================
// DOM SNAPSHOT — get full visible text of the page body
// ============================================================
async function getPageText(page) {
  return page.evaluate(() => {
    // Remove script/style/noscript noise
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg').forEach(el => el.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  });
}

// ============================================================
// LAST MESSAGE PARSER — find the last message block on page
// and compare with our query to confirm it's a response
// ============================================================
async function extractLastResponse(page, sentMessage, thinkingSelectors = [], responseSelectors = []) {
  return page.evaluate((sentMsg, tSels, rSels) => {
    // Remove thinking blocks first
    const clone = document.body.cloneNode(true);
    tSels.forEach(sel => clone.querySelectorAll(sel).forEach(el => el.remove()));
    clone.querySelectorAll('script,style,noscript,svg').forEach(el => el.remove());

    const sentNorm = sentMsg.trim().toLowerCase().slice(0, 100);
    const WAF_PATTERNS = ['one more step', 'checking your browser', 'cloudflare', 'please wait'];

    const UI_NOISE = [
      'ai-generated', 'for reference only', 'message deepseek', 'new chat', 'deepthink', 'start chatting',
      'le chat can make mistakes', 'check answers. learn more',  // Mistral footer
      'press and hold to scan', 'scan the qr code',             // Qwen mobile banner
      'reject all', 'accept all cookies', 'cookie settings',    // Cookie consent
      // 'high demand' intentionally NOT filtered — treated as error below
      'try supergrok',                                           // Grok upsell
      'upgrade to pro', 'upgrade your plan',                    // Upsell banners
      'ai-generated content may not be accurate',               // Qwen footer
      'download app', 'designed for mobile',                    // Qwen mobile banner
      'thinking completed',                                     // Qwen thinking status
      "incognito chats aren't saved", 'used to train models',   // Claude incognito footer
      'reply...', 'how can i help',                             // Claude/Qwen UI placeholders
      'guide computer as it works', 'upgrade your plan to use', // Perplexity upsell modal
      'computer deploys subagents', 'sit back while it browses',// Perplexity Computer modal
      'got it', 'opt out', 'cookie policy',                     // Cookie banners
      'ask a follow-up', 'free preview of advanced search',     // Perplexity UI chrome
      'answer\nlinks\nimages', 'links\nimages',                  // Perplexity tabs
      'send me a morning briefing', 'morning briefing on a topic', // Perplexity suggestion chips
      'plan a trip with full itinerary', 'plan a trip',          // Perplexity suggestion chips
      'want to be notified when claude responds', 'notify me',   // Claude notification prompt
      'профессиональный дилетант',                               // Qwen username shown in UI
      'мотивационный телеграмм бот',                             // Qwen suggested prompts
      'model\ndefault', 'default\nmodel',                        // Qwen model selector text
    ];
    function isGood(t) {
      if (t.length < 20) return false;
      const tl = t.toLowerCase();
      if (tl.startsWith(sentNorm.slice(0, 50))) return false;
      if (WAF_PATTERNS.some(p => tl.includes(p))) return false;
      if (UI_NOISE.some(p => tl.includes(p))) return false;
      return true;
    }

    // 1. Try adapter-specific response selectors first (most precise)
    // Only use the MOST specific selectors (first 2) to avoid wide matches
    for (const sel of rSels.slice(0, 2)) {
      const els = clone.querySelectorAll(sel);
      if (els.length > 0) {
        // Take last match (most recent response)
        for (let i = els.length - 1; i >= 0; i--) {
          const t = (els[i].innerText || els[i].textContent || '').trim();
          if (!t) continue;
          const tl = t.toLowerCase();
          if (WAF_PATTERNS.some(p => tl.includes(p))) continue;
          if (UI_NOISE.some(p => tl.includes(p))) continue;
          // Skip if candidate IS or CONTAINS our sent message (not a response)
          if (tl.includes(sentNorm.slice(0, 40))) continue;
          return t;
        }
      }
    }

    // 2. Fallback: scan all meaningful blocks
    const blocks = Array.from(clone.querySelectorAll(
      'p, div, article, section, [class*="message"], [class*="response"], [class*="assistant"], [class*="answer"], [class*="markdown"], [class*="prose"], [class*="content"]'
    ));
    const candidates = blocks
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(isGood);

    if (candidates.length === 0) return '';
    return candidates[candidates.length - 1];
  }, sentMessage, thinkingSelectors, responseSelectors);
}

// ============================================================
// POLL FOR RESPONSE — DOM change detection (5s intervals, 2 stable = done)
// ============================================================
async function pollForResponse(page, adapter, llmKey, sentMessage) {
  const deadline = Date.now() + REQUEST_TIMEOUT;
  const CHECK_INTERVAL = 5000; // 5 seconds per period
  const STABLE_PERIODS = 2;    // 2 consecutive stable periods = done

  let stableCount = 0;
  let lastSnapshot = '';
  let pollNum = 0;
  let firstResponseSeen = false;
  let lastIdleAt = Date.now();
  let nextIdleIn = rnd(12000, 25000); // random first idle threshold (12-25s)

  // Wait for generation to start (LLM needs a moment to begin)
  L.step(adapter.name, 'Waiting 3s for generation to start...');
  await sleep(3000);

  // Capture baseline snapshot right after sending
  lastSnapshot = await getPageText(page);
  L.debug(adapter.name, `Baseline snapshot: ${lastSnapshot.length} chars`);

  while (Date.now() < deadline) {
    await sleep(CHECK_INTERVAL);
    pollNum++;

    // Check if WAF appeared after message send (can be triggered by submission)
    if (pollNum <= 4) {
      const wafHandledMid = await handleWAFChallenge(page).catch(() => false);
      if (wafHandledMid) {
        L.info(adapter.name, 'WAF appeared after send — handled, resetting stable counter');
        stableCount = 0;
        lastSnapshot = '';
        await sleep(2000);
        continue;
      }
    }

    // Human: micro mouse movement at randomized intervals while waiting
    if (Date.now() - lastIdleAt > nextIdleIn) {
      const vp = page.viewport() || { width: 1280, height: 800 };
      const action = rnd(0, 2);
      if (action === 0) {
        // Micro mouse wiggle
        await humanMouseMove(page,
          rnd(200, vp.width - 200),
          rnd(150, vp.height - 150),
          { steps: rnd(4, 12), delay: rnd(6, 18) }
        ).catch(() => {});
      } else if (action === 1) {
        // Scroll slightly (reader behavior)
        await page.mouse.wheel({ deltaY: rnd(-80, 80) }).catch(() => {});
      } else {
        // Move toward center
        await humanMouseMove(page,
          vp.width / 2 + rnd(-120, 120),
          vp.height / 2 + rnd(-80, 80),
          { steps: rnd(3, 8), delay: rnd(10, 22) }
        ).catch(() => {});
      }
      lastIdleAt = Date.now();
      nextIdleIn = rnd(10000, 28000); // random delay until next idle action
    }

    const elapsed = Math.round((Date.now() - (deadline - REQUEST_TIMEOUT)) / 1000);
    const currentSnapshot = await getPageText(page);
    const changed = currentSnapshot !== lastSnapshot;

    // Check if any generating/thinking selectors are still active (e.g. Qwen web-search)
    // Exclude elements that indicate a *completed* thinking/search state
    const allGenSels = [...(adapter.generatingSelectors || []), ...(adapter.thinkingSelectors || [])];
    const isGenerating = allGenSels.length > 0 && await page.evaluate((sels) => {
      const DONE_TEXTS = ['completed', 'done', 'завершено', 'finished'];
      return sels.some(s => {
        try {
          const el = document.querySelector(s);
          if (!el) return false;
          const t = (el.textContent || el.innerText || '').toLowerCase();
          // If element exists but contains "completed" text — it's done, not active
          if (DONE_TEXTS.some(d => t.includes(d))) return false;
          return true;
        } catch (_) { return false; }
      });
    }, allGenSels).catch(() => false);

    L.debug(adapter.name, `Period #${pollNum} (${elapsed}s): changed=${changed}, generating=${isGenerating}, snapshot=${currentSnapshot.length}chars, stable=${stableCount}/${STABLE_PERIODS}`);

    if (changed || isGenerating) {
      // Page changed or generating indicator active — still in progress
      stableCount = 0;
      if (changed) { lastSnapshot = currentSnapshot; firstResponseSeen = true; }
      if (isGenerating) firstResponseSeen = true;
      L.debug(adapter.name, changed ? `Page still changing` : `Generating indicator active — waiting`);
    } else {
      // No change this period
      if (firstResponseSeen || pollNum >= 2) {
        // Only count stable periods after we've seen at least some response activity
        stableCount++;
        L.info(adapter.name, `Stable period ${stableCount}/${STABLE_PERIODS} — no changes detected`);

        if (stableCount >= STABLE_PERIODS) {
          // Page stable for 2×5s = 10s — parse the response
          L.info(adapter.name, `Page stable for ${STABLE_PERIODS * CHECK_INTERVAL / 1000}s — extracting response`);

          // Take screenshot before parsing
          await screenshot(page, `${llmKey}-stable`);

          // Extract last response message
          const response = await extractLastResponse(page, sentMessage, adapter.thinkingSelectors || [], adapter.responseSelectors || []);

          if (response && response.length >= MIN_TEXT_LEN) {
            // Verify it's not our own message
            const sentNorm = sentMessage.trim().toLowerCase().slice(0, 80);
            const respNorm = response.trim().toLowerCase().slice(0, 80);
            if (respNorm === sentNorm) {
              L.warn(adapter.name, 'Last block matches our query — waiting more...');
              stableCount = 0;
              continue;
            }

            // Detect service-side errors (rate limits, capacity issues)
            const respLow = response.toLowerCase();
            if (respLow.includes('high demand') || respLow.includes('try again later') ||
                respLow.includes('rate limit') || respLow.includes('too many requests')) {
              throw new Error(`[${adapter.name}] Service unavailable: ${response.slice(0, 100)}`);
            }

            L.info(adapter.name, `Response extracted: "${response.slice(0, 120)}"`);
            const postProc = adapter.postProcess;
            return postProc ? postProc(response) : response;
          } else {
            L.warn(adapter.name, `Response too short (${response?.length || 0} chars) — waiting more...`);
            stableCount = 0;
          }
        }
      } else {
        L.debug(adapter.name, `Stable but haven't seen activity yet — waiting`);
      }
    }

    // Periodic screenshot every 4 periods
    if (pollNum % 4 === 0) {
      await screenshot(page, `${llmKey}-poll${pollNum}`);
    }
  }

  // Timeout — try to return whatever is on the page
  L.warn(adapter.name, `Timeout after ${pollNum} periods — attempting final extraction`);
  const fallback = await extractLastResponse(page, sentMessage, adapter.thinkingSelectors || [], adapter.responseSelectors || []);
  if (fallback && fallback.length > 0) {
    L.warn(adapter.name, `Returning fallback response (${fallback.length} chars)`);
    return fallback;
  }
  throw new Error(`[${adapter.name}] Timeout: no response detected`);
}

async function extractText(page, responseSelectors, thinkingSelectors = []) {
  return page.evaluate((rSels, tSels) => {
    // Find last assistant response block
    let responseEl = null;
    for (const sel of rSels) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        responseEl = els[els.length - 1];
        break;
      }
    }
    if (!responseEl) return '';

    // Remove thinking blocks
    const clone = responseEl.cloneNode(true);
    for (const sel of tSels) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    return (clone.innerText || clone.textContent || '').trim();
  }, responseSelectors, thinkingSelectors);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// HTTP SERVER
// ============================================================
const server = http.createServer(async (req, res) => {
  L.info('http', `${req.method} ${req.url}`);
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: 'ok',
      llms: Object.keys(ADAPTERS),
      chromium: browser?.isConnected() ? 'connected' : 'disconnected',
    }));
  }

  if (req.method === 'GET' && req.url === '/llms') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      llms: Object.entries(ADAPTERS).map(([k, v]) => ({ id: k, name: v.name, url: v.url }))
    }));
  }

  if (req.method === 'POST' && req.url === '/query') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { llm, message, thread_id, new_thread } = JSON.parse(body);
        if (!llm || !message) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'llm and message required' }));
        }
        const result = await queryLLM(llm, message, thread_id || null, !!new_thread);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[bridge] Error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Multi-query: ask multiple LLMs at once
  if (req.method === 'POST' && req.url === '/query-all') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { llms, message } = JSON.parse(body);
        if (!llms || !message) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'llms[] and message required' }));
        }
        // Parse "llm:model" format — e.g. "deepseek:r1", "qwen:coder", "deepseek" (default)
        const specs = llms.map(spec => {
          const [llmKey, modelKey = null] = spec.split(':');
          return { spec, llmKey, modelKey };
        });
        // Filter disabled LLMs before running
        const enabledSpecs = specs.filter(({llmKey}) => {
          if (health.isDisabled(llmKey)) {
            L.warn('health', );
            return false;
          }
          return true;
        });
        if (enabledSpecs.length === 0) {
          res.writeHead(200);
          return res.end(JSON.stringify({ responses: specs.map(s => ({llm:s.spec, error:'LLM temporarily disabled'})), warning: 'All requested LLMs are disabled' }));
        }
        // Run with concurrency limit (max QUERY_CONCURRENCY parallel tabs)
        const results = await pLimit(
          specs.map(({ llmKey, modelKey }) => () => queryLLM(llmKey, message, null, false, modelKey)),
          QUERY_CONCURRENCY
        );
        // Merge results: enabled specs get actual results, disabled specs get error
        const resultMap = new Map(enabledSpecs.map((s, i) => [s.spec, results[i]]));
        const responses = specs.map(s => {
          if (!resultMap.has(s.spec)) return { llm: s.spec, error: 'disabled: ' + (health.getStatus()[s.llmKey]?.reason || 'unknown') };
          const r = resultMap.get(s.spec);
          return { llm: s.spec, ...(r.status === 'fulfilled' ? r.value : { error: r.reason.message }) };
        });
        res.writeHead(200);
        res.end(JSON.stringify({ responses }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // LLM health status
  if (req.method === 'GET' && req.url === '/llm-status') {
    res.writeHead(200);
    return res.end(JSON.stringify(health.getStatus()));
  }

  // Manual LLM re-enable: POST /llm-reset  body: {llm:'chatgpt'}
  if (req.method === 'POST' && req.url === '/llm-reset') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { llm } = JSON.parse(body);
        if (!llm) { res.writeHead(400); return res.end(JSON.stringify({error:'llm required'})); }
        health.resetLLM(llm);
        L.info('health', 'Manual reset: ' + llm + ' re-enabled');
        health.sendVKNotify('✅ Великий Мудрец: ' + llm + ' восстановлен вручную', 'reset_' + llm);
        res.writeHead(200); res.end(JSON.stringify({ok:true,llm}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  L.info('startup', `Browser LLM Bridge v1.1 listening on port ${BRIDGE_PORT}`);
  L.info('startup', `Available LLMs: ${Object.keys(ADAPTERS).join(', ')}`);
  L.info('startup', `Log file: ${LOG_FILE}`);
  L.info('startup', `Screenshots: ${SCREENSHOT_DIR}`);
  // Pre-connect to browser
  connectBrowser().catch(e => L.warn('startup', `Pre-connect failed: ${e.message}`));
});
