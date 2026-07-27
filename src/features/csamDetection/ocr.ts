import { createWorker, Worker, PSM } from "tesseract.js";
import sharp from "sharp";
import { logger } from "../../utils/logger";
import { CSAM_OCR_SCALES } from "../../config/constants";

/** Local OCR (tesseract.js), no image/text ever leaves the process. 2-worker pool, urgent jobs jump the queue. */

const MAX_WORKERS = 2;

// SINGLE_BLOCK locks onto the dominant overlay banner; SPARSE_TEXT catches scattered
// fragments. Their union across CSAM_OCR_SCALES is what makes a garbled token in one
// pass recoverable from another.
const OCR_MODES = [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT];

interface Job {
  input: Buffer;
  resolve: (text: string) => void;
}

let workers: Worker[] = [];
let freeWorkers: Worker[] = [];
let poolReady: Promise<void> | null = null;
const urgentJobs: Job[] = [];
const normalJobs: Job[] = [];

async function ensurePool(): Promise<void> {
  if (!poolReady) {
    poolReady = (async () => {
      while (workers.length < MAX_WORKERS) {
        const w = await createWorker("eng+spa");
        workers.push(w);
        freeWorkers.push(w);
      }
    })();
  }
  await poolReady;
}

/** Downscale to `dim` (upscaling small images too) and boost contrast so the overlay text survives. */
async function preprocess(input: Buffer, dim: number): Promise<Buffer> {
  return sharp(input)
    .resize({ width: dim, height: dim, fit: "inside", withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
}

/** OCR the image at every scale × mode and union the text; one failed pass never sinks the rest. */
async function runJob(worker: Worker, job: Job): Promise<void> {
  const parts: string[] = [];
  for (const dim of CSAM_OCR_SCALES) {
    let prepared: Buffer;
    try {
      prepared = await preprocess(job.input, dim);
    } catch (err) {
      logger.warn({ action: "csam_ocr_preprocess", dim, error: String(err) });
      continue;
    }
    for (const psm of OCR_MODES) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const { data } = await worker.recognize(prepared);
        if (data.text) parts.push(data.text);
      } catch (err) {
        logger.error({ action: "csam_ocr_recognize", dim, psm, error: String(err) });
      }
    }
  }
  job.resolve(parts.join("\n"));
}

/** Hands the next free worker the highest-priority waiting job, if any. */
function dispatch(): void {
  if (freeWorkers.length === 0) return;
  const job = urgentJobs.shift() ?? normalJobs.shift();
  if (!job) return;
  const worker = freeWorkers.pop()!;
  void runJob(worker, job).finally(() => {
    freeWorkers.push(worker);
    dispatch();
  });
}

/** Extract text from an image buffer. `urgent` jumps ahead of already-queued normal jobs. */
export async function ocrImage(input: Buffer, urgent = false): Promise<string> {
  await ensurePool();
  return new Promise<string>((resolve) => {
    (urgent ? urgentJobs : normalJobs).push({ input, resolve });
    dispatch();
  });
}

/** Tear down the worker pool (used on shutdown / after tests). */
export async function terminateOcr(): Promise<void> {
  for (const w of workers) {
    try {
      await w.terminate();
    } catch {
      /* silent */
    }
  }
  workers = [];
  freeWorkers = [];
  poolReady = null;
  urgentJobs.length = 0;
  normalJobs.length = 0;
}
