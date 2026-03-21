import { Topic } from "../models/Topic";
import { ITopic } from "../../types";

export const topicRepository = {
  async findByChatAndTopic(chatId: number, topicId: number): Promise<ITopic | null> {
    return await Topic.findOne({ chatId, topicId });
  },

  async findAllByChatId(chatId: number): Promise<ITopic[]> {
    return await Topic.find({ chatId });
  },

  async deleteOne(chatId: number, topicId: number): Promise<void> {
    await Topic.deleteOne({ chatId, topicId });
  },
};
