import { Api } from "grammy";

/**
 * In-memory map: "userId:chatId" → latest Telegram messageId.
 * Updated by trackUser middleware on every non-admin message.
 * Used by el* commands to delete the last message when no reply is provided.
 */
const lastMessageMap = new Map<string, number>();

export function trackLastMessage(userId: number, chatId: number, messageId: number): void {
  lastMessageMap.set(`${userId}:${chatId}`, messageId);
}

/**
 * Deletes the last tracked message for a user in a chat.
 * Returns true if deletion was attempted (message was found in the tracker).
 */
export async function deleteLastMessage(api: Api, chatId: number, userId: number): Promise<boolean> {
  const key = `${userId}:${chatId}`;
  const messageId = lastMessageMap.get(key);
  if (!messageId) return false;

  try {
    await api.deleteMessage(chatId, messageId);
    lastMessageMap.delete(key);
  } catch {
    // Ignore if already deleted or bot lacks permission
  }

  return true;
}
