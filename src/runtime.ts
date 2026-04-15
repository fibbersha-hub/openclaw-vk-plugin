// ============================================================================
// VK Long Poll Runtime — follows MAX plugin pattern
// ============================================================================

import { createPluginRuntimeStore } from "./plugin-sdk.js";
import type { PluginRuntime } from "./plugin-sdk.js";
import { setTimeout as sleep } from "node:timers/promises";
import { VkApi } from "./api.js";
import { markdownToVk, chunkText } from "./formatter.js";
import { extractButtons } from "./keyboard.js";
import { extractMedia, buildMediaDescription } from "./media.js";
import { getGroupConfig } from "./accounts.js";
import type {
  ResolvedVkAccount,
  LongPollServer,
  LongPollResponse,
  VkEvent,
  VkMessageNewObject,
  VkGroupChatConfig,
} from "./types.js";

// ============================================================================
// Runtime store (same pattern as MAX/Telegram)
// ============================================================================

const { setRuntime: setVkRuntime, getRuntime: getVkRuntime } =
  createPluginRuntimeStore<PluginRuntime>("VK runtime not initialized");
export { setVkRuntime, getVkRuntime };

// ============================================================================
// Runtime config
// ============================================================================

export interface VkRuntimeConfig {
  account: ResolvedVkAccount;
  channelRuntime?: any;
  cfg?: any;
  abortSignal?: AbortSignal;
  log?: (msg: string) => void;
}

// ============================================================================
// VK Long Poll Runtime
// ============================================================================

export class VkLongPollRuntime {
  private api: VkApi;
  private account: ResolvedVkAccount;
  private channelRuntime: any;
  private cfg: any;
  private abortSignal?: AbortSignal;
  private log: (msg: string) => void;
  private running = false;
  private longPollServer: LongPollServer | null = null;

  private _doneResolve?: () => void;
  public readonly done: Promise<void>;

  constructor(config: VkRuntimeConfig) {
    this.account = config.account;
    this.channelRuntime = config.channelRuntime;
    this.cfg = config.cfg;
    this.abortSignal = config.abortSignal;
    this.log = config.log ?? console.log;
    this.api = new VkApi({
      token: config.account.token,
      groupId: config.account.groupId,
      version: config.account.apiVersion,
      log: this.log,
    });
    this.done = new Promise<void>((resolve) => {
      this._doneResolve = resolve;
    });
  }

  getApi(): VkApi {
    return this.api;
  }

  async start(): Promise<void> {
    this.running = true;
    this.log(`[vk-lp] Starting Long Poll for group ${this.account.groupId}`);

    this.abortSignal?.addEventListener("abort", () => {
      this.running = false;
    });

    await this.pollLoop()
      .then(() => this._doneResolve?.())
      .catch((err) => {
        this.log(`[vk-lp] Fatal error: ${(err as Error).message}`);
        this._doneResolve?.();
      });
  }

