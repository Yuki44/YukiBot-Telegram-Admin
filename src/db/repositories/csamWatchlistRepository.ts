import { CsamWatchlist, ICsamWatchlist } from "../models/CsamWatchlist";
import { CSAM_WATCH_HANDLES } from "../../config";
import { buildWatchConfig } from "../../features/csamDetection/config";
import { WatchConfig } from "../../features/csamDetection/matcher";
import { logger } from "../../utils/logger";

const KEY = "global";

export type WatchCategory = "handles" | "solicitation" | "negation" | "keywords";

const normalizeValue = (category: WatchCategory, value: string): string => {
  const v = value.trim().toLowerCase();
  return category === "handles" ? v.replace(/^@/, "") : v;
};

export const csamWatchlistRepository = {
  /**
   * Resolve the effective WatchConfig (env handles + DB additions + built-in
   * defaults). Never throws — on DB failure it falls back to env + defaults so
   * the detector keeps running (G9).
   */
  async getConfig(): Promise<WatchConfig> {
    try {
      const doc = await CsamWatchlist.findOne({ key: KEY }).lean<ICsamWatchlist>();
      return buildWatchConfig(doc, CSAM_WATCH_HANDLES);
    } catch (err) {
      logger.error({ action: "csam_get_config_failed", error: String(err) });
      return buildWatchConfig(null, CSAM_WATCH_HANDLES);
    }
  },

  /**
   * Raw operator-added terms per category (no env/defaults merged). Powers the
   * dashboard editor, which shows these as the removable rows on top of the
   * always-on built-in defaults. Never throws (G9).
   */
  async getStored(): Promise<Record<WatchCategory, string[]>> {
    try {
      const doc = await CsamWatchlist.findOne({ key: KEY }).lean<ICsamWatchlist>();
      return {
        handles: doc?.handles ?? [],
        solicitation: doc?.solicitation ?? [],
        negation: doc?.negation ?? [],
        keywords: doc?.keywords ?? [],
      };
    } catch (err) {
      logger.error({ action: "csam_get_stored_failed", error: String(err) });
      return { handles: [], solicitation: [], negation: [], keywords: [] };
    }
  },

  async addTerm(category: WatchCategory, value: string): Promise<void> {
    const normalized = normalizeValue(category, value);
    if (!normalized) return;
    await CsamWatchlist.updateOne({ key: KEY }, { $addToSet: { [category]: normalized } }, { upsert: true });
  },

  async removeTerm(category: WatchCategory, value: string): Promise<void> {
    const normalized = normalizeValue(category, value);
    if (!normalized) return;
    await CsamWatchlist.updateOne({ key: KEY }, { $pull: { [category]: normalized } });
  },
};
