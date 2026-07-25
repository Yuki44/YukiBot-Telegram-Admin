import { CsamImageCache } from "../models/CsamImageCache";
import { CSAM_IMAGE_CACHE_TTL_S } from "../../config/constants";
import { logger } from "../../utils/logger";

export interface CachedImageText {
  text: string;
  reviewedSafe: boolean;
}

export const csamImageCacheRepository = {
  async get(fileUniqueId: string): Promise<CachedImageText | null> {
    try {
      const row = await CsamImageCache.findOne({ fileUniqueId }).lean();
      if (!row) return null;
      return { text: row.text ?? "", reviewedSafe: Boolean(row.reviewedSafe) };
    } catch (err) {
      logger.error({ action: "csam_imgcache_get", error: String(err) });
      return null;
    }
  },

  /** Cache OCR text with a rolling TTL. Never downgrades a reviewed-safe row. */
  async setText(fileUniqueId: string, text: string): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + CSAM_IMAGE_CACHE_TTL_S * 1000);
      await CsamImageCache.updateOne(
        { fileUniqueId },
        { $set: { text, expiresAt }, $setOnInsert: { reviewedSafe: false } },
        { upsert: true }
      );
    } catch (err) {
      logger.error({ action: "csam_imgcache_set", error: String(err) });
    }
  },

  /** Mark a file as a reviewed false positive: never acted on again, never expires. */
  async markReviewedSafe(fileUniqueId: string): Promise<void> {
    try {
      await CsamImageCache.updateOne(
        { fileUniqueId },
        { $set: { reviewedSafe: true }, $unset: { expiresAt: "" } },
        { upsert: true }
      );
    } catch (err) {
      logger.error({ action: "csam_imgcache_reviewed", error: String(err) });
    }
  },
};
