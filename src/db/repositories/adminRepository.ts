import { Admin } from "../models/Admin";
import { IAdmin } from "../../types";

export const adminRepository = {
  async findByChatId(chatId: number): Promise<IAdmin[]> {
    return await Admin.find({ chatId });
  },

  async isChatAdmin(userId: number, chatId: number): Promise<boolean> {
    const admin = await Admin.findOne({ userId, chatId });
    const exists = admin !== null;
    if (exists) {
      console.log(`[adminRepository.isChatAdmin] User ${userId} is admin in chat ${chatId} (DB Match)`);
    }
    return exists;
  },

  async findByUsername(username: string, chatId: number): Promise<IAdmin | null> {
    return await Admin.findOne({ username, chatId });
  },

  async upsert(data: {
    userId: number;
    username: string;
    name: string;
    chatId: number;
    chatName: string;
    role: "owner" | "admin";
  }): Promise<IAdmin> {
    const result = await Admin.findOneAndUpdate(
      { userId: data.userId, chatId: data.chatId },
      { $set: data },
      { upsert: true, returnDocument: "after" }
    );
    return result!;
  },

  async remove(userId: number, chatId: number): Promise<void> {
    await Admin.deleteOne({ userId, chatId });
  },
};
