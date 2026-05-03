import { Document } from "mongoose";
import { Context } from "grammy";

export enum MessageType {
  Photo = "photo",
  Video = "video",
  Sticker = "sticker",
  Audio = "audio",
  Voice = "voice",
  Document = "document",
  Text = "text",
  Other = "other",
}

/** Content types that can be used in topic filtering rules (excludes "other"). */
export const VALID_CONTENT_TYPES: MessageType[] = [
  MessageType.Photo,
  MessageType.Video,
  MessageType.Sticker,
  MessageType.Audio,
  MessageType.Voice,
  MessageType.Document,
  MessageType.Text,
];

// MongoDB interfaces
export interface IChat extends Document {
  chatId: number;
  name: string;
  type: "topics" | "normal";
  isActive: boolean;
  whitelist: boolean;
  features: {
    languageDetection: boolean;
    spamDetection: boolean;
    topicFiltering?: boolean;
    commands: boolean;
    autoBan: boolean;
    autoWarnSpam: boolean;
    promoSpamDetection: boolean;
  };
  /** Domains/URLs exempt from link spam detection (e.g. "example.com") */
  linkWhitelist: string[];
  /** UserIds exempt from promo-spam detection for this chat */
  spamUserWhitelist: number[];
  forwardsTo?: number;
  logsTo?: number;
  logFlags: {
    logWarns: boolean;
    logSilences: boolean;
    logBans: boolean;
    logAutoRebans: boolean;
    logKicks: boolean;
    logQBans: boolean;
    logUnsilences: boolean;
    logUnwarns: boolean;
    logEntries: boolean;
    logExits: boolean;
  };
}

export interface IAdmin extends Document {
  userId: number;
  username: string;
  name: string;
  chatId: number;
  chatName: string;
  role: "owner" | "admin";
}

export interface ITopic extends Document {
  chatId: number;
  topicId: number;
  name: string;
  allowedMsgTypes: string[];
}

export interface IUser extends Document {
  userId: number;
  chatId: number;
  username?: string;
  name?: string;
  warnings: number;
  warningReasons: string[];
  isMuted: boolean;
  muteUntil?: Date;
  isBanned: boolean;
  wasBanned: boolean;
  leftWithWarningsAt?: Date;
}

/**
 * Per-user domain allowance ("Mixtos" in the dashboard).
 * Listed users can post links to listed domains without being flagged by spam detection,
 * even if those domains are not in the chat-wide linkWhitelist.
 */
export interface IUserDomainAllowance extends Document {
  chatId: number;
  userId: number;
  domains: string[];
}

/**
 * All event kinds the dashboard's activity log can persist.
 * Keep this list in sync with the type filter chips on LogsScreen.
 */
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
  | "banned_word_remove";

/** Where the action originated. */
export type ActivityLogSource = "bot" | "panel" | "auto";

/**
 * Persistent moderation/audit log for the dashboard's "Registro" screen.
 * The bot already streams a parallel real-time feed to chatConfig.logsTo on Telegram —
 * this collection is *additive*, only used for the queryable history view in the web UI.
 *
 * TTL: 90 days, then dropped automatically by MongoDB.
 */
export interface IActivityLog extends Document {
  chatId: number;
  type: ActivityLogType;
  source: ActivityLogSource;
  actorId: number;
  actorName?: string;
  actorUsername?: string;
  targetId?: number;
  targetName?: string;
  targetUsername?: string;
  /** Free-form context: domain, feature key, banned word, topic name, etc. */
  targetRef?: string;
  reason?: string;
  topicId?: number;
  /** Resulting warning count when type === "warn" / "unwarn". */
  warningsAfter?: number;
  /** Snippet of the original message (e.g. for word deletes — kept short). */
  messageText?: string;
  timestamp: Date;
}

/**
 * What YukiBot does when a banned word is detected.
 * - flag      → notify admins via the log channel only, no enforcement
 * - aviso     → +1 warning (3/3 = auto-ban)
 * - borrar    → delete the message silently
 * - silenciar → 1-week mute
 * - kick      → kick from the group (can rejoin via invite)
 */
export type BannedWordSeverity = "flag" | "aviso" | "borrar" | "silenciar" | "kick";

/**
 * Banned word/phrase configured from the dashboard. The bot enforcement layer that
 * actually scans messages for these is a future, separate feature — Phase 7 only stores
 * and surfaces them in the UI.
 */
export interface IBannedWord extends Document {
  chatId: number;
  word: string;
  severity: BannedWordSeverity;
  /** When true, only matches the whole word; when false, matches substrings too. */
  exactMatch: boolean;
  /** Whether this rule applies to the whole chat or just one topic. */
  scope: "all" | "topic";
  /** Required when scope === "topic". */
  topicId?: number;
  createdBy: number;
  createdAt: Date;
}

export interface IMessage extends Document {
  userId: number;
  chatId: number;
  fingerprint: string;
  text: string;
  timestamp: Date;
}

// Custom Grammy context type
export interface BotContext extends Context {
  chatConfig: IChat | null;
  isAdmin: boolean;
}
