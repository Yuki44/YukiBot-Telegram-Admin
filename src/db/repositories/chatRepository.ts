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
