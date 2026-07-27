import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { isCandidate } from "./preScreen";
import { classifyLanguage } from "./classifier";
import { handleLanguageOffense } from "./actions";
import { logger } from "../../utils/logger";

export async function languageDetection(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig?.features?.languageDetection) return await next();
    if (ctx.isAdmin) return await next();

    const msg = ctx.message;
    if (!msg) return await next();

    const sender = msg.from;
    if (!sender || sender.is_bot) return await next();

    const text = msg.text ?? msg.caption ?? "";
    if (!text) return await next();

    if ((chatConfig.spamUserWhitelist ?? []).includes(sender.id)) return await next();
    try {
      if (await adminRepository.isChatAdmin(sender.id, msg.chat.id)) return await next();
    } catch {
      /* continue */
    }

    if (!isCandidate(text)) return await next();

    const { verdict, reason } = await classifyLanguage(text);
    if (verdict !== "FOREIGN_BLATANT") return await next();

    logger.info({ action: "languageDetection_match", chatId: msg.chat.id, userId: sender.id, reason });

    const senderName = [sender.first_name, sender.last_name].filter(Boolean).join(" ") || "Usuario";
    await handleLanguageOffense(ctx, { userId: sender.id, name: senderName, username: sender.username }, msg);
  } catch (err) {
    logger.error({ action: "languageDetection", error: String(err) });
    return await next();
  }
}
