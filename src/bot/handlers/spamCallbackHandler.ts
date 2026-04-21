import { BotContext } from "../../types";
import { parseCallbackData } from "../../features/promoSpamDetection";
import { userRepository } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { sendLog } from "../helpers/sendLog";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { t } from "../../locales/i18n";
import { logger } from "../../utils/logger";

export async function spamCallbackHandler(ctx: BotContext): Promise<void> {
  try {
    if (!ctx.callbackQuery) return;
    await ctx.answerCallbackQuery();

    const data = ctx.callbackQuery.data ?? "";
    if (!data) return;
    const parsed = parseCallbackData(data);
    if (!parsed) return;

    const { verdict, chatId, userId, warnMsgId } = parsed;

    // Helper: append a plain-text line to the original log message keeping all existing entities
    const originalMsg = ctx.callbackQuery.message!;
    const originalText = originalMsg.text ?? "";
    const originalEntities = originalMsg.entities ?? [];

    const appendToLog = async (suffix: string) => {
      const newText = originalText + "\n\n" + suffix;
      const newEntity = { type: "bold" as const, offset: originalText.length + 2, length: suffix.length };
      try {
        await ctx.editMessageText(newText, { entities: [...originalEntities, newEntity] });
      } catch {
        /* silent — message may be too old or unchanged */
      }
    };

    if (verdict === "ok") {
      await appendToLog(t("spam.confirmed"));
    } else if (verdict === "rv") {
      const issues: string[] = [];

      // 1. Unsilence
      const unsilenced = await unsilenceUser(ctx, userId, chatId);
      if (!unsilenced) issues.push("silencio");

      // 2. Decrement warning in DB
      let userRecord = null;
      try {
        userRecord = await userRepository.decrementWarning(userId, chatId);
      } catch (err) {
        logger.error({ action: "spamCallback_revert_decrement", chatId, userId, error: String(err) });
        issues.push("aviso");
      }

      // 3. Delete the warn message Yuki sent to the group
      if (warnMsgId && warnMsgId > 0) {
        try {
          await ctx.api.deleteMessage(chatId, warnMsgId);
        } catch {
          issues.push("mensaje de aviso");
        }
      }

      // 4. Look up chatConfig for the group to send Q_ logs
      let groupConfig = null;
      try {
        groupConfig = await chatRepository.findByChatId(chatId);
      } catch {
        /* silent */
      }

      const target = {
        id: userId,
        name: userRecord?.name ?? String(userId),
        username: userRecord?.username,
      };
      const actor = { id: ctx.from!.id, name: ctx.from!.first_name, username: ctx.from?.username };

      // 5. Q_SILENCIO log
      sendLog(ctx.api, groupConfig, {
        action: "Q_SILENCIO",
        actor,
        target,
        chatId,
        chatName: groupConfig?.name ?? String(chatId),
      }).catch(() => {});

      // 6. Q_AVISO log
      sendLog(ctx.api, groupConfig, {
        action: "Q_AVISO",
        actor,
        target,
        chatId,
        chatName: groupConfig?.name ?? String(chatId),
        warnings: userRecord?.warnings ?? 0,
      }).catch(() => {});

      const summary =
        issues.length === 0
          ? t("spam.reverted")
          : t("spam.revertedWithIssues", { issues: issues.join(", ") });

      await appendToLog(summary);

      logger.info({ action: "spamCallback_revert", chatId, userId, warnMsgId });
    }
  } catch (err) {
    logger.error({ action: "spamCallbackHandler", error: String(err) });
  }
}
