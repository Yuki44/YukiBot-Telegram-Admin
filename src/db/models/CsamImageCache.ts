import { Schema, model } from "mongoose";

/**
 * De-dup + reviewed-safe store for the image OCR path, keyed by Telegram's
 * `file_unique_id` (stable across re-sends of the same file).
 *
 *  - `text`         : the OCR'd text, cached so a re-sent image isn't re-OCR'd.
 *  - `reviewedSafe` : set when an admin clears a false positive; such rows are
 *                     never OCR-acted on again and never expire.
 *  - `expiresAt`    : TTL only for ordinary cache rows; unset for reviewed-safe.
 *
 * No image bytes are ever stored here (S-rules) — text + a flag only.
 */
export interface ICsamImageCache {
  fileUniqueId: string;
  text: string;
  reviewedSafe: boolean;
  expiresAt?: Date;
}

const csamImageCacheSchema = new Schema<ICsamImageCache>({
  fileUniqueId: {
    type: String,
    required: true,
    unique: true,
  },
  text: {
    type: String,
    default: "",
  },
  reviewedSafe: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
  },
});

// TTL — only rows carrying expiresAt are auto-removed; reviewed-safe rows omit it.
csamImageCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

export const CsamImageCache = model<ICsamImageCache>("CsamImageCache", csamImageCacheSchema);
