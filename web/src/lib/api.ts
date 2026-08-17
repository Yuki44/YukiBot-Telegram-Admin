import type {
  ActionResult,
  ActivityLogPage,
  ActivityLogType,
  AdminsResponse,
  AuthResponse,
  AuthUser,
  BannedWord,
  BannedWordCreateBody,
  ChannelBroadcast,
  ChatDetail,
  ChatFeatures,
  ChatStats,
  ChatSummary,
  DeduplicateResult,
  MigrationSelection,
  MigrationSummary,
  SpamDetection,
  SpamDetectionPermitResult,
  CsamWatchlistData,
  CsamWatchCategory,
  TelegramAuthData,
  Topic,
  TopicReminderConfig,
  UserDomainAllowance,
  UserListFilter,
  UserRecord,
  UserStats,
  WelcomeConfig,
  WhitelistUserEntry,
} from "../types/api";
import { clearSession, getToken } from "./auth";
import { loading } from "./loading";

const BASE = "/api";

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Ref-counted global loading indicator. See lib/loading.ts.
  loading.begin();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      clearSession();
      throw new ApiError(401, "unauthenticated");
    }

    if (!res.ok) {
      let code = "request_failed";
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) code = data.error;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, code);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    loading.end();
  }
}

interface PublicConfig {
  botUsername: string;
  /** Hostname registered with BotFather; widget renders only when it matches window.location.hostname. */
  botLoginDomain: string;
}

