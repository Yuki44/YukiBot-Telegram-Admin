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
