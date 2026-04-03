import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";
import { sendLog } from "../helpers/sendLog";
import { markKickInProgress } from "../helpers/kickTracker";

export async function kkHandler(ctx: BotContext): Promise<void> {
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
      await sendAndAutoDelete(ctx, "❌ No puedes echar a un administrador.", 0);
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
      return;
    }

    let success = false;
    try {
      markKickInProgress(chatId, target.userId);
      await ctx.api.banChatMember(chatId, target.userId);
      await ctx.api.unbanChatMember(chatId, target.userId);
      success = true;
    } catch (err) {
      console.error(`[KK] Failed to kick ${target.userId} from chat ${chatId}:`, err);
    }

    try { await ctx.deleteMessage(); } catch { /* ignore */ }

    if (success) {
      const mention = target.username ? `@${target.username}` : target.name;
      await sendAndAutoDelete(ctx, `👢 ${mention} ha sido echado. Puede volver a unirse.`, 0);

      const actor = ctx.from
        ? {
            id: ctx.from.id,
            name: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
            username: ctx.from.username,
          }
        : undefined;
      const chatName = (ctx.chat as any)?.title ?? "Unknown";
      sendLog(ctx.api, ctx.chatConfig, {
        action: "KICK",
        actor,
        target: { id: target.userId, name: target.name, username: target.username },
        chatId,
        chatName,
        topicId: ctx.message?.message_thread_id,
      }).catch(() => {});
    } else {
      await sendAndAutoDelete(ctx, "⚠️ No se pudo echar. ¿Tengo permisos?", 0);
    }
  } catch {
    // silent fail
  }
}

