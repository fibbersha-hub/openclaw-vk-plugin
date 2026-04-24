// ============================================================================
// Account resolution — reads from cfg.channels.vk (OpenClaw standard)
// ============================================================================

import type { ResolvedVkAccount, DmPolicy, VkGroupChatConfig } from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

const DEFAULTS = {
  apiVersion: "5.199",
  longPollWait: 25,
  dmPolicy: "pairing" as DmPolicy,
  formatMarkdown: true,
  autoKeyboard: true,
};

/**
 * Resolve a VK account from OpenClaw config.
 * Config location: cfg.channels.vk.accounts.<id>
 * Also supports flat: cfg.channels.vk.token (default account)
 */
export function resolveAccount(cfg: any, accountId?: string | null): ResolvedVkAccount {
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const vkCfg = cfg?.channels?.vk ?? {};
  const perAccount = vkCfg.accounts?.[id] ?? {};
  const merged = { ...vkCfg, ...perAccount };

  const token = (merged.token ?? "").trim();
  const groupId = (merged.groupId ?? "").trim();

  return {
    accountId: id,
    token,
    groupId,
    enabled: merged.enabled !== false,
    dmPolicy: merged.dmPolicy ?? DEFAULTS.dmPolicy,
    allowFrom: normalizeAllowFrom(merged.allowFrom),
    apiVersion: merged.apiVersion ?? DEFAULTS.apiVersion,
    longPollWait: merged.longPollWait ?? DEFAULTS.longPollWait,
    groups: merged.groups ?? {},
    formatMarkdown: merged.formatMarkdown ?? DEFAULTS.formatMarkdown,
    autoKeyboard: merged.autoKeyboard ?? DEFAULTS.autoKeyboard,
    groqApiKey: merged.groqApiKey,
    transcribeVoice: merged.transcribeVoice,
  };
}

/**
 * List all configured account IDs.
 */
export function listAccountIds(cfg: any): string[] {
  const vkCfg = cfg?.channels?.vk;
  if (!vkCfg) return [DEFAULT_ACCOUNT_ID];

  const ids = Object.keys(vkCfg.accounts ?? {});
  const hasRootToken = Boolean(vkCfg.token);

  if (hasRootToken || ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID, ...ids.filter((id) => id !== DEFAULT_ACCOUNT_ID)];
  }
  return ids;
}

function normalizeAllowFrom(raw?: (string | number)[]): string[] {
  if (!raw) return [];
  return raw.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * Get per-group config for a specific peer_id.
 * Returns null if no group-specific config exists.
 */
export function getGroupConfig(
  account: ResolvedVkAccount,
  peerId: number,
): VkGroupChatConfig | null {
  if (!account.groups || peerId <= 2000000000) return null;
  const key = String(peerId);
  return account.groups[key] ?? null;
}
