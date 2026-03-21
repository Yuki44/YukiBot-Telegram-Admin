import { Admin } from "../models/Admin";
import { IAdmin } from "../../types";

export const adminRepository = {
  async findByChatId(chatId: number): Promise<IAdmin[]> {
    return await Admin.find({ chatId });
  },

  async isChatAdmin(userId: number, chatId: number): Promise<boolean> {
    const admin = await Admin.findOne({ userId, chatId });
    return admin !== null;
  },
};