export const api = {
  publicConfig: (): Promise<PublicConfig> => request<PublicConfig>("GET", "/public/config"),
  auth: {
    telegram: (data: TelegramAuthData): Promise<AuthResponse> =>
      request<AuthResponse>("POST", "/auth/telegram", data),
    password: (username: string, password: string): Promise<AuthResponse> =>
      request<AuthResponse>("POST", "/auth/password", { username, password }),
    me: (): Promise<{ user: AuthUser }> => request<{ user: AuthUser }>("GET", "/auth/me"),
    changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
      request<void>("POST", "/auth/password/change", { currentPassword, newPassword }),
  },
  chats: {
    list: (): Promise<ChatSummary[]> => request<ChatSummary[]>("GET", "/chats"),
    get: (chatId: number | string): Promise<ChatDetail> => request<ChatDetail>("GET", `/chats/${chatId}`),
    stats: (chatId: number | string): Promise<ChatStats> =>
      request<ChatStats>("GET", `/chats/${chatId}/stats`),
    updateFeatures: (chatId: number | string, partial: Partial<ChatFeatures>): Promise<ChatFeatures> =>
      request<ChatFeatures>("PUT", `/chats/${chatId}/features`, partial),
    updateNotify: (
      chatId: number | string,
      partial: { notifyChatId?: number | null; notifySpam?: boolean; notifyCsam?: boolean }
    ): Promise<{
      notifyChatId: number | null;
      notifyFlags: { notifySpam: boolean; notifyCsam?: boolean };
    }> =>
      request<{ notifyChatId: number | null; notifyFlags: { notifySpam: boolean; notifyCsam?: boolean } }>(
        "PUT",
        `/chats/${chatId}/notify`,
        partial
      ),
  },
  migration: {
    // chatId is the DESTINATION (this) chat; sourceChatId is the old chat to copy from.
    run: (
      chatId: number | string,
      sourceChatId: number,
      selection?: MigrationSelection
    ): Promise<MigrationSummary> =>
      request<MigrationSummary>("POST", `/chats/${chatId}/migrate`, { sourceChatId, selection }),
    setSourceActive: (
      chatId: number | string,
      sourceChatId: number,
      active: boolean
    ): Promise<{ chatId: number; isActive: boolean }> =>
      request<{ chatId: number; isActive: boolean }>("POST", `/chats/${chatId}/migrate/source-active`, {
        sourceChatId,
        active,
      }),
  },
  topics: {
    list: (chatId: number | string): Promise<Topic[]> => request<Topic[]>("GET", `/chats/${chatId}/topics`),
    create: (
      chatId: number | string,
      body: { topicId: number; name: string; allowedMsgTypes: string[]; adminOnly?: boolean }
    ): Promise<Topic> => request<Topic>("POST", `/chats/${chatId}/topics`, body),
    update: (
      chatId: number | string,
      topicId: number,
      body: { name?: string; allowedMsgTypes?: string[]; adminOnly?: boolean }
    ): Promise<Topic> => request<Topic>("PUT", `/chats/${chatId}/topics/${topicId}`, body),
    remove: (chatId: number | string, topicId: number): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/topics/${topicId}`),
    setReminder: (
      chatId: number | string,
      topicId: number,
      body: { enabled: boolean; text: string }
    ): Promise<{ enabled: boolean; text: string }> =>
      request<{ enabled: boolean; text: string }>(
        "PUT",
        `/chats/${chatId}/topics/${topicId}/reminder`,
        body
      ),
  },
  users: {
    list: (
      chatId: number | string,
      opts: { filter?: UserListFilter; q?: string } = {}
    ): Promise<UserRecord[]> => {
      const qs = new URLSearchParams();
      if (opts.filter) qs.set("filter", opts.filter);
      if (opts.q) qs.set("q", opts.q);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<UserRecord[]>("GET", `/chats/${chatId}/users${suffix}`);
    },
    get: (chatId: number | string, userId: number | string): Promise<UserRecord> =>
      request<UserRecord>("GET", `/chats/${chatId}/users/${userId}`),
    stats: (chatId: number | string, userId: number | string): Promise<UserStats> =>
      request<UserStats>("GET", `/chats/${chatId}/users/${userId}/stats`),
    warn: (chatId: number | string, userId: number, reason?: string): Promise<ActionResult> =>
      request<ActionResult>("POST", `/chats/${chatId}/users/${userId}/warn`, { reason }),
    silence: (chatId: number | string, userId: number): Promise<ActionResult> =>
      request<ActionResult>("POST", `/chats/${chatId}/users/${userId}/silence`),
    unsilence: (chatId: number | string, userId: number): Promise<ActionResult> =>
      request<ActionResult>("POST", `/chats/${chatId}/users/${userId}/unsilence`),
    ban: (chatId: number | string, userId: number, reason?: string): Promise<ActionResult> =>
      request<ActionResult>("POST", `/chats/${chatId}/users/${userId}/ban`, { reason }),
    unban: (chatId: number | string, userId: number): Promise<ActionResult> =>
      request<ActionResult>("POST", `/chats/${chatId}/users/${userId}/unban`),
    pardon: (chatId: number | string, userId: number): Promise<void> =>
      request<void>("POST", `/chats/${chatId}/users/${userId}/pardon`),
    refresh: (chatId: number | string, userId: number): Promise<UserRecord> =>
      request<UserRecord>("POST", `/chats/${chatId}/users/${userId}/refresh`),
    deduplicate: (chatId: number | string): Promise<DeduplicateResult> =>
      request<DeduplicateResult>("POST", `/chats/${chatId}/users/deduplicate`),
  },
  whitelist: {
    listLinks: (chatId: number | string): Promise<string[]> =>
      request<string[]>("GET", `/chats/${chatId}/whitelist/links`),
    addLink: (chatId: number | string, domain: string): Promise<string[]> =>
      request<string[]>("POST", `/chats/${chatId}/whitelist/links`, { domain }),
    removeLink: (chatId: number | string, domain: string): Promise<string[]> =>
      request<string[]>("DELETE", `/chats/${chatId}/whitelist/links/${encodeURIComponent(domain)}`),
    listUsers: (chatId: number | string): Promise<WhitelistUserEntry[]> =>
      request<WhitelistUserEntry[]>("GET", `/chats/${chatId}/whitelist/users`),
    addUser: (chatId: number | string, userId: number): Promise<WhitelistUserEntry[]> =>
      request<WhitelistUserEntry[]>("POST", `/chats/${chatId}/whitelist/users`, { userId }),
    removeUser: (chatId: number | string, userId: number): Promise<WhitelistUserEntry[]> =>
      request<WhitelistUserEntry[]>("DELETE", `/chats/${chatId}/whitelist/users/${userId}`),
    // Mixtos: per-user domain allowances
    listCombo: (chatId: number | string): Promise<UserDomainAllowance[]> =>
      request<UserDomainAllowance[]>("GET", `/chats/${chatId}/whitelist/combo`),
    addComboDomain: (
      chatId: number | string,
      userId: number,
      domain: string
    ): Promise<{ userId: number; chatId: number; domains: string[] }> =>
      request<{ userId: number; chatId: number; domains: string[] }>(
        "POST",
        `/chats/${chatId}/whitelist/combo/${userId}/domains`,
        { domain }
      ),
    removeComboDomain: (
      chatId: number | string,
      userId: number,
      domain: string
    ): Promise<{ userId: number; chatId: number; domains: string[] }> =>
      request<{ userId: number; chatId: number; domains: string[] }>(
        "DELETE",
        `/chats/${chatId}/whitelist/combo/${userId}/domains/${encodeURIComponent(domain)}`
      ),
    removeComboUser: (chatId: number | string, userId: number): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/whitelist/combo/${userId}`),
  },
  welcome: {
    get: (chatId: number | string): Promise<WelcomeConfig> =>
      request<WelcomeConfig>("GET", `/chats/${chatId}/welcome`),
    update: (chatId: number | string, body: WelcomeConfig): Promise<WelcomeConfig> =>
      request<WelcomeConfig>("PUT", `/chats/${chatId}/welcome`, body),
  },
  topicReminder: {
    get: (chatId: number | string): Promise<TopicReminderConfig> =>
      request<TopicReminderConfig>("GET", `/chats/${chatId}/topic-reminder`),
    update: (chatId: number | string, body: TopicReminderConfig): Promise<TopicReminderConfig> =>
      request<TopicReminderConfig>("PUT", `/chats/${chatId}/topic-reminder`, body),
  },
  bannedWords: {
    list: (chatId: number | string): Promise<BannedWord[]> =>
      request<BannedWord[]>("GET", `/chats/${chatId}/banned-words`),
    create: (chatId: number | string, body: BannedWordCreateBody): Promise<BannedWord> =>
      request<BannedWord>("POST", `/chats/${chatId}/banned-words`, body),
    update: (chatId: number | string, id: string, body: BannedWordCreateBody): Promise<BannedWord> =>
      request<BannedWord>("PUT", `/chats/${chatId}/banned-words/${id}`, body),
    remove: (chatId: number | string, id: string): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/banned-words/${id}`),
  },
  admins: {
    list: (chatId: number | string): Promise<AdminsResponse> =>
      request<AdminsResponse>("GET", `/chats/${chatId}/admins`),
    delegate: (chatId: number | string, userId: number): Promise<{ delegatedOwnerId: number }> =>
      request<{ delegatedOwnerId: number }>("POST", `/chats/${chatId}/admins/delegate`, { userId }),
    revoke: (chatId: number | string): Promise<{ delegatedOwnerId: null }> =>
      request<{ delegatedOwnerId: null }>("DELETE", `/chats/${chatId}/admins/delegate`),
    setVisibility: (
      chatId: number | string,
      userId: number,
      hidden: boolean
    ): Promise<{ userId: number; hiddenInAdminList: boolean }> =>
      request<{ userId: number; hiddenInAdminList: boolean }>(
        "POST",
        `/chats/${chatId}/admins/${userId}/visibility`,
        { hidden }
      ),
  },
  spamDetections: {
    list: (chatId: number | string, limit = 50): Promise<SpamDetection[]> =>
      request<SpamDetection[]>("GET", `/chats/${chatId}/spam-detections?limit=${limit}`),
    permit: (chatId: number | string, patternId: string): Promise<SpamDetectionPermitResult> =>
      request<SpamDetectionPermitResult>("POST", `/chats/${chatId}/spam-detections/${patternId}/permit`),
    discard: (chatId: number | string, patternId: string): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/spam-detections/${patternId}`),
  },
  logs: {
    list: (
      chatId: number | string,
      opts: { types?: ActivityLogType[]; q?: string; before?: string; limit?: number } = {}
    ): Promise<ActivityLogPage> => {
      const qs = new URLSearchParams();
      if (opts.types && opts.types.length > 0) qs.set("type", opts.types.join(","));
      if (opts.q) qs.set("q", opts.q);
      if (opts.before) qs.set("before", opts.before);
      if (opts.limit) qs.set("limit", String(opts.limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<ActivityLogPage>("GET", `/chats/${chatId}/logs${suffix}`);
    },
    undo: (chatId: number | string, id: string): Promise<void> =>
      request<void>("POST", `/chats/${chatId}/logs/${id}/undo`),
  },
  channelBroadcasts: {
    list: (): Promise<ChannelBroadcast[]> => request<ChannelBroadcast[]>("GET", "/channel-broadcasts"),
    get: (channelId: number | string): Promise<ChannelBroadcast> =>
      request<ChannelBroadcast>("GET", `/channel-broadcasts/${channelId}`),
    updatePost: (
      channelId: number | string,
      index: number,
      patch: Partial<{ caption: string; url: string; enabled: boolean }>
    ): Promise<ChannelBroadcast> =>
      request<ChannelBroadcast>("PUT", `/channel-broadcasts/${channelId}/posts/${index}`, patch),
    updateButton: (
      channelId: number | string,
      button: { enabled: boolean; text: string }
    ): Promise<ChannelBroadcast> =>
      request<ChannelBroadcast>("PUT", `/channel-broadcasts/${channelId}/button`, button),
    removeImage: (channelId: number | string, index: number): Promise<ChannelBroadcast> =>
      request<ChannelBroadcast>("DELETE", `/channel-broadcasts/${channelId}/posts/${index}/image`),
    sendNow: (channelId: number | string): Promise<ChannelBroadcast> =>
      request<ChannelBroadcast>("POST", `/channel-broadcasts/${channelId}/send-now`),
    uploadImage: async (
      channelId: number | string,
      index: number,
      file: File
    ): Promise<ChannelBroadcast> => {
      const token = getToken();
      loading.begin();
      try {
        const res = await fetch(`${BASE}/channel-broadcasts/${channelId}/posts/${index}/image`, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            "X-Filename": file.name,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        if (res.status === 401) {
          clearSession();
          throw new ApiError(401, "unauthenticated");
        }
        if (!res.ok) {
          let code = "request_failed";
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) code = data.error;
          } catch {
            /* ignore */
          }
          throw new ApiError(res.status, code);
        }
        return (await res.json()) as ChannelBroadcast;
      } finally {
        loading.end();
      }
    },
  },
  csam: {
    getWatchlist: (): Promise<CsamWatchlistData> => request<CsamWatchlistData>("GET", "/csam/watchlist"),
    addTerm: (category: CsamWatchCategory, value: string): Promise<{ stored: CsamWatchlistData["stored"] }> =>
      request<{ stored: CsamWatchlistData["stored"] }>("POST", "/csam/watchlist", { category, value }),
    removeTerm: (
      category: CsamWatchCategory,
      value: string
    ): Promise<{ stored: CsamWatchlistData["stored"] }> =>
      request<{ stored: CsamWatchlistData["stored"] }>(
        "DELETE",
        `/csam/watchlist/${category}/${encodeURIComponent(value)}`
      ),
  },
};

export { ApiError };
