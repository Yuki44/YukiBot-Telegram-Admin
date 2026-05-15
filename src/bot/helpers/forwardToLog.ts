import { Api } from "grammy";
import { Message } from "grammy/types";
import { logger } from "../../utils/logger";

const HEADER = "💬 <b>Mensaje original:</b>";

/**
 * Sends the "Mensaje original" header above the message in the log channel,
 * always as two separate messages so all types are consistent.
 */
export async function forwardToLog(api: Api, logsTo: number, msg: Message): Promise<void> {
  const chatId = msg.chat.id;
  const msgId = msg.message_id;

  try {
    await api.sendMessage(logsTo, HEADER, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ action: "forwardToLog_header", logsTo, error: String(err) });
    return;
  }

  try {
    const cap = msg.caption ?? undefined;

    if (msg.text) {
      await api.sendMessage(logsTo, msg.text);
    } else if (msg.photo) {
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
    } else {
      try {
        await api.copyMessage(logsTo, chatId, msgId);
      } catch {
        await api.forwardMessage(logsTo, chatId, msgId);
      }
    }
  } catch (err) {
    logger.error({ action: "forwardToLog_content", logsTo, chatId, msgId, error: String(err) });
    try {
      await api.sendMessage(logsTo, "⚠️ <i>(no se pudo obtener el mensaje original)</i>", {
        parse_mode: "HTML",
      });
    } catch {
      /* best effort */
    }
  }
}
