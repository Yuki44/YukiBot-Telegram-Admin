import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { logger } from "../../utils/logger";

export const loadChat: Middleware<BotContext> = async (ctx, next) => {
  try {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      ctx.chatConfig = null;
    } else {
      const chatConfig = await chatRepository.findByChatId(Number(chatId));
      if (chatConfig && !chatConfig.whitelist) {
        ctx.chatConfig = null;
      } else {
        ctx.chatConfig = chatConfig?.isActive ? chatConfig : null;
      }
    }
  } catch (error) {
    logger.error({ action: "loadChat", error: String(error) });
    ctx.chatConfig = null;
  }
  await next();
};
