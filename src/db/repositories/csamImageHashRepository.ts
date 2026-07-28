import { CsamImageHash } from "../models/CsamImageHash";
import { HashRow } from "../../features/csamDetection/imageHash";
import { logger } from "../../utils/logger";

export const csamImageHashRepository = {
  async listAll(): Promise<HashRow[]> {
    try {
      const rows = await CsamImageHash.find({}, { hash: 1, verdict: 1 }).lean();
      return rows.map((r) => ({ hash: r.hash, verdict: r.verdict }));
    } catch (err) {
      logger.error({ action: "csam_imghash_list", error: String(err) });
      return [];
    }
  },

  /** Record a flagged image's hash. A verdict only ever escalates (SILENCE → AUTO_BAN). */
  async add(hash: string, verdict: "AUTO_BAN" | "SILENCE", fileUniqueId?: string): Promise<void> {
    try {
      if (verdict === "AUTO_BAN") {
        await CsamImageHash.updateOne(
          { hash },
          { $set: { verdict }, $setOnInsert: { fileUniqueId } },
          { upsert: true }
        );
      } else {
        // $setOnInsert only — an existing row may already hold AUTO_BAN.
        await CsamImageHash.updateOne(
          { hash },
          { $setOnInsert: { verdict, fileUniqueId } },
          { upsert: true }
        );
      }
    } catch (err) {
      logger.error({ action: "csam_imghash_add", error: String(err) });
    }
  },
};
