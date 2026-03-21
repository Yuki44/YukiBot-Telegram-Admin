import { User } from "../models/User";
import { IUser } from "../../types";

export const userRepository = {
  async findByUserAndChat(userId: number, chatId: number): Promise<IUser | null> {
    return await User.findOne({ userId, chatId });
  },

  async upsert(user: Partial<IUser>): Promise<IUser> {
    if (!user.userId || !user.chatId) {
      throw new Error("userId and chatId are required for upsert");
    }

    return await User.findOneAndUpdate(
      { userId: user.userId, chatId: user.chatId },
      { $set: user },
      { upsert: true, new: true }
    );
  },
};
