import { Schema, model } from "mongoose";
import { CSAM_RECENT_MESSAGE_TTL_S } from "../../config/constants";

/** TTL-expired message-id log per (user,chat) — feeds the on-ban bulk delete. */
export interface ICsamRecentMessage {
  userId: number;
  chatId: number;
  messageId: number;
  /** Message carried a photo/video/document/… — lets the on-ban delete confirm the media (image) was removed. */
  hasMedia?: boolean;
  createdAt: Date;
}

const csamRecentMessageSchema = new Schema<ICsamRecentMessage>({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  hasMedia: { type: Boolean },
  createdAt: { type: Date, default: Date.now },
});

csamRecentMessageSchema.index({ userId: 1, chatId: 1 });
csamRecentMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: CSAM_RECENT_MESSAGE_TTL_S });

export const CsamRecentMessage = model<ICsamRecentMessage>("CsamRecentMessage", csamRecentMessageSchema);
