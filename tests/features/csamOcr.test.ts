import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CSAM_OCR_SCALES } from "../../src/config/constants";

/** Passes per image = every scale run through both page-seg modes. */
const PASSES_PER_JOB = CSAM_OCR_SCALES.length * 2;

interface RecogCall {
  input: string;
  resolved: boolean;
  resolve: () => void;
}
const recognizeCalls: RecogCall[] = [];

vi.mock("tesseract.js", () => ({
  PSM: { SPARSE_TEXT: "11", SINGLE_BLOCK: "6" },
  createWorker: vi.fn(async () => ({
    setParameters: vi.fn(async () => {}),
    // Each recognize parks itself (labelled by the job's original buffer, which the
    // sharp stub passes straight through) until the test releases it, so we can drive
    // completion order across the two workers.
    recognize: vi.fn(
      (img: Buffer) =>
        new Promise((resolve) => {
          const input = img.toString();
          recognizeCalls.push({ input, resolved: false, resolve: () => resolve({ data: { text: input } }) });
        })
    ),
    terminate: vi.fn(async () => {}),
  })),
}));

vi.mock("sharp", () => {
  // Chainable stub; toBuffer passes the ORIGINAL input through so each recognize call
  // is identifiable by its job label.
  const make = (input: Buffer) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["resize", "grayscale", "normalize", "sharpen"]) chain[m] = () => chain;
    chain.toBuffer = async () => input;
    return chain;
  };
  return { default: (input: Buffer) => make(input) };
});

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ocrImage, terminateOcr } from "../../src/features/csamDetection/ocr";

/** Release every not-yet-resolved recognize call, repeatedly, until `promises` all settle. */
async function drain(promises: Promise<unknown>[]): Promise<void> {
  let pending = promises.length;
  promises.forEach((p) => void p.finally(() => (pending -= 1)));
  const start = Date.now();
  while (pending > 0) {
    for (const c of recognizeCalls) {
      if (!c.resolved) {
        c.resolved = true;
        c.resolve();
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    if (Date.now() - start > 3000) throw new Error("drain timeout");
  }
}

/** Release only the passes of the job labelled `label`, until `promise` settles. */
async function completeJob(label: string, promise: Promise<unknown>): Promise<void> {
  let done = false;
  void promise.finally(() => (done = true));
  const start = Date.now();
  while (!done) {
    for (const c of recognizeCalls) {
      if (c.input === label && !c.resolved) {
        c.resolved = true;
        c.resolve();
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    if (Date.now() - start > 3000) throw new Error(`timeout completing ${label}`);
  }
}

describe("ocrImage", () => {
  beforeEach(() => {
    recognizeCalls.length = 0;
  });

  afterEach(async () => {
    await terminateOcr();
  });

  it("unions every scale × mode pass into one text blob", async () => {
    const p = ocrImage(Buffer.from("photo"));
    await drain([p]);
    const text = await p;
    // Same label came back from every pass; the union keeps them all.
    expect(text.split(/\s+/).filter((t) => t === "photo")).toHaveLength(PASSES_PER_JOB);
  });

  it("runs two jobs concurrently on the two-worker pool", async () => {
    const a = ocrImage(Buffer.from("a"));
    const b = ocrImage(Buffer.from("b"));

    // If only one worker existed, only one job's first pass would have registered.
    await vi.waitFor(() => expect(recognizeCalls.length).toBe(2));
    expect(recognizeCalls.map((c) => c.input).sort()).toEqual(["a", "b"]);

    await drain([a, b]);
  });

  it("dispatches an urgent (captionless) job ahead of an already-queued normal one", async () => {
    // Both workers busy on their first pass.
    const busy1 = ocrImage(Buffer.from("busy1"));
    const busy2 = ocrImage(Buffer.from("busy2"));
    await vi.waitFor(() => expect(recognizeCalls.length).toBe(2));

    // Queue a normal job, then an urgent one — urgent must win the first freed worker.
    const normal = ocrImage(Buffer.from("normal"), false);
    const urgent = ocrImage(Buffer.from("urgent"), true);

    // Free exactly one worker by finishing busy1 (busy2 stays parked).
    await completeJob("busy1", busy1);

    // The freed worker picked up the urgent job, not the normal one queued before it.
    await vi.waitFor(() => expect(recognizeCalls.some((c) => c.input === "urgent")).toBe(true));
    expect(recognizeCalls.some((c) => c.input === "normal")).toBe(false);

    await drain([busy2, urgent, normal]);
  });
});
