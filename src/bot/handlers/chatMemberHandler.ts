import { Filter } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { sendLog, LogUser } from "../helpers/sendLog";

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
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const chatId = ctx.chat.id;
    const chatName = ctx.chat.title ?? "Unknown";

    const target: LogUser = { id: userId, name: fullName, username };

    // --- Admin demotion: was admin/creator, no longer is ---
    const wasAdmin = oldStatus === "administrator" || oldStatus === "creator";
    const isAdmin = status === "administrator" || status === "creator";

    if (wasAdmin && !isAdmin) {
      adminRepository.remove(userId, chatId).catch((err) =>
        console.error(`[ERROR] admin remove failed for ${userId}: ${err}`)
      );
    }

    // --- Admin promotion ---
    if (isAdmin) {
      adminRepository
        .upsert({
          userId,
          username: username || "",
          name: fullName || "Unknown",
          chatId,
          chatName,
          role: status === "creator" ? "owner" : "admin",
        })
        .catch((err) => console.error(`[ERROR] admin upsert failed for ${userId}: ${err}`));

      // Also cache in User table
      userRepository
        .findOrCreate(userId, chatId, username, name)
        .catch((err) => console.error(`[ERROR] user upsert failed for ${userId}: ${err}`));
      return;
    }

    // --- Banned (Telegram calls it "kicked") ---
    if (status === "kicked") {
      try {
        await userRepository.upsert({ userId, chatId, username, name, isBanned: true, wasBanned: true });
      } catch (err) {
        console.error(`[ERROR] ban sync failed for ${userId}: ${err}`);
      }

      // Log BAN only if triggered by an external actor (not YukiBot itself)
      // Telegram API uses status "kicked" for bans
      const from = ctx.chatMember.from;
      if (from && from.id !== ctx.me.id) {
        const actor: LogUser = {
          id: from.id,
          name: [from.first_name, from.last_name].filter(Boolean).join(" "),
          username: from.username,
        };
        sendLog(ctx.api, ctx.chatConfig, {
          action: "BAN",
          actor,
          target,
          chatId,
          chatName,
        }).catch(() => {});
      }
      return;
    }

    // --- Left ---
    if (status === "left") {
      // kicked → left = admin unbanned via UI — preserve wasBanned flag, no SALIDA log
      if (oldStatus === "kicked") {
        return;
      }

      // member/restricted → left = genuine departure
      // Check if user has wasBanned before deleting — never lose that flag (G3)
      let existingUser;
      try {
        existingUser = await userRepository.findByUserAndChat(userId, chatId);
      } catch { /* silent */ }

      if (existingUser?.wasBanned) {
        // Keep the record so auto-reban triggers if they rejoin
        return;
      }

      // Log SALIDA_USUARIO
      sendLog(ctx.api, ctx.chatConfig, {
        action: "SALIDA_USUARIO",
        target,
        chatId,
        chatName,
      }).catch(() => {});

      userRepository.remove(userId, chatId).catch((err) =>
        console.error(`[ERROR] user remove failed for ${userId}: ${err}`)
      );
      return;
    }

    // --- Joined or status changed: member | restricted ---
    let record;
    try {
      record = await userRepository.findOrCreate(userId, chatId, username, name);
    } catch (err) {
      console.error(`[ERROR] user findOrCreate failed for ${userId}: ${err}`);
      return;
    }

    // Auto-reban on rejoin
    if (ctx.chatConfig.features.autoBan && record.wasBanned) {
      try {
        await ctx.api.banChatMember(chatId, userId);
        await ctx.api.sendMessage(chatId, `🚫 @${username ?? userId} baneado.`);
      } catch (err) {
        console.error(`[ERROR] auto-reban failed for ${userId}: ${err}`);
      }

      sendLog(ctx.api, ctx.chatConfig, {
        action: "AUTO_BAN",
        target,
        chatId,
        chatName,
      }).catch(() => {});
      return;
    }

    // Log ENTRADA_USUARIO (only for genuine joins, not status changes within the group)
    const wasOut = oldStatus === "left" || oldStatus === "kicked";
    if (wasOut) {
      const from = ctx.chatMember.from;
      const actor: LogUser | undefined = (from && from.id !== userId)
        ? { id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(" "), username: from.username }
        : undefined;

      // Try to extract invite link creator
      let inviter: LogUser | undefined;
      const inviteLink = (ctx.chatMember as any).invite_link;
      if (inviteLink?.creator) {
        const c = inviteLink.creator;
        inviter = {
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" "),
          username: c.username,
        };
      }

      sendLog(ctx.api, ctx.chatConfig, {
        action: "ENTRADA_USUARIO",
        actor,
        target,
        chatId,
        chatName,
        inviter,
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`[ERROR] chatMemberHandler outer: ${err}`);
  }
}
