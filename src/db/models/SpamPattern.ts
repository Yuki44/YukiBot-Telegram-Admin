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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

spamPatternSchema.index({ chatId: 1, normalizedHash: 1 }, { unique: true });
spamPatternSchema.index({ chatId: 1, triggeredByUserId: 1 });

export const SpamPattern = model<ISpamPattern>("SpamPattern", spamPatternSchema);
