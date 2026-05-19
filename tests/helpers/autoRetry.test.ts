import { describe, it, expect, vi } from "vitest";
import { autoRetry } from "@grammyjs/auto-retry";

/**
 * Proves the hardening wired in src/index.ts (`bot.api.config.use(autoRetry(...))`):
 * a flood-control 429 on banChatMember is transparently retried instead of being
 * dropped, but retries are bounded so a hostile flood can't wedge the process.
 * The transformer is exercised directly with a fake `prev` (no network, no bot boot).
 */
describe("@grammyjs/auto-retry hardening", () => {
  const TOO_MANY = {
    ok: false,
    error_code: 429,
    description: "Too Many Requests: retry later",
    parameters: { retry_after: 0 },
  };
  const OK = { ok: true, result: true };

  it("retries a 429 and ultimately succeeds (the ban is not missed)", async () => {
    const transformer = autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 });
    const prev = vi
      .fn()
      .mockResolvedValueOnce(TOO_MANY)
      .mockResolvedValueOnce(OK);

    const res = await transformer(
      prev as never,
      "banChatMember",
      { chat_id: -100, user_id: 7 } as never,
      undefined as never
    );

    expect(prev).toHaveBeenCalledTimes(2);
    expect(res).toEqual(OK);
  });

  it("stops retrying after maxRetryAttempts instead of looping forever", async () => {
    const transformer = autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 });
    const prev = vi.fn().mockResolvedValue(TOO_MANY);

    const res = await transformer(
      prev as never,
      "banChatMember",
      { chat_id: -100, user_id: 7 } as never,
      undefined as never
    );

    // Initial attempt + 3 bounded retries, then it gives up (still a 429).
    expect(prev).toHaveBeenCalledTimes(4);
    expect((res as { ok: boolean }).ok).toBe(false);
  });
});
