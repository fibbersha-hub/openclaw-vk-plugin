// ============================================================================
// VK API Types for OpenClaw Channel Plugin
// API Version: 5.199
// ============================================================================

// --- Config ---

export interface VkAccountConfig {
  token: string;
  groupId: string;
  enabled?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  apiVersion?: string;
  longPollWait?: number;
  /** Per-group chat configurations */
  groups?: Record<string, VkGroupChatConfig>;
  /** Enable markdown→VK formatting conversion */
  formatMarkdown?: boolean;
  /** Enable auto-parsing buttons from LLM responses */
  autoKeyboard?: boolean;
  /** Groq API key for voice message transcription via Whisper */
  groqApiKey?: string;
  /** Automatically transcribe incoming voice messages (default: true if groqApiKey set) */
  transcribeVoice?: boolean;
}

/** Per-group chat configuration (system prompt, tool policies, access) */
export interface VkGroupChatConfig {
  /** Custom system prompt for this group chat */
  systemPrompt?: string;
  /** Tool allow list (overrides default) */
  toolsAllow?: string[];
  /** Additional tools to allow (adds to default) */
  toolsAlsoAllow?: string[];
  /** Tools to deny in this group */
  toolsDeny?: string[];
  /** Allow list for this specific group */
  allowFrom?: string[];
  /** Require @bot mention to respond */
  requireMention?: boolean;
}

export interface ResolvedVkAccount extends VkAccountConfig {
  accountId: string;
  apiVersion: string;
  longPollWait: number;
}

export type DmPolicy = "open" | "pairing" | "closed" | "allowlist" | "disabled";

// --- API Core ---

export interface VkApiResponse<T = unknown> {
  response?: T;
  error?: VkApiError;
}

export interface VkApiError {
  error_code: number;
  error_msg: string;
  request_params?: Array<{ key: string; value: string }>;
  captcha_sid?: string;
  captcha_img?: string;
  redirect_uri?: string;
}

export enum VkErrorCode {
  UNKNOWN = 1,
  APP_DISABLED = 2,
  UNKNOWN_METHOD = 3,
  AUTH_FAILED = 5,
  TOO_MANY_REQUESTS = 6,
  PERMISSION_DENIED = 7,
  INVALID_REQUEST = 8,
  FLOOD_CONTROL = 9,
  INTERNAL = 10,
  CAPTCHA_NEEDED = 14,
  ACCESS_DENIED = 15,
  RATE_LIMIT = 29,
  PRIVATE_PROFILE = 30,
  PARAM_ERROR = 100,
  NOT_FOUND = 104,
  WEIGHTED_FLOOD = 601,
  MESSAGES_DENY_SEND = 901,
  MESSAGES_KEYBOARD_INVALID = 911,
  MESSAGES_TOO_LONG = 914,
  MARKET_TOO_MANY_ITEMS = 1405,
  RECAPTCHA_NEEDED = 3300,
}

// --- Long Poll ---

export interface LongPollServer {
  key: string;
  server: string;
  ts: string;
}

export interface LongPollResponse {
  ts?: string;
  updates?: VkEvent[];
  failed?: number;
  min_version?: number;
  max_version?: number;
}

// --- Events ---

export interface VkEvent {
  type: VkEventType;
  object: unknown;
  group_id: number;
  event_id: string;
}

