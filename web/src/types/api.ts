export interface AuthUser {
  userId: number;
  username?: string;
  name?: string;
  isSuperAdmin: boolean;
}

export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export type ChatRole = "owner" | "admin" | "super";

export interface ChatSummary {
  chatId: number;
  name: string;
  type: "topics" | "normal";
  isActive: boolean;
  role: ChatRole;
}

export interface ChatFeatures {
  languageDetection: boolean;
  spamDetection: boolean;
  topicFiltering: boolean;
  commands: boolean;
  autoBan: boolean;
  autoWarnSpam: boolean;
  promoSpamDetection: boolean;
}

export interface ChatDetail extends ChatSummary {
  whitelist: boolean;
  features: ChatFeatures;
  linkWhitelist: string[];
  spamUserWhitelist: number[];
  forwardsTo?: number | null;
  logsTo?: number | null;
  delegatedOwnerId?: number | null;
}

export interface AdminRecord {
  userId: number;
  name: string;
  username: string;
  /** What Telegram itself records for this admin in the chat. */
  telegramRole: "owner" | "admin";
  /** True only when this user is the YukiBot-side delegated owner. */
  isDelegatedOwner: boolean;
}

export interface AdminsResponse {
  admins: AdminRecord[];
  delegatedOwnerId: number | null;
}

export type MsgType = "photo" | "video" | "sticker" | "audio" | "voice" | "document" | "text";

export const ALL_MSG_TYPES: MsgType[] = [
  "text",
  "photo",
  "video",
  "sticker",
  "voice",
  "audio",
  "document",
];

export interface Topic {
  chatId: number;
  topicId: number;
  name: string;
  allowedMsgTypes: string[];
}

export type UserStatus = "active" | "warned" | "silenced" | "banned";
export type UserListFilter = "all" | "warned" | "silenced" | "banned";

export interface UserDomainAllowance {
  userId: number;
  chatId: number;
  name?: string | null;
  username?: string | null;
  domains: string[];
}

export type ActivityLogType =
  | "warn"
  | "unwarn"
  | "silence"
  | "unsilence"
  | "ban"
  | "unban"
  | "kick"
  | "autoban"
  | "pardon"
  | "feature_toggle"
  | "topic_rule_change"
  | "whitelist_add"
  | "whitelist_remove"
  | "combo_add"
  | "combo_remove"
  | "banned_word_add"
  | "banned_word_remove"
  | "owner_delegate"
  | "owner_revoke";

export type ActivityLogSource = "bot" | "panel" | "auto";

export interface ActivityLogEntry {
  id: string;
  chatId: number;
  type: ActivityLogType;
  source: ActivityLogSource;
  actorId: number;
  actorName: string | null;
  actorUsername: string | null;
  targetId: number | null;
  targetName: string | null;
  targetUsername: string | null;
  targetRef: string | null;
  reason: string | null;
  topicId: number | null;
  warningsAfter: number | null;
  messageText: string | null;
  timestamp: string;
}

export interface ActivityLogPage {
  entries: ActivityLogEntry[];
  nextBefore: string | null;
}

export type BannedWordSeverity = "flag" | "aviso" | "borrar" | "silenciar" | "kick";

export interface BannedWord {
  id: string;
  chatId: number;
  word: string;
  severity: BannedWordSeverity;
  exactMatch: boolean;
  scope: "all" | "topic";
  topicId?: number | null;
  createdBy: number;
  createdAt: string;
}

export interface UserRecord {
  userId: number;
  chatId: number;
  username?: string;
  name?: string;
  warnings: number;
  warningReasons: string[];
  isMuted: boolean;
  muteUntil?: string | null;
  isBanned: boolean;
  wasBanned: boolean;
  isAdmin: boolean;
}

export interface ActionResult {
  user: UserRecord;
  enforced: boolean;
  enforceError?: string;
}

export function userStatus(u: UserRecord): UserStatus {
  if (u.isBanned) return "banned";
  if (u.isMuted) return "silenced";
  if (u.warnings > 0) return "warned";
  return "active";
}
