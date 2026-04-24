#!/usr/bin/env node
// === Sage Report Generator ===
// Generates beautiful reports from sage.db session data
// Usage:
//   node report-generator.js chart   <session_id> <db_path> <out_dir>
//   node report-generator.js html    <session_id> <db_path> <out_dir>
//   node report-generator.js pdf     <session_id> <db_path> <out_dir>
//   node report-generator.js mermaid <session_id> <db_path> <out_dir>
//   node report-generator.js all     <session_id> <db_path> <out_dir>
// Prints REPORT_FILE:<path> for each generated file

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ── DB access (sync, sqlite3 not installed — use sqlite3 CLI) ─────────────────

function dbQuery(dbPath, sql) {
  const res = spawnSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  if (res.error) throw new Error(`sqlite3 not found: ${res.error.message}`);
  if (!res.stdout.trim()) return [];
  return JSON.parse(res.stdout);
}

function loadSession(dbPath, sessionId) {
  const sessions = dbQuery(dbPath,
    `SELECT * FROM sessions WHERE id='${sessionId}' LIMIT 1`);
  if (!sessions.length) throw new Error(`Session ${sessionId} not found`);

  const messages = dbQuery(dbPath,
    `SELECT * FROM messages WHERE session_id='${sessionId}' ORDER BY id`);

  return { session: sessions[0], messages };
}

// ── Colour palette ─────────────────────────────────────────────────────────

const LLM_COLORS = {
  'DeepSeek':     '#4A90D9',
  'ChatGPT':      '#74AA9C',
  'Claude':       '#D97700',
  'Perplexity':   '#A855F7',
  'Mistral Chat': '#E8734A',
  'Qwen':         '#14B8A6',
  'default':      '#94A3B8',
};

function colorFor(name) {
  return LLM_COLORS[name] || LLM_COLORS.default;
}

// ── 1. Chart.js → PNG ─────────────────────────────────────────────────────

async function generateChart(session, messages, outDir) {
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

  // Count how many questions each LLM answered
  const counts = {};
  for (const m of messages) {
    const responses = JSON.parse(m.responses);
    for (const r of responses) {
      counts[r.llm] = (counts[r.llm] || 0) + 1;
    }
  }

  const llms   = Object.keys(counts);
  const values = llms.map(l => counts[l]);
  const colors = llms.map(l => colorFor(l));

  const canvas = new ChartJSNodeCanvas({ width: 900, height: 500, backgroundColour: '#1a1a2e' });

  const config = {
    type: 'bar',
    data: {
      labels: llms,
      datasets: [{
        label: 'Ответов дано',
        data: values,
        backgroundColor: colors,
        borderColor: colors.map(c => c + 'cc'),
        borderWidth: 2,
        borderRadius: 8,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `🧙 Великий Мудрец — участие ИИ`,
          color: '#e2e8f0',
          font: { size: 18, weight: 'bold' },
          padding: { bottom: 20 },
        },
        subtitle: {
          display: true,
          text: `Тема: ${session.title.slice(0, 60)}`,
          color: '#94a3b8',
          font: { size: 13 },
          padding: { bottom: 10 },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', stepSize: 1 },
          grid: { color: '#2d3748' },
        },
        x: {
          ticks: { color: '#e2e8f0', font: { size: 13 } },
          grid: { display: false },
        },
      },
    },
  };

  const buffer = await canvas.renderToBuffer(config);
  const fname  = path.join(outDir, `sage_${session.id}_chart.png`);
  fs.writeFileSync(fname, buffer);
  return fname;
}

// ── 2. Handlebars + Showdown → HTML ──────────────────────────────────────

function generateHtml(session, messages, outDir) {
  const Handlebars = require('handlebars');
  const Showdown   = require('showdown');
  const converter  = new Showdown.Converter({ tables: true, strikethrough: true });

  const template = Handlebars.compile(HTML_TEMPLATE);

  const msgData = messages.map((m, i) => {
    const responses = JSON.parse(m.responses);
    return {
      index:     i + 1,
      question:  m.question,
      date:      m.asked_at.slice(0, 16).replace('T', ' '),
      synthesis: converter.makeHtml(m.synthesis),
      responses: responses.map(r => ({
        llm:   r.llm,
        color: colorFor(r.llm),
        text:  converter.makeHtml(r.text),
      })),
    };
  });

  const html = template({
    title:     session.title,
    sessionId: session.id,
    created:   session.created_at.slice(0, 10),
    updated:   session.updated_at.slice(0, 10),
    total:     messages.length,
    messages:  msgData,
    year:      new Date().getFullYear(),
  });

  const fname = path.join(outDir, `sage_${session.id}_report.html`);
  fs.writeFileSync(fname, html, 'utf8');
  return fname;
}

// ── 3. HTML → PDF via md-to-pdf ──────────────────────────────────────────

