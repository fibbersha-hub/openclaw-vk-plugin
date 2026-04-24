// ============================================================================
// VK Channel Plugin — OpenClaw ChannelPlugin (follows MAX plugin pattern)
// ============================================================================

import { VkApi } from "./api.js";
import { VkLongPollRuntime } from "./runtime.js";
import { resolveAccount, listAccountIds, DEFAULT_ACCOUNT_ID } from "./accounts.js";
import { markdownToVk, chunkText } from "./formatter.js";
import { extractButtons } from "./keyboard.js";
import type { ResolvedVkAccount } from "./types.js";
import type { ChannelPlugin } from "./plugin-sdk.js";

// Active runtime instances per account
const activeRuntimes = new Map<string, VkLongPollRuntime>();

export function getRuntime(accountId: string): VkLongPollRuntime | undefined {
  return activeRuntimes.get(accountId);
}

export function getApi(accountId: string): VkApi | undefined {
  return activeRuntimes.get(accountId)?.getApi();
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const vkPlugin: ChannelPlugin<ResolvedVkAccount, unknown> = {
  id: "vk",

  meta: {
    id: "vk",
    label: "VK (VKontakte)",
    selectionLabel: "VK",
    docsPath: "/channels/vk",
    blurb: "VK community bot integration for OpenClaw — messaging, wall, market, media, community management.",
    order: 80,
    aliases: ["vk", "vkontakte"],
    quickstartAllowFrom: true,
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  reload: {
    configPrefixes: ["channels.vk"],
  },

  config: {
    listAccountIds,
    resolveAccount,
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.vk) next.channels.vk = {};
      if (!next.channels.vk.accounts) next.channels.vk.accounts = {};
      if (!next.channels.vk.accounts[accountId]) next.channels.vk.accounts[accountId] = {};
      next.channels.vk.accounts[accountId].enabled = enabled;
      return next;
    },

    deleteAccount: ({ cfg, accountId }: any) => {
      const next = { ...cfg };
      if (next.channels?.vk?.accounts?.[accountId]) {
        delete next.channels.vk.accounts[accountId];
      }
      return next;
    },

    isConfigured: (account: ResolvedVkAccount) => {
      return Boolean(account.token && account.groupId);
    },

    unconfiguredReason: (account: ResolvedVkAccount) => {
      if (!account.token) return "VK community token not configured (channels.vk.accounts.<id>.token)";
      if (!account.groupId) return "VK group ID not configured (channels.vk.accounts.<id>.groupId)";
      return undefined;
    },

    describeAccount: (account: ResolvedVkAccount) => ({
      accountId: account.accountId,
      groupId: account.groupId,
      enabled: account.enabled,
      configured: Boolean(account.token && account.groupId),
    }),
  },

  pairing: {
    idLabel: "vkUserId",
    normalizeAllowEntry: (entry: string) =>
      entry.replace(/^https?:\/\/(m\.)?vk\.com\//, "").replace(/^id/, "").trim(),
    notifyApproval: async ({ cfg, id }: any) => {
      const account = resolveAccount(cfg);
      if (!account.token) return;
      const api = new VkApi({ token: account.token, groupId: account.groupId });
      try {
        await api.messagesSend({
          user_id: Number(id),
          random_id: Math.floor(Math.random() * 2147483647),
          message: "✅ You have been approved to use this bot.",
        });
      } catch { /* user may not have allowed messages */ }
    },
  },

  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: account.dmPolicy || "pairing",
      allowFrom: account.allowFrom || [],
      policyPath: `channels.vk.accounts.${account.accountId}.dmPolicy`,
      allowFromPath: `channels.vk.accounts.${account.accountId}`,
      approveHint: "Run: openclaw channels vk allow <vk_user_id>",
    }),
  },

  messaging: {
    normalizeTarget: (to: string) => to.replace(/\s/g, ""),
    targetResolver: {
      looksLikeId: (id: string) => /^\d+$/.test(id),
      hint: "<vk_user_id>",
    },
  },

  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },

  setup: {
    resolveAccountId: ({ accountId }: any) => accountId || DEFAULT_ACCOUNT_ID,

    applyAccountConfig: ({ cfg, accountId, input }: any) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.vk) next.channels.vk = {};
      if (!next.channels.vk.accounts) next.channels.vk.accounts = {};
      if (!next.channels.vk.accounts[accountId]) next.channels.vk.accounts[accountId] = {};
      const acct = next.channels.vk.accounts[accountId];
      if (input.token) acct.token = input.token;
      if (input.groupId) acct.groupId = input.groupId;
      if (input.dmPolicy) acct.dmPolicy = input.dmPolicy;
      if (input.allowFrom) acct.allowFrom = input.allowFrom.split(",").map((s: string) => s.trim());
      return next;
    },

    validateInput: ({ input }: any) => {
      if (!input.token) return "VK community token is required";
      if (!input.groupId) return "VK group ID is required";
      if (!/^\d+$/.test(input.groupId)) return "Group ID must be numeric";
      return null;
    },
  },

  outbound: {
    deliveryMode: "gateway" as const,
    chunker: null,
    textChunkLimit: 4096,

    sendText: async ({ cfg, to, text, accountId }: any) => {
      const account = resolveAccount(cfg, accountId);
      if (!account.token) throw new Error("VK token not configured");
      const runtime = activeRuntimes.get(account.accountId);
      const api = runtime?.getApi() ?? new VkApi({ token: account.token, groupId: account.groupId, version: account.apiVersion });
      const peerId = Number(to);
      if (isNaN(peerId)) throw new Error(`Invalid VK peer_id: ${to}`);

      // Format markdown and extract buttons
      let formattedText = account.formatMarkdown !== false ? markdownToVk(text) : text;
      let keyboardJson: string | undefined;
      if (account.autoKeyboard !== false) {
        const { text: cleanText, keyboard } = extractButtons(formattedText);
        if (keyboard) {
          formattedText = cleanText;
          keyboardJson = JSON.stringify(keyboard);
        }
      }

      // Chunk and send
      const chunks = chunkText(formattedText);
      let lastMessageId = 0;
      for (let i = 0; i < chunks.length; i++) {
        lastMessageId = await api.messagesSend({
          peer_id: peerId,
          random_id: Math.floor(Math.random() * 2147483647),
          message: chunks[i],
          ...(i === chunks.length - 1 && keyboardJson && { keyboard: keyboardJson }),
        });
      }
      return { channel: "vk", messageId: String(lastMessageId), chatId: to };
    },

    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }: any) => {
      const account = resolveAccount(cfg, accountId);
      if (!account.token) throw new Error("VK token not configured");
      const api = activeRuntimes.get(account.accountId)?.getApi() ?? new VkApi({ token: account.token, groupId: account.groupId, version: account.apiVersion });
      const peerId = Number(to);
      if (isNaN(peerId)) throw new Error(`Invalid VK peer_id: ${to}`);
      // Send media URL as text (full upload requires local file)
      const msg = text ? `${text}\n${mediaUrl}` : (mediaUrl ?? "");
      const messageId = await api.messagesSend({
        peer_id: peerId,
        random_id: Math.floor(Math.random() * 2147483647),
        message: msg,
      });
      return { channel: "vk", messageId: String(messageId), chatId: to };
    },
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const { account, abortSignal } = ctx;
      console.log(`[VK] [${account.accountId}] starting Long Poll for group ${account.groupId}`);

      const runtime = new VkLongPollRuntime({
        account,
        channelRuntime: ctx.channelRuntime,
        cfg: ctx.cfg,
        abortSignal,
        log: (msg: string) => console.log(`[VK] [${account.accountId}] ${msg}`),
      });

      activeRuntimes.set(account.accountId, runtime);

      abortSignal?.addEventListener("abort", () => {
        console.log(`[VK] [${account.accountId}] stopping (abort signal)`);
        runtime.stop();
        activeRuntimes.delete(account.accountId);
      });

      // Verify token
      try {
        const api = runtime.getApi();
        const info = await api.groupsGetById({ fields: "members_count" });
        if (info.groups?.[0]) {
          console.log(`[VK] [${account.accountId}] connected: ${info.groups[0].name} (members: ${info.groups[0].members_count ?? "?"})`);
        }
      } catch (err: any) {
        console.error(`[VK] [${account.accountId}] token verification failed: ${err.message}`);
      }

      // Block until stopped — required by OpenClaw Gateway
      await runtime.start();
      await runtime.done;
    },

    logoutAccount: async ({ accountId }: any) => {
      const runtime = activeRuntimes.get(accountId);
      if (runtime) {
        runtime.stop();
        activeRuntimes.delete(accountId);
      }
    },
  },
};

export default vkPlugin;
