import { NextFunction } from "grammy";
import { BotContext } from "../../types";

const ADMIN_STATUSES = new Set(["creator", "administrator"]);

export async function adminOnlyCommands(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  if (ctx.message?.text?.startsWith("/")) {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    let isTelegramAdmin = false;
    if (userId && chatId) {
      try {
        const member = await ctx.getChatMember(userId);
        isTelegramAdmin = ADMIN_STATUSES.has(member.status);
      } catch {
        // If we can't check, deny by default
      }
    }

    if (!isTelegramAdmin) {
      try {
        await ctx.deleteMessage();
      } catch {
        // Silently ignore delete failures (e.g. missing permissions)
      }
      return;
    }
  }
  await next();
}
