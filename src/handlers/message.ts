import { Context } from "grammy";
import { ADMIN_IDS, BOT_ENABLED, TOPIC_RULES } from "../config";
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
  const isAdmin = senderId !== undefined && ADMIN_IDS.includes(senderId);

  if (!msg.message_thread_id) return;

  const rules = TOPIC_RULES[msg.message_thread_id];
  if (!rules) return;

  const type = detectMessageType(msg);
  const username = msg.from?.username || msg.from?.first_name || `ID:${senderId}`;
  const chatName = ctx.chat?.title || "Unknown";
  const topicId = msg.message_thread_id;

  // Log admin activity in topics
  if (isAdmin) {
    console.log(`Admin ${username} posted in topic ${topicId} (${chatName}) with message type: ${type}`);
    return;
  }

  // Check if message type is allowed in topic
  if (!rules.includes(type)) {
    if (BOT_ENABLED) {
      try {
        await ctx.deleteMessage();
        console.log(`Message deleted from user ${username} in chat "${chatName}" topic ${topicId}. Not allowed message type: ${type}`);
      } catch (err) {
        console.error(`Failed to delete message ${msg.message_id} from user ${username} in topic ${topicId}:`, err);
      }
    } else {
      console.log(`[DRY-RUN] Would delete message from user ${username} in chat "${chatName}" topic ${topicId}. Not allowed message type: ${type}`);
    }
  }
}
