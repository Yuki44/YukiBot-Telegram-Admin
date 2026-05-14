import { UserDomainAllowance } from "../models/UserDomainAllowance";
import { IUserDomainAllowance } from "../../types";

export const userDomainAllowanceRepository = {
  async findByChatId(chatId: number): Promise<IUserDomainAllowance[]> {
    return await UserDomainAllowance.find({ chatId }).sort({ userId: 1 });
  },

  async findByUserAndChat(
    userId: number,
    chatId: number
  ): Promise<IUserDomainAllowance | null> {
    return await UserDomainAllowance.findOne({ userId, chatId });
  },

  async addDomain(
    userId: number,
    chatId: number,
    domain: string
  ): Promise<IUserDomainAllowance> {
    return (await UserDomainAllowance.findOneAndUpdate(
      { userId, chatId },
      { $addToSet: { domains: domain } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ))!;
  },

  async removeDomain(
    userId: number,
    chatId: number,
    domain: string
  ): Promise<IUserDomainAllowance | null> {
    return await UserDomainAllowance.findOneAndUpdate(
      { userId, chatId },
      { $pull: { domains: domain } },
      { returnDocument: "after" }
    );
  },

  async removeAllForUser(userId: number, chatId: number): Promise<void> {
    await UserDomainAllowance.deleteOne({ userId, chatId });
  },
};
