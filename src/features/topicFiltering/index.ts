import { Middleware } from "grammy";
import { BotContext, MessageType } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";

export const topicFiltering: Middleware<BotContext> = async (ctx, next) => {
  try {
    // Skip if user is admin
    if (ctx.isAdmin) {
      return await next();
    }

    // Skip if no chat config
    if (!ctx.chatConfig) {
      return await next();
    }

    // Skip if topic filtering is disabled
    if (!ctx.chatConfig.features.topicFiltering) {
      return await next();
    }

    // Get thread ID
    const threadId = ctx.message?.message_thread_id;
    if (!threadId) {
      return await next();
    }

    // Load topic rules
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return await next();
    }

    const topic = await topicRepository.findByChatAndTopic(chatId, threadId);
    if (!topic) {
      return await next();
    }

    // Detect message type
    let messageType = MessageType.Other;
    if (ctx.message?.photo) {
      messageType = MessageType.Photo;
    } else if (ctx.message?.video) {
      messageType = MessageType.Video;
    } else if (ctx.message?.sticker) {
      messageType = MessageType.Sticker;
    } else if (ctx.message?.audio) {
      messageType = MessageType.Audio;
    } else if (ctx.message?.voice) {
      messageType = MessageType.Voice;
    } else if (ctx.message?.document) {
      messageType = MessageType.Document;
    } else if (ctx.message?.text) {
      messageType = MessageType.Text;
    }

    // Check if message type is allowed
    if (!topic.allowedMsgTypes.includes(messageType)) {
      console.log(
        `Message type ${messageType} not allowed in topic ${threadId}, deleting`
      );

      try {
        await ctx.deleteMessage();
      } catch (error) {
        // Silent fail
      }
    }

    await next();
  } catch (error) {
    console.error("Error in topic filtering:", error);
    await next();
  }
};
