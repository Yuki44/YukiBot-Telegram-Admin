import { createWorker, Worker } from "tesseract.js";
import sharp from "sharp";
import { logger } from "../../utils/logger";
import { CSAM_OCR_MAX_DIM } from "../../config/constants";

/**
 * Local OCR engine (tesseract.js) — no image or text ever leaves the process.
 *
 * A single lazily-created worker keeps memory bounded, and a promise chain
 * serialises `recognize` calls (tesseract workers are not re-entrant). Images
 * are downscaled + greyscaled with sharp first to cut work and improve accuracy
 * on the low-contrast gallery screenshots this targets.
 */

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng+spa");
  }
  return workerPromise;
}

async function preprocess(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input)
      .resize({
        width: CSAM_OCR_MAX_DIM,
        height: CSAM_OCR_MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .grayscale()
      .normalize()
      .toBuffer();
  } catch (err) {
    logger.warn({ action: "csam_ocr_preprocess", error: String(err) });
    return input;
  }
}

/** Extract text from an image buffer. Serialised; returns "" on failure. */
export async function ocrImage(input: Buffer): Promise<string> {
  const run = queue.then(async () => {
    try {
      const prepared = await preprocess(input);
      const worker = await getWorker();
      const { data } = await worker.recognize(prepared);
      return data.text ?? "";
    } catch (err) {
      logger.error({ action: "csam_ocr_recognize", error: String(err) });
      return "";
    }
  });
  // Keep the chain alive even if this run rejects (it can't — caught above).
  queue = run.catch(() => undefined);
  return run;
}

/** Tear down the worker (used on shutdown / after tests). */
export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {
      /* silent */
    }
    workerPromise = null;
  }
}
