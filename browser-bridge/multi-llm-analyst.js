#!/usr/bin/env node
// === Multi-LLM Analyst ===
// Step 1: Query all browser LLMs in parallel (free, no API tokens)
// Step 2: Truncate each response to key extract (~350 chars)
// Step 3: One Cerebras API call to synthesize → final answer
// Total API cost: ~700-1000 tokens (minimal)

'use strict';

const https = require('https');

const BRIDGE_URL = 'http://127.0.0.1:7788';
const CEREBRAS_KEY = process.env.CEREBRAS_KEY;
if (!CEREBRAS_KEY) { console.error('ERROR: CEREBRAS_KEY env var not set. Get free key at https://cloud.cerebras.ai'); process.exit(1); }
const CEREBRAS_MODEL = 'llama3.1-8b';
const MAX_CHARS_PER_RESPONSE = 400; // truncation limit per LLM (saves tokens)

// LLMs to query — Gemini blocked, Grok skipped (rate limit)
const ACTIVE_LLMS = ['deepseek', 'chatgpt', 'perplexity', 'claude', 'mistral', 'qwen'];
const SKIPPED_LLMS = {
  gemini:  'заблокирован в стране',
  grok:    'временно недоступен (rate limit)',
};

// ── Utils ──────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function truncate(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';
  // Try to cut at sentence boundary
  const cut = text.slice(0, maxChars);
  const lastDot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return lastDot > maxChars * 0.6 ? cut.slice(0, lastDot + 1) : cut + '…';
}

async function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname, search } = new URL(url);
    const req = require('http').request({
      hostname, port: port || 80,
      path: pathname + (search || ''),
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function cerebrasChat(messages, maxTokens = 600) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CEREBRAS_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
    });
    const req = https.request({
      hostname: 'api.cerebras.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CEREBRAS_KEY}`,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error(`Cerebras parse error: ${data.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ────────────────────────────────────────────────────────

(async () => {
  const QUESTION = 'Подскажи какая криптовалютная пара больше всего подходит по своему движению на евро-доллар (EUR/USD), и какая модель торговли больше всего подходит для этой пары? Дай конкретный ответ.';

  console.log('\n═══ MULTI-LLM ANALYST ═══');
  console.log(`Вопрос: ${QUESTION}`);
  console.log(`LLMs: ${ACTIVE_LLMS.join(', ')}`);
  console.log(`Пропущены: ${Object.entries(SKIPPED_LLMS).map(([k,v])=>`${k} (${v})`).join(', ')}`);
  console.log('─────────────────────────\n');

  // ── STEP 1: Query all browser LLMs in parallel ──
  console.log('▶ Шаг 1: Параллельный опрос LLM через браузер...');
  const startQuery = Date.now();

  let responses;
  try {
    const result = await fetchJson(`${BRIDGE_URL}/query-all`, {
      method: 'POST',
      body: { llms: ACTIVE_LLMS, message: QUESTION },
    });
    responses = result.responses || [];
  } catch (e) {
    console.error('Bridge error:', e.message);
    process.exit(1);
  }

  const queryTime = ((Date.now() - startQuery) / 1000).toFixed(1);
  console.log(`✓ Получено ответов: ${responses.length} за ${queryTime}s\n`);

  // ── STEP 2: Truncate and format responses ──
  console.log('▶ Шаг 2: Извлечение ключевых фрагментов...');

  const extracts = [];
  let totalOrigChars = 0;
  let totalExtractChars = 0;

  for (const r of responses) {
    if (r.error) {
      console.log(`  ${r.llm}: ❌ ${r.error.slice(0, 80)}`);
      continue;
    }
    const orig = r.text || '';
    const extract = truncate(orig, MAX_CHARS_PER_RESPONSE);
    totalOrigChars += orig.length;
    totalExtractChars += extract.length;
    extracts.push({ llm: r.llm || r.llms, text: extract });
    console.log(`  ${r.llm}: ${orig.length}→${extract.length} chars ✓`);
  }

  const savings = Math.round((1 - totalExtractChars / totalOrigChars) * 100);
  console.log(`\n  Всего: ${totalOrigChars} → ${totalExtractChars} chars (экономия ${savings}%)\n`);

  // ── STEP 3: One Cerebras call to synthesize ──
  console.log('▶ Шаг 3: Синтез через Cerebras API...');

  const llmBlock = extracts.map(e =>
    `### ${e.llm}:\n${e.text}`
  ).join('\n\n');

  const skippedBlock = Object.entries(SKIPPED_LLMS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const systemPrompt = `Ты — аналитик крипторынков. Тебе дали ответы ${extracts.length} разных LLM на один вопрос о трейдинге. Твоя задача:
1. Найти консенсус: какую криптопару называют чаще всего как аналог EUR/USD
2. Найти консенсус по торговой модели
3. Если есть расхождения — отметить их
4. Дать чёткий итоговый вывод (3-4 предложения)
Отвечай на русском. Будь конкретен.`;

  const userPrompt = `Вопрос: ${QUESTION}

Ответы LLM:

${llmBlock}

Не опросили (по техническим причинам):
${skippedBlock}

Дай итоговый синтез.`;

  const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3.5);
  console.log(`  Расчётный расход: ~${estimatedTokens} input tokens\n`);

  const startSynth = Date.now();
  let synthesis;
  try {
    synthesis = await cerebrasChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 600);
  } catch (e) {
    console.error('Cerebras error:', e.message);
    process.exit(1);
  }

  const synthTime = ((Date.now() - startSynth) / 1000).toFixed(1);
  console.log(`✓ Синтез получен за ${synthTime}s\n`);

  // ── OUTPUT ──
  console.log('═══ РЕЗУЛЬТАТЫ ПО LLM ═══\n');
  for (const e of extracts) {
    console.log(`┌─ ${e.llm} ─`);
    console.log(e.text);
    console.log('');
  }

  console.log('═══ ИТОГОВЫЙ АНАЛИЗ (Cerebras) ═══\n');
  console.log(synthesis);
  console.log('\n═══════════════════════════════════\n');
  console.log(`Время: опрос ${queryTime}s + синтез ${synthTime}s = ${(parseFloat(queryTime)+parseFloat(synthTime)).toFixed(1)}s`);
  console.log(`Токены Cerebras: ~${estimatedTokens} input + ~150 output`);

})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
