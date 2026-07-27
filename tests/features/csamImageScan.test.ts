import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { scanImage, ImageScanDeps } from "../../src/features/csamDetection/imageScan";
import { WatchConfig } from "../../src/features/csamDetection/matcher";
import { logger } from "../../src/utils/logger";

const config: WatchConfig = {
  handles: ["nomax16"],
  solicitation: ["for buy", "buy"],
  negation: ["no cp"],
  keywords: ["cp gei", "videos cp"],
};

function makeDeps(over: Partial<ImageScanDeps> = {}): ImageScanDeps {
  return {
    getConfig: async () => config,
    download: async () => Buffer.from("img"),
    ocr: async () => "",
    cacheGet: async () => null,
    cacheSet: async () => undefined,
    ...over,
  };
}

describe("scanImage cost-control pipeline", () => {
  it("caption-first: matches on caption and NEVER downloads", async () => {
    const download = vi.fn(async () => Buffer.from("x"));
    const ocr = vi.fn(async () => "");
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u", caption: "hit me up @nomax16 for buy" },
      makeDeps({ download, ocr })
    );
    expect(r.matched).toBe(true);
    expect(r.verdict).toBe("AUTO_BAN"); // handle @nomax16 + "for buy" ⇒ ban, no OCR needed
    expect(r.source).toBe("caption");
    expect(download).not.toHaveBeenCalled();
    expect(ocr).not.toHaveBeenCalled();
  });

  it("reviewed-safe cache short-circuits to no-match without OCR", async () => {
    const ocr = vi.fn(async () => "@nomax16 cp gei");
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "safe" },
      makeDeps({ cacheGet: async () => ({ text: "@nomax16 cp gei", reviewedSafe: true }), ocr })
    );
    expect(r.matched).toBe(false);
    expect(r.source).toBe("cache");
    expect(ocr).not.toHaveBeenCalled();
  });

  it("uses cached OCR text (no re-download) and re-evaluates it", async () => {
    const download = vi.fn(async () => Buffer.from("x"));
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({ cacheGet: async () => ({ text: ">11000 videos cp gei", reviewedSafe: false }), download })
    );
    expect(r.matched).toBe(true);
    expect(r.source).toBe("cache");
    expect(download).not.toHaveBeenCalled();
  });

  it("OCR path: downloads, OCRs, caches, and matches on the extracted text", async () => {
    const cacheSet = vi.fn(async () => undefined);
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({ ocr: async () => "pls text to @NOMAX16 for buy", cacheSet })
    );
    expect(r.matched).toBe(true);
    expect(r.verdict).toBe("AUTO_BAN"); // handle + "for buy" read off the image ⇒ OCR alone bans
    expect(r.source).toBe("ocr");
    expect(cacheSet).toHaveBeenCalledWith("u", "pls text to @NOMAX16 for buy");
  });

  it("OCR path with benign text does not match", async () => {
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({ ocr: async () => "a lovely photo of the beach" })
    );
    expect(r.matched).toBe(false);
    expect(r.source).toBe("ocr");
  });

  it("keyword-only OCR text (no handle) SILENCEs, never bans (aggressive image tier)", async () => {
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({ ocr: async () => ">11000 videos cp gei" })
    );
    expect(r.matched).toBe(true);
    expect(r.verdict).toBe("SILENCE"); // keyword alone is never enough to auto-ban
    expect(r.keyword).toBeDefined();
  });

  it("handle alone (no sale word) SILENCEs, never bans", async () => {
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({ ocr: async () => "contact nomax16" })
    );
    expect(r.matched).toBe(true);
    expect(r.verdict).toBe("SILENCE");
  });

  it("download failure degrades to skip (never throws) but logs the error", async () => {
    vi.mocked(logger.error).mockClear();
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u" },
      makeDeps({
        download: async () => {
          throw new Error("boom");
        },
      })
    );
    expect(r.matched).toBe(false);
    expect(r.source).toBe("skip");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "csam_image_scan_failed",
        fileUniqueId: "u",
        error: expect.stringContaining("boom"),
      })
    );
  });

  it("OCR failure (not just download) also degrades to skip and logs", async () => {
    vi.mocked(logger.error).mockClear();
    const r = await scanImage(
      { fileId: "f", fileUniqueId: "u2" },
      makeDeps({
        ocr: async () => {
          throw new Error("tesseract crashed");
        },
      })
    );
    expect(r.matched).toBe(false);
    expect(r.source).toBe("skip");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "csam_image_scan_failed", fileUniqueId: "u2" })
    );
  });
});
