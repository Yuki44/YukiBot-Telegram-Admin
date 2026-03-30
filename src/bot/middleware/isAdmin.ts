import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";

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
          console.error(`[isAdmin] Fallback getChatMember failed for user ${userId} in chat ${chatId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Error checking admin status:", error);
    ctx.isAdmin = false;
  }
  await next();
};
