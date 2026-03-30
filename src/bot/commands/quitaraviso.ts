import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { userRepository } from "../../db/repositories/userRepository";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

async function executeQuitarAviso(ctx: BotContext, deleteReplied: boolean): Promise<void> {
  if (!ctx.chatConfig) return;

  const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];
  const target = await resolveTarget(ctx, args);

  if (!target) {
    const msg = args.length > 0 || ctx.message?.reply_to_message
      ? "⚠️ No se encontró al usuario."
      : "⚠️ Debes especificar un usuario o responder a su mensaje.";
    await ctx.reply(msg, {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    return;
  }

  const chatId = ctx.chat!.id;
  const user = await userRepository.decrementWarning(target.userId, chatId);

  if (!user) {
    await ctx.reply("❌ Este usuario no tiene avisos registrados.", {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    });
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    return;
  }

  if (deleteReplied && ctx.message?.reply_to_message?.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, ctx.message.reply_to_message.message_id);
    } catch {
      // Silently ignore if delete fails
    }
  }

  const dn = displayName(target.name, target.username);
  await ctx.reply(
    `✅ Aviso eliminado para ${dn}.\n📋 Avisos actuales: ${user.warnings}/3`,
    {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    }
  );

  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}

export async function quitarAvisoHandler(ctx: BotContext): Promise<void> {
  await executeQuitarAviso(ctx, false);
}
