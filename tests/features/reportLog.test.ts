import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bot/helpers/sendLog", () => ({ sendLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn() } }));

import { reportLog, isReportTrigger } from "../../src/features/reportLog";
import { sendLog } from "../../src/bot/helpers/sendLog";
import { BotContext, IChat } from "../../src/types";

const BOT = "yuki_kaylbot";

describe("isReportTrigger", () => {
  it.each([
    "/report",
    "/report esto es spam",
    `/report@${BOT}`,
    "porfa @admin ayuda",
    "@Admin",
    `mira @${BOT} esto`,
    `@${BOT} este usuario esta espameando!`,
    `@Yuki_Kaylbot ayuda`,
  ])("matches %j", (text) => {
    expect(isReportTrigger(text, BOT)).toBe(true);
  });

  it.each([
    "",
    "voy a reportar esto",
    "check this report please",
    "hola @administrador",
    "escribe a x@admin.com",
    "un mensaje normal",
  ])("does not match %j", (text) => {
    expect(isReportTrigger(text, BOT)).toBe(false);
  });
});

function makeChatConfig(overrides: Partial<IChat> = {}): IChat {
  return {
    chatId: -1001234,
    name: "Test Group",
    type: "normal",
    isActive: true,
    logsTo: -100999,
    logFlags: { logReports: true },
    features: {},
    ...overrides,
  } as unknown as IChat;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const chat = { id: -1001234, type: "supergroup", title: "Test Group" };
  return {
    chatConfig: makeChatConfig(),
    chat,
    from: { id: 700, is_bot: false, first_name: "Reporter" },
    message: { message_id: 42, chat, date: 0, text: "/report", message_thread_id: undefined },
    api: {},
    ...overrides,
  } as unknown as BotContext;
}

describe("reportLog middleware", () => {
  const log = sendLog as ReturnType<typeof vi.fn>;
  beforeEach(() => vi.clearAllMocks());

  it("logs a REPORTE for a reply, with reporter, reported author and the reply id", async () => {
    const ctx = makeCtx({
      message: {
        message_id: 42,
        chat: { id: -1001234, type: "supergroup" },
        date: 0,
        text: "/report",
        reply_to_message: { message_id: 30, from: { id: 900, is_bot: false, first_name: "Bad" } },
      },
    });
    const next = vi.fn();
    await reportLog(ctx, next);

    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0][2];
    expect(payload).toMatchObject({
      action: "REPORTE",
      actor: { id: 700 },
      target: { id: 900 },
      refMsgId: 42, // links to the reporter's own message, not the reported one
    });
    expect(payload.reporterMsg).toBeTruthy();
    expect(payload.repliedMsg).toBeTruthy();
    expect(next).toHaveBeenCalled();
  });

  it("logs a REPORTE with no target and links to the command message when not a reply", async () => {
    const ctx = makeCtx({ message: { message_id: 55, chat: { id: -1001234 }, date: 0, text: "@admin ayuda" } });
    await reportLog(ctx, vi.fn());

    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0][2];
    expect(payload.actor.id).toBe(700);
    expect(payload.target.id).toBe(700); // self ⇒ sendLog drops the "A" line
    expect(payload.refMsgId).toBe(55);
    expect(payload.reporterMsg).toBeTruthy();
    expect(payload.repliedMsg).toBeUndefined();
  });

  it("does nothing when logReports is off", async () => {
    const ctx = makeCtx({ chatConfig: makeChatConfig({ logFlags: { logReports: false } } as never) });
    await reportLog(ctx, vi.fn());
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing when logsTo is not configured", async () => {
    const ctx = makeCtx({ chatConfig: makeChatConfig({ logsTo: undefined } as never) });
    await reportLog(ctx, vi.fn());
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores a normal message that is not a report", async () => {
    const ctx = makeCtx({ message: { message_id: 1, chat: { id: -1001234 }, date: 0, text: "hola grupo" } });
    await reportLog(ctx, vi.fn());
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores reports sent by a bot", async () => {
    const ctx = makeCtx({ from: { id: 5, is_bot: true, first_name: "SomeBot" } });
    await reportLog(ctx, vi.fn());
    expect(log).not.toHaveBeenCalled();
  });

  it("always continues the middleware chain", async () => {
    const ctx = makeCtx();
    const next = vi.fn();
    await reportLog(ctx, next);
    expect(next).toHaveBeenCalled();
  });
});
