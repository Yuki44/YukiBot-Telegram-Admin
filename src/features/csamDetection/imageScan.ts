import { WatchConfig, evaluateImageText } from "./matcher";
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
 * Images NEVER auto-ban (adversarial/noisy) — a match yields SILENCE-for-review.
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
  matched: boolean;
  text: string;
  handle?: string;
  keyword?: string;
  source: ScanSource;
}

export interface ImageScanDeps {
  getConfig: () => Promise<WatchConfig>;
  download: (fileId: string) => Promise<Buffer>;
  ocr: (image: Buffer) => Promise<string>;
  cacheGet: (fileUniqueId: string) => Promise<{ text: string; reviewedSafe: boolean } | null>;
  cacheSet: (fileUniqueId: string, text: string) => Promise<void>;
}

export async function scanImage(candidate: ScanCandidate, deps: ImageScanDeps): Promise<ImageScanResult> {
  const config = await deps.getConfig();
  const caption = candidate.caption?.trim() ?? "";

  if (caption) {
    const cap = evaluateImageText(caption, config);
    if (cap.matched) {
      return { matched: true, text: caption, handle: cap.handle, keyword: cap.keyword, source: "caption" };
    }
  }

  const cached = await deps.cacheGet(candidate.fileUniqueId);
  if (cached) {
    if (cached.reviewedSafe) {
      return { matched: false, text: cached.text, source: "cache" };
    }
    const combined = [caption, cached.text].filter(Boolean).join(" ");
    const r = evaluateImageText(combined, config);
    return { matched: r.matched, text: cached.text, handle: r.handle, keyword: r.keyword, source: "cache" };
  }

  let text: string;
  try {
    const buf = await deps.download(candidate.fileId);
    text = await deps.ocr(buf);
  } catch (err) {
    // G10/G11 — must not be silent, or a real failure reads as "OCR ran, no match".
    logger.error({
      action: "csam_image_scan_failed",
      fileUniqueId: candidate.fileUniqueId,
      error: String(err),
    });
    return { matched: false, text: "", source: "skip" };
  }
  await deps.cacheSet(candidate.fileUniqueId, text);

  const combined = [caption, text].filter(Boolean).join(" ");
  const r = evaluateImageText(combined, config);
  return { matched: r.matched, text, handle: r.handle, keyword: r.keyword, source: "ocr" };
}
