import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";

export const isAdmin: Middleware<BotContext> = async (ctx, next) => {
  try {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      ctx.isAdmin = false;
    } else {
      ctx.isAdmin = await adminRepository.isChatAdmin(Number(userId), Number(chatId));

      // Fallback: if not in DB, check live status
      if (!ctx.isAdmin) {
        try {
          const member = await ctx.api.getChatMember(Number(chatId), Number(userId));
          const isAdminStatus = member.status === "creator" || member.status === "administrator";
          if (isAdminStatus) {
            ctx.isAdmin = true;
          }
        } catch (error) {
          logger.error({ action: "isAdmin_fallback", userId, chatId, error: String(error) });
        }
      }
    }
  } catch (error) {
    logger.error({ action: "isAdmin", error: String(error) });
    ctx.isAdmin = false;
  }
  await next();
};
