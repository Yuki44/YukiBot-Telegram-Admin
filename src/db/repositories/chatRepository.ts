import { Chat } from "../models/Chat";
import { IChat } from "../../types";

export const chatRepository = {
  async findByChatId(chatId: number): Promise<IChat | null> {
    return await Chat.findOne({ chatId });
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
};
