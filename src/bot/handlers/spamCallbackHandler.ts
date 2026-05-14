import { BotContext } from "../../types";
import { parseCallbackData } from "../../features/promoSpamDetection";
import { userRepository } from "../../db/repositories/userRepository";
import { chatRepository } from "../../db/repositories/chatRepository";
import { spamPatternRepository } from "../../db/repositories/spamPatternRepository";
import { sendLog } from "../helpers/sendLog";
import { unsilenceUser } from "../helpers/unsilenceUser";
import { recordActivity } from "../../utils/activityLog";
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
      const reviewer = {
        id: ctx.from!.id,
        name: ctx.from!.first_name,
        username: ctx.from?.username,
      };

      // Mark the most recent matching SpamPattern as reviewed-by-admin so the
      // dashboard's Recientes list can hide already-handled rows. Best-effort:
      // link-only detections (no /spam command) won't have a SpamPattern row,
      // so this is silently a no-op for those.
      let targetUser: { name?: string; username?: string } = {};
      try {
        const pattern = await spamPatternRepository.markLatestReviewed(chatId, userId, reviewer);
        if (pattern) {
          // Best-effort hydrate target display fields from the user collection.
          try {
            const u = await userRepository.findByUserAndChat(userId, chatId);
            targetUser = { name: u?.name, username: u?.username };
          } catch {
            /* silent */
          }
        }
      } catch (err) {
        logger.error({ action: "spamCallback_confirm_mark", chatId, userId, error: String(err) });
      }

      // Audit trail: surface the confirmation in the dashboard's Registro screen.
      recordActivity({
        chatId,
        type: "spam_confirmed",
        source: "bot",
        actor: reviewer,
        target: { id: userId, name: targetUser.name, username: targetUser.username },
        reason: "spam confirmado en revisión",
      });

      await appendToLog(t("spam.confirmed"));
      logger.info({ action: "spamCallback_confirm", chatId, userId, reviewerId: reviewer.id });
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
