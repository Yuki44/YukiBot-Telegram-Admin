import { WatchConfig, evaluateImageText, BioVerdict } from "./matcher";
import { HashMatch } from "./imageHash";
import { CSAM_PHASH_STRICT_MAX_DIST } from "../../config/constants";
import { logger } from "../../utils/logger";

/**
 * Image decision pipeline (pure orchestration — engine/IO injected, unit-testable).
 *
 * Cost-control order: caption → cache (reviewed-safe honoured) → pHash → OCR.
 * A tight pHash match on a stored AUTO_BAN bans before any OCR — catching the same
 * ad re-posted from fresh alt accounts, whose new file_unique_id defeats the text
 * cache. Any other pHash match is only a FLOOR: OCR still runs and may escalate to
 * a ban; if it reads nothing the match still guarantees delete + silence.
 *
 * A strong hit (handle + solicitation/keyword) AUTO-BANs; a lone hit SILENCEs.
 */

export interface ScanCandidate {
  fileId: string;
  fileUniqueId: string;
  caption?: string;
  /** Byte size if known — used to skip oversized files upstream. */
  fileSize?: number;
}

export type ScanSource = "caption" | "cache" | "phash" | "ocr" | "skip";

export interface ImageScanResult {
  verdict: BioVerdict;
  matched: boolean;
  text: string;
  handle?: string;
  keyword?: string;
  solicitation: string[];
  source: ScanSource;
  /** Hamming distance to the stored hash when source === "phash". */
  phashDistance?: number;
}

export interface ImageScanDeps {
  getConfig: () => Promise<WatchConfig>;
  download: (fileId: string) => Promise<Buffer>;
  /** `urgent` (no caption to fall back on) jumps ahead of queued non-urgent OCR jobs. */
  ocr: (image: Buffer, urgent: boolean) => Promise<string>;
  cacheGet: (fileUniqueId: string) => Promise<{ text: string; reviewedSafe: boolean } | null>;
  cacheSet: (fileUniqueId: string, text: string) => Promise<void>;
  /** 64-bit pHash of the downloaded bytes; null when hashing fails (scan continues). */
  hashImage: (image: Buffer) => Promise<string | null>;
  /** Closest known-bad hash within the review distance, if any. */
  findKnownBadHash: (hash: string) => Promise<HashMatch | null>;
  /** Record a hash the text tier just flagged, so re-uploads are caught instantly. */
  storeKnownBadHash: (hash: string, verdict: "AUTO_BAN" | "SILENCE") => Promise<void>;
}

export async function scanImage(candidate: ScanCandidate, deps: ImageScanDeps): Promise<ImageScanResult> {
  const config = await deps.getConfig();
  const caption = candidate.caption?.trim() ?? "";

  if (caption) {
    const cap = evaluateImageText(caption, config);
    if (cap.verdict !== "NONE") {
      return {
        verdict: cap.verdict,
        matched: true,
        text: caption,
        handle: cap.handle,
        keyword: cap.keyword,
        solicitation: cap.solicitation,
        source: "caption",
      };
    }
  }

  const cached = await deps.cacheGet(candidate.fileUniqueId);
  if (cached) {
    if (cached.reviewedSafe) {
      return { verdict: "NONE", matched: false, text: cached.text, solicitation: [], source: "cache" };
    }
    const combined = [caption, cached.text].filter(Boolean).join(" ");
    const r = evaluateImageText(combined, config);
    return {
      verdict: r.verdict,
      matched: r.matched,
      text: cached.text,
      handle: r.handle,
      keyword: r.keyword,
      solicitation: r.solicitation,
      source: "cache",
    };
  }

  let buf: Buffer;
  try {
    buf = await deps.download(candidate.fileId);
  } catch (err) {
    // G10/G11 — must not be silent, or a real failure reads as "scan ran, no match".
    logger.error({
      action: "csam_image_scan_failed",
      fileUniqueId: candidate.fileUniqueId,
      error: String(err),
    });
    return { verdict: "NONE", matched: false, text: "", solicitation: [], source: "skip" };
  }

  // pHash: a tight match on a stored AUTO_BAN bans instantly. Any other match is a
  // FLOOR, not a ceiling — the scan continues to OCR so the text tier can escalate
  // to a ban (a stale stored SILENCE must never cap a stronger read), and if OCR
  // reads nothing the match still guarantees delete + silence.
  const hash = await deps.hashImage(buf);
  let hashFloor: HashMatch | null = null;
  if (hash) {
    const known = await deps.findKnownBadHash(hash);
    if (known) {
      const instantBan = known.verdict === "AUTO_BAN" && known.distance <= CSAM_PHASH_STRICT_MAX_DIST;
      logger.info({
        action: "csam_phash_match",
        fileUniqueId: candidate.fileUniqueId,
        distance: known.distance,
        storedVerdict: known.verdict,
        decision: instantBan ? "ban" : "floor",
      });
      if (instantBan) {
        return {
          verdict: "AUTO_BAN",
          matched: true,
          text: "",
          solicitation: [],
          source: "phash",
          phashDistance: known.distance,
        };
      }
      hashFloor = known;
    }
  }

  let text: string;
  try {
    text = await deps.ocr(buf, !caption);
  } catch (err) {
    logger.error({
      action: "csam_image_scan_failed",
      fileUniqueId: candidate.fileUniqueId,
      error: String(err),
    });
    if (hashFloor) {
      // The visual match alone still warrants delete + silence-for-review.
      return {
        verdict: "SILENCE",
        matched: true,
        text: "",
        solicitation: [],
        source: "phash",
        phashDistance: hashFloor.distance,
      };
    }
    return { verdict: "NONE", matched: false, text: "", solicitation: [], source: "skip" };
  }
  await deps.cacheSet(candidate.fileUniqueId, text);

  const combined = [caption, text].filter(Boolean).join(" ");
  const r = evaluateImageText(combined, config);
  // Log what OCR read (text only) so a miss is diagnosable, not silent.
  logger.info({
    action: "csam_ocr_result",
    fileUniqueId: candidate.fileUniqueId,
    textLen: text.length,
    verdict: r.verdict,
    sample: text.replace(/\s+/g, " ").trim().slice(0, 160),
  });

  const floored = r.verdict === "NONE" && hashFloor !== null;
  const verdict: BioVerdict = floored ? "SILENCE" : r.verdict;
  if (verdict !== "NONE" && hash) {
    await deps.storeKnownBadHash(hash, verdict);
  }
  return {
    verdict,
    matched: verdict !== "NONE",
    text,
    handle: r.handle,
    keyword: r.keyword,
    solicitation: r.solicitation,
    source: floored ? "phash" : "ocr",
    phashDistance: hashFloor?.distance,
  };
}
