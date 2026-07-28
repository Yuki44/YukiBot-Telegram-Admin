import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface DetectCall {
  input: string;
  resolved: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
}
const detectCalls: DetectCall[] = [];
let createFailures = 0;

vi.mock("../../src/features/csamDetection/paddle", () => ({
  createOcrEngine: vi.fn(async () => {
    if (createFailures > 0) {
      createFailures -= 1;
      throw new Error("model load failed");
    }
    return {
      // Each detect parks itself (labelled by the job's original buffer, which the
      // sharp stub passes straight through) until the test releases it, so we can
      // drive completion order across the two slots.
      detect: (img: Buffer) =>
        new Promise((resolve, reject) => {
          const input = img.toString();
          detectCalls.push({
            input,
            resolved: false,
            resolve: () => resolve([{ text: input }, { text: input + "-2" }]),
            reject,
          });
        }),
    };
  }),
}));

vi.mock("sharp", () => {
  // Small metadata → preprocess passes the ORIGINAL buffer through untouched,
  // so each detect call is identifiable by its job label.
  const make = (input: Buffer) => ({
    metadata: async () => ({ width: 100, height: 100 }),
    resize: () => ({ toBuffer: async () => input }),
  });
  return { default: (input: Buffer) => make(input) };
});

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ocrImage, terminateOcr } from "../../src/features/csamDetection/ocr";
import { logger } from "../../src/utils/logger";

/** Release every not-yet-resolved detect call, repeatedly, until `promises` all settle. */
async function drain(promises: Promise<unknown>[]): Promise<void> {
  let pending = promises.length;
  promises.forEach((p) => void p.finally(() => (pending -= 1)));
  const start = Date.now();
  while (pending > 0) {
    for (const c of detectCalls) {
      if (!c.resolved) {
        c.resolved = true;
        c.resolve();
      }
    }
    await new Promise((r) => setTimeout(r, 0));
    if (Date.now() - start > 3000) throw new Error("drain timeout");
  }
}

/** Release only the detect call labelled `label`, until `promise` settles. */
async function completeJob(label: string, promise: Promise<unknown>): Promise<void> {
  let done = false;
  void promise.finally(() => (done = true));
  const start = Date.now();
  while (!done) {
    for (const c of detectCalls) {
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
    detectCalls.length = 0;
    createFailures = 0;
  });

  afterEach(async () => {
    await terminateOcr();
  });

  it("joins every detected line into one text blob", async () => {
    const p = ocrImage(Buffer.from("photo"));
    await drain([p]);
    expect(await p).toBe("photo\nphoto-2");
  });

  it("runs two jobs concurrently on the two slots", async () => {
    const a = ocrImage(Buffer.from("a"));
    const b = ocrImage(Buffer.from("b"));

    // If only one slot existed, only one job's detect would have registered.
    await vi.waitFor(() => expect(detectCalls.length).toBe(2));
    expect(detectCalls.map((c) => c.input).sort()).toEqual(["a", "b"]);

    await drain([a, b]);
  });

  it("dispatches an urgent (captionless) job ahead of an already-queued normal one", async () => {
    // Both slots busy.
    const busy1 = ocrImage(Buffer.from("busy1"));
    const busy2 = ocrImage(Buffer.from("busy2"));
    await vi.waitFor(() => expect(detectCalls.length).toBe(2));

    // Queue a normal job, then an urgent one — urgent must win the first freed slot.
    const normal = ocrImage(Buffer.from("normal"), false);
    const urgent = ocrImage(Buffer.from("urgent"), true);

    // Free exactly one slot by finishing busy1 (busy2 stays parked).
    await completeJob("busy1", busy1);

    await vi.waitFor(() => expect(detectCalls.some((c) => c.input === "urgent")).toBe(true));
    expect(detectCalls.some((c) => c.input === "normal")).toBe(false);

    await drain([busy2, urgent, normal]);
  });

  it("resolves empty text and logs when the engine fails to load, then recovers", async () => {
    vi.mocked(logger.error).mockClear();
    createFailures = 1;

    // Failed load → empty text, error logged, job still resolves (never throws).
    expect(await ocrImage(Buffer.from("first"))).toBe("");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "csam_ocr_recognize",
        error: expect.stringContaining("model load failed"),
      })
    );

    // A failed load must not poison later scans — the next job loads fresh and succeeds.
    const retry = ocrImage(Buffer.from("retry"));
    await drain([retry]);
    expect(await retry).toBe("retry\nretry-2");
  });
});
