import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { topicRepository } from "../../db/repositories/topicRepository";
import { detectMessageType } from "../../bot/helpers/detectMessageType";
import { logger } from "../../utils/logger";

export const topicFiltering: Middleware<BotContext> = async (ctx, next) => {
  try {
    if (ctx.isAdmin) return await next();
    if (!ctx.chatConfig) return await next();
    if (!ctx.chatConfig.features.topicFiltering) return await next();

    const threadId = ctx.message?.message_thread_id;
    if (!threadId) return await next();

    const chatId = ctx.chat?.id;
    if (!chatId) return await next();

    const topic = await topicRepository.findByChatAndTopic(chatId, threadId);
    if (!topic) return await next();

    if (topic.adminOnly) {
      logger.info({ action: "topicFilter_adminOnly_delete", chatId, topicId: threadId });
      try {
        await ctx.deleteMessage();
      } catch {
        // silent fail — bot may lack permission
      }
      return;
    }

    const messageType = ctx.message ? detectMessageType(ctx.message) : null;
    if (!messageType) return await next();

    if (!topic.allowedMsgTypes.includes(messageType)) {
      logger.info({ action: "topicFilter_delete", chatId, topicId: threadId, messageType });
      try {
        await ctx.deleteMessage();
      } catch {
        // silent fail — bot may lack permission
      }
    }

    await next();
  } catch (error) {
    logger.error({ action: "topicFiltering", error: String(error) });
    await next();
  }
};
