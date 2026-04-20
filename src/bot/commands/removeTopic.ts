import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { logger } from "../../utils/logger";

export async function removeTopicHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!ctx.isAdmin) return;

    if (!ctx.chatConfig) return;

    if (ctx.chatConfig.type !== "topics") {
      await ctx.reply("This command only works in topic-based chats.");
      return;
    }

    const args = ctx.match?.toString().trim().split(/\s+/) || [];

    if (args.length < 1 || !args[0]) {
      await ctx.reply("Usage: /removetopic <topicId>\nExample: /removetopic 12283");
      return;
    }

    const topicId = parseInt(args[0], 10);
    if (isNaN(topicId)) {
      await ctx.reply("Invalid topic ID. Must be a number.");
      return;
    }

    const topic = await topicRepository.findByChatAndTopic(chatId, topicId);
    if (!topic) {
      await ctx.reply(`Topic ${topicId} not found.`);
      return;
    }

    await topicRepository.deleteOne(chatId, topicId);

    logger.info({
      action: "removeTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId,
      topicId,
    });

    await ctx.reply(`Topic ${topicId} removed. No content rules will be enforced there.`);
  } catch (error) {
    logger.error({
      action: "removeTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Failed to remove topic, check logs.");
  }
}
