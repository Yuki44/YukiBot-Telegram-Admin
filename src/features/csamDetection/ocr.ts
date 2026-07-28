import sharp from "sharp";
import { logger } from "../../utils/logger";
import { CSAM_OCR_MAX_EDGE_PX } from "../../config/constants";
import { createOcrEngine, OcrEngine } from "./paddle";

/**
 * Local scene-text OCR (PP-OCRv4 via onnxruntime, CPU) — no image/text ever leaves
 * the process. One shared engine, up to MAX_CONCURRENT in-flight reads (the onnx
 * session is safe for concurrent run()); urgent jobs jump the queue.
 */

const MAX_CONCURRENT = 2;

interface Job {
  input: Buffer;
  resolve: (text: string) => void;
}

let enginePromise: Promise<OcrEngine> | null = null;
let running = 0;
const urgentJobs: Job[] = [];
const normalJobs: Job[] = [];

async function ensureEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    enginePromise = createOcrEngine().catch((err) => {
      enginePromise = null; // a failed load must not poison every later scan
      throw err;
    });
  }
  return enginePromise;
}

/** Cap the longest edge so an outsized document upload can't blow the latency budget. */
async function preprocess(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const maxEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (maxEdge <= CSAM_OCR_MAX_EDGE_PX) return input;
  return sharp(input)
    .resize({ width: CSAM_OCR_MAX_EDGE_PX, height: CSAM_OCR_MAX_EDGE_PX, fit: "inside" })
    .toBuffer();
}

async function runJob(job: Job): Promise<void> {
  let text = "";
  try {
    const engine = await ensureEngine();
    const prepared = await preprocess(job.input);
    const lines = await engine.detect(prepared);
    text = lines.map((l) => l.text).join("\n");
  } catch (err) {
    logger.error({ action: "csam_ocr_recognize", error: String(err) });
  }
  job.resolve(text);
}

function dispatch(): void {
  while (running < MAX_CONCURRENT) {
    const job = urgentJobs.shift() ?? normalJobs.shift();
    if (!job) return;
    running += 1;
    void runJob(job).finally(() => {
      running -= 1;
      dispatch();
    });
  }
}

/** Load the engine at boot so the first real scan doesn't pay the cold start. */
export function warmupOcr(): void {
  void ensureEngine().catch((err) => {
    logger.warn({ action: "csam_ocr_warmup", error: String(err) });
  });
}

/** Extract text from an image buffer. `urgent` jumps ahead of already-queued normal jobs. */
export async function ocrImage(input: Buffer, urgent = false): Promise<string> {
  return new Promise<string>((resolve) => {
    (urgent ? urgentJobs : normalJobs).push({ input, resolve });
    dispatch();
  });
}

/** Drop queued jobs and the engine reference (used on shutdown / after tests). */
export async function terminateOcr(): Promise<void> {
  enginePromise = null;
  urgentJobs.length = 0;
  normalJobs.length = 0;
}
