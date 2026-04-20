import { Topic } from "../models/Topic";
import { ITopic } from "../../types";

export const topicRepository = {
  async findByChatAndTopic(chatId: number, topicId: number): Promise<ITopic | null> {
    return await Topic.findOne({ chatId, topicId });
  },

  async findAllByChatId(chatId: number): Promise<ITopic[]> {
    return await Topic.find({ chatId });
  },

  async upsert(data: {
    chatId: number;
    topicId: number;
    name: string;
    allowedMsgTypes: string[];
  }): Promise<ITopic> {
    const result = await Topic.findOneAndUpdate(
      { chatId: data.chatId, topicId: data.topicId },
      { $set: data },
      { upsert: true, returnDocument: "after" }
    );
    return result!;
  },

  /** Update only the topic name (used by forum_topic_created/edited auto-cache). */
  async upsertName(chatId: number, topicId: number, name: string): Promise<void> {
    await Topic.findOneAndUpdate(
      { chatId, topicId },
      { $set: { name }, $setOnInsert: { allowedMsgTypes: [] } },
      { upsert: true }
    );
  },

  async deleteOne(chatId: number, topicId: number): Promise<void> {
    await Topic.deleteOne({ chatId, topicId });
  },
};
