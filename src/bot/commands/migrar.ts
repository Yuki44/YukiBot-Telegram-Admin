import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { adminRepository } from "../../db/repositories/adminRepository";
import { migrateChatData } from "../../services/chatMigration";
import { logger } from "../../utils/logger";
import { t } from "../../locales/i18n";

/**
 * /migrar <sourceChatId> — copy moderation state from another chat into THIS
 * chat. Owner-only on the destination chat (the Telegram creator or a delegated
 * owner). No permission is required on the source chat by design — the new
 * chat's owner may differ from the old chat's owner.
 *
 * The keep/deactivate-old-chat prompt is web-only (it's interactive); the bot
 * path leaves both chats active. Use the dashboard to deactivate the old chat.
 */
export async function migrarHandler(ctx: CommandContext<BotContext>): Promise<void> {
  const destChatId = ctx.chat?.id;
  if (!destChatId) return;
  const senderId = ctx.from?.id;
  if (!senderId) return;

  const threadOpts = { message_thread_id: ctx.message?.message_thread_id };

  let isOwner = false;
  try {
    isOwner =
      (await adminRepository.isOwner(senderId, destChatId)) || ctx.chatConfig?.delegatedOwnerId === senderId;
  } catch (err) {
    logger.error({ action: "migrar.ownerCheck", senderId, destChatId, error: String(err) });
  }
  if (!isOwner) {
    await ctx.reply(t("migration.notOwner"), threadOpts);
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    return;
  }

  const match = ctx.match?.toString().trim();
  const sourceChatId = match ? Number(match) : NaN;
  if (!match || !Number.isFinite(sourceChatId)) {
    await ctx.reply(t("migration.specifySource"), threadOpts);
    return;
  }
  if (sourceChatId === destChatId) {
    await ctx.reply(t("migration.sameChat"), threadOpts);
    return;
  }

  try {
    const summary = await migrateChatData(sourceChatId, destChatId, senderId);

    await ctx.reply(
      t("migration.success", {
        users: summary.users,
        words: summary.bannedWords,
        mixtos: summary.domainAllowances,
      }),
      threadOpts
    );

    // Post the outcome to the (just-copied) logs channel, if any. G10: a logging
    // failure must never surface to the group or break the flow.
    if (summary.logsTo) {
      try {
        await ctx.api.sendMessage(
          summary.logsTo,
          t("migration.logPost", {
            sourceChatId,
            destChatId,
            actor: ctx.from?.username ? `@${ctx.from.username}` : String(senderId),
            users: summary.users,
            words: summary.bannedWords,
            mixtos: summary.domainAllowances,
          })
        );
      } catch (err) {
        logger.warn({ action: "migrar.logPost", sourceChatId, destChatId, error: String(err) });
      }
    }

    logger.info({ action: "migrar", senderId, ...summary });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("source_chat_not_found")) {
      await ctx.reply(t("migration.sourceNotFound", { chatId: sourceChatId }), threadOpts);
    } else if (msg.includes("dest_chat_not_found")) {
      await ctx.reply(t("migration.destNotSetup"), threadOpts);
    } else {
      logger.error({ action: "migrar", senderId, sourceChatId, destChatId, error: msg });
      await ctx.reply(t("migration.failed"), threadOpts);
    }
  }
}
