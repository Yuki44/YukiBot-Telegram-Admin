import { NextFunction } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { isCandidate } from "./preScreen";
import { detectLocally } from "./localDetect";
import { classifyLanguage } from "./classifier";
import { handleLanguageOffense } from "./actions";
import { LANGUAGE_SHADOW_SAMPLE_RATE } from "../../config/constants";
import { logger } from "../../utils/logger";
import { fullName } from "../../bot/helpers/fullName";

/**
 * Re-classifies a sampled slice of skipped messages without acting on the verdict, so a
 * pre-filter that starts swallowing offenses shows up as a countable FOREIGN_BLATANT here
 * instead of as silence nobody notices.
 */
function shadowSample(text: string, language?: string, confidence?: number): void {
  if (Math.random() >= LANGUAGE_SHADOW_SAMPLE_RATE) return;
  void classifyLanguage(text)
    .then(({ verdict, reason }) => {
      logger.info({
        action: "language_prefilter_shadow",
        missed: verdict === "FOREIGN_BLATANT",
        verdict,
        reason,
        language,
        confidence,
        text,
      });
    })
    .catch((err) => logger.error({ action: "language_prefilter_shadow_error", error: String(err) }));
}

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

    const local = await detectLocally(text);
    if (local.skip) {
      logger.info({
        action: "language_prefilter_skip",
        chatId: msg.chat.id,
        userId: sender.id,
        language: local.language,
        confidence: local.confidence,
      });
      shadowSample(text, local.language, local.confidence);
      return await next();
    }

    const { verdict, reason } = await classifyLanguage(text);
    if (verdict !== "FOREIGN_BLATANT") return await next();

    logger.info({ action: "languageDetection_match", chatId: msg.chat.id, userId: sender.id, reason });

    const senderName = fullName(sender) || "Usuario";
    await handleLanguageOffense(ctx, { userId: sender.id, name: senderName, username: sender.username }, msg);
  } catch (err) {
    logger.error({ action: "languageDetection", error: String(err) });
    return await next();
  }
}
