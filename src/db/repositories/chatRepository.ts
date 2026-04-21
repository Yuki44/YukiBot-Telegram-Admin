import { Chat } from "../models/Chat";
import { IChat } from "../../types";

export const chatRepository = {
  async findByChatId(chatId: number): Promise<IChat | null> {
    return await Chat.findOne({ chatId });
  },

  async findByLogsTo(logsChannelId: number): Promise<IChat[]> {
    return await Chat.find({ logsTo: logsChannelId, isActive: true });
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
};
