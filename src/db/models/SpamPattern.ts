import { Schema, model, Document } from "mongoose";

export interface ISpamPattern extends Document {
  chatId: number;
  /** Original message text (or media label like "[media:photo]") */
  text: string;
  /** SHA-256 hex of normalizeText(text) */
  normalizedHash: string;
  /** First 7 chars of normalizedHash — shown to admins as the removable ID */
  patternId: string;
  /** Admin who ran /spam */
  addedByUserId: number;
  /** User whose message was flagged (stored so /nospam <userId> works after they leave) */
  triggeredByUserId: number;
  /**
   * Telegram file_id of the media attached to the flagged message, if any.
   * Lets the dashboard render the actual image/video preview in "Ver detalle"
   * instead of just the "[media:photo]" marker. Null for plain-text spam or
   * patterns created before v2.0.2.
   */
  mediaFileId?: string | null;
  /** When an admin pressed ✅ Correcto on the spam log message, marking the detection as accepted. */
  reviewedAt?: Date | null;
  reviewedById?: number | null;
  reviewedByName?: string | null;
  reviewedByUsername?: string | null;
  createdAt: Date;
}

const spamPatternSchema = new Schema<ISpamPattern>(
  {
    chatId: { type: Number, required: true },
    text: { type: String, required: true },
    normalizedHash: { type: String, required: true },
    patternId: { type: String, required: true },
    addedByUserId: { type: Number, required: true },
    triggeredByUserId: { type: Number, required: true },
    mediaFileId: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedById: { type: Number, default: null },
    reviewedByName: { type: String, default: null },
    reviewedByUsername: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

spamPatternSchema.index({ chatId: 1, normalizedHash: 1 }, { unique: true });
spamPatternSchema.index({ chatId: 1, triggeredByUserId: 1 });

export const SpamPattern = model<ISpamPattern>("SpamPattern", spamPatternSchema);
