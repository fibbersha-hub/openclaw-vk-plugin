// ============================================================================
// Multi-Provider LLM Key Rotator Proxy for OpenClaw
// Routes requests through optional SOCKS5 proxy (useful for geo-restricted regions)
// Pools: Groq (62s cooldown) + OpenRouter (90s cooldown)
//
// Configuration via environment variables (see .env.example):
//   GROQ_KEY_1 ... GROQ_KEY_N      — Groq API keys
//   OPENROUTER_KEY_1 ... _N        — OpenRouter API keys
//   SOCKS_PROXY                    — optional, e.g. socks5h://user:pass@host:port
// ============================================================================

import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

const PORT = parseInt(process.env.GROQ_PROXY_PORT || "8787");

// --- SOCKS5 Proxy (optional) ---
const SOCKS_PROXY = process.env.SOCKS_PROXY || "";
const socksAgent = SOCKS_PROXY ? new SocksProxyAgent(SOCKS_PROXY) : undefined;

// --- Load keys from environment ---
function loadKeys(prefix) {
  const keys = [];
  for (let i = 1; i <= 20; i++) {
    const k = process.env[`${prefix}_${i}`];
    if (k && k.trim()) keys.push(k.trim());
    else if (i > 1) break;
  }
  return keys;
}

const groqKeys = loadKeys("GROQ_KEY");
const openrouterKeys = loadKeys("OPENROUTER_KEY");

if (groqKeys.length === 0 && openrouterKeys.length === 0) {
  console.error("[LLM Rotator] ERROR: No API keys found. Set GROQ_KEY_1, OPENROUTER_KEY_1 etc. in .env");
  process.exit(1);
}

// --- Key Pools ---

const POOLS = [];

if (groqKeys.length > 0) {
  POOLS.push({
    name: "groq",
    host: "api.groq.com",
    pathPrefix: "/openai/v1",
    defaultModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    cooldownMs: 62_000,
    headers: {},
    keys: groqKeys,
  });
}

if (openrouterKeys.length > 0) {
  POOLS.push({
    name: "openrouter",
    host: "openrouter.ai",
    pathPrefix: "/api/v1",
    defaultModel: process.env.OPENROUTER_MODEL || "qwen/qwen3.6-plus:free",
    cooldownMs: 90_000,
    headers: {
      "http-referer": process.env.OPENROUTER_REFERER || "https://github.com/openclaw",
      "x-title": process.env.OPENROUTER_TITLE || "OpenClaw VK Bot",
    },
    keys: openrouterKeys,
  });
}

// --- State ---

const lastUsed = new Map(); // key → timestamp
let requestCount = 0;

