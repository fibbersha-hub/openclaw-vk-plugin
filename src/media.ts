// ============================================================================
// Inbound Media Handler — extract attachments from VK messages
// ============================================================================

import type { VkMessage, VkAttachment, VkPhotoSize } from "./types.js";

const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 5 MB limit for inbound media

// ============================================================================
// Types
// ============================================================================

export interface ExtractedMedia {
  type: "image" | "document" | "audio" | "video" | "sticker" | "link" | "voice";
  url: string;
  mimeType: string;
  filename?: string;
  caption?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
}

// ============================================================================
// Extract media from VK message attachments
// ============================================================================

/**
 * Extract all media attachments from a VK message.
 * Returns structured media objects for OpenClaw to process.
 */
export function extractMedia(msg: VkMessage): ExtractedMedia[] {
  if (!msg.attachments || msg.attachments.length === 0) return [];

  const media: ExtractedMedia[] = [];

  for (const att of msg.attachments) {
    const extracted = extractSingleAttachment(att);
    if (extracted) media.push(extracted);
  }

  return media;
}

function extractSingleAttachment(att: VkAttachment): ExtractedMedia | null {
  switch (att.type) {
    case "photo":
      return extractPhoto(att);
    case "doc":
      return extractDoc(att);
    case "audio":
      return extractAudio(att);
    case "video":
      return extractVideo(att);
    case "sticker":
      return extractSticker(att);
    case "link":
      return extractLink(att);
    case "audio_message":
      return extractVoice(att);
    default:
      return null;
  }
}

// ============================================================================
// Individual attachment extractors
// ============================================================================

function extractPhoto(att: VkAttachment): ExtractedMedia | null {
  if (!att.photo?.sizes?.length) return null;

  // Get the largest photo size
  const best = getBestPhotoSize(att.photo.sizes);
  if (!best) return null;

  return {
    type: "image",
    url: best.url,
    mimeType: "image/jpeg",
    width: best.width,
    height: best.height,
    caption: att.photo.text || undefined,
  };
}

function extractDoc(att: VkAttachment): ExtractedMedia | null {
  if (!att.doc?.url) return null;

  const doc = att.doc;
  const mimeType = docExtToMime(doc.ext) ?? "application/octet-stream";

  // GIF → classify as image
  if (doc.ext === "gif") {
    return {
      type: "image",
      url: doc.url,
      mimeType: "image/gif",
      filename: doc.title,
      size: doc.size,
    };
  }

  // Image documents (type 4)
  if (doc.type === 4) {
    return {
      type: "image",
      url: doc.url,
      mimeType,
      filename: doc.title,
      size: doc.size,
    };
  }

  return {
    type: "document",
    url: doc.url,
    mimeType,
    filename: doc.title,
    size: doc.size,
  };
}

function extractAudio(att: VkAttachment): ExtractedMedia | null {
  if (!att.audio?.url) return null;

  return {
    type: "audio",
    url: att.audio.url,
    mimeType: "audio/mpeg",
    filename: `${att.audio.artist} - ${att.audio.title}.mp3`,
    duration: att.audio.duration,
  };
}

function extractVideo(att: VkAttachment): ExtractedMedia | null {
  if (!att.video) return null;

  // VK doesn't give direct video URL in message events,
  // but we can provide player URL and thumbnail
  const url = att.video.player ?? "";
  if (!url) return null;

  return {
    type: "video",
    url,
    mimeType: "video/mp4",
    caption: att.video.title,
    duration: att.video.duration,
  };
}

function extractSticker(att: VkAttachment): ExtractedMedia | null {
  if (!att.sticker?.images?.length) return null;

  // Get largest sticker image
  const best = att.sticker.images.reduce((a, b) =>
    (a.width ?? 0) > (b.width ?? 0) ? a : b,
  );

  return {
    type: "sticker",
    url: best.url,
    mimeType: "image/png",
    width: best.width,
    height: best.height,
  };
}

function extractLink(att: VkAttachment): ExtractedMedia | null {
  if (!att.link?.url) return null;

  return {
    type: "link",
    url: att.link.url,
    mimeType: "text/html",
    caption: att.link.title,
  };
}

function extractVoice(att: VkAttachment): ExtractedMedia | null {
  if (!att.audio_message) return null;
  const url = att.audio_message.link_ogg || att.audio_message.link_mp3 || "";
  if (!url) return null;

  return {
    type: "voice",
    url,
    mimeType: att.audio_message.link_ogg ? "audio/ogg" : "audio/mpeg",
    filename: "voice_message.ogg",
    duration: att.audio_message.duration,
  };
}

// ============================================================================
// Build text representation for media-only messages
// ============================================================================

/**
 * Build a text description of media for messages that have attachments but no text.
 * This helps the LLM understand what was sent.
 */
export function buildMediaDescription(media: ExtractedMedia[]): string {
  if (media.length === 0) return "";

  const parts = media.map((m) => {
    switch (m.type) {
      case "image":
        return m.caption ? `[Фото: ${m.caption}]` : "[Фото]";
      case "document":
        return `[Документ: ${m.filename ?? "файл"}]`;
      case "audio":
        return `[Аудио: ${m.filename ?? "аудио"}]`;
      case "video":
        return `[Видео: ${m.caption ?? "видео"}]`;
      case "sticker":
        return "[Стикер]";
      case "link":
        return `[Ссылка: ${m.caption ?? m.url}]`;
      case "voice":
        return m.duration ? `[Голосовое сообщение, ${m.duration}с]` : "[Голосовое сообщение]";
      default:
        return "[Вложение]";
    }
  });

  return parts.join("\n");
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the best (largest useful) photo size.
 * Prefers sizes: w > z > y > x > r > q > p > o > m > s
 */
function getBestPhotoSize(sizes: VkPhotoSize[]): VkPhotoSize | null {
  const priority = ["w", "z", "y", "x", "r", "q", "p", "o", "m", "s"];

  for (const type of priority) {
    const found = sizes.find((s) => s.type === type);
    if (found) return found;
  }

  // Fallback: largest by area
  return sizes.reduce((best, s) =>
    (s.width * s.height) > ((best?.width ?? 0) * (best?.height ?? 0)) ? s : best,
    sizes[0]!,
  );
}

/**
 * Map common file extensions to MIME types.
 */
function docExtToMime(ext: string): string | null {
  const map: Record<string, string> = {
    // Images
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
    svg: "image/svg+xml", tiff: "image/tiff",
    // Documents
    pdf: "application/pdf", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    txt: "text/plain", csv: "text/csv", json: "application/json",
    xml: "text/xml", html: "text/html", md: "text/markdown",
    // Archives
    zip: "application/zip", rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed", tar: "application/x-tar",
    gz: "application/gzip",
    // Audio
    mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
    flac: "audio/flac", aac: "audio/aac",
    // Video
    mp4: "video/mp4", avi: "video/x-msvideo", mkv: "video/x-matroska",
    webm: "video/webm", mov: "video/quicktime",
    // Code
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    java: "text/x-java-source", c: "text/x-c", cpp: "text/x-c++",
    h: "text/x-c", cs: "text/x-csharp", rb: "text/x-ruby",
    go: "text/x-go", rs: "text/x-rust", sql: "text/x-sql",
    sh: "text/x-shellscript", yaml: "text/yaml", yml: "text/yaml",
    // 3D
    stl: "model/stl", obj: "model/obj", glb: "model/gltf-binary",
    gltf: "model/gltf+json", fbx: "application/octet-stream",
  };

  return map[ext.toLowerCase()] ?? null;
}
