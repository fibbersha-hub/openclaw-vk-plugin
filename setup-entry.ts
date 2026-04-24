// ============================================================================
// OpenClaw VK Plugin — Setup Entry (lightweight, no runtime dependencies)
// ============================================================================

export const vkSetupPlugin = {
  id: "vk",
  name: "VK (VKontakte)",

  setup: {
    fields: [
      {
        key: "token",
        label: "VK Community Bot Token",
        type: "password" as const,
        required: true,
        help: "Go to your VK Community → Management → API usage → Create token. Grant: messages, photos, docs, wall, stories, manage.",
      },
      {
        key: "groupId",
        label: "VK Community (Group) ID",
        type: "text" as const,
        required: true,
        help: "Numeric ID of your VK community. Find it in Community → Management → API usage.",
      },
      {
        key: "dmPolicy",
        label: "Who can message the bot?",
        type: "select" as const,
        required: false,
        options: [
          { value: "pairing", label: "Require pairing approval (recommended)" },
          { value: "allowlist", label: "Only allowed user IDs" },
          { value: "open", label: "Anyone (not recommended)" },
          { value: "closed", label: "Nobody" },
        ],
        default: "pairing",
      },
      {
        key: "allowFrom",
        label: "Allowed VK User IDs (comma-separated)",
        type: "text" as const,
        required: false,
        help: "Used with 'allowlist' or 'pairing' policy. Example: 12345678,87654321",
      },
      {
        key: "groqApiKey",
        label: "Groq API Key (for voice transcription)",
        type: "password" as const,
        required: false,
        help: "Get a free key at console.groq.com. Enables Whisper transcription of incoming voice messages (~2 hours/day free).",
      },
    ],

    validate(input: Record<string, string>): string | null {
      if (!input.token) return "VK community token is required";
      if (!input.groupId) return "VK community (group) ID is required";
      if (!/^\d+$/.test(input.groupId)) return "Group ID must be numeric (e.g., 123456789)";
      return null;
    },
  },
};

export default vkSetupPlugin;
