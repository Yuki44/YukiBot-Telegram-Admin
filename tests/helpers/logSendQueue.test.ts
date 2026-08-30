import { describe, it, expect } from "vitest";
import { enqueueLogSend } from "../../src/bot/helpers/logSendQueue";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("enqueueLogSend", () => {
  it("runs tasks for the same dest one at a time, in order (no interleaving)", async () => {
    const events: string[] = [];
    const block = (tag: string, delay: number) => async () => {
      events.push(`${tag}:start`);
      await tick(delay);
      events.push(`${tag}:end`);
    };

    // B is enqueued while A is still running; it must wait for A to finish.
    const a = enqueueLogSend(1, block("A", 30));
    const b = enqueueLogSend(1, block("B", 1));
    await Promise.all([a, b]);

    expect(events).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  it("does not serialize across different dests", async () => {
    const events: string[] = [];
    const block = (tag: string, delay: number) => async () => {
      events.push(`${tag}:start`);
      await tick(delay);
      events.push(`${tag}:end`);
    };

    const a = enqueueLogSend(1, block("A", 20));
    const b = enqueueLogSend(2, block("B", 1));
    await Promise.all([a, b]);

    // B (other dest) finishes before A, so they overlap.
    expect(events.indexOf("B:end")).toBeLessThan(events.indexOf("A:end"));
  });

  it("a failing task does not break the chain for the next one", async () => {
    const events: string[] = [];
    const bad = enqueueLogSend(3, async () => {
      throw new Error("boom");
    });
    const good = enqueueLogSend(3, async () => {
      events.push("ran");
    });

    await expect(bad).rejects.toThrow("boom");
    await good;
    expect(events).toEqual(["ran"]);
  });

  it("returns the task's resolved value", async () => {
    await expect(enqueueLogSend(4, async () => 42)).resolves.toBe(42);
  });
});
