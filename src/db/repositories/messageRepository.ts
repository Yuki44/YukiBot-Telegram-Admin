import { Message } from "../models/Message";
import { IMessage } from "../../types";

export const messageRepository = {
  async create(message: Partial<IMessage>): Promise<IMessage> {
    const newMessage = new Message(message);
    return await newMessage.save();
  },

  async findRecentByUser(userId: number, chatId: number, withinHours: number): Promise<IMessage[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - withinHours);

    return await Message.find({
      userId,
      chatId,
      timestamp: { $gte: cutoffDate },
    }).sort({ timestamp: -1 });
  },
};
