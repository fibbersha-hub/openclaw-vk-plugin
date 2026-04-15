// ============================================================================
// VK API Client — Rate-limited, with execute() batching and error handling
// ============================================================================

import FormData from "form-data";
import { createReadStream } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  VkApiResponse,
  VkApiError,
  VkErrorCode,
  LongPollServer,
  VkUploadServer,
  VkUploadResult,
  VkPhoto,
  VkDoc,
  VkVideo,
  VkUser,
  VkGroup,
  VkWallPost,
  VkMarketItem,
  VkMarketAlbum,
  VkMarketOrder,
  VkStory,
  VkPoll,
  VkStats,
  VkLeadForm,
  VkDonutSubscription,
  VkMessage,
  SendMessageParams,
  WallPostParams,
  MarketAddParams,
  VkCallbackEventAnswer,
  VkWidgetType,
  VkKeyboard,
  VkKeyboardButton,
  VkCarousel,
} from "./types.js";

const VK_API_BASE = "https://api.vk.com/method";
const MAX_REQUESTS_PER_SECOND = 3;
const EXECUTE_BATCH_SIZE = 25;

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private queue: Array<{ resolve: () => void }> = [];
  private timestamps: number[] = [];
  private processing = false;

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      if (!this.processing) this.process();
    });
  }

  private async process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);

      if (this.timestamps.length >= MAX_REQUESTS_PER_SECOND) {
        const waitMs = 1000 - (now - this.timestamps[0]!) + 10;
        await sleep(waitMs);
        continue;
      }

      const item = this.queue.shift();
      if (item) {
        this.timestamps.push(Date.now());
        item.resolve();
      }
    }
    this.processing = false;
  }
}

// ============================================================================
// VK API Client
// ============================================================================

export class VkApi {
  private token: string;
  private groupId: string;
  private version: string;
  private rateLimiter = new RateLimiter();
  private log: (msg: string) => void;

  constructor(opts: {
    token: string;
    groupId: string;
    version?: string;
    log?: (msg: string) => void;
  }) {
    this.token = opts.token;
    this.groupId = opts.groupId;
    this.version = opts.version ?? "5.199";
    this.log = opts.log ?? console.log;
  }

