import { Chat } from "../models/Chat";
import { IChat } from "../../types";

export const chatRepository = {
  async findByChatId(chatId: number): Promise<IChat | null> {
    return await Chat.findOne({ chatId });
  },

  async findByLogsTo(logsChannelId: number): Promise<IChat[]> {
    return await Chat.find({ logsTo: logsChannelId, isActive: true });
  },

  async listAll(): Promise<IChat[]> {
    return await Chat.find({}).sort({ name: 1 });
  },

  async listByChatIds(chatIds: number[]): Promise<IChat[]> {
    if (chatIds.length === 0) return [];
    return await Chat.find({ chatId: { $in: chatIds } }).sort({ name: 1 });
  },

  async upsert(chat: Partial<IChat>): Promise<IChat> {
    if (!chat.chatId) {
      throw new Error("chatId is required for upsert");
    }

    return await Chat.findOneAndUpdate(
      { chatId: chat.chatId },
      { $set: chat },
      { upsert: true, returnDocument: "after" }
    );
  },

  /**
   * Idempotent initialization for /setup. `name` and `type` are re-synced from
   * Telegram on every run; every other field is fill-missing-only — an owner who
   * has enabled a feature, turned on whitelist, etc. never has it reset by a
   * second /setup. Also backfills fields added after a chat was first set up
   * (e.g. `features.bannedWordsEnforcement`).
   *
   * The existing doc is read with `.lean()` on purpose: a hydrated Mongoose doc
   * applies schema defaults in memory, so a genuinely-missing field would read as
   * its default and never be detected as absent. `.lean()` reflects exactly what
   * is stored, so the backfill diff is accurate.
   */
  async ensureInitialized(chatId: number, meta: { name: string; type: "topics" | "normal" }): Promise<IChat> {
    const existing = (await Chat.findOne({ chatId }).lean()) as Record<string, unknown> | null;

    // Always re-synced from Telegram (decision: name/type reflect live chat state).
    const $set: Record<string, unknown> = { name: meta.name, type: meta.type };

    // Defaults mirror src/db/models/Chat.ts. Everything off except isActive.
    const topLevelDefaults: Record<string, unknown> = {
      isActive: true,
      whitelist: false,
      linkWhitelist: [],
      spamUserWhitelist: [],
      hiddenAdminIds: [],
      delegatedOwnerId: null,
      forwardsTo: null,
      logsTo: null,
    };
    for (const [key, def] of Object.entries(topLevelDefaults)) {
      if (existing == null || existing[key] === undefined) $set[key] = def;
    }

    // Canonical feature keys (mirrors FEATURE_KEYS in src/api/routes/chats.ts).
    const featureKeys = [
      "languageDetection",
      "topicFiltering",
      "autoBan",
      "autoWarnSpam",
      "promoSpamDetection",
      "bannedWordsEnforcement",
    ] as const;
    const existingFeatures = existing?.features as Record<string, unknown> | undefined;
    for (const k of featureKeys) {
      if (existing == null || existingFeatures?.[k] === undefined) $set[`features.${k}`] = false;
    }

    const logFlagKeys = [
      "logWarns",
      "logSilences",
      "logBans",
      "logAutoRebans",
      "logKicks",
      "logQBans",
      "logUnsilences",
      "logUnwarns",
      "logEntries",
      "logExits",
      "logBannedWords",
    ] as const;
    const existingLogFlags = existing?.logFlags as Record<string, unknown> | undefined;
    for (const k of logFlagKeys) {
      if (existing == null || existingLogFlags?.[k] === undefined) $set[`logFlags.${k}`] = false;
    }

    return await Chat.findOneAndUpdate({ chatId }, { $set }, { upsert: true, returnDocument: "after" });
  },

  async updateFeatures(chatId: number, features: IChat["features"]): Promise<IChat | null> {
    return await Chat.findOneAndUpdate({ chatId }, { $set: { features } }, { returnDocument: "after" });
  },

  /** Partial feature update — only changes the keys provided, leaves the rest untouched. */
  async patchFeatures(chatId: number, partial: Partial<IChat["features"]>): Promise<IChat | null> {
    const $set: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (typeof v === "boolean") $set[`features.${k}`] = v;
    }
    if (Object.keys($set).length === 0) {
      return await Chat.findOne({ chatId });
    }
    return await Chat.findOneAndUpdate({ chatId }, { $set }, { returnDocument: "after" });
  },

  async addLinkWhitelist(chatId: number, domain: string): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $addToSet: { linkWhitelist: domain } },
      { returnDocument: "after" }
    );
  },

  async removeLinkWhitelist(chatId: number, domain: string): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $pull: { linkWhitelist: domain } },
      { returnDocument: "after" }
    );
  },

  async addSpamUserWhitelist(chatId: number, userId: number): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $addToSet: { spamUserWhitelist: userId } },
      { returnDocument: "after" }
    );
  },

  async removeSpamUserWhitelist(chatId: number, userId: number): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $pull: { spamUserWhitelist: userId } },
      { returnDocument: "after" }
    );
  },

  async setDelegatedOwner(chatId: number, userId: number | null): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $set: { delegatedOwnerId: userId } },
      { returnDocument: "after" }
    );
  },

  /**
   * Toggle whether an admin is rendered as hidden in the dashboard's admin list for
   * this chat. Pure display flag; Telegram's admin list is unaffected.
   */
  async setAdminVisibility(chatId: number, userId: number, hidden: boolean): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      hidden ? { $addToSet: { hiddenAdminIds: userId } } : { $pull: { hiddenAdminIds: userId } },
      { returnDocument: "after" }
    );
  },

  async setMembersCount(chatId: number, members: number): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $set: { members, membersCheckedAt: new Date() } },
      { returnDocument: "after" }
    );
  },

  /** `fileId === null` records "checked, no photo" so we don't re-poll on every render. */
  async setPhoto(chatId: number, fileId: string | null): Promise<IChat | null> {
    return await Chat.findOneAndUpdate(
      { chatId },
      { $set: { photoFileId: fileId, photoCheckedAt: new Date() } },
      { returnDocument: "after" }
    );
  },
};
