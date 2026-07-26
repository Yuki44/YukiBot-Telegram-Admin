import { CsamRecentMessage } from "../models/CsamRecentMessage";
import { logger } from "../../utils/logger";

export const csamRecentMessageRepository = {
  async record(userId: number, chatId: number, messageId: number): Promise<void> {
    try {
      await CsamRecentMessage.create({ userId, chatId, messageId });
    } catch (err) {
      logger.error({ action: "csam_recentmsg_record", userId, chatId, error: String(err) });
    }
  },

  async findMessageIds(userId: number, chatId: number): Promise<number[]> {
    try {
      const rows = await CsamRecentMessage.find({ userId, chatId }).lean();
      return rows.map((r) => r.messageId);
    } catch (err) {
      logger.error({ action: "csam_recentmsg_find", userId, chatId, error: String(err) });
      return [];
    }
  },
};
