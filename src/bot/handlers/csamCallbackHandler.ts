import { InlineKeyboard } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { recordActivity } from "../../utils/activityLog";
import { logger } from "../../utils/logger";
import {
  parseCsamCallback,
  banAcrossChats,
  unbanAcrossChats,
  unsilenceInChat,
  buildCsamCallback,
  CsamTarget,
} from "../../features/csamDetection/actions";

/**
 * Handles the inline buttons on a #CP_ALERTA post:
 *  - ban  : (from a SILENCE alert) a human confirms → ban across all chats.
 *  - qsil : (from a SILENCE alert) false positive → lift the silence.
 *  - undo : (from an AUTO_BAN alert) mistaken auto-ban → unban across all chats.
 */
export async function csamCallbackHandler(ctx: BotContext): Promise<void> {
  try {
    if (!ctx.callbackQuery) return;
    await ctx.answerCallbackQuery();

    const parsed = parseCsamCallback(ctx.callbackQuery.data ?? "");
    if (!parsed) return;
    const { verdict, chatId, userId } = parsed;

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

    let userRecord = null;
    try {
      userRecord = await userRepository.findByUserAndChat(userId, chatId);
    } catch {
      /* silent */
    }
    const target: CsamTarget = {
      userId,
      name: userRecord?.name,
      username: userRecord?.username,
    };
    const actor = { id: ctx.from!.id, name: ctx.from!.first_name, username: ctx.from?.username };

    if (verdict === "ban") {
      const propagatedTo = await banAcrossChats(ctx.api, target, actor, "CP/impostor confirmado manualmente");
      recordActivity({
        chatId,
        type: "csam_autoban",
        source: "bot",
        actor,
        target: { id: userId, name: target.name, username: target.username },
        reason: `CP/impostor confirmado manualmente (propagado a ${propagatedTo} chat/s)`,
      });
      // Swap the buttons to a single undo so a mistaken confirm is still reversible.
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard().text(
            "↩️ Deshacer (desbanear)",
            buildCsamCallback("undo", chatId, userId)
          ),
        });
      } catch {
        /* silent */
      }
      await appendToLog(`🚫 Baneado en ${propagatedTo} chat(s) por ${actor.name}.`);
      logger.info({ action: "csamCallback_ban", chatId, userId, propagatedTo });
    } else if (verdict === "qsil") {
      const freed = await unsilenceInChat(ctx.api, chatId, target);
      recordActivity({
        chatId,
        type: "unsilence",
        source: "bot",
        actor,
        target: { id: userId, name: target.name, username: target.username },
        reason: "falso positivo CP/impostor",
      });
      // Drop only this chat's qsil button; a sibling chat's alert keeps its own.
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: new InlineKeyboard().text("🚫 Banear", buildCsamCallback("ban", chatId, userId)),
        });
      } catch {
        /* silent */
      }
      await appendToLog(
        freed
          ? `🔊 Falso positivo — silencio retirado en este chat por ${actor.name}.`
          : `⚠️ Intento de quitar silencio (revisar manualmente) por ${actor.name}.`
      );
      logger.info({ action: "csamCallback_qsil", chatId, userId, freed });
    } else if (verdict === "undo") {
      await unbanAcrossChats(ctx.api, target);
      recordActivity({
        chatId,
        type: "unban",
        source: "bot",
        actor,
        target: { id: userId, name: target.name, username: target.username },
        reason: "baneo CP/impostor deshecho",
      });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        /* silent */
      }
      await appendToLog(`↩️ Baneo deshecho por ${actor.name}. (wasBanned se mantiene, G3.)`);
      logger.info({ action: "csamCallback_undo", chatId, userId });
    }
  } catch (err) {
    logger.error({ action: "csamCallbackHandler", error: String(err) });
  }
}
