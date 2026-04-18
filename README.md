# OpenClaw VK (VKontakte) Channel Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-channel%20plugin-blueviolet)](https://github.com/openclaw/openclaw)
[![VK API](https://img.shields.io/badge/VK%20API-120%2B%20methods-blue)](https://dev.vk.com/reference)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-3178c6)](https://www.typescriptlang.org/)

Full VK (VKontakte) integration for [OpenClaw](https://github.com/openclaw/openclaw) — the open-source AI agent platform.

> **VK is Russia's largest social network** with 100M+ monthly active users. This plugin brings OpenClaw AI assistants to VK communities — messaging, shops, wall posts, and more.

**The most complete VK plugin for OpenClaw** with 120+ API methods, including messaging, wall posts, market/shop, media upload, stories, polls, statistics, and community management.

## Why This Plugin

| Feature | **This plugin** | Other VK plugins |
|---------|----------------|-----------------|
| VK API methods | **120+** | 3-10 |
| Wall posts | Yes | No |
| Market/Shop | Yes | No |
| Stories | Yes | No |
| Polls & Stats | Yes | No |
| `execute()` batching | Yes (25 calls/request) | No |
| Markdown formatting | Yes | Partial |
| Auto-keyboard from LLM | Yes | Partial |
| Inbound media (40+ MIME) | Yes | Partial |
| Per-group system prompts | Yes | Rare |
| Own API client (no vk-io) | Yes | No |

## Quick Start

### 1. Prepare VK Community

1. Go to your VK community **Manage > Settings > API usage**
2. Create an **Access Token** with permissions: `messages`, `photos`, `docs`, `wall`, `stories`, `manage`
3. Enable **Long Poll API** in community settings (API version 5.199)
4. Enable **Bot capabilities** in Messages settings

### 2. Install

```bash
# Clone the plugin
git clone https://github.com/anthropics-user/openclaw-vk-plugin.git /opt/openclaw-vk-plugin

# Install dependencies
cd /opt/openclaw-vk-plugin && npm install

# Build
npm run build
```

### 3. Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/opt/openclaw-vk-plugin"]
    },
    "entries": {
      "vk": {
        "enabled": true,
        "config": {
          "accounts": {
            "default": {
              "token": "vk1.a.YOUR_COMMUNITY_TOKEN",
              "groupId": "YOUR_GROUP_ID",
              "dmPolicy": "pairing",
              "allowFrom": ["YOUR_VK_USER_ID"]
            }
          }
        }
      }
    }
  },
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "vk1.a.YOUR_COMMUNITY_TOKEN",
          "groupId": "YOUR_GROUP_ID",
          "enabled": true,
          "dmPolicy": "allowlist",
          "allowFrom": ["YOUR_VK_USER_ID"]
        }
      }
    }
  }
}
```

### 4. Start

```bash
openclaw gateway run --verbose
```

The bot will connect via Long Poll and start responding to messages.

## Token & Key Setup

The plugin requires two credentials:

| Parameter | Description | Where to get |
|-----------|-------------|--------------|
| `token` | VK Community Access Token | Community → Manage → API usage → Create token |
| `groupId` | Numeric community ID | Community → Manage → API usage → Community ID field |

**Minimum required token scope:** `messages`

**Recommended scope:** `messages`, `photos`, `docs`, `wall`, `stories`, `market`, `manage`

**Verify your token is working:**
```bash
curl "https://api.vk.com/method/groups.getById?group_id=YOUR_GROUP_ID&access_token=YOUR_TOKEN&v=5.199"
```

Expected: `{"response": [{"id": 123456789, ...}]}`  
Error `error_code: 5` → invalid token, create a new one.  
Error `error_code: 7` → insufficient permissions, check token scopes.

> Full token setup guide: [docs/VK_TOKENS_GUIDE_EN.md](docs/VK_TOKENS_GUIDE_EN.md) · [RU](docs/VK_TOKENS_GUIDE_RU.md)

## Features

### Messaging
- Send/receive text messages (DM and group chats)
- Inline & standard keyboards (text, callback, link, VK Pay, Mini App, location)
- Carousel (template) messages
- Typing indicators
- Message chunking (4096 char limit with smart paragraph splitting)
- File/photo/video/audio attachments
- Sticker and voice message detection
- Reply and forwarded messages

### Markdown to VK Formatting
LLM responses in markdown are automatically converted:
- `# Header` → **Header** (bold)
- `[link](url)` → link (url)
- `- item` → • item
- `> quote` → « quote »
- `[x]` / `[ ]` → ✅ / ☐
- Tables → text format
- Code blocks preserved

