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

/**
 * Dedup window (ms) for the welcome message. A single join is signalled by up
 * to two updates almost simultaneously (`chat_member` + `new_chat_members`),
 * and Telegram may redeliver an unconfirmed update within seconds — this window
 * collapses those into one greeting. It is intentionally short so that a
 * genuine later re-entry (the user left and came back) is greeted again.
 */
export const WELCOME_DEDUP_TTL_MS = 15_000;

/**
 * Minimum gap between two reminders in the same topic. Triggered by activity,
 * never by a timer, so this is a floor rather than a schedule.
 */
export const TOPIC_REMINDER_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ── Deleted-topic reconciliation sweep ───────────────────────────────

/** How often every cached topic is probed against Telegram. */
export const TOPIC_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Gap between probes, keeping the sweep well under Telegram's rate limits. */
export const TOPIC_SWEEP_SPACING_MS = 500;

/** Consecutive sweeps a topic must be missing before its row is deleted. */
export const TOPIC_SWEEP_STRIKES = 2;

/**
 * Bump when new entries are added to VALID_CONTENT_TYPES: existing topics are
 * granted the new types once, without re-granting ones an admin later removed.
 */
export const TOPIC_TYPES_VERSION = 2;

/** TTL for User docs with `leftWithWarningsAt` (seconds — 6 months). */
export const LEFT_WITH_WARNINGS_TTL_S = 15_552_000;

/** Default delay (ms) for ephemeral bot messages sent via sendAndAutoDelete. */
export const AUTO_DELETE_DELAY_MS = 5_000;

/** Short delay (ms) for confirmation-only ephemeral messages. */
export const AUTO_DELETE_SHORT_MS = 1_000;

// ── CSAM/impostor rolling bio scanner ────────────────────────────────

/** How many consecutive getChat misses before we spend a tick on a getChatMember presence probe. */
export const CSAM_SCAN_MISS_LIMIT = 3;

/**
 * How long a row confirmed absent stays out of the scan queue before we re-probe it. A missed
 * rejoin (bot offline, or no permission to receive membership updates) must not bench a user
 * for good — that would be a silent blind spot in the CSAM coverage.
 */
export const NOT_MEMBER_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/** Spacing (ms) between consecutive getChat calls in the bio scanner (rate-safe). */
export const CSAM_SCAN_SPACING_MS = 1_500;

/** How many users the scanner pulls per DB batch. */
export const CSAM_SCAN_BATCH = 25;

/** Idle wait (ms) when there is nothing due to scan, before polling again. */
export const CSAM_SCAN_IDLE_MS = 60_000;

/**
 * Floor (ms) on how often the same user's bio may be re-fetched. Not a period: the
 * scanner rotates continuously, so the real re-check gap is population ÷ rate budget
 * (~78 min today). The floor only bites on a small population, where the rotation
 * would otherwise spin on the same few users.
 */
export const CSAM_SCAN_MIN_INTERVAL_MS = 30 * 60 * 1000;

/** How often the scanner reports its rotation stats, so a silent stall is visible. */
export const CSAM_SCAN_HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Minimum gap (ms) before a user who just posted can jump the rotation queue
 * again. Keeps a chatty user from burning the shared getChat rate budget on
 * every single message while still checking anyone who hasn't been looked at
 * recently the moment they show activity.
 */
export const CSAM_URGENT_COOLDOWN_MS = 10 * 60 * 1000;

/** How long a sent message's id is kept around for the on-ban bulk-delete (seconds). */
export const CSAM_RECENT_MESSAGE_TTL_S = 48 * 60 * 60;

// ── CSAM/impostor image OCR ──────────────────────────────────────────

/** Longest edge (px) an image is capped to before OCR — bounds inference latency only. */
export const CSAM_OCR_MAX_EDGE_PX = 1600;

/**
 * OCR pipeline version. Bump on algorithm changes so stale cached text is re-scanned
 * instead of trusted for its full TTL. Reviewed-safe rows are honoured regardless.
 * v3 = tesseract multi-scale union replaced by PP-OCRv4 (onnx).
 * v4 = discard v3 rows cached while the Alpine deploy crashed the engine (empty text).
 */
export const CSAM_OCR_VERSION = 4;

/**
 * pHash hamming-distance gates (calibrated: re-encode ≈ 0, small text edit ≈ 4,
 * unrelated image ≈ 20+). REVIEW ⇒ match (delete + at least silence); STRICT ⇒ a
 * stored AUTO_BAN verdict is inherited outright.
 */
export const CSAM_PHASH_STRICT_MAX_DIST = 6;
export const CSAM_PHASH_REVIEW_MAX_DIST = 12;

/** Skip OCR entirely for files larger than this (bytes) — cheap DoS guard. */
export const CSAM_OCR_MAX_BYTES = 10 * 1024 * 1024;

/** TTL (seconds) for OCR text cache rows (reviewed-safe rows never expire). */
export const CSAM_IMAGE_CACHE_TTL_S = 7 * 24 * 60 * 60;

// ── Language detection ───────────────────────────────────────────────

/**
 * Messages with this many words or fewer are never evaluated (Stage 1 hard gate).
 * "not hard" / "hi" / "dm me" — one or two words is normal chat noise. Kept at 2 (not
 * 3) so a short-but-fully-foreign phrase like "comment ca marche" (3 words) still
 * reaches the classifier, which is better positioned to tell an assimilated loanword
 * ("dm me") from a genuine foreign sentence than a raw word count ever could.
 */
export const LANGUAGE_MIN_WORDS = 2;

/** Bulk-delete window (ms) on offense #2+ — "the last couple of hours" of a user's messages. */
export const LANGUAGE_BULK_DELETE_WINDOW_MS = 2 * 60 * 60 * 1000;
