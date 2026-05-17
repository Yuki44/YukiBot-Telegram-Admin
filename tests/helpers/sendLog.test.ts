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

  it("uses HTML parse mode", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), { ...BASE_PAYLOAD });

    expect(api.sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
  });
});
