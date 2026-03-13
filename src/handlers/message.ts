import { Context } from "grammy";
import { ADMIN_IDS, TOPIC_RULES } from "../config";
import { MessageType } from "../types";

function detectMessageType(msg: NonNullable<Context["message"]>): MessageType {
  if (msg.photo) return MessageType.Photo;
  if (msg.video) return MessageType.Video;
  if (msg.sticker) return MessageType.Sticker;
  if (msg.audio) return MessageType.Audio;
  if (msg.voice) return MessageType.Voice;
  if (msg.document) return MessageType.Document;
  if (msg.text) return MessageType.Text;
  return MessageType.Other;
}

export async function handleMessage(ctx: Context): Promise<void> {
  const msg = ctx.message;
  if (!msg) return;

  // Admin check must be first
  const senderId = msg.from?.id;
  if (senderId !== undefined && ADMIN_IDS.includes(senderId)) return;

  if (!msg.message_thread_id) return;

  const rules = TOPIC_RULES[msg.message_thread_id];
  if (!rules) return;

  const type = detectMessageType(msg);

  if (!rules.includes(type)) {
    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error(`Failed to delete message ${msg.message_id}:`, err);
    }
  }
}
