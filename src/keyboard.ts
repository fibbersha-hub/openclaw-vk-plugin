// ============================================================================
// VK Keyboard Builder — auto-parse buttons from LLM text responses
// ============================================================================

import type { VkKeyboard, VkKeyboardButton } from "./types.js";

// Max constraints from VK API
const MAX_ROWS = 10;
const MAX_BUTTONS_PER_ROW = 4;
const MAX_LABEL_LENGTH = 40;

// ============================================================================
// Auto-detect and extract button patterns from LLM text
// ============================================================================

export interface ExtractedButtons {
  text: string;          // text with button patterns removed
  keyboard: VkKeyboard | null;
}

/**
 * Parse LLM response text for button-like patterns and convert to VK keyboard.
 *
 * Recognized patterns:
 * 1. Numbered lists that look like choices: "1. Option A\n2. Option B"
 * 2. Bracket commands: "[Button Text]" or "[Button Text](command)"
 * 3. Slash commands: "/command - description"
 */
export function extractButtons(text: string): ExtractedButtons {
  // Try bracket buttons first (explicit)
  const bracketResult = parseBracketButtons(text);
  if (bracketResult) return bracketResult;

  // Try numbered choice lists
  const numberedResult = parseNumberedChoices(text);
  if (numberedResult) return numberedResult;

  // Try slash commands
  const slashResult = parseSlashCommands(text);
  if (slashResult) return slashResult;

  return { text, keyboard: null };
}

/**
 * Parse [Button Text] or [Button Text](payload) patterns.
 */
function parseBracketButtons(text: string): ExtractedButtons | null {
  const pattern = /\[([^\]]{1,40})\](?:\(([^)]{1,255})\))?/g;
  const matches = [...text.matchAll(pattern)];

  if (matches.length < 2 || matches.length > MAX_ROWS * MAX_BUTTONS_PER_ROW) {
    return null;
  }

  const buttons: VkKeyboardButton[] = matches.map((m) => ({
    action: {
      type: "text" as const,
      label: truncateLabel(m[1]!),
      payload: JSON.stringify({ command: m[2] || m[1] }),
    },
    color: "primary" as const,
  }));

  // Remove button patterns from text
  let cleanText = text.replace(pattern, "").replace(/\n{2,}/g, "\n").trim();

  return {
    text: cleanText,
    keyboard: buildKeyboard(buttons, false),
  };
}

/**
 * Parse numbered choice patterns like:
 * "1. Вариант A\n2. Вариант B\n3. Вариант C"
 *
 * Only triggers when it looks like a menu/choice list.
 */
function parseNumberedChoices(text: string): ExtractedButtons | null {
  // Find a block of consecutive numbered items
  const numberedPattern = /^(\d+)[.)]\s+(.{1,60})$/gm;
  const matches = [...text.matchAll(numberedPattern)];

  // Need at least 2 and at most 10 choices
  if (matches.length < 2 || matches.length > 10) return null;

  // Check they're consecutive (1,2,3... or all same prefix)
  const numbers = matches.map((m) => parseInt(m[1]!, 10));
  const isSequential = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1);
  if (!isSequential) return null;

  const buttons: VkKeyboardButton[] = matches.map((m) => ({
    action: {
      type: "text" as const,
      label: truncateLabel(m[2]!.trim()),
      payload: JSON.stringify({ choice: parseInt(m[1]!, 10), text: m[2]!.trim() }),
    },
    color: "secondary" as const,
  }));

  return {
    text,  // Keep original text — buttons supplement it
    keyboard: buildKeyboard(buttons, true),
  };
}

/**
 * Parse /command patterns.
 */
function parseSlashCommands(text: string): ExtractedButtons | null {
  const cmdPattern = /^(\/\w+)\s*[-—]\s*(.{1,50})$/gm;
  const matches = [...text.matchAll(cmdPattern)];

  if (matches.length < 2 || matches.length > 10) return null;

  const buttons: VkKeyboardButton[] = matches.map((m) => ({
    action: {
      type: "text" as const,
      label: truncateLabel(m[1]!),
      payload: JSON.stringify({ command: m[1] }),
    },
    color: "primary" as const,
  }));

  return {
    text,
    keyboard: buildKeyboard(buttons, false),
  };
}

// ============================================================================
// Keyboard construction helpers
// ============================================================================

/**
 * Build VK keyboard from flat button list.
 * Arranges into rows respecting VK limits.
 */
export function buildKeyboard(
  buttons: VkKeyboardButton[],
  oneTime: boolean,
  inline = false,
): VkKeyboard {
  const rows: VkKeyboardButton[][] = [];
  let currentRow: VkKeyboardButton[] = [];

  for (const btn of buttons) {
    currentRow.push(btn);

    // Estimate: short labels → more per row, long → fewer
    const labelLen = getLabelLength(btn);
    const maxPerRow = labelLen > 20 ? 2 : labelLen > 10 ? 3 : MAX_BUTTONS_PER_ROW;

    if (currentRow.length >= maxPerRow) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) rows.push(currentRow);

  return {
    one_time: oneTime,
    inline,
    buttons: rows.slice(0, MAX_ROWS),
  };
}

/**
 * Create a simple keyboard from label strings.
 */
export function simpleKeyboard(
  labels: string[],
  opts: { oneTime?: boolean; inline?: boolean; color?: VkKeyboardButton["color"] } = {},
): VkKeyboard {
  const buttons: VkKeyboardButton[] = labels.map((label) => ({
    action: { type: "text" as const, label: truncateLabel(label) },
    color: opts.color ?? "secondary",
  }));

  return buildKeyboard(buttons, opts.oneTime ?? true, opts.inline ?? false);
}

/**
 * Create a keyboard removal payload (empty keyboard).
 */
export function removeKeyboard(): string {
  return JSON.stringify({ buttons: [], one_time: true });
}

// ============================================================================
// Utilities
// ============================================================================

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  return label.slice(0, MAX_LABEL_LENGTH - 1) + "…";
}

function getLabelLength(btn: VkKeyboardButton): number {
  const action = btn.action as { label?: string };
  return action.label?.length ?? 0;
}
