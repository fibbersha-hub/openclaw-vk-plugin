# OpenClaw VK Plugin

**AI-powered assistant bot for VK communities.**  
Query multiple LLMs, generate images, manage notes and reminders — all from VK messages.

> 🇷🇺 **Новичок? Читай сюда:** [docs/GUIDE_FOR_BEGINNERS.md](docs/GUIDE_FOR_BEGINNERS.md)  
> Полный гайд простым языком — что делает каждая функция, как получить ключи, как установить.  
> Опыт программирования не нужен.

---

## What it does

| Feature | Description |
|---------|-------------|
| 🤖 **VK Bot Core** | Receives messages, shows button menus, routes commands |
| 🔄 **LLM Proxy** | Rotates free Groq + OpenRouter API keys for uninterrupted AI access |
| 🌐 **Browser LLM Bridge** | Connects to 6 LLMs (ChatGPT, Claude, DeepSeek, Mistral, Perplexity, Qwen) via real browser — no paid API |
| 🧙 **Великий Мудрец** | Queries all LLMs in parallel, synthesizes consensus answer via Cerebras |
| 📝 **Personal Tools** | Notes, reminders, todos, daily digest — SQLite, no cloud |
| 🎨 **Image Generation** | Text-to-image via ModelsLab (100 free images/day) |
| 📊 **Reports** | Export discussions as TXT, Markdown table, HTML, Chart.js PNG, Mermaid diagrams |

---

## Architecture

```
VK User
  │
  ▼
VK Community Bot  ←── button-dispatcher.ts
  │
  ├── LLM Proxy (groq-proxy/)          ← Groq + OpenRouter key rotation
  │
  ├── Browser LLM Bridge               ← Puppeteer → ChatGPT/Claude/etc
  │     └── Великий Мудрец (sage.py)   ← multi-LLM consensus + reports
  │
  ├── Personal Tools (scripts/)         ← notes, reminders, todos
  │
  └── Image Gen (skills/image-gen/)     ← ModelsLab API
```

---

## Requirements

- Ubuntu 20.04+ / Debian 11+
- Node.js 18+
- Python 3.9+
- 1+ VK community token

Optional (per module):
- Groq API key (free) — for LLM Proxy
- OpenRouter API key (free) — for LLM Proxy
- Cerebras API key (free) — for Великий Мудрец
- ModelsLab API key (free) — for image generation
- Chromium + 2GB RAM per session — for Browser Bridge

---

## Quick Install

```bash
git clone https://github.com/your-username/openclaw-vk-plugin
cd openclaw-vk-plugin
sudo bash installer/install.sh
```

The installer will:
1. Check system dependencies (Node.js, Python, Chromium)
2. Ask which modules you want to install
3. Walk you through getting each required API key (with direct links)
4. Configure everything and start systemd services

---

## Module-by-module install

You can also install modules separately:

```bash
# Core VK bot only
sudo bash installer/modules/1_vk_bot.sh

# Add LLM proxy
sudo bash installer/modules/2_llm_proxy.sh

# Add browser LLM bridge
sudo bash installer/modules/3_browser_bridge.sh

# Add Великий Мудрец
sudo bash installer/modules/4_sage.sh

# Add personal tools (notes/reminders/todos)
sudo bash installer/modules/5_personal_tools.sh

# Add image generation
sudo bash installer/modules/6_image_gen.sh
```

---

## Configuration

All configuration is done via environment variables in `/opt/openclaw-vk-plugin/.env`.  
See [.env.example](.env.example) for the full list with descriptions.

**Minimum required:**
```env
VK_COMMUNITY_TOKEN=your_token
VK_COMMUNITY_ID=123456789
```

---

## Getting API Keys

| Service | Where to get | Free tier |
|---------|-------------|-----------|
| VK Community Token | [vk.com community settings → API](https://vk.com/editapp) | Free |
| Groq | [console.groq.com](https://console.groq.com) | 1 req/62s per key |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Free models available |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai) | Generous free tier |
| ModelsLab | [modelslab.com](https://modelslab.com) | 100 images/day |

Full guides: [docs/LLM_KEYS_GUIDE.md](docs/LLM_KEYS_GUIDE.md) · [docs/VK_TOKENS_GUIDE_RU.md](docs/VK_TOKENS_GUIDE_RU.md)

---

## Browser LLM Bridge — Setup

The bridge connects to LLM websites using a real Chromium browser.  
You need to log in to each service once:

```bash
# Start setup (opens Chromium windows for each LLM)
bash /opt/browser-bridge/setup-persistent-sessions.sh

# Log in to: ChatGPT, Claude, DeepSeek, Perplexity, Mistral, Qwen
# Sessions are saved — you only do this once

# Then start the bridge
systemctl start openclaw-bridge
```

> No API keys required for the browser bridge — it uses your logged-in sessions.

---

## Supported LLMs (Browser Bridge)

| LLM | URL | Notes |
|-----|-----|-------|
| ChatGPT | chat.openai.com | Free tier |
| Claude | claude.ai | Free tier |
| DeepSeek | chat.deepseek.com | Free |
| Perplexity | perplexity.ai | Free tier |
| Mistral | chat.mistral.ai | Free |
| Qwen | qwen.ai | Free |

---

## Великий Мудрец (Great Sage)

A unique feature: queries **all 6 LLMs simultaneously**, truncates responses to key extracts, then synthesizes a consensus answer via Cerebras in a single fast API call.

```
6 LLMs queried in parallel (browser, free)
     ↓ each response truncated to 400 chars
Cerebras llama3.1-8b synthesizes consensus
     ↓ ~700 tokens total, <2s
Final answer in VK chat
```

Sessions are saved to SQLite. You can:
- Return to previous discussions
- Archive sessions
- Export as TXT, Markdown table, HTML, or PNG charts

---

## Services

After installation, these systemd services run:

| Service | Purpose |
|---------|---------|
| `openclaw` | Main VK bot |
| `groq-proxy` | LLM key rotator (if installed) |
| `openclaw-bridge` | Browser LLM bridge (if installed) |

```bash
# Check status
systemctl status openclaw groq-proxy openclaw-bridge

# View logs
journalctl -u openclaw -f
journalctl -u groq-proxy -f
journalctl -u openclaw-bridge -f
```

---

## Project Structure

```
openclaw-vk-plugin/
├── src/                    # TypeScript VK bot core
├── browser-bridge/         # Puppeteer LLM bridge + Sage + reports
├── groq-proxy/             # LLM key rotation proxy
├── personas/               # AI role prompts (15 personas)
├── scripts/                # Personal tools (notes/reminders/todos)
├── skills/image-gen/       # Image generation
├── docs/                   # Documentation
├── installer/              # Installation scripts
│   ├── install.sh          # Interactive installer
│   └── modules/            # Per-module scripts
├── .env.example            # Configuration template
└── README.md
```

---

## License

MIT — see [LICENSE](LICENSE)
