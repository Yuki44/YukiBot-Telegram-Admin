import { CommandContext } from "grammy";
import { BotContext } from "../../types";
import { User } from "../../db/models/User";

export async function perdonarbanHandler(
  ctx: CommandContext<BotContext>
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const match = ctx.match?.toString().trim();
  if (!match) {
    await ctx.reply("⚠️ Especifica un usuario.");
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
    console.log(`[PARDON] DB lookup error: ${err}`);
  }

  if (!user) {
    await ctx.reply("❌ Sin registros para este usuario.");
    return;
  }

  const userId = user.userId;
  const username = user.username ?? String(userId);

  console.log(`[PARDON] Pardoning ${userId} (${username}) in ${chatId}`);

  await User.deleteOne({ userId, chatId });
  console.log(`[PARDON] Deleted user document for ${userId} in ${chatId}`);

  let unbanFailed = false;
  try {
    await ctx.api.unbanChatMember(chatId, userId);
    console.log(`[PARDON] Telegram unban successful for ${userId}`);
  } catch (err) {
    console.log(`[PARDON] Telegram unban failed for ${userId}: ${err}`);
    unbanFailed = true;
  }

  const msg = unbanFailed
    ? `✅ Hecho. @${username} puede volver a unirse. (Desbanealo manualmente si es necesario.)`
    : `✅ Hecho. @${username} puede volver a unirse.`;

  await ctx.reply(msg);
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}
