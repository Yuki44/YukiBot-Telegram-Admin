import type {
  ActionResult,
  ActivityLogPage,
  ActivityLogType,
  AuthResponse,
  AuthUser,
  BannedWord,
  BannedWordSeverity,
  ChatDetail,
  ChatFeatures,
  ChatSummary,
  TelegramAuthData,
  Topic,
  UserDomainAllowance,
  UserListFilter,
  UserRecord,
} from "../types/api";
import { clearSession, getToken } from "./auth";

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
}

interface PublicConfig {
  botUsername: string;
}

export const api = {
  publicConfig: (): Promise<PublicConfig> => request<PublicConfig>("GET", "/public/config"),
  auth: {
    telegram: (data: TelegramAuthData): Promise<AuthResponse> =>
      request<AuthResponse>("POST", "/auth/telegram", data),
    me: (): Promise<{ user: AuthUser }> => request<{ user: AuthUser }>("GET", "/auth/me"),
  },
  chats: {
    list: (): Promise<ChatSummary[]> => request<ChatSummary[]>("GET", "/chats"),
    get: (chatId: number | string): Promise<ChatDetail> =>
      request<ChatDetail>("GET", `/chats/${chatId}`),
    updateFeatures: (chatId: number | string, partial: Partial<ChatFeatures>): Promise<ChatFeatures> =>
      request<ChatFeatures>("PUT", `/chats/${chatId}/features`, partial),
  },
  topics: {
    list: (chatId: number | string): Promise<Topic[]> =>
      request<Topic[]>("GET", `/chats/${chatId}/topics`),
    create: (chatId: number | string, body: { topicId: number; name: string; allowedMsgTypes: string[] }): Promise<Topic> =>
      request<Topic>("POST", `/chats/${chatId}/topics`, body),
    update: (chatId: number | string, topicId: number, body: { name?: string; allowedMsgTypes?: string[] }): Promise<Topic> =>
      request<Topic>("PUT", `/chats/${chatId}/topics/${topicId}`, body),
    remove: (chatId: number | string, topicId: number): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/topics/${topicId}`),
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
  },
  whitelist: {
    listLinks: (chatId: number | string): Promise<string[]> =>
      request<string[]>("GET", `/chats/${chatId}/whitelist/links`),
    addLink: (chatId: number | string, domain: string): Promise<string[]> =>
      request<string[]>("POST", `/chats/${chatId}/whitelist/links`, { domain }),
    removeLink: (chatId: number | string, domain: string): Promise<string[]> =>
      request<string[]>("DELETE", `/chats/${chatId}/whitelist/links/${encodeURIComponent(domain)}`),
    listUsers: (chatId: number | string): Promise<number[]> =>
      request<number[]>("GET", `/chats/${chatId}/whitelist/users`),
    addUser: (chatId: number | string, userId: number): Promise<number[]> =>
      request<number[]>("POST", `/chats/${chatId}/whitelist/users`, { userId }),
    removeUser: (chatId: number | string, userId: number): Promise<number[]> =>
      request<number[]>("DELETE", `/chats/${chatId}/whitelist/users/${userId}`),
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
  bannedWords: {
    list: (chatId: number | string): Promise<BannedWord[]> =>
      request<BannedWord[]>("GET", `/chats/${chatId}/banned-words`),
    create: (
      chatId: number | string,
      body: {
        word: string;
        severity: BannedWordSeverity;
        exactMatch: boolean;
        scope: "all" | "topic";
        topicId?: number;
      }
    ): Promise<BannedWord> =>
      request<BannedWord>("POST", `/chats/${chatId}/banned-words`, body),
    remove: (chatId: number | string, id: string): Promise<void> =>
      request<void>("DELETE", `/chats/${chatId}/banned-words/${id}`),
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
  },
};

export { ApiError };
