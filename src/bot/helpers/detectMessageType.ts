/**
 * Detects the Telegram message type from a Grammy message object.
 * Single source of truth — used by topicFiltering and any future content rules.
 */

import { Context } from "grammy";
import { MessageType } from "../../types";

export function detectMessageType(msg: NonNullable<Context["message"]>): MessageType {
  if (msg.photo) return MessageType.Photo;
  if (msg.video) return MessageType.Video;
  if (msg.sticker) return MessageType.Sticker;
  if (msg.audio) return MessageType.Audio;
  if (msg.voice) return MessageType.Voice;
  if (msg.document) return MessageType.Document;
  if (msg.text) return MessageType.Text;
  return MessageType.Other;
}