export type VkEventType =
  // Messages
  | "message_new"
  | "message_reply"
  | "message_edit"
  | "message_event"
  | "message_typing_state"
  | "message_allow"
  | "message_deny"
  // Photos
  | "photo_new"
  | "photo_comment_new"
  | "photo_comment_edit"
  | "photo_comment_restore"
  | "photo_comment_delete"
  // Video
  | "video_new"
  | "video_comment_new"
  | "video_comment_edit"
  | "video_comment_restore"
  | "video_comment_delete"
  // Wall
  | "wall_post_new"
  | "wall_repost"
  | "wall_reply_new"
  | "wall_reply_edit"
  | "wall_reply_restore"
  | "wall_reply_delete"
  // Board
  | "board_post_new"
  | "board_post_edit"
  | "board_post_restore"
  | "board_post_delete"
  // Market
  | "market_comment_new"
  | "market_comment_edit"
  | "market_comment_restore"
  | "market_comment_delete"
  // Group
  | "group_leave"
  | "group_join"
  | "user_block"
  | "user_unblock"
  | "group_officers_edit"
  | "group_change_settings"
  | "group_change_photo"
  // Other
  | "poll_vote_new"
  | "vkpay_transaction"
  // Donut
  | "donut_subscription_create"
  | "donut_subscription_prolonged"
  | "donut_subscription_cancelled"
  | "donut_subscription_expired"
  | "donut_subscription_price_changed"
  | "donut_money_withdraw"
  | "donut_money_withdraw_error";

// --- Messages ---

export interface VkMessage {
  id: number;
  date: number;
  peer_id: number;
  from_id: number;
  text: string;
  random_id: number;
  ref?: string;
  ref_source?: string;
  attachments: VkAttachment[];
  important: boolean;
  geo?: VkGeo;
  payload?: string;
  keyboard?: VkKeyboard;
  fwd_messages?: VkMessage[];
  reply_message?: VkMessage;
  action?: VkMessageAction;
  conversation_message_id: number;
  is_cropped?: boolean;
}

export interface VkMessageNewObject {
  message: VkMessage;
  client_info: VkClientInfo;
}

export interface VkClientInfo {
  button_actions: string[];
  keyboard: boolean;
  inline_keyboard: boolean;
  carousel: boolean;
  lang_id: number;
}

export interface VkMessageAction {
  type: string;
  member_id?: number;
  text?: string;
  email?: string;
  photo?: VkPhoto;
}

export interface VkMessageEventObject {
  user_id: number;
  peer_id: number;
  event_id: string;
  payload: Record<string, unknown>;
  conversation_message_id: number;
}

// --- Keyboard ---

export interface VkKeyboard {
  one_time?: boolean;
  inline?: boolean;
  buttons: VkKeyboardButton[][];
}

export interface VkKeyboardButton {
  action: VkKeyboardButtonAction;
  color?: "primary" | "secondary" | "negative" | "positive";
}

export type VkKeyboardButtonAction =
  | { type: "text"; label: string; payload?: string }
  | { type: "callback"; label: string; payload?: string }
  | { type: "open_link"; link: string; label: string }
  | { type: "vkpay"; hash: string }
  | { type: "open_app"; app_id: number; owner_id?: number; label: string; hash?: string }
  | { type: "location"; payload?: string };

// --- Carousel (Template) ---

export interface VkCarousel {
  type: "carousel";
  elements: VkCarouselElement[];
}

export interface VkCarouselElement {
  title?: string;
  description?: string;
  photo_id?: string;
  action?: { type: "open_link"; link: string } | { type: "open_photo" };
  buttons: VkKeyboardButton[];
}

// --- Attachments ---

export interface VkAttachment {
  type: VkAttachmentType;
  photo?: VkPhoto;
  video?: VkVideo;
  audio?: VkAudio;
  audio_message?: VkAudioMessage;
  doc?: VkDoc;
  link?: VkLink;
  market?: VkMarketItem;
  wall?: VkWallPost;
  sticker?: VkSticker;
  gift?: { id: number };
}

export type VkAttachmentType =
  | "photo" | "video" | "audio" | "doc" | "link"
  | "market" | "wall" | "sticker" | "gift"
  | "graffiti" | "audio_message" | "poll";

// --- Photo ---

export interface VkPhoto {
  id: number;
  album_id: number;
  owner_id: number;
  sizes: VkPhotoSize[];
  text: string;
  date: number;
  access_key?: string;
}

export interface VkPhotoSize {
  type: string; // s, m, x, o, p, q, r, y, z, w
  url: string;
  width: number;
  height: number;
}

// --- Video ---

export interface VkVideo {
  id: number;
  owner_id: number;
  title: string;
  description: string;
  duration: number;
  image: VkPhotoSize[];
  date: number;
  player?: string;
  access_key?: string;
}

