import { CommandContext } from "grammy";
import { BotContext, MessageType } from "../../types";
import { Topic } from "../../db/models/Topic";
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

export async function addTopicHandler(ctx: CommandContext<BotContext>) {
  try {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Only works in topics-type chats
    if (ctx.chatConfig?.type !== "topics") {
      await ctx.reply("This command only works in forum chats.", {
        message_thread_id: ctx.message?.message_thread_id,
      });
      return;
    }

    // Check sender is admin
    if (!ctx.isAdmin) {
      return;
    }

    // Parse command arguments
    const args = ctx.match?.toString().trim().split(/\s+/) || [];

    if (args.length < 2) {
      await ctx.reply(
        "Usage: /addtopic <topicId> <allowedTypes> [name]\n" +
          "Example: /addtopic 12283 photo,video General Chat\n" +
          "Valid types: photo, video, sticker, audio, voice, document, text",
        { message_thread_id: ctx.message?.message_thread_id }
      );
      return;
    }

    const topicId = parseInt(args[0], 10);
    if (isNaN(topicId)) {
      await ctx.reply("Invalid topic ID. Must be a number.", {
        message_thread_id: ctx.message?.message_thread_id,
      });
      return;
    }

    const allowedMsgTypes = args[1]
      .toLowerCase()
      .split(",")
      .map((type) => type.trim());

    // Validate message types
    const validTypes = allowedMsgTypes.filter((type) =>
      VALID_MESSAGE_TYPES.includes(type as MessageType)
    );

    if (validTypes.length === 0) {
      await ctx.reply(
        "Invalid message types. Valid types: photo, video, sticker, audio, voice, document, text",
        { message_thread_id: ctx.message?.message_thread_id }
      );
      return;
    }

    const topicName = args.length >= 3 ? args.slice(2).join(" ") : `Topic ${topicId}`;

    // Upsert Topic document
    await Topic.findOneAndUpdate(
      { chatId, topicId },
      {
        $set: {
          chatId,
          topicId,
          name: topicName,
          allowedMsgTypes: validTypes,
        },
      },
      { upsert: true, new: true }
    );

    logger.info({
      action: "addTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId,
      topicId,
      topicName,
      allowedMsgTypes: validTypes,
    });

    await ctx.reply(
      `Topic '${topicName}' (${topicId}) registered with types: ${validTypes.join(", ")}`,
      { message_thread_id: ctx.message?.message_thread_id }
    );
  } catch (error) {
    logger.error({
      action: "addTopic",
      userId: ctx.from?.id,
      username: ctx.from?.username,
      chatId: ctx.chat?.id,
      error: String(error),
    });
    await ctx.reply("Failed to add topic, check logs.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
  }
}
