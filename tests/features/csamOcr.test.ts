import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recognizeCalls: { text: string; resolve: () => void }[] = [];

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(
      (_img: Buffer) =>
        new Promise((resolve) => {
          // Each call registers itself and waits until the test releases it,
          // so we can control completion order across concurrent workers.
          const text = `text-${recognizeCalls.length}`;
          recognizeCalls.push({ text, resolve: () => resolve({ data: { text } }) });
        })
    ),
    terminate: vi.fn(async () => {}),
  })),
}));

vi.mock("sharp", () => ({
  default: () => ({
    resize: () => ({
      grayscale: () => ({
        normalize: () => ({
          toBuffer: async () => Buffer.from("prepared"),
        }),
      }),
    }),
  }),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ocrImage, terminateOcr } from "../../src/features/csamDetection/ocr";

describe("ocrImage priority", () => {
  beforeEach(() => {
    recognizeCalls.length = 0;
  });

  afterEach(async () => {
    await terminateOcr();
  });

  it("runs two jobs concurrently on the two-worker pool", async () => {
    const a = ocrImage(Buffer.from("a"));
    const b = ocrImage(Buffer.from("b"));

    // Give both calls a tick to reach the worker — if only one worker existed,
    // only one recognize() call would have registered by now.
    await vi.waitFor(() => expect(recognizeCalls.length).toBe(2));

    recognizeCalls[0].resolve();
    recognizeCalls[1].resolve();
    await Promise.all([a, b]);
  });

  it("dispatches an urgent (captionless) job ahead of an already-queued normal one", async () => {
    // Both workers busy first.
    const busy1 = ocrImage(Buffer.from("busy1"));
    const busy2 = ocrImage(Buffer.from("busy2"));
    await vi.waitFor(() => expect(recognizeCalls.length).toBe(2));

    // Queue a normal job, then an urgent one — urgent must be served first
    // once a worker frees up.
    const normal = ocrImage(Buffer.from("normal"), false);
    const urgent = ocrImage(Buffer.from("urgent"), true);

    recognizeCalls[0].resolve();
    recognizeCalls[1].resolve();
    await Promise.all([busy1, busy2]);

    await vi.waitFor(() => expect(recognizeCalls.length).toBe(3));
    // The 3rd recognize() call dispatched must belong to the urgent job, not
    // the normal one that was queued first.
    recognizeCalls[2].resolve();
    const urgentText = await urgent;
    expect(urgentText).toBe("text-2");

    await vi.waitFor(() => expect(recognizeCalls.length).toBe(4));
    recognizeCalls[3].resolve();
    await normal;
  });
});
