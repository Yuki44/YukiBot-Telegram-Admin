import { WatchConfig, evaluateImageText, BioVerdict } from "./matcher";
import { logger } from "../../utils/logger";

/**
 * Image OCR decision pipeline (pure orchestration — engine/IO injected so it
 * is fully unit-testable without tesseract, sharp, or Telegram).
 *
 * Cost-control order (cheap → expensive):
 *   1. caption-first  — if the visible caption already matches, skip OCR.
 *   2. cache lookup   — reuse prior OCR text; honour the reviewed-safe allowlist.
 *   3. OCR            — download + OCR only when the above didn't decide.
 *
 * A strong hit (handle + solicitation) AUTO-BANs; a lone hit SILENCEs for review.
 */

export interface ScanCandidate {
  fileId: string;
  fileUniqueId: string;
  caption?: string;
  /** Byte size if known — used to skip oversized files upstream. */
  fileSize?: number;
}

export type ScanSource = "caption" | "cache" | "ocr" | "skip";

export interface ImageScanResult {
  verdict: BioVerdict;
  matched: boolean;
  text: string;
  handle?: string;
  keyword?: string;
  solicitation: string[];
  source: ScanSource;
}

export interface ImageScanDeps {
  getConfig: () => Promise<WatchConfig>;
  download: (fileId: string) => Promise<Buffer>;
  /** `urgent` (no caption to fall back on) jumps ahead of queued non-urgent OCR jobs. */
  ocr: (image: Buffer, urgent: boolean) => Promise<string>;
  cacheGet: (fileUniqueId: string) => Promise<{ text: string; reviewedSafe: boolean } | null>;
  cacheSet: (fileUniqueId: string, text: string) => Promise<void>;
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

  let text: string;
  try {
    const buf = await deps.download(candidate.fileId);
    text = await deps.ocr(buf, !caption);
  } catch (err) {
    // G10/G11 — must not be silent, or a real failure reads as "OCR ran, no match".
    logger.error({
      action: "csam_image_scan_failed",
      fileUniqueId: candidate.fileUniqueId,
      error: String(err),
    });
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
  return {
    verdict: r.verdict,
    matched: r.matched,
    text,
    handle: r.handle,
    keyword: r.keyword,
    solicitation: r.solicitation,
    source: "ocr",
  };
}
