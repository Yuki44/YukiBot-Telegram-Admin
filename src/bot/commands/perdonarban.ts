import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog } from "../helpers/sendLog";
import { buildActor, getChatTitle } from "../helpers/contextHelpers";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

export async function quitarbanHandler(ctx: CommandContext<BotContext>): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const match = ctx.match?.toString().trim();
  if (!match) {
    await ctx.reply("⚠️ Especifica un usuario.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    return;
  }

  let user = null;
  const isNumeric = /^\d+$/.test(match);
  const usernameClean = match.startsWith("@") ? match.slice(1) : match;

  try {
    if (isNumeric) {
      user = await userRepository.findByUserAndChat(Number(match), chatId);
    } else {
      user = await userRepository.findByUsername(usernameClean, chatId);
    }
  } catch (err) {
    logger.error({ action: "qban_lookup", error: String(err) });
  }

  if (!user) {
    await ctx.reply("❌ Sin registros para este usuario.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
    return;
  }

  const userId = user.userId;
  const username = user.username ?? String(userId);
  const userName = user.name ?? String(userId);

  try {
    await userRepository.remove(userId, chatId);
  } catch (err) {
    logger.error({ action: "qban_delete", error: String(err) });
  }

  let unbanFailed = false;
  try {
    await ctx.api.unbanChatMember(chatId, userId);
  } catch (err) {
    logger.error({ action: "qban_unban", userId, error: String(err) });
    unbanFailed = true;
  }

  const actor = buildActor(ctx);
  sendLog(ctx.api, ctx.chatConfig, {
    action: "Q_BAN",
    actor,
    target: { id: userId, name: userName, username: user.username },
    chatId,
    chatName: getChatTitle(ctx),
  }).catch(() => {});

  recordActivity({
    chatId,
    type: "pardon",
    source: "bot",
    actor,
    target: { id: userId, name: userName, username: user.username },
  });

  const msg = unbanFailed
    ? `✅ Hecho. @${username} puede volver a unirse. (Desbanealo manualmente si es necesario.)`
    : `✅ Hecho. @${username} puede volver a unirse.`;

  await ctx.reply(msg, {
    message_thread_id: ctx.message?.message_thread_id,
  });
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
}
