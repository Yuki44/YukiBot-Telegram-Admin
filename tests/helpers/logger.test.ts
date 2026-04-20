import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../src/utils/logger";

// Capture the last JSON line written to stdout or stderr, regardless of
// which console method the logger uses internally.
function captureOutput(fn: () => void): Record<string, unknown> {
  let captured = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    captured = String(chunk);
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    captured = String(args[0]);
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    captured = String(chunk);
    return true;
  });
  const errConsoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    captured = String(args[0]);
  });

  fn();

  outSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
  errConsoleSpy.mockRestore();

  return JSON.parse(captured.trim());
}

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logger.info emits valid JSON with level INFO and supplied fields", () => {
    const parsed = captureOutput(() => logger.info({ action: "test_info", userId: 1 }));
    expect(parsed.level).toBe("INFO");
    expect(parsed.action).toBe("test_info");
    expect(parsed.userId).toBe(1);
    expect(typeof parsed.ts).toBe("string");
    expect(() => new Date(parsed.ts as string).toISOString()).not.toThrow();
  });

  it("logger.warn emits valid JSON with level WARN", () => {
    const parsed = captureOutput(() => logger.warn({ action: "test_warn" }));
    expect(parsed.level).toBe("WARN");
    expect(parsed.action).toBe("test_warn");
    expect(parsed.ts).toBeDefined();
  });

  it("logger.error emits valid JSON with level ERROR", () => {
    const parsed = captureOutput(() => logger.error({ action: "test_error" }));
    expect(parsed.level).toBe("ERROR");
    expect(parsed.action).toBe("test_error");
    expect(parsed.ts).toBeDefined();
  });

  it("emitted JSON contains a valid ISO timestamp", () => {
    const parsed = captureOutput(() => logger.info({ action: "ts_check" }));
    const ts = parsed.ts as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("extra fields are passed through to the log entry", () => {
    const parsed = captureOutput(() =>
      logger.info({ action: "extra_fields", chatId: -100, username: "testuser" })
    );
    expect(parsed.chatId).toBe(-100);
    expect(parsed.username).toBe("testuser");
  });
});
