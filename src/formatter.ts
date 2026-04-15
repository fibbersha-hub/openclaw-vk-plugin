// ============================================================================
// Markdown → VK Format Converter
// Converts LLM markdown output to VK-compatible rich text
// ============================================================================

/**
 * Convert markdown text to VK-compatible format.
 * VK supports limited formatting — we convert common patterns.
 */
export function markdownToVk(text: string): string {
  if (!text) return "";

  let result = text;

  // Code blocks (```lang\n...\n```) → keep as-is, VK renders monospace
  // But remove the language hint
  result = result.replace(/```\w*\n([\s\S]*?)```/g, "```\n$1```");

  // Inline code (`...`) → keep as-is, VK renders monospace
  // No change needed

  // Bold: **text** or __text__ → VK doesn't have native bold, keep **
  // Actually VK messenger renders **bold** natively since 2024
  // So we keep ** as-is

  // Italic: *text* or _text_ (single) → keep as-is
  // VK renders *italic* natively

  // Strikethrough: ~~text~~ → VK supports ~~strikethrough~~
  // No change needed

  // Headers: # Header → **Header** (bold equivalent)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");

  // Horizontal rule: --- or *** → visual separator
  result = result.replace(/^(?:[-*_]){3,}\s*$/gm, "————————————————");

  // Links: [text](url) → text (url)
  // VK auto-links URLs, so we make them visible
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Images: ![alt](url) → [Изображение: alt] url
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[Изображение: $1] $2");

  // Unordered lists: - item or * item → • item
  result = result.replace(/^[\t ]*[-*]\s+/gm, "• ");

  // Ordered lists: 1. item → 1) item
  result = result.replace(/^(\d+)\.\s+/gm, "$1) ");

  // Blockquotes: > text → « text »
  result = result.replace(/^>\s+(.+)$/gm, "« $1 »");

  // Nested blockquotes: >> text
  result = result.replace(/^>{2,}\s+(.+)$/gm, "  « $1 »");

  // Task lists: - [x] → ✅, - [ ] → ☐
  result = result.replace(/•\s*\[x\]\s*/gi, "✅ ");
  result = result.replace(/•\s*\[\s*\]\s*/g, "☐ ");

  // Tables: | col1 | col2 | → simplified text
  result = convertTables(result);

  // Clean up excessive newlines (max 2 consecutive)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Convert markdown tables to readable text format.
 * VK doesn't support tables, so we convert to aligned text.
 */
function convertTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const isTableRow = /^\|(.+)\|$/.test(line.trim());
    const isSeparator = /^\|[-:\s|]+\|$/.test(line.trim());

    if (isTableRow && !isSeparator) {
      inTable = true;
      tableLines.push(line.trim());
    } else if (isSeparator && inTable) {
      // Skip separator row
      continue;
    } else {
      if (inTable && tableLines.length > 0) {
        result.push(formatTable(tableLines));
        tableLines = [];
        inTable = false;
      }
      result.push(line);
    }
  }

  // Flush remaining table
  if (tableLines.length > 0) {
    result.push(formatTable(tableLines));
  }

  return result.join("\n");
}

function formatTable(rows: string[]): string {
  const parsed = rows.map((row) =>
    row
      .split("|")
      .filter(Boolean)
      .map((cell) => cell.trim()),
  );

  if (parsed.length === 0) return "";

  // Header row bold
  const header = parsed[0]!;
  const dataRows = parsed.slice(1);

  const lines: string[] = [];
  lines.push(header.map((h) => `**${h}**`).join(" | "));

  for (const row of dataRows) {
    lines.push(row.join(" | "));
  }

  return lines.join("\n");
}

/**
 * Chunk text respecting VK's 4096 char limit.
 * Splits on paragraph boundaries when possible.
 */
export function chunkText(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt < maxLen * 0.3) {
      // Too far back, try single newline
      splitAt = remaining.lastIndexOf("\n", maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      // Still too far, try space
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      // Force split
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
