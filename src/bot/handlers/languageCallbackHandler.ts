import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { logger } from "../../utils/logger";
import { parseGraceCallback } from "../../features/languageDetection/actions";

/** Handles the "➕ Otorgar gracia extra" button on an #IDIOMA_GRACIA log post. */
export async function languageCallbackHandler(ctx: BotContext): Promise<void> {
  try {
    if (!ctx.callbackQuery) return;
    await ctx.answerCallbackQuery();

    const parsed = parseGraceCallback(ctx.callbackQuery.data ?? "");
    if (!parsed) return;
    const { chatId, userId } = parsed;

    await userRepository.clearLanguageGrace(userId, chatId);

    const actorName = ctx.from?.first_name ?? "Admin";
    const originalMsg = ctx.callbackQuery.message;
    if (originalMsg?.text) {
      try {
        await ctx.editMessageText(`${originalMsg.text}\n\n✅ Gracia extra otorgada por ${actorName}.`, {
          reply_markup: undefined,
        });
      } catch {
        /* silent — message may be too old or unchanged */
      }
    }

    logger.info({ action: "language_grace_reset", chatId, userId, actorId: ctx.from?.id });
  } catch (err) {
    logger.error({ action: "languageCallbackHandler", error: String(err) });
  }
}