  // -------------------------------------------------------------------------
  // Core: call any VK API method
  // -------------------------------------------------------------------------

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    retries = 2,
  ): Promise<T> {
    await this.rateLimiter.acquire();

    const body = new URLSearchParams();
    body.set("access_token", this.token);
    body.set("v", this.version);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    }

    const response = await fetch(`${VK_API_BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const json = (await response.json()) as VkApiResponse<T>;

    if (json.error) {
      const err = json.error;

      // Retryable errors
      if (
        retries > 0 &&
        (err.error_code === 6 || err.error_code === 9 || err.error_code === 1)
      ) {
        const delay = err.error_code === 6 ? 350 : 1000;
        this.log(`[vk-api] Rate limit (${err.error_code}), retry in ${delay}ms...`);
        await sleep(delay);
        return this.call<T>(method, params, retries - 1);
      }

      throw new VkApiCallError(method, err);
    }

    return json.response as T;
  }

  // -------------------------------------------------------------------------
  // execute() — batch up to 25 API calls in one request
  // -------------------------------------------------------------------------

  async execute<T = unknown>(code: string): Promise<T> {
    return this.call<T>("execute", { code });
  }

  async executeBatch(
    calls: Array<{ method: string; params: Record<string, unknown> }>,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    for (let i = 0; i < calls.length; i += EXECUTE_BATCH_SIZE) {
      const batch = calls.slice(i, i + EXECUTE_BATCH_SIZE);
      const code = batch
        .map((c) => {
          const paramStr = JSON.stringify(c.params);
          return `API.${c.method}(${paramStr})`;
        })
        .join(",");
      const batchResult = await this.execute<unknown[]>(`return [${code}];`);
      results.push(...batchResult);
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // File upload (generic 3-step process)
  // -------------------------------------------------------------------------

  private async uploadFile(
    uploadUrl: string,
    filePath: string,
    fieldName = "file",
  ): Promise<VkUploadResult> {
    const form = new FormData();
    form.append(fieldName, createReadStream(filePath));

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: form as unknown as BodyInit,
      headers: form.getHeaders() as Record<string, string>,
    });

    return (await response.json()) as VkUploadResult;
  }

  private async uploadFileFromBuffer(
    uploadUrl: string,
    buffer: Buffer,
    filename: string,
    fieldName = "file",
  ): Promise<VkUploadResult> {
    const form = new FormData();
    form.append(fieldName, buffer, { filename });

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: form as unknown as BodyInit,
      headers: form.getHeaders() as Record<string, string>,
    });

    return (await response.json()) as VkUploadResult;
  }

  // =========================================================================
  // MESSAGES
  // =========================================================================

  async messagesSend(params: SendMessageParams): Promise<number> {
    return this.call<number>("messages.send", params as unknown as Record<string, unknown>);
  }

  async messagesEdit(params: {
    peer_id: number;
    message_id: number;
    message?: string;
    attachment?: string;
    keyboard?: string;
    dont_parse_links?: 0 | 1;
  }): Promise<1> {
    return this.call<1>("messages.edit", params);
  }

  async messagesDelete(params: {
    message_ids?: string;
    cmids?: string;
    peer_id?: number;
    spam?: 0 | 1;
    delete_for_all?: 0 | 1;
  }): Promise<Record<string, 1>> {
    return this.call("messages.delete", params);
  }

  async messagesGetHistory(params: {
    peer_id: number;
    offset?: number;
    count?: number; // max 200
    start_message_id?: number;
    rev?: 0 | 1;
  }): Promise<{ count: number; items: VkMessage[] }> {
    return this.call("messages.getHistory", params);
  }

  async messagesGetConversations(params?: {
    offset?: number;
    count?: number; // max 200
    filter?: "all" | "unread" | "important" | "unanswered";
  }): Promise<{ count: number; items: Array<{ conversation: unknown; last_message: VkMessage }> }> {
    return this.call("messages.getConversations", params ?? {});
  }

  async messagesSetActivity(params: {
    peer_id: number;
    type: "typing" | "audiomessage";
  }): Promise<1> {
    return this.call<1>("messages.setActivity", { ...params, group_id: this.groupId });
  }

  async messagesPin(params: {
    peer_id: number;
    message_id?: number;
    conversation_message_id?: number;
  }): Promise<VkMessage> {
    return this.call("messages.pin", params);
  }

  async messagesUnpin(params: { peer_id: number }): Promise<1> {
    return this.call<1>("messages.unpin", params);
  }

  async messagesMarkAsRead(params: {
    peer_id: number;
    start_message_id?: number;
  }): Promise<1> {
    return this.call<1>("messages.markAsRead", { ...params, group_id: this.groupId });
  }

  async messagesSearch(params: {
    q: string;
    peer_id?: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkMessage[] }> {
    return this.call("messages.search", { ...params, group_id: this.groupId });
  }

  async messagesSendEventAnswer(params: {
    event_id: string;
    user_id: number;
    peer_id: number;
    event_data: VkCallbackEventAnswer;
  }): Promise<1> {
    return this.call<1>("messages.sendMessageEventAnswer", {
      ...params,
      event_data: JSON.stringify(params.event_data),
    });
  }

  async messagesCreateChat(params: {
    user_ids: number[];
    title: string;
  }): Promise<number> {
    return this.call<number>("messages.createChat", {
      ...params,
      user_ids: params.user_ids.join(","),
      group_id: this.groupId,
    });
  }

  async messagesGetConversationMembers(params: {
    peer_id: number;
  }): Promise<{ count: number; items: Array<{ member_id: number; invited_by: number; join_date: number; is_admin?: boolean }> }> {
    return this.call("messages.getConversationMembers", { ...params, group_id: this.groupId });
  }

  async messagesGetHistoryAttachments(params: {
    peer_id: number;
    media_type: "photo" | "video" | "audio" | "doc" | "link" | "market" | "wall" | "graffiti" | "audio_message";
    count?: number;
    start_from?: string;
  }): Promise<{ items: Array<{ message_id: number; attachment: unknown }>; next_from?: string }> {
    return this.call("messages.getHistoryAttachments", { ...params, group_id: this.groupId });
  }

  async messagesSendReaction(params: {
    peer_id: number;
    cmid: number;
    reaction_id: number;
  }): Promise<1> {
    return this.call<1>("messages.sendReaction", params);
  }

  async messagesDeleteReaction(params: {
    peer_id: number;
    cmid: number;
  }): Promise<1> {
    return this.call<1>("messages.deleteReaction", params);
  }

  // =========================================================================
  // PHOTOS
  // =========================================================================

  async photosGetMessagesUploadServer(params?: {
    peer_id?: number;
  }): Promise<VkUploadServer> {
    return this.call("photos.getMessagesUploadServer", { ...params, group_id: this.groupId });
  }

  async photosSaveMessagesPhoto(params: {
    photo: string;
    server: number;
    hash: string;
  }): Promise<VkPhoto[]> {
    return this.call("photos.saveMessagesPhoto", params);
  }

  async photosGetWallUploadServer(params?: {
    group_id?: string;
  }): Promise<VkUploadServer> {
    return this.call("photos.getWallUploadServer", { group_id: params?.group_id ?? this.groupId });
  }

  async photosSaveWallPhoto(params: {
    photo: string;
    server: number;
    hash: string;
    group_id?: string;
  }): Promise<VkPhoto[]> {
    return this.call("photos.saveWallPhoto", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async photosGetMarketUploadServer(params: {
    group_id?: string;
    main_photo?: 0 | 1;
    crop_x?: number;
    crop_y?: number;
    crop_width?: number;
  }): Promise<VkUploadServer> {
    return this.call("photos.getMarketUploadServer", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async photosSaveMarketPhoto(params: {
    photo: string;
    server: number;
    hash: string;
    crop_data?: string;
    crop_hash?: string;
    group_id?: string;
  }): Promise<VkPhoto[]> {
    return this.call("photos.saveMarketPhoto", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async photosGetOwnerCoverPhotoUploadServer(params?: {
    group_id?: string;
    crop_x?: number;
    crop_y?: number;
    crop_x2?: number;
    crop_y2?: number;
  }): Promise<VkUploadServer> {
    return this.call("photos.getOwnerCoverPhotoUploadServer", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async photosSaveOwnerCoverPhoto(params: {
    photo: string;
    hash: string;
  }): Promise<{ images: Array<{ url: string; width: number; height: number }> }> {
    return this.call("photos.saveOwnerCoverPhoto", params);
  }

  // High-level: upload photo for messages
  async uploadPhotoForMessage(filePath: string, peerId?: number): Promise<VkPhoto> {
    const server = await this.photosGetMessagesUploadServer({ peer_id: peerId });
    const uploaded = await this.uploadFile(server.upload_url, filePath, "photo");
    const saved = await this.photosSaveMessagesPhoto({
      photo: uploaded.photo!,
      server: uploaded.server,
      hash: uploaded.hash,
    });
    return saved[0]!;
  }

  // High-level: upload photo for wall post
  async uploadPhotoForWall(filePath: string): Promise<VkPhoto> {
    const server = await this.photosGetWallUploadServer();
    const uploaded = await this.uploadFile(server.upload_url, filePath, "photo");
    const saved = await this.photosSaveWallPhoto({
      photo: uploaded.photo!,
      server: uploaded.server,
      hash: uploaded.hash,
    });
    return saved[0]!;
  }

  // High-level: upload photo for market item
  async uploadPhotoForMarket(filePath: string, mainPhoto = true): Promise<VkPhoto> {
    const server = await this.photosGetMarketUploadServer({ main_photo: mainPhoto ? 1 : 0 });
    const uploaded = await this.uploadFile(server.upload_url, filePath, "file");
    const saved = await this.photosSaveMarketPhoto({
      photo: uploaded.photo!,
      server: uploaded.server,
      hash: uploaded.hash,
    });
    return saved[0]!;
  }

  // High-level: upload community cover
  async uploadCoverPhoto(filePath: string): Promise<string> {
    const server = await this.photosGetOwnerCoverPhotoUploadServer();
    const uploaded = await this.uploadFile(server.upload_url, filePath, "photo");
    const result = await this.photosSaveOwnerCoverPhoto({
      photo: uploaded.photo!,
      hash: uploaded.hash,
    });
    return result.images[0]?.url ?? "";
  }

  // =========================================================================
  // DOCUMENTS
  // =========================================================================

  async docsGetMessagesUploadServer(params: {
    peer_id: number;
    type?: "doc" | "audio_message" | "graffiti";
  }): Promise<VkUploadServer> {
    return this.call("docs.getMessagesUploadServer", { ...params, group_id: this.groupId });
  }

  async docsGetWallUploadServer(params?: {
    group_id?: string;
  }): Promise<VkUploadServer> {
    return this.call("docs.getWallUploadServer", { group_id: params?.group_id ?? this.groupId });
  }

  async docsSave(params: {
    file: string;
    title?: string;
    tags?: string;
  }): Promise<{ type: string; doc?: VkDoc; audio_message?: unknown; graffiti?: unknown }> {
    return this.call("docs.save", params);
  }

  async docsGet(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
    type?: number;
  }): Promise<{ count: number; items: VkDoc[] }> {
    return this.call("docs.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  // High-level: upload document for message
  async uploadDocForMessage(filePath: string, peerId: number, title?: string): Promise<VkDoc> {
    const server = await this.docsGetMessagesUploadServer({ peer_id: peerId });
    const uploaded = await this.uploadFile(server.upload_url, filePath, "file");
    const saved = await this.docsSave({ file: uploaded.file!, title });
    return saved.doc!;
  }

  // High-level: upload document for wall
  async uploadDocForWall(filePath: string, title?: string): Promise<VkDoc> {
    const server = await this.docsGetWallUploadServer();
    const uploaded = await this.uploadFile(server.upload_url, filePath, "file");
    const saved = await this.docsSave({ file: uploaded.file!, title });
    return saved.doc!;
  }

  // =========================================================================
  // VIDEO
  // =========================================================================

  async videoSave(params: {
    name?: string;
    description?: string;
    is_private?: 0 | 1;
    wallpost?: 0 | 1;
    group_id?: string;
    album_id?: number;
    no_comments?: 0 | 1;
    repeat?: 0 | 1;
    compression?: 0 | 1;
  }): Promise<{ access_key: string; description: string; owner_id: number; title: string; upload_url: string; video_id: number }> {
    return this.call("video.save", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async videoGet(params?: {
    owner_id?: number;
    videos?: string;
    album_id?: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkVideo[] }> {
    return this.call("video.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  // High-level: upload video
  async uploadVideo(filePath: string, name?: string, description?: string): Promise<{ video_id: number; owner_id: number }> {
    const saveResult = await this.videoSave({ name, description });
    await this.uploadFile(saveResult.upload_url, filePath, "video_file");
    return { video_id: saveResult.video_id, owner_id: saveResult.owner_id };
  }

  // =========================================================================
  // WALL
  // =========================================================================

  async wallPost(params: WallPostParams): Promise<{ post_id: number }> {
    return this.call("wall.post", {
      ...params,
      owner_id: params.owner_id || -Number(this.groupId),
    } as Record<string, unknown>);
  }

  async wallEdit(params: WallPostParams & { post_id: number }): Promise<{ post_id: number }> {
    return this.call("wall.edit", {
      ...params,
      owner_id: params.owner_id || -Number(this.groupId),
    } as Record<string, unknown>);
  }

  async wallDelete(params: { owner_id?: number; post_id: number }): Promise<1> {
    return this.call<1>("wall.delete", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async wallGet(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
    filter?: "owner" | "others" | "all" | "suggests" | "postponed";
  }): Promise<{ count: number; items: VkWallPost[] }> {
    return this.call("wall.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  async wallGetById(params: { posts: string }): Promise<VkWallPost[]> {
    return this.call("wall.getById", params);
  }

  async wallPin(params: { post_id: number; owner_id?: number }): Promise<1> {
    return this.call<1>("wall.pin", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async wallUnpin(params: { post_id: number; owner_id?: number }): Promise<1> {
    return this.call<1>("wall.unpin", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async wallCreateComment(params: {
    owner_id?: number;
    post_id: number;
    message?: string;
    attachments?: string;
    from_group?: number;
    reply_to_comment?: number;
    sticker_id?: number;
  }): Promise<{ comment_id: number }> {
    return this.call("wall.createComment", {
      ...params,
      owner_id: params.owner_id ?? -Number(this.groupId),
      from_group: params.from_group ?? Number(this.groupId),
    });
  }

  async wallGetComments(params: {
    owner_id?: number;
    post_id: number;
    count?: number;
    offset?: number;
    sort?: "asc" | "desc";
    need_likes?: 0 | 1;
  }): Promise<{ count: number; items: unknown[] }> {
    return this.call("wall.getComments", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async wallSearch(params: {
    owner_id?: number;
    query: string;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkWallPost[] }> {
    return this.call("wall.search", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async wallRepost(params: {
    object: string; // e.g. "wall-123_456"
    message?: string;
    group_id?: string;
  }): Promise<{ success: 1; post_id: number; reposts_count: number; likes_count: number }> {
    return this.call("wall.repost", params);
  }

  // =========================================================================
  // MARKET
  // =========================================================================

  async marketAdd(params: MarketAddParams): Promise<{ market_item_id: number }> {
    return this.call("market.add", {
      ...params,
      owner_id: params.owner_id || -Number(this.groupId),
    } as Record<string, unknown>);
  }

  async marketEdit(params: MarketAddParams & { item_id: number }): Promise<1> {
    return this.call<1>("market.edit", {
      ...params,
      owner_id: params.owner_id || -Number(this.groupId),
    } as Record<string, unknown>);
  }

  async marketDelete(params: { item_id: number; owner_id?: number }): Promise<1> {
    return this.call<1>("market.delete", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketRestore(params: { item_id: number; owner_id?: number }): Promise<1> {
    return this.call<1>("market.restore", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketGet(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
    album_id?: number;
    need_variants?: 0 | 1;
  }): Promise<{ count: number; items: VkMarketItem[] }> {
    return this.call("market.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  async marketGetById(params: { item_ids: string }): Promise<{ count: number; items: VkMarketItem[] }> {
    return this.call("market.getById", params);
  }

  async marketSearch(params: {
    owner_id?: number;
    q?: string;
    price_from?: number;
    price_to?: number;
    sort?: 0 | 1 | 2 | 3; // 0=default, 1=date, 2=price_asc, 3=price_desc
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkMarketItem[] }> {
    return this.call("market.search", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketGetCategories(params?: { count?: number; offset?: number }): Promise<{ count: number; items: unknown[] }> {
    return this.call("market.getCategories", params ?? {});
  }

  // Albums (Collections)
  async marketAddAlbum(params: {
    title: string;
    photo_id?: number;
    main_album?: 0 | 1;
    is_hidden?: 0 | 1;
    owner_id?: number;
  }): Promise<{ market_album_id: number }> {
    return this.call("market.addAlbum", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketEditAlbum(params: {
    album_id: number;
    title: string;
    photo_id?: number;
    main_album?: 0 | 1;
    is_hidden?: 0 | 1;
    owner_id?: number;
  }): Promise<1> {
    return this.call<1>("market.editAlbum", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketDeleteAlbum(params: { album_id: number; owner_id?: number }): Promise<1> {
    return this.call<1>("market.deleteAlbum", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketGetAlbums(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkMarketAlbum[] }> {
    return this.call("market.getAlbums", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  async marketAddToAlbum(params: {
    item_id: number;
    album_ids: number[];
    owner_id?: number;
  }): Promise<1> {
    return this.call<1>("market.addToAlbum", {
      ...params,
      album_ids: params.album_ids.join(","),
      owner_id: params.owner_id ?? -Number(this.groupId),
    });
  }

  async marketRemoveFromAlbum(params: {
    item_id: number;
    album_ids: number[];
    owner_id?: number;
  }): Promise<1> {
    return this.call<1>("market.removeFromAlbum", {
      ...params,
      album_ids: params.album_ids.join(","),
      owner_id: params.owner_id ?? -Number(this.groupId),
    });
  }

  // Orders
  async marketGetGroupOrders(params?: {
    group_id?: string;
    offset?: number;
    count?: number;
  }): Promise<{ count: number; items: VkMarketOrder[] }> {
    return this.call("market.getGroupOrders", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async marketGetOrderById(params: {
    order_id: number;
    user_id?: number;
  }): Promise<VkMarketOrder> {
    return this.call("market.getOrderById", params);
  }

  async marketEditOrder(params: {
    order_id: number;
    user_id: number;
    merchant_comment?: string;
    status?: number;
    track_number?: string;
    payment_status?: string;
    delivery_type?: string;
    width?: number;
    height?: number;
    length?: number;
    weight?: number;
  }): Promise<1> {
    return this.call<1>("market.editOrder", params);
  }

  // Market comments
  async marketCreateComment(params: {
    item_id: number;
    owner_id?: number;
    message?: string;
    attachments?: string;
    from_group?: 0 | 1;
  }): Promise<number> {
    return this.call<number>("market.createComment", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async marketGetComments(params: {
    item_id: number;
    owner_id?: number;
    count?: number;
    offset?: number;
    sort?: "asc" | "desc";
  }): Promise<{ count: number; items: unknown[] }> {
    return this.call("market.getComments", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  // =========================================================================
  // STORIES
  // =========================================================================

  async storiesGetPhotoUploadServer(params?: {
    add_to_news?: 0 | 1;
    user_ids?: string;
    reply_to_story?: string;
    link_text?: string;
    link_url?: string;
    group_id?: string;
  }): Promise<VkUploadServer> {
    return this.call("stories.getPhotoUploadServer", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async storiesGetVideoUploadServer(params?: {
    add_to_news?: 0 | 1;
    user_ids?: string;
    reply_to_story?: string;
    link_text?: string;
    link_url?: string;
    group_id?: string;
  }): Promise<VkUploadServer> {
    return this.call("stories.getVideoUploadServer", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async storiesSave(params: { upload_results: string }): Promise<{ count: number; items: VkStory[] }> {
    return this.call("stories.save", params);
  }

  async storiesGet(params?: {
    owner_id?: number;
  }): Promise<{ count: number; items: VkStory[] }> {
    return this.call("stories.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  async storiesGetViewers(params: { story_id: number; owner_id?: number; count?: number; offset?: number }): Promise<{ count: number; items: unknown[] }> {
    return this.call("stories.getViewers", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  // High-level: upload photo story
  async uploadPhotoStory(filePath: string, addToNews = true): Promise<VkStory> {
    const server = await this.storiesGetPhotoUploadServer({ add_to_news: addToNews ? 1 : 0 });
    const uploaded = await this.uploadFile(server.upload_url, filePath, "file");
    const saved = await this.storiesSave({ upload_results: JSON.stringify(uploaded) });
    return saved.items[0]!;
  }

  // =========================================================================
  // GROUPS / COMMUNITY
  // =========================================================================

  async groupsGetById(params?: {
    group_id?: string;
    group_ids?: string;
    fields?: string;
  }): Promise<{ groups: VkGroup[] }> {
    return this.call("groups.getById", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async groupsGetMembers(params?: {
    group_id?: string;
    sort?: "id_asc" | "id_desc" | "time_asc" | "time_desc";
    offset?: number;
    count?: number;
    fields?: string;
    filter?: "friends" | "unsure" | "managers" | "donut";
  }): Promise<{ count: number; items: number[] }> {
    return this.call("groups.getMembers", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async groupsEdit(params: Record<string, unknown>): Promise<1> {
    return this.call<1>("groups.edit", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsBan(params: {
    group_id?: string;
    owner_id: number;
    end_date?: number;
    reason?: number;
    comment?: string;
    comment_visible?: 0 | 1;
  }): Promise<1> {
    return this.call<1>("groups.ban", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsUnban(params: { owner_id: number; group_id?: string }): Promise<1> {
    return this.call<1>("groups.unban", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsGetBanned(params?: {
    group_id?: string;
    offset?: number;
    count?: number;
  }): Promise<{ count: number; items: unknown[] }> {
    return this.call("groups.getBanned", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async groupsIsMember(params: {
    group_id?: string;
    user_id?: number;
    user_ids?: string;
  }): Promise<number | Array<{ member: number; user_id: number }>> {
    return this.call("groups.isMember", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsEnableOnline(params?: { group_id?: string }): Promise<1> {
    return this.call<1>("groups.enableOnline", { group_id: params?.group_id ?? this.groupId });
  }

  async groupsDisableOnline(params?: { group_id?: string }): Promise<1> {
    return this.call<1>("groups.disableOnline", { group_id: params?.group_id ?? this.groupId });
  }

  async groupsGetOnlineStatus(params?: { group_id?: string }): Promise<{ status: string; minutes?: number }> {
    return this.call("groups.getOnlineStatus", { group_id: params?.group_id ?? this.groupId });
  }

  async groupsGetTokenPermissions(): Promise<{ mask: number; permissions: Array<{ setting: number; name: string }> }> {
    return this.call("groups.getTokenPermissions", {});
  }

  async groupsGetSettings(params?: { group_id?: string }): Promise<Record<string, unknown>> {
    return this.call("groups.getSettings", { group_id: params?.group_id ?? this.groupId });
  }

  // Tags
  async groupsTagAdd(params: { group_id?: string; tag_name: string; tag_color?: string }): Promise<1> {
    return this.call<1>("groups.tagAdd", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsTagDelete(params: { group_id?: string; tag_id: number }): Promise<1> {
    return this.call<1>("groups.tagDelete", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async groupsGetTagList(params?: { group_id?: string }): Promise<unknown[]> {
    return this.call("groups.getTagList", { group_id: params?.group_id ?? this.groupId });
  }

  // Long Poll
  async groupsGetLongPollServer(params?: { group_id?: string }): Promise<LongPollServer> {
    return this.call("groups.getLongPollServer", { group_id: params?.group_id ?? this.groupId });
  }

  // =========================================================================
  // USERS
  // =========================================================================

  async usersGet(params: {
    user_ids?: string;
    fields?: string;
    name_case?: "nom" | "gen" | "dat" | "acc" | "ins" | "abl";
  }): Promise<VkUser[]> {
    return this.call("users.get", params);
  }

  // =========================================================================
  // LIKES
  // =========================================================================

  async likesAdd(params: {
    type: "post" | "comment" | "photo" | "video" | "market" | "market_comment";
    owner_id?: number;
    item_id: number;
  }): Promise<{ likes: number }> {
    return this.call("likes.add", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async likesDelete(params: {
    type: "post" | "comment" | "photo" | "video" | "market" | "market_comment";
    owner_id?: number;
    item_id: number;
  }): Promise<{ likes: number }> {
    return this.call("likes.delete", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async likesGetList(params: {
    type: "post" | "comment" | "photo" | "video" | "market" | "market_comment";
    owner_id?: number;
    item_id: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: number[] }> {
    return this.call("likes.getList", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  // =========================================================================
  // POLLS
  // =========================================================================

  async pollsCreate(params: {
    owner_id?: number;
    question: string;
    is_anonymous?: 0 | 1;
    is_multiple?: 0 | 1;
    end_date?: number;
    add_answers: string; // JSON array of strings
  }): Promise<VkPoll> {
    return this.call("polls.create", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async pollsGetById(params: { poll_id: number; owner_id?: number }): Promise<VkPoll> {
    return this.call("polls.getById", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async pollsGetVoters(params: {
    poll_id: number;
    answer_ids: string;
    owner_id?: number;
    count?: number;
    offset?: number;
  }): Promise<Array<{ answer_id: number; users: { count: number; items: number[] } }>> {
    return this.call("polls.getVoters", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  // =========================================================================
  // STATS
  // =========================================================================

  async statsGet(params: {
    group_id?: string;
    date_from: string; // YYYY-MM-DD
    date_to: string;
    stats_groups?: string;
  }): Promise<VkStats[]> {
    return this.call("stats.get", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async statsGetPostReach(params: {
    owner_id?: number;
    post_ids: string;
  }): Promise<Array<{ reach_subscribers: number; reach_total: number; reach_viral: number; reach_ads: number }>> {
    return this.call("stats.getPostReach", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  // =========================================================================
  // LEAD FORMS
  // =========================================================================

  async leadFormsGet(params: { form_id: number; group_id?: string }): Promise<VkLeadForm> {
    return this.call("leadForms.get", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async leadFormsList(params?: { group_id?: string }): Promise<VkLeadForm[]> {
    return this.call("leadForms.list", { group_id: params?.group_id ?? this.groupId });
  }

  async leadFormsGetLeads(params: {
    form_id: number;
    group_id?: string;
    limit?: number;
    next_page_token?: string;
  }): Promise<{ leads: unknown[]; next_page_token?: string }> {
    return this.call("leadForms.getLeads", { ...params, group_id: params.group_id ?? this.groupId });
  }

  // =========================================================================
  // APP WIDGETS
  // =========================================================================

  async appWidgetsUpdate(params: {
    code: string; // VKScript code for widget content
    type: VkWidgetType;
  }): Promise<1> {
    return this.call<1>("appWidgets.update", params);
  }

  // =========================================================================
  // BOARD (Discussions)
  // =========================================================================

  async boardGetTopics(params?: {
    group_id?: string;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: unknown[] }> {
    return this.call("board.getTopics", { ...params, group_id: params?.group_id ?? this.groupId });
  }

  async boardAddTopic(params: {
    group_id?: string;
    title: string;
    text?: string;
    from_group?: 0 | 1;
    attachments?: string;
  }): Promise<number> {
    return this.call<number>("board.addTopic", { ...params, group_id: params.group_id ?? this.groupId });
  }

  async boardCreateComment(params: {
    group_id?: string;
    topic_id: number;
    message?: string;
    attachments?: string;
    from_group?: 0 | 1;
    sticker_id?: number;
  }): Promise<number> {
    return this.call<number>("board.createComment", { ...params, group_id: params.group_id ?? this.groupId });
  }

  // =========================================================================
  // DONUT
  // =========================================================================

  async donutIsDon(params: { owner_id?: number }): Promise<number> {
    return this.call<number>("donut.isDon", { owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async donutGetFriends(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: VkUser[] }> {
    return this.call("donut.getFriends", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }

  // =========================================================================
  // UTILS
  // =========================================================================

  async utilsResolveScreenName(params: { screen_name: string }): Promise<{ type: string; object_id: number } | []> {
    return this.call("utils.resolveScreenName", params);
  }

  async utilsGetShortLink(params: { url: string; private?: 0 | 1 }): Promise<{ short_url: string; url: string; key: string }> {
    return this.call("utils.getShortLink", params);
  }

  async utilsGetServerTime(): Promise<number> {
    return this.call<number>("utils.getServerTime", {});
  }

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================

  async notificationsSendMessage(params: {
    user_ids: string;
    message: string;
    fragment?: string;
    group_id?: string;
  }): Promise<Array<{ user_id: number; status: boolean }>> {
    return this.call("notifications.sendMessage", { ...params, group_id: params.group_id ?? this.groupId });
  }

  // =========================================================================
  // PRETTY CARDS
  // =========================================================================

  async prettyCardsCreate(params: {
    owner_id?: number;
    photo: string;
    title: string;
    link: string;
    price?: string;
    price_old?: string;
    button?: string;
  }): Promise<{ card_id: string; owner_id: number }> {
    return this.call("prettyCards.create", { ...params, owner_id: params.owner_id ?? -Number(this.groupId) });
  }

  async prettyCardsGet(params?: {
    owner_id?: number;
    count?: number;
    offset?: number;
  }): Promise<{ count: number; items: unknown[] }> {
    return this.call("prettyCards.get", { ...params, owner_id: params?.owner_id ?? -Number(this.groupId) });
  }
}

// ============================================================================
// Error class
// ============================================================================

export class VkApiCallError extends Error {
  code: number;
  method: string;
  raw: VkApiError;

  constructor(method: string, error: VkApiError) {
    super(`VK API error ${error.error_code} in ${method}: ${error.error_msg}`);
    this.name = "VkApiCallError";
    this.code = error.error_code;
    this.method = method;
    this.raw = error;
  }
}

// ============================================================================
// Keyboard builder helpers
// ============================================================================

export function buildKeyboard(
  buttons: VkKeyboardButton[][],
  opts?: { inline?: boolean; one_time?: boolean },
): string {
  const keyboard: VkKeyboard = {
    buttons,
    inline: opts?.inline ?? false,
    one_time: opts?.one_time ?? false,
  };
  return JSON.stringify(keyboard);
}

export function buildCarousel(elements: VkCarousel["elements"]): string {
  const template: VkCarousel = { type: "carousel", elements };
  return JSON.stringify(template);
}

export function textButton(
  label: string,
  color: VkKeyboardButton["color"] = "secondary",
  payload?: Record<string, unknown>,
): VkKeyboardButton {
  return {
    action: { type: "text", label, payload: payload ? JSON.stringify(payload) : undefined },
    color,
  };
}

export function callbackButton(
  label: string,
  payload: Record<string, unknown>,
  color: VkKeyboardButton["color"] = "primary",
): VkKeyboardButton {
  return {
    action: { type: "callback", label, payload: JSON.stringify(payload) },
    color,
  };
}

export function linkButton(label: string, link: string): VkKeyboardButton {
  return { action: { type: "open_link", label, link } };
}

export function locationButton(payload?: Record<string, unknown>): VkKeyboardButton {
  return { action: { type: "location", payload: payload ? JSON.stringify(payload) : undefined } };
}

export function vkPayButton(hash: string): VkKeyboardButton {
  return { action: { type: "vkpay", hash } };
}

export function openAppButton(
  label: string,
  appId: number,
  ownerId?: number,
  hash?: string,
): VkKeyboardButton {
  return { action: { type: "open_app", label, app_id: appId, owner_id: ownerId, hash } };
}

// ============================================================================
// Attachment string builder
// ============================================================================

export function attachmentString(type: string, ownerId: number, mediaId: number, accessKey?: string): string {
  return accessKey ? `${type}${ownerId}_${mediaId}_${accessKey}` : `${type}${ownerId}_${mediaId}`;
}