function pickSlot() {
  const now = Date.now();
  for (const pool of POOLS) {
    for (const key of pool.keys) {
      const last = lastUsed.get(key) || 0;
      if (now - last >= pool.cooldownMs) {
        lastUsed.set(key, now);
        return { pool, key, waitMs: 0 };
      }
    }
  }
  let best = { pool: POOLS[0], key: POOLS[0].keys[0], waitMs: Infinity };
  for (const pool of POOLS) {
    for (const key of pool.keys) {
      const last = lastUsed.get(key) || 0;
      const wait = pool.cooldownMs - (now - last);
      if (wait < best.waitMs) {
        best = { pool, key, waitMs: wait };
      }
    }
  }
  return best;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyLabel(key) {
  return `...${key.slice(-6)}`;
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// --- Server ---

const server = http.createServer(async (req, res) => {
  // Health
  if (req.url === "/health") {
    const now = Date.now();
    const pools = POOLS.map((p) => ({
      name: p.name,
      host: p.host,
      model: p.defaultModel,
      cooldown_s: p.cooldownMs / 1000,
      keys: p.keys.map((k) => ({
        key: keyLabel(k),
        cooldown_remaining_s: Math.max(0, Math.round((p.cooldownMs - (now - (lastUsed.get(k) || 0))) / 1000)),
        available: now - (lastUsed.get(k) || 0) >= p.cooldownMs,
      })),
    }));
    const totalKeys = POOLS.reduce((s, p) => s + p.keys.length, 0);
    const avgCooldown = POOLS.reduce((s, p) => s + p.keys.length * p.cooldownMs, 0) / totalKeys;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      socks_proxy: SOCKS_PROXY ? SOCKS_PROXY.replace(/:[^:]*@/, ":***@") : "disabled",
      requests_served: requestCount,
      total_keys: totalKeys,
      est_throughput_rpm: Math.round(totalKeys * 60_000 / avgCooldown),
      pools,
    }, null, 2));
    return;
  }

  // Collect body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = Buffer.concat(chunks);

  // Pick key
  const slot = pickSlot();
  if (slot.waitMs > 0) {
    console.log(`[${ts()}] All keys cooling, waiting ${slot.waitMs}ms → ${slot.pool.name}:${keyLabel(slot.key)}`);
    await sleep(slot.waitMs);
    lastUsed.set(slot.key, Date.now());
  }

  const { pool, key } = slot;

  // Rewrite model in body + strip reasoning fields (Groq doesn't support them)
  if (req.url?.includes("/chat/completions") && body.length > 0) {
    try {
      const parsed = JSON.parse(body.toString());
      parsed.model = pool.defaultModel;
      if (parsed.messages) {
        for (const msg of parsed.messages) {
          delete msg.reasoning;
          delete msg.reasoning_content;
          delete msg.reasoning_details;
          delete msg.thinking;
        }
      }
      delete parsed.reasoning;
      delete parsed.thinking;
      body = Buffer.from(JSON.stringify(parsed));
    } catch {
      // not JSON
    }
  }

  requestCount++;
  console.log(`[${ts()}] #${requestCount} ${req.method} ${req.url} → ${pool.name}:${keyLabel(key)}${SOCKS_PROXY ? " via SOCKS5" : ""}`);

  // Build upstream path
  let upstreamPath = req.url || "/";
  if (upstreamPath.startsWith("/v1/")) {
    upstreamPath = pool.pathPrefix + upstreamPath.slice(3);
  } else if (upstreamPath.startsWith("/api/")) {
    upstreamPath = pool.pathPrefix + upstreamPath.slice(7);
  } else if (!upstreamPath.startsWith(pool.pathPrefix)) {
    upstreamPath = pool.pathPrefix + upstreamPath;
  }

  // Forward request (through SOCKS5 if configured, or direct)
  const options = {
    hostname: pool.host,
    port: 443,
    path: upstreamPath,
    method: req.method,
    ...(socksAgent ? { agent: socksAgent } : {}),
    headers: {
      "content-type": req.headers["content-type"] || "application/json",
      "authorization": `Bearer ${key}`,
      "content-length": body.length,
      ...pool.headers,
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);

    if (proxyRes.statusCode === 429) {
      console.log(`[${ts()}] ⚠ 429 on ${pool.name}:${keyLabel(key)}, doubling cooldown`);
      lastUsed.set(key, Date.now() + pool.cooldownMs);
    }
  });

  proxyReq.on("error", (err) => {
    console.error(`[${ts()}] Proxy error (${pool.name}): ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", provider: pool.name, message: err.message }));
  });

  if (body.length > 0) proxyReq.write(body);
  proxyReq.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[LLM Rotator] http://127.0.0.1:${PORT}`);
  if (SOCKS_PROXY) console.log(`[LLM Rotator] SOCKS5: ${SOCKS_PROXY.replace(/:[^:]*@/, ":***@")}`);
  for (const p of POOLS) {
    console.log(`  ${p.name}: ${p.keys.length} key(s), ${p.cooldownMs / 1000}s cooldown, model=${p.defaultModel}`);
  }
  const totalKeys = POOLS.reduce((s, p) => s + p.keys.length, 0);
  console.log(`  Total: ${totalKeys} keys, health: http://127.0.0.1:${PORT}/health`);
});