// --- Audio ---

export interface VkAudio {
  id: number;
  owner_id: number;
  artist: string;
  title: string;
  duration: number;
  url: string;
}

// --- Audio Message (Voice) ---

export interface VkAudioMessage {
  id: number;
  owner_id: number;
  duration: number;
  waveform?: number[];
  link_ogg: string;
  link_mp3?: string;
  access_key?: string;
  transcript?: string;
}

// --- Document ---

export interface VkDoc {
  id: number;
  owner_id: number;
  title: string;
  size: number;
  ext: string;
  url: string;
  date: number;
  type: number; // 1=text, 2=archive, 3=gif, 4=image, 5=audio, 6=video, 7=ebook, 8=unknown
}

// --- Link ---

export interface VkLink {
  url: string;
  title: string;
  caption?: string;
  description: string;
  photo?: VkPhoto;
}

// --- Sticker ---

export interface VkSticker {
  product_id: number;
  sticker_id: number;
  images: VkPhotoSize[];
  images_with_background: VkPhotoSize[];
  animation_url?: string;
}

// --- Geo ---

export interface VkGeo {
  type: string;
  coordinates: { latitude: number; longitude: number };
  place?: { id: number; title: string; latitude: number; longitude: number; created: number; icon: string; country: string; city: string };
}

// --- Wall Post ---

export interface VkWallPost {
  id: number;
  owner_id: number;
  from_id: number;
  date: number;
  text: string;
  attachments?: VkAttachment[];
  post_type: "post" | "copy" | "reply" | "postpone" | "suggest";
  comments?: { count: number; can_post: number };
  likes?: { count: number; user_likes: number; can_like: number };
  reposts?: { count: number; user_reposted: number };
  views?: { count: number };
  is_pinned?: number;
  marked_as_ads?: number;
  post_source?: { type: string; platform?: string };
  copy_history?: VkWallPost[];
}

// --- Market ---

export interface VkMarketItem {
  id: number;
  owner_id: number;
  title: string;
  description: string;
  price: VkMarketPrice;
  category: VkMarketCategory;
  thumb_photo: string;
  date: number;
  availability: 0 | 1 | 2; // 0=available, 1=removed, 2=unavailable
  is_favorite: boolean;
  sku?: string;
  photos?: VkPhoto[];
  can_comment?: number;
  can_repost?: number;
  likes?: { count: number; user_likes: number };
  url?: string;
  dimensions?: { width: number; height: number; length: number };
  weight?: number;
}

export interface VkMarketPrice {
  amount: string;
  currency: { id: number; name: string };
  text: string;
  old_amount?: string;
}

export interface VkMarketCategory {
  id: number;
  name: string;
  section: { id: number; name: string };
}

export interface VkMarketOrder {
  id: number;
  group_id: number;
  user_id: number;
  date: number;
  status: number;
  items_count: number;
  total_price: VkMarketPrice;
  comment?: string;
  preview_order_items?: VkMarketItem[];
}

// --- Market Album (Collection) ---

export interface VkMarketAlbum {
  id: number;
  owner_id: number;
  title: string;
  photo?: VkPhoto;
  count: number;
}

// --- Story ---

export interface VkStory {
  id: number;
  owner_id: number;
  date: number;
  type: "photo" | "video";
  photo?: VkPhoto;
  video?: VkVideo;
  views?: number;
  can_see?: number;
  can_reply?: number;
  is_expired: boolean;
}

// --- User ---

export interface VkUser {
  id: number;
  first_name: string;
  last_name: string;
  deactivated?: "deleted" | "banned";
  is_closed: boolean;
  photo_50?: string;
  photo_100?: string;
  photo_200?: string;
  online?: number;
  screen_name?: string;
  sex?: 0 | 1 | 2; // 0=unknown, 1=female, 2=male
  city?: { id: number; title: string };
  country?: { id: number; title: string };
}

// --- Group ---

