import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { forwardToLog } from "../../src/bot/helpers/forwardToLog";
import { logger } from "../../src/utils/logger";
import { Message } from "grammy/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

const LOGS_TO = -100999;

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPhoto: vi.fn().mockResolvedValue(undefined),
    sendVideo: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    sendAnimation: vi.fn().mockResolvedValue(undefined),
    sendAudio: vi.fn().mockResolvedValue(undefined),
    sendVoice: vi.fn().mockResolvedValue(undefined),
    sendSticker: vi.fn().mockResolvedValue(undefined),
    sendVideoNote: vi.fn().mockResolvedValue(undefined),
    copyMessage: vi.fn().mockResolvedValue(undefined),
    forwardMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    message_id: 1,
    chat: { id: -1001234, type: "supergroup" },
    date: 0,
    ...overrides,
  } as unknown as Message;
}

const HEADER_CALL = ["💬 <b>Mensaje original:</b>", { parse_mode: "HTML" }];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("forwardToLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Header ─────────────────────────────────────────────────────────────────

  it("always sends the header first", async () => {
    const api = makeApi();
    await forwardToLog(api as any, LOGS_TO, makeMsg({ text: "hi" }));

    expect(api.sendMessage).toHaveBeenNthCalledWith(1, LOGS_TO, ...HEADER_CALL);
  });

  it("returns early and logs when the header send fails", async () => {
    const api = makeApi({
      sendMessage: vi.fn().mockRejectedValueOnce(new Error("network")),
    });
    await forwardToLog(api as any, LOGS_TO, makeMsg({ text: "hi" }));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forwardToLog_header" })
    );
    // Only one sendMessage call (the failed header) — content never attempted
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  // ── Text ───────────────────────────────────────────────────────────────────

  it("sends text as a plain second message", async () => {
    const api = makeApi();
    await forwardToLog(api as any, LOGS_TO, makeMsg({ text: "hello world" }));

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, LOGS_TO, "hello world");
  });

  // ── Photo ──────────────────────────────────────────────────────────────────

  it("sends photo without caption", async () => {
    const api = makeApi();
    const msg = makeMsg({ photo: [{ file_id: "photo123", file_unique_id: "u", width: 1, height: 1 }] });
    await forwardToLog(api as any, LOGS_TO, msg);

    expect(api.sendPhoto).toHaveBeenCalledWith(LOGS_TO, "photo123", { caption: undefined });
  });

  it("sends photo with original caption preserved", async () => {
    const api = makeApi();
    const msg = makeMsg({
      photo: [{ file_id: "photo123", file_unique_id: "u", width: 1, height: 1 }],
      caption: "look at this",
    });
    await forwardToLog(api as any, LOGS_TO, msg);

    expect(api.sendPhoto).toHaveBeenCalledWith(LOGS_TO, "photo123", { caption: "look at this" });
  });

  it("uses the last (largest) photo in the array", async () => {
    const api = makeApi();
    const msg = makeMsg({
      photo: [
        { file_id: "small", file_unique_id: "u1", width: 100, height: 100 },
        { file_id: "large", file_unique_id: "u2", width: 800, height: 600 },
      ],
    });
    await forwardToLog(api as any, LOGS_TO, msg);

    expect(api.sendPhoto).toHaveBeenCalledWith(LOGS_TO, "large", { caption: undefined });
  });

  // ── Other media types ──────────────────────────────────────────────────────

  it("sends video with caption", async () => {
    const api = makeApi();
    await forwardToLog(
      api as any,
      LOGS_TO,
      makeMsg({ video: { file_id: "vid1", file_unique_id: "u", width: 1, height: 1, duration: 5 }, caption: "vid cap" })
    );
    expect(api.sendVideo).toHaveBeenCalledWith(LOGS_TO, "vid1", { caption: "vid cap" });
  });

  it("sends document", async () => {
    const api = makeApi();
    await forwardToLog(
      api as any,
      LOGS_TO,
      makeMsg({ document: { file_id: "doc1", file_unique_id: "u" } })
    );
    expect(api.sendDocument).toHaveBeenCalledWith(LOGS_TO, "doc1", { caption: undefined });
  });

  it("sends sticker", async () => {
    const api = makeApi();
    await forwardToLog(
      api as any,
      LOGS_TO,
      makeMsg({ sticker: { file_id: "stk1", file_unique_id: "u", type: "regular", width: 1, height: 1, is_animated: false, is_video: false } })
    );
    expect(api.sendSticker).toHaveBeenCalledWith(LOGS_TO, "stk1");
  });

  it("sends video_note", async () => {
    const api = makeApi();
    await forwardToLog(
      api as any,
      LOGS_TO,
      makeMsg({ video_note: { file_id: "vn1", file_unique_id: "u", length: 1, duration: 5 } })
    );
    expect(api.sendVideoNote).toHaveBeenCalledWith(LOGS_TO, "vn1");
  });

  // ── Unknown type fallback ──────────────────────────────────────────────────

  it("falls back to copyMessage for unknown types", async () => {
    const api = makeApi();
    await forwardToLog(api as any, LOGS_TO, makeMsg()); // no text/photo/etc

    expect(api.copyMessage).toHaveBeenCalledWith(LOGS_TO, -1001234, 1);
    expect(api.forwardMessage).not.toHaveBeenCalled();
  });

  it("falls back to forwardMessage when copyMessage fails for unknown types", async () => {
    const api = makeApi({
      copyMessage: vi.fn().mockRejectedValueOnce(new Error("protected")),
    });
    await forwardToLog(api as any, LOGS_TO, makeMsg());

    expect(api.forwardMessage).toHaveBeenCalledWith(LOGS_TO, -1001234, 1);
  });

  // ── Content failure guard ──────────────────────────────────────────────────

  it("sends error placeholder when content send fails", async () => {
    const api = makeApi({
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(undefined) // header succeeds
        .mockRejectedValueOnce(new Error("fail")) // text send fails
        .mockResolvedValueOnce(undefined), // placeholder
    });
    await forwardToLog(api as any, LOGS_TO, makeMsg({ text: "hi" }));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forwardToLog_content" })
    );
    expect(api.sendMessage).toHaveBeenNthCalledWith(
      3,
      LOGS_TO,
      "⚠️ <i>(no se pudo obtener el mensaje original)</i>",
      { parse_mode: "HTML" }
    );
  });

  it("logs content error and does not throw when placeholder also fails", async () => {
    const api = makeApi({
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce(undefined) // header succeeds
        .mockRejectedValue(new Error("all fail")), // text + placeholder both fail
    });

    await expect(forwardToLog(api as any, LOGS_TO, makeMsg({ text: "hi" }))).resolves.not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forwardToLog_content" })
    );
  });
});

