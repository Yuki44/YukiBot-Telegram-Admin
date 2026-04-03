import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { userRepository } from "../../db/repositories/userRepository";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";

export async function bnHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const chatId = ctx.chat!.id;
    const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

    const target = await resolveTarget(ctx, args);
    if (!target) {
      const msg =
        args.length > 0 || ctx.message?.reply_to_message
          ? "⚠️ No se encontró al usuario."
          : "⚠️ Especifica un usuario.";
      await sendAndAutoDelete(ctx, msg, 0);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
    if (isTargetAdmin) {
      await sendAndAutoDelete(ctx, "❌ No puedes banear a un administrador.", 0);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    let success = false;
    try {
      await ctx.api.banChatMember(chatId, target.userId);
      success = true;
    } catch (err) {
      console.error(`[BN] Failed to ban ${target.userId} from chat ${chatId}:`, err);
    }

    // Update DB — mark permanently banned (G3: wasBanned must never revert to false)
    try {
      await userRepository.markBanned(target.userId, chatId, target.username, target.name);
    } catch (err) {
      console.error(`[BN] DB update failed for ${target.userId}:`, err);
    }

    try { await ctx.deleteMessage(); } catch { /* ignore */ }

    if (success) {
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `🚷 ${mention} ha sido baneado permanentemente.`, 0);

      const actor = ctx.from
        ? {
            id: ctx.from.id,
            name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
            username: ctx.from.username,
          }
        : undefined;
      const chatName = (ctx.chat as any)?.title ?? "Unknown";
      sendLog(ctx.api, ctx.chatConfig, {
        action: "BAN",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      await sendAndAutoDelete(ctx, "⚠️ No se pudo banear. ¿Tengo permisos?", 0);
    }
  } catch {
    // silent fail
  }
}



