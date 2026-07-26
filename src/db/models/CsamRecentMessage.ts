import { Schema, model } from "mongoose";
import { CSAM_RECENT_MESSAGE_TTL_S } from "../../config/constants";

/**
 * Rolling per-(user,chat) message-id log for csamDetection chats, so an
 * auto-ban can batch-delete what this person just posted. TTL-expired after
 * CSAM_RECENT_MESSAGE_TTL_S — a short lookback window, not a message archive.
 */
export interface ICsamRecentMessage {
  userId: number;
  chatId: number;
  messageId: number;
  createdAt: Date;
}

const csamRecentMessageSchema = new Schema<ICsamRecentMessage>({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  messageId: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

csamRecentMessageSchema.index({ userId: 1, chatId: 1 });
csamRecentMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: CSAM_RECENT_MESSAGE_TTL_S });

export const CsamRecentMessage = model<ICsamRecentMessage>("CsamRecentMessage", csamRecentMessageSchema);
