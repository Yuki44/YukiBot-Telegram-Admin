import { Middleware } from "grammy";
import { BotContext } from "../../types";
import { sendLog } from "../../bot/helpers/sendLog";
import { getChatTitle } from "../../bot/helpers/contextHelpers";
import { fullName } from "../../bot/helpers/fullName";
import { REPORT_MENTION_HANDLES } from "../../config/constants";
import { BOT_USERNAME } from "../../config";
import { logger } from "../../utils/logger";

// A message is a report when it uses /report (optionally /report@bot) or @-mentions
// the bot or any summon handle. Matched case-insensitively at a token boundary so
// @admin doesn't fire on @administrator. Gated on logFlags.logReports like every log.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isReportTrigger(text: string, botUsername: string): boolean {
  if (!text) return false;
  if (/(^|\s)\/report(@[A-Za-z0-9_]+)?(?![A-Za-z0-9_])/i.test(text)) return true;
  const handles = [botUsername, ...REPORT_MENTION_HANDLES].map((h) => h.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  return handles.some((h) => new RegExp(`(^|[^A-Za-z0-9_@])@${escapeRegex(h)}(?![A-Za-z0-9_])`).test(lower));
}

export const reportLog: Middleware<BotContext> = async (ctx, next) => {
  try {
    const cfg = ctx.chatConfig;
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";
    if (
      cfg?.logFlags?.logReports &&
      cfg.logsTo &&
      ctx.from &&
      !ctx.from.is_bot &&
      isReportTrigger(text, BOT_USERNAME)
    ) {
      const replied = ctx.message?.reply_to_message;
      const reporter = { id: ctx.from.id, name: fullName(ctx.from), username: ctx.from.username };
      const reportedFrom = replied?.from && !replied.from.is_bot ? replied.from : undefined;
      // No reply → target is the reporter, so sendLog drops the "A" line.
      const target = reportedFrom
        ? { id: reportedFrom.id, name: fullName(reportedFrom), username: reportedFrom.username }
        : reporter;

      void sendLog(ctx.api, cfg, {
        action: "REPORTE",
        actor: reporter,
        target,
        chatId: ctx.chat!.id,
        chatName: getChatTitle(ctx),
        chatType: cfg.type,
        topicId: ctx.message?.message_thread_id,
        // Nav always jumps to the reporter's own report/mention message.
        refMsgId: ctx.message?.message_id,
        reporterMsg: ctx.message,
        repliedMsg: replied,
      });
    }
  } catch (err) {
    logger.error({ action: "reportLog", error: String(err) });
  }
  return await next();
};
