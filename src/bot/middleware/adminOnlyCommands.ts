import { NextFunction } from "grammy";
import { BotContext } from "../../types";

const ADMIN_STATUSES = new Set(["creator", "administrator"]);

export async function adminOnlyCommands(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  const text = ctx.message?.text || ctx.message?.caption;
  if (text?.startsWith("/")) {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    const isTelegramAdmin = ctx.isAdmin;

    if (!isTelegramAdmin) {
      try {
        await ctx.deleteMessage();
      } catch {
        // Silently ignore delete failures
      }
      return;
    }
  }
  await next();
}