function generatePdf(htmlFile, outDir, sessionId) {
  const pdfFile = path.join(outDir, `sage_${sessionId}_report.pdf`);
  // md-to-pdf can convert HTML files too
  const res = spawnSync('md-to-pdf', [htmlFile, '--pdf-options', '{"format":"A4","margin":{"top":"20mm","bottom":"20mm","left":"15mm","right":"15mm"}}'],
    { encoding: 'utf8', timeout: 60000 });
  if (res.status !== 0) {
    // fallback: try using chromium directly
    const chromeRes = spawnSync('chromium-browser', [
      '--headless', '--no-sandbox', '--disable-gpu',
      `--print-to-pdf=${pdfFile}`,
      `file://${htmlFile}`,
    ], { encoding: 'utf8', timeout: 30000 });
    if (chromeRes.status !== 0) throw new Error(`PDF generation failed: ${res.stderr}`);
  } else {
    // md-to-pdf outputs next to input with .pdf extension
    const mdPdfOut = htmlFile.replace(/\.[^.]+$/, '.pdf');
    if (fs.existsSync(mdPdfOut) && mdPdfOut !== pdfFile) {
      fs.renameSync(mdPdfOut, pdfFile);
    }
  }
  return pdfFile;
}

// ── 4. Mermaid → PNG ─────────────────────────────────────────────────────

function generateMermaid(session, messages, outDir) {
  // Build a pie chart of LLM participation
  const counts = {};
  for (const m of messages) {
    const responses = JSON.parse(m.responses);
    for (const r of responses) counts[r.llm] = (counts[r.llm] || 0) + 1;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const lines = Object.entries(counts)
    .map(([llm, cnt]) => `    "${llm}" : ${cnt}`);

  const mmd = [
    `%%{init: {'theme': 'dark', 'themeVariables': {'background': '#1a1a2e'}}}%%`,
    `pie title Участие ИИ в обсуждении (${total} ответов)`,
    ...lines,
  ].join('\n');

  const mmdFile = path.join(outDir, `sage_${session.id}_diagram.mmd`);
  const pngFile = path.join(outDir, `sage_${session.id}_diagram.png`);
  fs.writeFileSync(mmdFile, mmd, 'utf8');

  const puppCfgFile = path.join(outDir, `_puppeteer_cfg_${Date.now()}.json`);
  fs.writeFileSync(puppCfgFile, JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }));

  const res = spawnSync('mmdc', [
    '-i', mmdFile,
    '-o', pngFile,
    '-t', 'dark',
    '-b', '#1a1a2e',
    '--width', '900',
    '--height', '500',
    '--puppeteerConfigFile', puppCfgFile,
  ], { encoding: 'utf8', timeout: 30000 });

  fs.unlinkSync(mmdFile); // cleanup temp files
  try { fs.unlinkSync(puppCfgFile); } catch (_) {}

  if (res.status !== 0) throw new Error(`mmdc failed: ${res.stderr}`);
  return pngFile;
}

