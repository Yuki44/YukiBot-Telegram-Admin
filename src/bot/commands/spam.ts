import { createHash } from "crypto";
import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { spamPatternRepository, normalizeText } from "../../db/repositories/spamPatternRepository";
import { applyWarn } from "../helpers/applyWarn";
import { silenceUser } from "../helpers/silenceUser";
import { getChatTitle } from "../helpers/contextHelpers";
import { sendSpamLog } from "../../features/promoSpamDetection";
import { logger } from "../../utils/logger";

/** Describe media type for non-text messages stored as learned patterns */
function describeMedia(msg: NonNullable<CommandContext<BotContext>["message"]>): string {
  if (msg.photo) return "[media:photo]";
  if (msg.video) return "[media:video]";
  if (msg.document) return "[media:document]";
  if (msg.audio) return "[media:audio]";
  if (msg.voice) return "[media:voice]";
  if (msg.sticker) return "[media:sticker]";
  return "[media:other]";
}

/** Extract the best file_id from a media message (largest photo size, or the media's own file_id). */
function extractMediaFileId(msg: NonNullable<CommandContext<BotContext>["message"]>): string | null {
  if (msg.photo && msg.photo.length > 0) return msg.photo[msg.photo.length - 1].file_id;
  if (msg.video) return msg.video.file_id;
  if (msg.document) return msg.document.file_id;
  if (msg.audio) return msg.audio.file_id;
  if (msg.voice) return msg.voice.file_id;
  if (msg.sticker) return msg.sticker.file_id;
  return null;
}

export async function spamHandler(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const chatConfig = ctx.chatConfig;
    if (!chatConfig) return;

    const replied = ctx.message?.reply_to_message;
    if (!replied) return;

    const target = replied.from;
    if (!target || target.is_bot) return;

    const chatId = ctx.chat.id;
    const logsTo = chatConfig.logsTo;
    const topicId = ctx.message?.message_thread_id;
    const chatName = getChatTitle(ctx);
    const targetName = [target.first_name, target.last_name].filter(Boolean).join(" ");
    const targetUsername = target.username;
    const adminId = ctx.from!.id;

    const repliedMsg = replied as NonNullable<CommandContext<BotContext>["message"]>;
    const patternText =
      (replied.text ?? replied.caption)
        ? (replied.text ?? replied.caption)!
        : describeMedia(repliedMsg);
    const mediaFileId = extractMediaFileId(repliedMsg);

    const normalized = normalizeText(patternText);
    const normalizedHash = createHash("sha256").update(normalized).digest("hex");
    const patternId = normalizedHash.slice(0, 7);

    // Forward spam message to logs BEFORE deleting
    if (logsTo) {
      try {
        await ctx.api.forwardMessage(logsTo, chatId, replied.message_id);
      } catch (err) {
        logger.error({ action: "spam_cmd_forward", chatId, error: String(err) });
      }
    }

    try {
      await ctx.api.deleteMessage(chatId, replied.message_id);
    } catch (err) {
      logger.error({ action: "spam_cmd_delete", chatId, error: String(err) });
    }

    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }

    await silenceUser(ctx, target.id, chatId);

    const { warnMsgId } = await applyWarn(ctx, target.id, chatId, targetName, targetUsername, "por spam", {
      chatConfig,
      chatName,
      topicId,
      actor: { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username },
    });

    if (logsTo) {
      await sendSpamLog(
        ctx,
        logsTo,
        chatId,
        chatName,
        target.id,
        targetName,
        "manual:/spam",
        topicId,
        warnMsgId
      );
    }

    try {
      await spamPatternRepository.add(chatId, patternText, adminId, target.id, mediaFileId);
      logger.info({
        action: "spam_cmd_pattern_saved",
        chatId,
        patternId,
        triggeredByUserId: target.id,
        addedByUserId: adminId,
      });
    } catch (err) {
      logger.error({ action: "spam_cmd_save_pattern", chatId, error: String(err) });
    }
  } catch (err) {
    logger.error({ action: "spam_cmd", error: String(err) });
  }
}
