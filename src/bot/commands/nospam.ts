import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { spamPatternRepository } from "../../db/repositories/spamPatternRepository";
import { t } from "../../locales/i18n";
import { logger } from "../../utils/logger";

export async function nospamHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatId = ctx.chat.id;
    const arg = ctx.match?.toString().trim();

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    if (!arg) return;

    const logsTo = ctx.chatConfig?.logsTo;

    const isUserId = /^\d+$/.test(arg);
    const isPatternId = /^[a-f0-9]{7}$/.test(arg);

    if (!isUserId && !isPatternId) return;

    let removed = false;
    let removedId = "";

    try {
      if (isUserId) {
        const userId = parseInt(arg, 10);
        const pattern = await spamPatternRepository.removeByTriggeredUser(chatId, userId);
        removed = !!pattern;
        removedId = pattern?.patternId ?? arg;
      } else {
        removed = await spamPatternRepository.removeByPatternId(chatId, arg);
        removedId = arg;
      }
    } catch (err) {
      logger.error({ action: "nospam_cmd", chatId, arg, error: String(err) });
      return;
    }

    const message = removed
      ? t("spam.patternRemoved", { id: removedId })
      : t("spam.patternNotFound", { arg });

    if (logsTo) {
      try {
        await ctx.api.sendMessage(logsTo, message, { parse_mode: "HTML" });
      } catch {
        /* silent */
      }
    }

    logger.info({ action: "nospam_cmd", chatId, arg, removed, removedId });
  } catch (err) {
    logger.error({ action: "nospam_cmd", error: String(err) });
  }
}
