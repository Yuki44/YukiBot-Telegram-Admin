import { BotContext, IChat } from "../../types";
import { chatRepository } from "../../db/repositories/chatRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { applyWarn } from "../helpers/applyWarn";

interface SpamLogData {
  userId: number;
  chatId: number;
  userName: string;
  chatName: string;
}

function parseSpamLog(text: string): SpamLogData | null {
  if (!text.includes("#SPAM")) return null;

  const deMatch = text.match(/• De:\s*(.*?)\s*\[(\d+)]/);
  const grupoMatch = text.match(/• Grupo:\s*(.*?)\s*\[(-?\d+)]/);
  if (!deMatch || !grupoMatch) return null;

  return {
    userName: deMatch[1].trim(),
    userId: parseInt(deMatch[2], 10),
    chatName: grupoMatch[1].trim(),
    chatId: parseInt(grupoMatch[2], 10),
  };
}

function parseTopicIdFromEntities(entities: any[]): number | undefined {
  for (const entity of entities) {
    if (entity.type !== "text_link" || !entity.url) continue;
    const match = (entity.url as string).match(/[?&]thread=(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

export async function groupHelpSpamHandler(ctx: BotContext): Promise<void> {
  try {
    const text = ctx.message?.text ?? (ctx as any).channelPost?.text;
    if (!text) return;

    const parsed = parseSpamLog(text);
    if (!parsed) return;

    const { userId, chatId, userName, chatName } = parsed;

    const entities = ctx.message?.entities ?? (ctx as any).channelPost?.entities ?? [];
    const topicId = parseTopicIdFromEntities(entities);

    const logsChannelId = ctx.chat?.id;
    if (!logsChannelId) return;

    let chats: IChat[];
    try {
      chats = await chatRepository.findByLogsTo(logsChannelId);
    } catch (err) {
      console.error("[groupHelpSpamHandler] findByLogsTo failed:", err);
      return;
    }

    const targetChat = chats.find((c) => c.chatId === chatId);
    if (!targetChat) return;

    if (!targetChat.features.autoWarnSpam) return; // G8

    try {
      if (await adminRepository.isChatAdmin(userId, chatId)) return; // G4
    } catch (err) {
      console.error("[groupHelpSpamHandler] isChatAdmin check failed:", err);
      return;
    }

    await applyWarn(ctx, userId, chatId, userName, undefined, "por spam", {
      chatConfig: targetChat,
      chatName,
      topicId,
      actor: { id: ctx.me.id, name: ctx.me.first_name, username: ctx.me.username },
    });
  } catch (err) {
    console.error("[groupHelpSpamHandler] Unexpected error:", err);
  }
}
