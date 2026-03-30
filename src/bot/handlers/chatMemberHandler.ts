import { Filter } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";

export async function chatMemberHandler(
  ctx: Filter<BotContext, "chat_member">
): Promise<void> {
  try {
    const { old_chat_member, new_chat_member } = ctx.chatMember;
    const { status, user } = new_chat_member;
    const oldStatus = old_chat_member.status;

    if (user.is_bot) return;
    if (!ctx.chatConfig) return;

    const userId = user.id;
    const username = user.username;
    const name = user.first_name;
    const chatId = ctx.chat.id;
    const chatName = ctx.chat.title ?? "Unknown";

    // --- Admin demotion: was admin/creator, no longer is ---
    const wasAdmin = oldStatus === "administrator" || oldStatus === "creator";
    const isAdmin = status === "administrator" || status === "creator";

    if (wasAdmin && !isAdmin) {
      adminRepository.remove(userId, chatId).catch((err) =>
        console.log(`[ERROR] admin remove failed for ${userId}: ${err}`)
      );
    }

    // --- Admin promotion ---
    if (isAdmin) {
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
      adminRepository
        .upsert({
          userId,
          username: username || "",
          name: fullName || "Unknown",
          chatId,
          chatName,
          role: status === "creator" ? "owner" : "admin",
        })
        .catch((err) => console.log(`[ERROR] admin upsert failed for ${userId}: ${err}`));

      // Also cache in User table
      userRepository
        .findOrCreate(userId, chatId, username, name)
        .catch((err) => console.log(`[ERROR] user upsert failed for ${userId}: ${err}`));
      return;
    }

    // --- Banned (Telegram calls it "kicked") ---
    if (status === "kicked") {
      try {
        await userRepository.upsert({ userId, chatId, username, name, isBanned: true, wasBanned: true });
        // console.log(`[BAN SYNC] ${userId} (${username ?? userId}) banned in ${chatId}`);
      } catch (err) {
        console.error(`[ERROR] ban sync failed for ${userId}: ${err}`);
      }
      return;
    }

    // --- Left or kicked by admin (can rejoin) — clean slate ---
    if (status === "left") {
      userRepository.remove(userId, chatId).catch((err) =>
        console.log(`[ERROR] user remove failed for ${userId}: ${err}`)
      );
      return;
    }

    // --- Joined or status changed: member | restricted ---
    let record;
    try {
      record = await userRepository.findOrCreate(userId, chatId, username, name);
    } catch (err) {
      console.log(`[ERROR] user findOrCreate failed for ${userId}: ${err}`);
      return;
    }

    // Auto-reban on rejoin
    if (ctx.chatConfig.features.autoBan && record.wasBanned) {
      // console.log(`[AUTO-REBAN] ${userId} (${username ?? userId}) attempted rejoin in ${chatId}`);
      try {
        await ctx.api.banChatMember(chatId, userId);
        await ctx.api.sendMessage(chatId, `🚫 @${username ?? userId} baneado.`);
      } catch (err) {
        console.error(`[ERROR] auto-reban failed for ${userId}: ${err}`);
      }
    }
  } catch (err) {
    console.log(`[ERROR] chatMemberHandler outer: ${err}`);
  }
}
