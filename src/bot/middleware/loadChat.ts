import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";

export const loadChat: Middleware<BotContext> = async (ctx, next) => {
  try {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      ctx.chatConfig = null;
    } else {
      const chatConfig = await chatRepository.findByChatId(chatId);
      if (chatConfig && !chatConfig.whitelist) {
        console.log(`[WHITELIST] chat ${chatId} not whitelisted, ignoring`);
        ctx.chatConfig = null;
      } else {
        ctx.chatConfig = chatConfig?.isActive ? chatConfig : null;
      }
    }
  } catch (error) {
    console.error("Error loading chat config:", error);
    ctx.chatConfig = null;
  }
  await next();
};
