export interface AuthUser {
  userId: number;
  username?: string;
  name?: string;
  isSuperAdmin: boolean;
  /** True when a password credential exists for this user (vs Telegram-only login). */
  hasCredential?: boolean;
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
  /** Cached Telegram member count; null when never synced. */
  members: number | null;
  /** Cached chat photo file_id; null when checked-but-no-photo or unknown. */
  photoFileId: string | null;
}

export interface ChatFeatures {
  languageDetection: boolean;
  topicFiltering: boolean;
  autoBan: boolean;
  autoWarnSpam: boolean;
  promoSpamDetection: boolean;
  bannedWordsEnforcement: boolean;
  welcomeMessage: boolean;
}

export interface WelcomeConfig {
  message: string;
  button: {
    enabled: boolean;
    text: string;
    url: string;
  };
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

export interface ChatStats {
  warnedCount: number;
  silencedCount: number;
  bannedCount: number;
  actionsToday: number;
  bannedWordsCount: number;
}

export interface MigrationSummary {
  sourceChatId: number;
  destChatId: number;
  users: number;
  bannedWords: number;
  bannedWordsSkipped: number;
  domainAllowances: number;
  configCopied: boolean;
  logsTo: number | null;
}

export interface AdminRecord {
  userId: number;
  name: string;
  username: string;
  /** What Telegram itself records for this admin in the chat. */
  telegramRole: "owner" | "admin";
  /** True only when this user is the YukiBot-side delegated owner. */
  isDelegatedOwner: boolean;
  /** Display-only opt-in flag — admin chose to hide themselves in the dashboard list. */
  hiddenInAdminList: boolean;
  /** Telegram profile photo file_id; null when checked-but-no-photo or unknown. */
  photoFileId?: string | null;
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
  /** When true, only chat admins may post in this topic. */
  adminOnly: boolean;
  /**
   * False = topic was auto-discovered (the bot hasn't received an explicit save
   * for it yet). The dashboard treats these specially in the topic edit screen —
   * new topics default to "all allowed" until saved.
   */
  isUserConfigured?: boolean;
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

/** Hydrated entry returned by /whitelist/users — userId plus best-effort identity. */
export interface WhitelistUserEntry {
  userId: number;
  name: string | null;
  username: string | null;
  photoFileId: string | null;
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
  | "owner_revoke"
  | "spam_confirmed";

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
  /** ISO timestamp when this entry was reversed via Undo, or null. */
  undoneAt: string | null;
  timestamp: string;
}

/**
 * Types the dashboard's Undo button can reverse. Keep in sync with the server's UNDOABLE
 * set in `src/api/routes/activityLogs.ts`.
 */
const UNDOABLE_TYPES: ReadonlySet<ActivityLogType> = new Set<ActivityLogType>([
  "warn",
  "silence",
  "ban",
  "feature_toggle",
  "whitelist_add",
  "combo_add",
  "banned_word_add",
  "owner_delegate",
]);

export function isUndoableLogType(type: ActivityLogType): boolean {
  return UNDOABLE_TYPES.has(type);
}

export interface ActivityLogPage {
  entries: ActivityLogEntry[];
  nextBefore: string | null;
}

export type BannedWordSeverity = "flag" | "aviso" | "borrar" | "silenciar" | "kick";

export interface BannedWordActions {
  delete: boolean;
  warn: boolean;
  silence: boolean;
}

export interface BannedWord {
  id: string;
  chatId: number;
  word: string;
  /** Legacy primary severity — derived server-side from the action combo. */
  severity: BannedWordSeverity;
  actions: BannedWordActions;
  kick: boolean;
  flag: boolean;
  warnReason: string | null;
  exactMatch: boolean;
  scope: "all" | "topic";
  topicId?: number | null;
  createdBy: number;
  createdAt: string;
}

export interface BannedWordCreateBody {
  word: string;
  actions: BannedWordActions;
  kick: boolean;
  flag: boolean;
  warnReason?: string;
  exactMatch: boolean;
  scope: "all" | "topic";
  topicId?: number;
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
  /** Telegram profile photo file_id; null when checked-but-no-photo. */
  photoFileId?: string | null;
}

export interface ActionResult {
  user: UserRecord;
  enforced: boolean;
  enforceError?: string;
}

export interface UserStats {
  messagesLast30d: number;
}

export type SpamDetectionKind = "link" | "media" | "text";

export interface SpamDetection {
  patternId: string;
  chatId: number;
  kind: SpamDetectionKind;
  preview: string;
  fullText: string;
  linkDomain?: string;
  /** Telegram file_id for media spam — proxied via /api/photos/:fileId. */
  mediaFileId?: string | null;
  triggeredByUserId: number;
  triggeredByName: string | null;
  triggeredByUsername: string | null;
  addedByUserId: number;
  createdAt: string;
}

export interface SpamDetectionPermitResult {
  kind: SpamDetectionKind;
  linkDomain?: string;
  userId?: number;
}

export function userStatus(u: UserRecord): UserStatus {
  if (u.isBanned) return "banned";
  if (u.isMuted) return "silenced";
  if (u.warnings > 0) return "warned";
  return "active";
}
