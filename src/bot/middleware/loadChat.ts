import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";

export const loadChat: Middleware<BotContext> = async (ctx, next) => {
  try {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      ctx.chatConfig = null;
      return await next();
    }

    const chatConfig = await chatRepository.findByChatId(chatId);

    if (!chatConfig || !chatConfig.isActive) {
      ctx.chatConfig = null;
    } else {
      ctx.chatConfig = chatConfig;
    }

    await next();
  } catch (error) {
    console.error("Error loading chat config:", error);
    ctx.chatConfig = null;
    await next();
  }
};
