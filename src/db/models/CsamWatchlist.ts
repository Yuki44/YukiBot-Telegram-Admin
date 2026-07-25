import { Schema, model } from "mongoose";

/**
 * Global singleton holding operator-added CSAM watch terms.
 *
 * Handles are intentionally kept OUT of source (G2); they are seeded from the
 * CSAM_WATCH_HANDLES env var and extended here at runtime. Solicitation /
 * negation / keyword arrays layer on top of the built-in defaults in config.ts.
 */
export interface ICsamWatchlist {
  key: string;
  handles: string[];
  solicitation: string[];
  negation: string[];
  keywords: string[];
}

const csamWatchlistSchema = new Schema<ICsamWatchlist>({
  key: {
    type: String,
    required: true,
    unique: true,
    default: "global",
  },
  handles: {
    type: [String],
    default: [],
  },
  solicitation: {
    type: [String],
    default: [],
  },
  negation: {
    type: [String],
    default: [],
  },
  keywords: {
    type: [String],
    default: [],
  },
});

export const CsamWatchlist = model<ICsamWatchlist>("CsamWatchlist", csamWatchlistSchema);
