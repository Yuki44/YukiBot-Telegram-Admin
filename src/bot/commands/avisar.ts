import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function displayName(name: string, username?: string): string {
  return username ? `${esc(name)} (@${esc(username)})` : esc(name);
}

async function executeAvisar(ctx: BotContext, deleteReplied: boolean): Promise<void> {
  if (!ctx.chatConfig) return;

  const chatId = ctx.chat!.id;
  const senderId = ctx.from?.id;
  const args = ctx.match ? String(ctx.match).trim().split(/\s+/).filter(Boolean) : [];

  const target = await resolveTarget(ctx, args);

  if (!target) {
    await ctx.reply("⚠️ Debes especificar un usuario o responder a su mensaje.", { parse_mode: "HTML" });
    return;
  }

  // Silently ignore if trying to warn self
  if (target.userId === senderId) return;

  // Silently ignore if target is an admin
  const isTargetAdmin = await adminRepository.isChatAdmin(target.userId, chatId);
  if (isTargetAdmin) return;

  // If target was resolved from args[0], reason starts at args[1]; otherwise all args are the reason
  const reasonArgs = target.resolvedFromArgs ? args.slice(1) : args;
  const reason = reasonArgs.join(" ").trim();

  if (!reason) {
    await ctx.reply("⚠️ Debes especificar una razón para el aviso.", { parse_mode: "HTML" });
    return;
  }

  const user = await userRepository.incrementWarning(target.userId, chatId, reason, target.username, target.name);
  const dn = displayName(target.name, target.username);

  if (deleteReplied && ctx.message?.reply_to_message?.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, ctx.message.reply_to_message.message_id);
    } catch {
      // Silently ignore if delete fails
    }
  }

  if (user.warnings >= 3) {
    let banMsg = `🚫 <b>${dn} ha sido baneado</b> tras recibir 3 avisos.\n📋 Última razón: ${esc(reason)}`;
    try {
      await ctx.api.banChatMember(chatId, target.userId);
    } catch {
      banMsg += "\n<i>(Error al ejecutar el ban, hazlo manualmente.)</i>";
    }
    await ctx.reply(banMsg, { parse_mode: "HTML" });
  } else if (user.warnings === 2) {
    await ctx.reply(
      `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}\n❗ Un aviso más y será baneado.`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `⚠️ <b>Aviso ${user.warnings}/3</b> para ${dn}\n📋 Razón: ${esc(reason)}`,
      { parse_mode: "HTML" }
    );
  }

  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}

export async function avisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, false);
}

export async function elAvisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, true);
}
