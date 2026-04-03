import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { User } from "../../db/models/User";
import { sendLog } from "../helpers/sendLog";

export async function quitarbanHandler(
  ctx: CommandContext<BotContext>
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const match = ctx.match?.toString().trim();
  if (!match) {
    await ctx.reply("⚠️ Especifica un usuario.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    return;
  }

  // Accept @username or numeric userId
  let user = null;
  const isNumeric = /^\d+$/.test(match);
  const usernameClean = match.startsWith("@") ? match.slice(1) : match;

  try {
    if (isNumeric) {
      user = await User.findOne({ userId: Number(match), chatId });
    } else {
      user = await User.findOne({ username: usernameClean, chatId });
    }
  } catch (err) {
    console.error(`[QBAN] DB lookup error: ${err}`);
  }

  if (!user) {
    await ctx.reply("❌ Sin registros para este usuario.", {
      message_thread_id: ctx.message?.message_thread_id,
    });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    return;
  }

  const userId = user.userId;
  const username = user.username ?? String(userId);
  const userName = user.name ?? String(userId);

  await User.deleteOne({ userId, chatId });

  let unbanFailed = false;
  try {
    await ctx.api.unbanChatMember(chatId, userId);
  } catch (err) {
    console.error(`[QBAN] Telegram unban failed for ${userId}: ${err}`);
    unbanFailed = true;
  }

  const actor = ctx.from
    ? { id: ctx.from.id, name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""), username: ctx.from.username }
    : undefined;
  const chatName = (ctx.chat as any)?.title ?? "Unknown";
  sendLog(ctx.api, ctx.chatConfig, {
    action: "Q_BAN",
    actor,
    target: { id: userId, name: userName, username: user.username },
    chatId,
    chatName,
  }).catch(() => {});

  const msg = unbanFailed
    ? `✅ Hecho. @${username} puede volver a unirse. (Desbanealo manualmente si es necesario.)`
    : `✅ Hecho. @${username} puede volver a unirse.`;

  await ctx.reply(msg, {
    message_thread_id: ctx.message?.message_thread_id,
  });
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}
