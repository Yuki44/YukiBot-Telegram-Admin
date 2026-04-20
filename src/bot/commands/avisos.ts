import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { userRepository } from "../../db/repositories/userRepository";
import { esc, displayName } from "../helpers/html";
import { parseArgs } from "../helpers/contextHelpers";
import { t } from "../../locales/i18n";
import { MAX_WARNINGS } from "../../config/constants";

export async function avisosHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const args = parseArgs(ctx);
    const target = await resolveTarget(ctx, args);

    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message
          ? t("errors.userNotFound")
          : t("errors.specifyUserOrReply");
      await ctx.reply(msg, {
        parse_mode: "HTML",
        message_thread_id: ctx.message?.message_thread_id,
      });
      try {
        await ctx.deleteMessage();
      } catch {
        /* ignore */
      }
      return;
    }

    const chatId = ctx.chat!.id;
    const user = await userRepository.findOrCreate(target.userId, chatId, target.username, target.name);
    const dn = displayName(target.name, target.username);

    let msg = t("warnings.warningStatus", { user: dn, current: user.warnings, max: MAX_WARNINGS });

    if (user.warningReasons && user.warningReasons.length > 0) {
      msg += `\n${t("warnings.warningReasons")}`;
      user.warningReasons.forEach((reason, i) => {
        msg += `\n${i + 1}. ${esc(reason)}`;
      });
    }

    await ctx.reply(msg, {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    });
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
  } catch {
    // silent fail (G10)
  }
}
