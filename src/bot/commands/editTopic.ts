import { CommandContext } from "grammy";
import { BotContext, MessageType } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { logger } from "../../utils/logger";

const VALID_MESSAGE_TYPES = [
  MessageType.Photo,
  MessageType.Video,
  MessageType.Sticker,
  MessageType.Audio,
  MessageType.Voice,
  MessageType.Document,
  MessageType.Text,
];

export async function editTopicHandler(ctx: CommandContext<BotContext>) {
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

    if (args.length < 2) {
      await ctx.reply(
        "Usage: /edittopic <topicId> <allowedTypes>\n" +
          "Example: /edittopic 12283 photo,video\n" +
          "Valid types: photo, video, sticker, audio, voice, document, text"
      );
      return;
    }

    const topicId = parseInt(args[0], 10);
    if (isNaN(topicId)) {
      await ctx.reply("Invalid topic ID. Must be a number.");
      return;
    }

    const allowedMsgTypes = args[1]
      .toLowerCase()
      .split(",")
      .map((type) => type.trim())
      .filter((type) => VALID_MESSAGE_TYPES.includes(type as MessageType));

    if (allowedMsgTypes.length === 0) {
      await ctx.reply(
        "Invalid message types. Valid types: photo, video, sticker, audio, voice, document, text"
      );
      return;
    }

    const topic = await topicRepository.findByChatAndTopic(chatId, topicId);
    if (!topic) {
      await ctx.reply(
        `Topic ${topicId} not found. Use /addtopic to create it first.`
      );
      return;
    }

    topic.allowedMsgTypes = allowedMsgTypes;
    await topic.save();

    logger.info({
      action: "editTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId,
      topicId,
      allowedMsgTypes,
    });

    await ctx.reply(
      `Topic ${topicId} updated. Now allows: ${allowedMsgTypes.join(", ")}`
    );
  } catch (error) {
    logger.error({
      action: "editTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Failed to edit topic, check logs.");
  }
}
