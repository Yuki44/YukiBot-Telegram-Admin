import { Schema, model } from "mongoose";

/**
 * pHashes of images the scanner flagged. A re-upload by a fresh alt account gets a
 * new file_unique_id (defeating the text cache) but lands within a few hamming bits
 * of a stored hash. No TTL — the same ad campaign recurs for weeks; only the 16-char
 * hash is kept, never image bytes (S-rules).
 */
export interface ICsamImageHash {
  hash: string;
  /** Strongest text-tier verdict any image with this hash has produced. */
  verdict: "AUTO_BAN" | "SILENCE";
  /** file_unique_id of the first flagged upload (diagnostics only). */
  fileUniqueId?: string;
  createdAt?: Date;
}

const csamImageHashSchema = new Schema<ICsamImageHash>({
  hash: {
    type: String,
    required: true,
    unique: true,
  },
  verdict: {
    type: String,
    enum: ["AUTO_BAN", "SILENCE"],
    required: true,
  },
  fileUniqueId: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const CsamImageHash = model<ICsamImageHash>("CsamImageHash", csamImageHashSchema);
