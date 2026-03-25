import { BotContext } from "../../types";
import { resolveTarget } from "../helpers/resolveTarget";
import { adminRepository } from "../../db/repositories/adminRepository";
import { applyWarn } from "../helpers/applyWarn";

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

  if (deleteReplied && ctx.message?.reply_to_message?.message_id) {
    try {
      await ctx.api.deleteMessage(chatId, ctx.message.reply_to_message.message_id);
    } catch {
      // Silently ignore if delete fails
    }
  }

  await applyWarn(ctx, target.userId, chatId, target.name, target.username, reason);

  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}

export async function avisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, false);
}

export async function elAvisarHandler(ctx: BotContext): Promise<void> {
  await executeAvisar(ctx, true);
}
