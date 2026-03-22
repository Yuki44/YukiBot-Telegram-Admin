import { Filter } from "grammy";
import { BotContext } from "../../types";
import { User } from "../../db/models/User";

export async function chatMemberHandler(
  ctx: Filter<BotContext, "chat_member">
): Promise<void> {
  try {
    const newMember = ctx.chatMember.new_chat_member;
    const status = newMember.status;

    // Ignore "left" completely
    if (status === "left") return;

    // Skip bots
    if (newMember.user.is_bot) return;

    const userId = newMember.user.id;
    const username = newMember.user.username ?? String(userId);
    const firstName = newMember.user.first_name;
    const chatId = ctx.chat.id;

    if (status === "kicked") {
      if (!ctx.chatConfig) return;

      try {
        await User.findOneAndUpdate(
          { userId, chatId },
          { $set: { isBanned: true, wasBanned: true, username, name: firstName } },
          { upsert: true }
        );
        console.log(`[BAN SYNC] ${userId} (${username}) banned in ${chatId}`);
      } catch (err) {
        console.log(`[ERROR] chatMemberHandler ban sync failed for ${userId}: ${err}`);
      }
      return;
    }

    if (status === "member" || status === "restricted") {
      if (!ctx.chatConfig) return;

      if (!ctx.chatConfig.features.autoBan) {
        console.log(`[AUTO-REBAN SKIPPED] autoBan disabled for ${chatId}`);
        return;
      }

      let user;
      try {
        user = await User.findOne({ userId, chatId });
      } catch (err) {
        console.log(`[ERROR] chatMemberHandler DB lookup failed for ${userId}: ${err}`);
        return;
      }

      if (!user) {
        console.log(`[JOIN] ${userId} not in DB, skip`);
        return;
      }

      if (!user.wasBanned) return;

      console.log(`[AUTO-REBAN] ${userId} (${username}) attempted rejoin in ${chatId}`);

      try {
        await ctx.api.banChatMember(chatId, userId);
        await ctx.api.sendMessage(chatId, `🚫 @${username} baneado.`);
      } catch (err) {
        console.log(`[ERROR] auto-reban failed for ${userId}: ${err}`);
      }
    }
  } catch (err) {
    console.log(`[ERROR] chatMemberHandler outer: ${err}`);
  }
}
