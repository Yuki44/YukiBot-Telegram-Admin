import { Api } from "grammy";
import { Message } from "grammy/types";
import { esc } from "./html";
import { logger } from "../../utils/logger";

/**
 * Sends a "💬 Mensaje original:" header then forwards the message to the log
 * channel via copy → forward → file_id fallback cascade, bypassing content
 * protection. Shared by command-reply logs and spam detection logs.
 */
export async function forwardToLog(api: Api, logsTo: number, msg: Message): Promise<void> {
  try {
    await api.sendMessage(logsTo, "💬 <b>Mensaje original:</b>", { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "forwardToLog_header", logsTo, error: String(err) });
    return;
  }

  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  try {
    await api.copyMessage(logsTo, chatId, msgId);
    return;
  } catch {
    /* fall through */
  }

  try {
    await api.forwardMessage(logsTo, chatId, msgId);
    return;
  } catch {
    /* fall through */
  }

  try {
    const cap = msg.caption ?? undefined;
    if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      await api.sendPhoto(logsTo, photo.file_id, { caption: cap });
    } else if (msg.video) {
      await api.sendVideo(logsTo, msg.video.file_id, { caption: cap });
    } else if (msg.document) {
      await api.sendDocument(logsTo, msg.document.file_id, { caption: cap });
    } else if (msg.animation) {
      await api.sendAnimation(logsTo, msg.animation.file_id, { caption: cap });
    } else if (msg.audio) {
      await api.sendAudio(logsTo, msg.audio.file_id, { caption: cap });
    } else if (msg.voice) {
      await api.sendVoice(logsTo, msg.voice.file_id, { caption: cap });
    } else if (msg.sticker) {
      await api.sendSticker(logsTo, msg.sticker.file_id);
    } else if (msg.video_note) {
      await api.sendVideoNote(logsTo, msg.video_note.file_id);
    } else if (msg.text) {
      await api.sendMessage(logsTo, `💬 ${esc(msg.text)}`, { parse_mode: "HTML" });
    }
  } catch (err) {
    logger.error({ action: "forwardToLog_fileId", logsTo, chatId, msgId, error: String(err) });
  }
}
