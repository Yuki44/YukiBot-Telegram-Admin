import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/bot/helpers/forwardToLog", () => ({
  forwardToLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { sendLog, LogPayload } from "../../src/bot/helpers/sendLog";
import { forwardToLog } from "../../src/bot/helpers/forwardToLog";
import { IChat } from "../../src/types";
import { Message } from "grammy/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeApi() {
  return { sendMessage: vi.fn().mockResolvedValue(undefined) };
}

function makeChatConfig(overrides: Partial<IChat> = {}): IChat {
  return {
    chatId: -1001234,
    name: "Test Group",
    type: "normal",
    isActive: true,
    whitelist: [],
    logsTo: -100999,
    logFlags: {
      logWarns: true,
      logSilences: true,
      logBans: true,
      logAutoRebans: true,
      logKicks: true,
      logQBans: true,
      logUnsilences: true,
      logUnwarns: true,
      logEntries: true,
      logExits: true,
      logBannedWords: true,
      logReports: true,
    },
    features: {},
    ...overrides,
  } as unknown as IChat;
}

function makeMessage(text = "some text"): Message {
  return {
    message_id: 1,
    chat: { id: -1001234, type: "supergroup" },
    date: 0,
    text,
  } as unknown as Message;
}

const BASE_PAYLOAD: LogPayload = {
  action: "AVISO",
  actor: { id: 99, name: "Admin", username: "admin" },
  target: { id: 42, name: "Bad User", username: "baduser" },
  chatId: -1001234,
  chatName: "Test Group",
  chatType: "normal",
  warnings: 1,
  reason: "spam",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("sendLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one message when repliedMsg is absent", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), { ...BASE_PAYLOAD });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(forwardToLog).not.toHaveBeenCalled();
  });

  it("calls forwardToLog when repliedMsg is provided", async () => {
    const api = makeApi();
    const msg = makeMessage("I AM A VERY BAD PERSON");
    await sendLog(api as any, makeChatConfig(), { ...BASE_PAYLOAD, repliedMsg: msg });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(forwardToLog).toHaveBeenCalledOnce();
    expect(forwardToLog).toHaveBeenCalledWith(api, -100999, msg);
  });

  it("sends the main log to logsTo", async () => {
    const api = makeApi();
    const config = makeChatConfig({ logsTo: -100777 } as any);
    await sendLog(api as any, config, { ...BASE_PAYLOAD });

    expect(api.sendMessage.mock.calls[0][0]).toBe(-100777);
  });

  it("does not send any message when logsTo is absent", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig({ logsTo: undefined } as any), {
      ...BASE_PAYLOAD,
      repliedMsg: makeMessage(),
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(forwardToLog).not.toHaveBeenCalled();
  });

  it("does not send any message when the relevant logFlag is disabled", async () => {
    const api = makeApi();
    const config = makeChatConfig({
      logFlags: { ...makeChatConfig().logFlags, logWarns: false },
    } as any);
    await sendLog(api as any, config, { ...BASE_PAYLOAD, repliedMsg: makeMessage() });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(forwardToLog).not.toHaveBeenCalled();
  });

  it("main log contains #BAN tag for BAN action", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "BAN",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      chatType: "normal",
      repliedMsg: makeMessage("I will destroy this group"),
    });

    expect(api.sendMessage.mock.calls[0][1]).toContain("#BAN");
    expect(forwardToLog).toHaveBeenCalledOnce();
  });

  it("main log contains #KICK tag for KICK action", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "KICK",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      chatType: "normal",
      repliedMsg: makeMessage("kick me if you can"),
    });

    expect(api.sendMessage.mock.calls[0][1]).toContain("#KICK");
    expect(forwardToLog).toHaveBeenCalledOnce();
  });

  it("main log contains #SILENCIO tag for SILENCIO action", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "SILENCIO",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      chatType: "normal",
      repliedMsg: makeMessage("spam spam spam"),
    });

    expect(api.sendMessage.mock.calls[0][1]).toContain("#SILENCIO");
    expect(forwardToLog).toHaveBeenCalledOnce();
  });

  it("builds the #PALABRA_PROHIBIDA entry with the word and no actor", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "PALABRA_PROHIBIDA",
      target: { id: 8016403283, name: "Romeeo" },
      chatId: -1003600946482,
      chatName: "GAYBCN",
      chatType: "normal",
      word: "priv",
    });

    const text = api.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("🆎 #PALABRA_PROHIBIDA");
    expect(text).toContain("• De: ");
    expect(text).toContain("• Palabra: priv");
    expect(text).toContain("#id8016403283");
    expect(forwardToLog).not.toHaveBeenCalled();
  });

  it("suppresses #PALABRA_PROHIBIDA when logBannedWords is off", async () => {
    const api = makeApi();
    const config = makeChatConfig({
      logFlags: { ...makeChatConfig().logFlags, logBannedWords: false },
    } as any);
    await sendLog(api as any, config, {
      action: "PALABRA_PROHIBIDA",
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      chatType: "normal",
      word: "priv",
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("builds a #REPORTE with De, A, the reporter-message link and both id hashtags (reply case)", async () => {
    const api = makeApi();
    const reporterMsg = { ...makeMessage("/report"), message_id: 1234 } as any;
    const reportedMsg = { ...makeMessage("mensaje reportado"), message_id: 30 } as any;
    await sendLog(api as any, makeChatConfig(), {
      action: "REPORTE",
      actor: { id: 8948030606, name: "Eric" },
      target: { id: 5213307301, name: "E" },
      chatId: -1003327455783,
      chatName: "GayVerso",
      chatType: "normal",
      refMsgId: 1234,
      reporterMsg,
      repliedMsg: reportedMsg,
    });

    const text = api.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("🆘 #REPORTE");
    expect(text).toContain("• De: ");
    expect(text).toContain("• A: ");
    expect(text).toContain("⬅️ Ir al mensaje");
    expect(text).toContain("/3327455783/1234"); // links to the reporter message, -100 stripped
    expect(text).toContain("#id8948030606 #id5213307301");
    // Two blocks: reporter's message then the reported one, each with its own header.
    expect(forwardToLog).toHaveBeenCalledTimes(2);
    expect(forwardToLog).toHaveBeenNthCalledWith(1, api, -100999, reporterMsg, "💬 <b>Reporte:</b>");
    expect(forwardToLog).toHaveBeenNthCalledWith(2, api, -100999, reportedMsg, "💬 <b>Mensaje reportado:</b>");
  });

  it("no reply → no A line, single hashtag, only the reporter-message block", async () => {
    const api = makeApi();
    const reporter = { id: 8948030606, name: "Eric" };
    const reporterMsg = { ...makeMessage("@admin ayuda"), message_id: 77 } as any;
    await sendLog(api as any, makeChatConfig(), {
      action: "REPORTE",
      actor: reporter,
      target: reporter,
      chatId: -1003327455783,
      chatName: "GayVerso",
      chatType: "normal",
      refMsgId: 77,
      reporterMsg,
    });

    const text = api.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("🆘 #REPORTE");
    expect(text).not.toContain("• A: ");
    expect(text).toContain("/3327455783/77");
    expect(text).toContain("#id8948030606");
    expect(text).not.toContain("#id8948030606 #id");
    expect(forwardToLog).toHaveBeenCalledTimes(1);
    expect(forwardToLog).toHaveBeenNthCalledWith(1, api, -100999, reporterMsg, "💬 <b>Reporte:</b>");
  });

  it("suppresses #REPORTE when logReports is off", async () => {
    const api = makeApi();
    const config = makeChatConfig({
      logFlags: { ...makeChatConfig().logFlags, logReports: false },
    } as any);
    await sendLog(api as any, config, {
      action: "REPORTE",
      actor: { id: 1, name: "A" },
      target: { id: 1, name: "A" },
      chatId: -1001234,
      chatName: "Test Group",
      chatType: "normal",
      refMsgId: 5,
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("uses HTML parse mode", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), { ...BASE_PAYLOAD });

    expect(api.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
  });
});
