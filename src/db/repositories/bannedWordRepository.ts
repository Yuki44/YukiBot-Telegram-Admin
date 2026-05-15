import { BannedWord } from "../models/BannedWord";
import { IBannedWord } from "../../types";
import { derivePrimarySeverity } from "../../utils/bannedWord";

export const bannedWordRepository = {
  async findByChatId(chatId: number): Promise<IBannedWord[]> {
    return await BannedWord.find({ chatId }).sort({ scope: 1, topicId: 1, word: 1 });
  },

  async findByChatAndScope(chatId: number, scope: "all" | "topic", topicId?: number): Promise<IBannedWord[]> {
    const query: Record<string, unknown> = { chatId, scope };
    if (scope === "topic" && topicId !== undefined) query.topicId = topicId;
    return await BannedWord.find(query).sort({ word: 1 });
  },

  async create(data: {
    chatId: number;
    word: string;
    actions: { delete: boolean; warn: boolean; silence: boolean };
    kick: boolean;
    flag: boolean;
    warnReason?: string | null;
    exactMatch: boolean;
    scope: "all" | "topic";
    topicId?: number;
    createdBy: number;
  }): Promise<IBannedWord> {
    const severity = derivePrimarySeverity({
      delete: data.actions.delete,
      warn: data.actions.warn,
      silence: data.actions.silence,
      kick: data.kick,
      flag: data.flag,
    });
    return await BannedWord.create({
      chatId: data.chatId,
      word: data.word.trim().toLowerCase(),
      severity,
      actions: data.actions,
      kick: data.kick,
      flag: data.flag,
      warnReason: data.warnReason ?? null,
      exactMatch: data.exactMatch,
      scope: data.scope,
      topicId: data.topicId,
      createdBy: data.createdBy,
    });
  },

  async remove(id: string): Promise<boolean> {
    const result = await BannedWord.deleteOne({ _id: id });
    return result.deletedCount === 1;
  },

  async removeByWord(
    chatId: number,
    word: string,
    scope: "all" | "topic",
    topicId?: number
  ): Promise<boolean> {
    const query: Record<string, unknown> = {
      chatId,
      word: word.trim().toLowerCase(),
      scope,
    };
    if (scope === "topic" && topicId !== undefined) query.topicId = topicId;
    const result = await BannedWord.deleteOne(query);
    return result.deletedCount === 1;
  },
};
