import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";

export const isAdmin: Middleware<BotContext> = async (ctx, next) => {
  try {
    const userId = ctx.message?.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      ctx.isAdmin = false;
    } else {
      ctx.isAdmin = await adminRepository.isChatAdmin(userId, chatId);
    }
  } catch (error) {
    console.error("Error checking admin status:", error);
    ctx.isAdmin = false;
  }
  await next();
};