### Auto-Keyboard
Numbered lists and command patterns in LLM responses are automatically converted to VK buttons:

```
Choose an option:        →  [Terrain] [Scatter]
1. Terrain                   [Dungeon] [Buildings]
2. Scatter
3. Dungeon Tiles
4. Buildings
```

### Inbound Media Processing
- Photos (best resolution auto-selected)
- Documents with 40+ MIME types (including 3D: STL, OBJ, GLB)
- Audio, video, stickers, voice messages, links
- Text descriptions for media-only messages: `[Photo]`, `[Document: file.pdf]`

### Wall Posts
- Create, edit, delete, search
- Scheduled (postponed) posts
- Pin/unpin, comments, repost

### Market (Shop)
- Products: add, edit, delete, search
- Albums/collections management
- Orders tracking
- Product comments

### Stories
- Photo and video stories
- Upload and publish

### Other
- Polls: create, get votes
- Group statistics (visitors, reach, activity)
- Lead forms
- App widgets
- Community management (ban/unban, members, settings)
- Donut subscriptions
- `execute()` batching (25 API calls in 1 request)
- Rate limiter (3 req/s with auto-retry)

## Per-Group Configuration

Different group chats can have independent system prompts and tool policies:

```json
{
  "channels": {
    "vk": {
      "accounts": {
        "default": {
          "token": "...",
          "groupId": "...",
          "groups": {
            "2000000001": {
              "systemPrompt": "You are a helpful assistant for tabletop gaming questions.",
              "requireMention": true,
              "toolsAllow": ["web-search", "calculator"],
              "toolsDeny": ["exec"]
            },
            "2000000002": {
              "systemPrompt": "You are a store assistant. Help customers choose terrain.",
              "allowFrom": ["12345", "67890"]
            }
          }
        }
      }
    }
  }
}
```

## DM Access Policies

| Policy | Behavior |
|--------|----------|
| `pairing` (default) | Unknown users get a pairing code to approve |
| `allowlist` | Only listed VK user IDs can message |
| `open` | Anyone can message |
| `disabled` | No inbound messages |

## Architecture

```
src/
├── api.ts          # VK API client (120+ methods, rate limiter, execute batching)
├── channel.ts      # OpenClaw ChannelPlugin definition
├── runtime.ts      # VK Long Poll runtime (message loop, dispatch)
├── accounts.ts     # Account resolution and per-group config
├── formatter.ts    # Markdown → VK text conversion
├── keyboard.ts     # Auto-parse LLM text → VK keyboard buttons
├── media.ts        # Inbound media extraction (40+ MIME types)
├── types.ts        # TypeScript types (VK API v5.199)
└── plugin-sdk.ts   # OpenClaw Plugin SDK types
```

- **No dependency on vk-io** — own lightweight VK API client
- **Single production dependency**: `form-data` (for file uploads)
- **VK API v5.199** (latest)
- **Long Poll transport** — no public URL or webhook needed

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | string | — | VK community bot API token |
| `groupId` | string | — | VK community (group) numeric ID |
| `enabled` | boolean | `true` | Enable/disable this account |
| `dmPolicy` | string | `"pairing"` | DM access policy |
| `allowFrom` | string[] | `[]` | Allowed VK user IDs |
| `apiVersion` | string | `"5.199"` | VK API version |
| `longPollWait` | number | `25` | Long Poll timeout (seconds) |
| `formatMarkdown` | boolean | `true` | Convert markdown in responses |
| `autoKeyboard` | boolean | `true` | Auto-parse buttons from text |
| `groups` | object | `{}` | Per-group chat configurations |

## Requirements

- OpenClaw v2026.4.x or later
- Node.js 22+
- VK community with bot capabilities enabled

## License

MIT