  stop(): void {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running && !this.abortSignal?.aborted) {
      try {
        if (!this.longPollServer) {
          this.longPollServer = await this.api.groupsGetLongPollServer();
          this.log(`[vk-lp] Connected to Long Poll server`);
        }

        const response = await this.poll();

        if (response.failed) {
          await this.handleFailed(response.failed);
          continue;
        }

        if (response.ts) this.longPollServer!.ts = response.ts;

        if (response.updates) {
          for (const event of response.updates) {
            if (event.type === "message_new") {
              await this.handleMessageNew(event);
            }
          }
        }
      } catch (err) {
        if (this.abortSignal?.aborted) break;
        this.log(`[vk-lp] Error: ${(err as Error).message}`);
        this.longPollServer = null;
        await sleep(3000);
      }
    }
    this.log(`[vk-lp] Long Poll stopped`);
  }

  private async poll(): Promise<LongPollResponse> {
    const s = this.longPollServer!;
    const url = `${s.server}?act=a_check&key=${s.key}&ts=${s.ts}&wait=${this.account.longPollWait}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout((this.account.longPollWait + 10) * 1000),
    });
    return (await response.json()) as LongPollResponse;
  }

  private async handleFailed(code: number): Promise<void> {
    if (code === 1) {
      this.log(`[vk-lp] History outdated, updating ts`);
    } else {
      this.log(`[vk-lp] Session lost (code ${code}), reconnecting...`);
      this.longPollServer = null;
    }
  }

  // =========================================================================
  // Handle incoming VK message — dispatch to OpenClaw agent (MAX pattern)
  // =========================================================================

  private async handleMessageNew(event: VkEvent): Promise<void> {
    try {
      const obj = event.object as VkMessageNewObject;
      const msg = obj.message;

      // Skip bot's own messages
      if (msg.from_id < 0) return;

      const userId = msg.from_id;
      const isGroupChat = msg.peer_id > 2000000000;
      let text = msg.text || "";

      // Per-group config
      const groupCfg = isGroupChat ? getGroupConfig(this.account, msg.peer_id) : null;

      // Security: enforce allowlist (group-level overrides account-level)
      if (isGroupChat && groupCfg?.allowFrom?.length) {
        if (!groupCfg.allowFrom.includes(String(userId))) {
          return; // silently skip — don't log every group message
        }
      } else if (!this.isUserAllowed(userId)) {
        this.log(`[security] message from ${userId} blocked — not in allowFrom`);
        return;
      }

      // Group chat: require @mention if configured
      if (isGroupChat && groupCfg?.requireMention) {
        const botMention = `[club${this.account.groupId}|`;
        if (!text.includes(botMention) && !text.startsWith("/")) return;
        // Remove the mention from text
        text = text.replace(/\[club\d+\|[^\]]*\]/g, "").trim();
      }

      // Extract media attachments
      const media = extractMedia(msg);
      const mediaDesc = buildMediaDescription(media);

      // Build body: text + media descriptions
      let body = text;
      if (!body && mediaDesc) {
        body = mediaDesc; // media-only message
      } else if (body && mediaDesc) {
        body = `${body}\n\n${mediaDesc}`; // text + media
      }

      // Skip truly empty messages
      if (!body) return;

      this.log(`[msg] from ${userId}: "${body.slice(0, 80)}"${media.length ? ` +${media.length} media` : ""}`);

      // Get channelRuntime from ctx or global runtime
      const channelRuntime = this.channelRuntime ?? (getVkRuntime() as any)?.channel;
      if (!channelRuntime) {
        this.log(`[error] channelRuntime not available — cannot dispatch`);
        return;
      }

      const vkTo = `${userId}`;

      // Get user display name
      let displayName = `User ${userId}`;
      try {
        const users = await this.api.usersGet({ user_ids: String(userId) });
        if (users[0]) displayName = `${users[0].first_name} ${users[0].last_name}`;
      } catch { /* ignore */ }

      // Build inbound context (same structure as MAX)
      const rawCtxFields: Record<string, any> = {
        Body: body,
        BodyForAgent: body,
        RawBody: body,
        CommandBody: body,
        BodyForCommands: body,
        From: vkTo,
        To: vkTo,
        AccountId: this.account.accountId,
        ChatType: msg.peer_id > 2000000000 ? "group" : "direct",
        ConversationLabel: displayName,
        SenderName: displayName,
        SenderId: userId.toString(),
        Provider: "vk",
        Surface: "vk",
        MessageSid: String(msg.id),
        Timestamp: msg.date * 1000,
        CommandAuthorized: false as const,
        OriginatingChannel: "vk",
        OriginatingTo: vkTo,
        ExplicitDeliverRoute: true,
        // Media attachments for OpenClaw to process
        ...(media.length > 0 && { Media: media }),
      };

      // Per-group system prompt and tool policies
      if (groupCfg?.systemPrompt) {
        rawCtxFields.SystemPrompt = groupCfg.systemPrompt;
      }
      if (groupCfg?.toolsAllow) {
        rawCtxFields.ToolsAllow = groupCfg.toolsAllow;
      }
      if (groupCfg?.toolsAlsoAllow) {
        rawCtxFields.ToolsAlsoAllow = groupCfg.toolsAlsoAllow;
      }
      if (groupCfg?.toolsDeny) {
        rawCtxFields.ToolsDeny = groupCfg.toolsDeny;
      }

      // Resolve agent route
      let route: any;
      if (typeof channelRuntime?.routing?.resolveAgentRoute === "function") {
        route = await channelRuntime.routing.resolveAgentRoute({ ctx: rawCtxFields, cfg: this.cfg });
      }

      // Finalize context
      if (route?.sessionKey) rawCtxFields.SessionKey = route.sessionKey;

      const ctxPayload = typeof channelRuntime?.reply?.finalizeInboundContext === "function"
        ? channelRuntime.reply.finalizeInboundContext(rawCtxFields)
        : rawCtxFields;

      // Record inbound session
      const storePath = typeof channelRuntime?.session?.resolveStorePath === "function"
        ? (channelRuntime.session.resolveStorePath((this.cfg as any)?.session?.store, { agentId: route?.agentId ?? "main" }) ?? "")
        : "";

      if (storePath && typeof channelRuntime?.session?.recordInboundSession === "function" && route) {
        await channelRuntime.session.recordInboundSession({
          storePath,
          sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
          ctx: ctxPayload,
          updateLastRoute: {
            sessionKey: route.mainSessionKey ?? route.sessionKey,
            channel: "vk",
            to: vkTo,
            accountId: this.account.accountId,
          },
          onRecordError: (err: unknown) => {
            this.log(`[error] recordInboundSession: ${err}`);
          },
        });
      }

      // Dispatch reply with streaming
      if (typeof channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher === "function") {
        // Show typing
        this.api.messagesSetActivity({ peer_id: msg.peer_id, type: "typing" }).catch(() => {});

        const typingInterval = setInterval(() => {
          this.api.messagesSetActivity({ peer_id: msg.peer_id, type: "typing" }).catch(() => {});
        }, 5000);

        try {
          let finalText = "";

          await channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg: this.cfg,
            replyOptions: {
              onPartialReply: async (payload: { text?: string }) => {
                if (payload?.text) finalText = payload.text;
              },
            },
            dispatcherOptions: {
              deliver: async (payload: { text?: string; body?: string }) => {
                clearInterval(typingInterval);
                let responseText = payload?.text ?? payload?.body ?? finalText;
                if (responseText) {
                  // Apply markdown→VK formatting
                  if (this.account.formatMarkdown !== false) {
                    responseText = markdownToVk(responseText);
                  }

                  // Auto-parse buttons from response
                  let keyboardJson: string | undefined;
                  if (this.account.autoKeyboard !== false) {
                    const { text: cleanText, keyboard } = extractButtons(responseText);
                    if (keyboard) {
                      responseText = cleanText;
                      keyboardJson = JSON.stringify(keyboard);
                    }
                  }

                  // Chunk long messages
                  const chunks = chunkText(responseText);
                  for (let i = 0; i < chunks.length; i++) {
                    await this.api.messagesSend({
                      peer_id: msg.peer_id,
                      random_id: Math.floor(Math.random() * 2147483647),
                      message: chunks[i],
                      // Keyboard only on last chunk
                      ...(i === chunks.length - 1 && keyboardJson && { keyboard: keyboardJson }),
                    });
                  }
                }
              },
              onError: (err: Error, info: any) => {
                clearInterval(typingInterval);
                this.log(`[error] reply dispatch: ${err.message}`);
              },
            },
          });
        } catch (err: any) {
          clearInterval(typingInterval);
          this.log(`[error] dispatchReply: ${err.message}`);
          // Send error message to user
          await this.api.messagesSend({
            peer_id: msg.peer_id,
            random_id: Math.floor(Math.random() * 2147483647),
            message: "Произошла ошибка при обработке сообщения. Попробуйте позже.",
          }).catch(() => {});
        }
        return;
      }

      this.log(`[warn] channelRuntime.reply not available — message lost`);
    } catch (err: any) {
      this.log(`[error] handleMessageNew: ${err.message}`);
    }
  }

  private isUserAllowed(userId: number): boolean {
    const policy = this.account.dmPolicy ?? "pairing";
    const allowFrom = this.account.allowFrom ?? [];
    if (policy === "disabled" || policy === "closed") return false;
    if (policy === "open") return true;
    return allowFrom.includes(String(userId));
  }
}

// ============================================================================
// Event handlers (optional, for custom event handling)
// ============================================================================

export type VkEventHandler = (event: VkEvent, api: VkApi) => Promise<void>;
const eventHandlers = new Map<string, VkEventHandler[]>();

export function onVkEvent(type: string, handler: VkEventHandler): void {
  const handlers = eventHandlers.get(type) ?? [];
  handlers.push(handler);
  eventHandlers.set(type, handlers);
}