// ── HTML Template ─────────────────────────────────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🧙 Великий Мудрец — {{title}}</title>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface2: #273548;
    --border: #334155; --text: #e2e8f0; --muted: #94a3b8;
    --accent: #7c3aed; --accent2: #a78bfa;
    --success: #10b981; --warning: #f59e0b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.6; padding: 2rem; }
  .container { max-width: 1100px; margin: 0 auto; }

  /* Header */
  .header { background: linear-gradient(135deg, #1e1b4b, #312e81); border: 1px solid #4338ca; border-radius: 16px; padding: 2rem; margin-bottom: 2rem; }
  .header h1 { font-size: 2rem; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .header .meta { color: var(--muted); margin-top: 0.5rem; font-size: 0.9rem; }
  .header .stats { display: flex; gap: 1.5rem; margin-top: 1rem; }
  .stat-badge { background: rgba(124,58,237,0.2); border: 1px solid #7c3aed; border-radius: 8px; padding: 0.4rem 0.9rem; font-size: 0.85rem; color: var(--accent2); }

  /* Question block */
  .question-block { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 1.5rem; overflow: hidden; }
  .question-header { background: var(--surface2); padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 0.75rem; }
  .question-num { background: var(--accent); color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold; flex-shrink: 0; }
  .question-text { font-size: 1.05rem; font-weight: 600; color: var(--text); }
  .question-date { margin-left: auto; color: var(--muted); font-size: 0.82rem; white-space: nowrap; }
  .question-body { padding: 1.5rem; }

  /* LLM grid */
  .llm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .llm-card { background: var(--surface2); border-radius: 10px; padding: 1rem; border-left: 3px solid var(--llm-color, #7c3aed); }
  .llm-name { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--llm-color, var(--accent2)); margin-bottom: 0.6rem; }
  .llm-text { font-size: 0.88rem; color: var(--text); line-height: 1.5; }
  .llm-text p { margin-bottom: 0.4rem; }
  .llm-text p:last-child { margin-bottom: 0; }

  /* Synthesis */
  .synthesis { background: linear-gradient(135deg, rgba(124,58,237,0.08), rgba(59,130,246,0.08)); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; padding: 1.25rem; }
  .synthesis-label { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent2); margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem; }
  .synthesis-text { font-size: 0.92rem; color: var(--text); line-height: 1.6; }
  .synthesis-text p { margin-bottom: 0.5rem; }
  .synthesis-text strong { color: var(--accent2); }

  /* Markdown */
  .llm-text code, .synthesis-text code { background: rgba(255,255,255,0.08); padding: 0.1em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: monospace; }
  .llm-text a, .synthesis-text a { color: #60a5fa; }

  /* Footer */
  .footer { text-align: center; color: var(--muted); font-size: 0.8rem; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
</style>
</head>
<body>
<div class="container">

  <div class="header">
    <h1>🧙 Великий Мудрец</h1>
    <div class="meta">ID: {{sessionId}} · Создано: {{created}} · Обновлено: {{updated}}</div>
    <div style="font-size:1.1rem; margin-top:0.75rem; color:#c4b5fd;">{{title}}</div>
    <div class="stats">
      <span class="stat-badge">💬 {{total}} вопросов</span>
      <span class="stat-badge">🤖 6 ИИ-моделей</span>
    </div>
  </div>

  {{#each messages}}
  <div class="question-block">
    <div class="question-header">
      <div class="question-num">{{index}}</div>
      <div class="question-text">{{question}}</div>
      <div class="question-date">{{date}}</div>
    </div>
    <div class="question-body">
      <div class="llm-grid">
        {{#each responses}}
        <div class="llm-card" style="--llm-color: {{color}}">
          <div class="llm-name">{{llm}}</div>
          <div class="llm-text">{{{text}}}</div>
        </div>
        {{/each}}
      </div>
      <div class="synthesis">
        <div class="synthesis-label">🔮 Синтез Мудреца</div>
        <div class="synthesis-text">{{{synthesis}}}</div>
      </div>
    </div>
  </div>
  {{/each}}

  <div class="footer">
    🧙 Великий Мудрец · Сгенерировано {{year}} · 6 ИИ-моделей в консенсусе
  </div>

</div>
</body>
</html>`;

// ── Entry point ───────────────────────────────────────────────────────────

(async () => {
  const [,, command, sessionId, dbPath, outDir] = process.argv;

  if (!command || !sessionId || !dbPath || !outDir) {
    console.error('Usage: node report-generator.js <command> <session_id> <db_path> <out_dir>');
    console.error('Commands: chart | html | pdf | mermaid | all');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  let data;
  try {
    data = loadSession(dbPath, sessionId);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const { session, messages } = data;
  if (!messages.length) {
    console.error('❌ Нет сообщений в сессии.');
    process.exit(1);
  }

  const generated = [];

  try {
    if (command === 'chart' || command === 'all') {
      const f = await generateChart(session, messages, outDir);
      generated.push({ type: 'chart', file: f });
      console.log(`REPORT_FILE:${f}`);
      console.log(`📊 График: ${path.basename(f)}`);
    }
  } catch (e) { console.error(`⚠️ Chart: ${e.message}`); }

  try {
    if (command === 'mermaid' || command === 'all') {
      const f = generateMermaid(session, messages, outDir);
      generated.push({ type: 'mermaid', file: f });
      console.log(`REPORT_FILE:${f}`);
      console.log(`🔵 Диаграмма: ${path.basename(f)}`);
    }
  } catch (e) { console.error(`⚠️ Mermaid: ${e.message}`); }

  let htmlFile;
  try {
    if (command === 'html' || command === 'pdf' || command === 'all') {
      htmlFile = generateHtml(session, messages, outDir);
      generated.push({ type: 'html', file: htmlFile });
      console.log(`REPORT_FILE:${htmlFile}`);
      console.log(`📄 HTML: ${path.basename(htmlFile)}`);
    }
  } catch (e) { console.error(`⚠️ HTML: ${e.message}`); }

  try {
    if ((command === 'pdf' || command === 'all') && htmlFile) {
      const f = generatePdf(htmlFile, outDir, sessionId);
      generated.push({ type: 'pdf', file: f });
      console.log(`REPORT_FILE:${f}`);
      console.log(`📑 PDF: ${path.basename(f)}`);
    }
  } catch (e) { console.error(`⚠️ PDF: ${e.message}`); }

  if (generated.length === 0) {
    console.error('❌ Ни один файл не был сгенерирован.');
    process.exit(1);
  }

  console.log(`\n✅ Готово: ${generated.length} файл(ов) в ${outDir}`);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
