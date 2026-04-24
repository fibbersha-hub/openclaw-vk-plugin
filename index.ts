// ============================================================================
// OpenClaw VK Plugin — Entry Point (follows MAX plugin pattern)
// ============================================================================

import type { ChannelPlugin, OpenClawExtension, OpenClawPluginApi } from "./src/plugin-sdk.js";
import { emptyPluginConfigSchema } from "./src/plugin-sdk.js";
import { vkPlugin } from "./src/channel.js";
import { setVkRuntime } from "./src/runtime.js";

// Re-exports
export { VkApi, VkApiCallError, buildKeyboard, buildCarousel, textButton, callbackButton, linkButton, locationButton, vkPayButton, openAppButton, attachmentString } from "./src/api.js";
export { vkPlugin, getRuntime, getApi } from "./src/channel.js";
export { VkLongPollRuntime, onVkEvent } from "./src/runtime.js";
export { resolveAccount, listAccountIds } from "./src/accounts.js";
export type * from "./src/types.js";

const extension: OpenClawExtension = {
  id: "vk",
  name: "VK (VKontakte)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setVkRuntime(api.runtime);
    api.registerChannel({ plugin: vkPlugin as ChannelPlugin });
  },
};

export default extension;
