import { createWorker, Worker } from "tesseract.js";
import sharp from "sharp";
import { logger } from "../../utils/logger";
import { CSAM_OCR_MAX_DIM } from "../../config/constants";

/** Local OCR (tesseract.js), no image/text ever leaves the process. 2-worker pool, urgent jobs jump the queue. */

const MAX_WORKERS = 2;

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

async function runJob(worker: Worker, job: Job): Promise<void> {
  try {
    const prepared = await preprocess(job.input);
    const { data } = await worker.recognize(prepared);
    job.resolve(data.text ?? "");
  } catch (err) {
    logger.error({ action: "csam_ocr_recognize", error: String(err) });
    job.resolve("");
  }
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
