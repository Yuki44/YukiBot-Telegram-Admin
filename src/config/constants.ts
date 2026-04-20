/**
 * Application-wide constants.
 * Centralises magic numbers so every module references a single source of truth.
 */

/** Maximum warnings before automatic ban. */
export const MAX_WARNINGS = 3;

/** Silence duration in seconds (1 week). */
export const SILENCE_DURATION_S = 7 * 24 * 60 * 60;

/** Silence duration in milliseconds (1 week). */
export const SILENCE_DURATION_MS = SILENCE_DURATION_S * 1000;

/** TTL for the kick-in-progress tracker (ms). */
export const KICK_TRACKER_TTL_MS = 30_000;

/** TTL for User docs with `leftWithWarningsAt` (seconds — 6 months). */
export const LEFT_WITH_WARNINGS_TTL_S = 15_552_000;

/** Default delay (ms) for ephemeral bot messages sent via sendAndAutoDelete. */
export const AUTO_DELETE_DELAY_MS = 5_000;

/** Short delay (ms) for confirmation-only ephemeral messages. */
export const AUTO_DELETE_SHORT_MS = 1_000;