export interface VkGroup {
  id: number;
  name: string;
  screen_name: string;
  is_closed: 0 | 1 | 2; // 0=open, 1=closed, 2=private
  type: "group" | "page" | "event";
  photo_50: string;
  photo_100: string;
  photo_200: string;
  description?: string;
  members_count?: number;
  status?: string;
  contacts?: Array<{ user_id: number; desc?: string; phone?: string; email?: string }>;
}

// --- Poll ---

export interface VkPoll {
  id: number;
  owner_id: number;
  created: number;
  question: string;
  votes: number;
  answers: Array<{ id: number; text: string; votes: number; rate: number }>;
  anonymous: boolean;
  multiple: boolean;
  end_date: number;
  closed: boolean;
}

// --- Stats ---

export interface VkStats {
  period_from: string;
  period_to: string;
  visitors?: { count: number; sex?: Array<{ value: string; count: number }> };
  reach?: { count: number; sex?: Array<{ value: string; count: number }> };
  activity?: { comments: number; copies: number; hidden: number; likes: number; subscribed: number; unsubscribed: number };
}

// --- Upload ---

export interface VkUploadServer {
  upload_url: string;
  album_id?: number;
  group_id?: number;
}

export interface VkUploadResult {
  server: number;
  photo?: string;
  photos_list?: string;
  hash: string;
  aid?: number;
  file?: string;
}

// --- Execute ---

export interface VkExecuteResponse {
  response: unknown[];
  execute_errors?: VkApiError[];
}

// --- Donut ---

export interface VkDonutSubscription {
  owner_id: number;
  next_payment_date: number;
  amount: number;
  status: string;
}

// --- Lead Form ---

export interface VkLeadForm {
  form_id: number;
  group_id: number;
  name: string;
  title: string;
  description: string;
  site_link_url: string;
  url: string;
  active: number;
  leads_count: number;
}

// --- App Widget ---

export type VkWidgetType =
  | "text" | "list" | "table" | "tiles"
  | "compact_list" | "cover_list" | "match" | "matches";

// --- Callback Button Response ---

export interface VkCallbackEventAnswer {
  type: "show_snackbar" | "open_link" | "open_app";
  text?: string;
  link?: string;
  app_id?: number;
  owner_id?: number;
  hash?: string;
}

// --- API Method Params (commonly used) ---

export interface SendMessageParams {
  peer_id?: number;
  peer_ids?: number[];
  user_id?: number;
  domain?: string;
  chat_id?: number;
  random_id: number;
  message?: string;
  lat?: number;
  long?: number;
  attachment?: string;
  sticker_id?: number;
  keyboard?: string; // JSON string of VkKeyboard
  template?: string; // JSON string of VkCarousel
  payload?: string;
  content_source?: string;
  forward_messages?: string;
  forward?: string;
  dont_parse_links?: 0 | 1;
  disable_mentions?: 0 | 1;
  intent?: "default" | "promo_newsletter" | "bot_ad_invite" | "bot_ad_promo";
}

export interface WallPostParams {
  owner_id: number; // negative for community
  friends_only?: 0 | 1;
  from_group?: 0 | 1;
  message?: string;
  attachments?: string;
  services?: string;
  signed?: 0 | 1;
  publish_date?: number; // Unix timestamp for scheduled post
  lat?: number;
  long?: number;
  place_id?: number;
  post_id?: number; // for editing
  guid?: string;
  mark_as_ads?: 0 | 1;
  close_comments?: 0 | 1;
  donut_paid_duration?: number;
  mute_notifications?: 0 | 1;
  copyright?: string;
  topic_id?: number;
}

export interface MarketAddParams {
  owner_id: number; // negative for community
  name: string; // 4-100 chars
  description: string; // min 10 chars
  category_id: number;
  price?: number;
  old_price?: number;
  deleted?: 0 | 1;
  main_photo_id: number;
  photo_ids?: string; // comma-separated photo IDs (up to 4 extra)
  url?: string;
  dimension_width?: number;
  dimension_height?: number;
  dimension_length?: number;
  weight?: number;
  sku?: string;
}
