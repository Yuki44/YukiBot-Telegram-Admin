import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories/topicRepository", () => ({
  topicRepository: {
    findByChatAndTopic: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { sendLog, LogPayload } from "../../src/bot/helpers/sendLog";
import { IChat } from "../../src/types";

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
    },
    features: {},
    ...overrides,
  } as unknown as IChat;
}

const BASE_PAYLOAD: LogPayload = {
  action: "AVISO",
  actor: { id: 99, name: "Admin", username: "admin" },
  target: { id: 42, name: "Bad User", username: "baduser" },
  chatId: -1001234,
  chatName: "Test Group",
  warnings: 1,
  reason: "spam",
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("sendLog — repliedMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends only one message when repliedMessage is absent", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), { ...BASE_PAYLOAD });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a second message when repliedMessage is provided", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      ...BASE_PAYLOAD,
      repliedMessage: "I AM A VERY BAD PERSON",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("second message contains 'Mensaje original' label", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      ...BASE_PAYLOAD,
      repliedMessage: "I AM A VERY BAD PERSON",
    });

    const secondCall = api.sendMessage.mock.calls[1];
    expect(secondCall[1]).toContain("Mensaje original");
  });

  it("second message contains the replied text verbatim (HTML-escaped)", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      ...BASE_PAYLOAD,
      repliedMessage: "hello <world> & everyone",
    });

    const secondCall = api.sendMessage.mock.calls[1];
    expect(secondCall[1]).toContain("hello &lt;world&gt; &amp; everyone");
  });

  it("second message is sent to the same logsTo chat", async () => {
    const api = makeApi();
    const config = makeChatConfig({ logsTo: -100777 } as any);
    await sendLog(api as any, config, {
      ...BASE_PAYLOAD,
      repliedMessage: "some text",
    });

    const secondCall = api.sendMessage.mock.calls[1];
    expect(secondCall[0]).toBe(-100777);
  });

  it("second message uses HTML parse mode", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      ...BASE_PAYLOAD,
      repliedMessage: "some text",
    });

    const secondCall = api.sendMessage.mock.calls[1];
    expect(secondCall[2]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("does not send second message when repliedMessage is an empty string", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      ...BASE_PAYLOAD,
      repliedMessage: "",
    });

    // Empty string is falsy — only the main log should be sent
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send any message when logsTo is absent", async () => {
    const api = makeApi();
    const config = makeChatConfig({ logsTo: undefined } as any);
    await sendLog(api as any, config, {
      ...BASE_PAYLOAD,
      repliedMessage: "something",
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send any message when the relevant logFlag is disabled", async () => {
    const api = makeApi();
    const config = makeChatConfig({
      logFlags: { ...makeChatConfig().logFlags, logWarns: false },
    } as any);
    await sendLog(api as any, config, {
      ...BASE_PAYLOAD,
      repliedMessage: "something",
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("works for BAN action with repliedMessage", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "BAN",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      repliedMessage: "I will destroy this group",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    const firstCall = api.sendMessage.mock.calls[0];
    expect(firstCall[1]).toContain("#BAN");
    const secondCall = api.sendMessage.mock.calls[1];
    expect(secondCall[1]).toContain("I will destroy this group");
  });

  it("works for KICK action with repliedMessage", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "KICK",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      repliedMessage: "kick me if you can",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls[0][1]).toContain("#KICK");
    expect(api.sendMessage.mock.calls[1][1]).toContain("kick me if you can");
  });

  it("works for SILENCIO action with repliedMessage", async () => {
    const api = makeApi();
    await sendLog(api as any, makeChatConfig(), {
      action: "SILENCIO",
      actor: { id: 99, name: "Admin" },
      target: { id: 42, name: "Bad User" },
      chatId: -1001234,
      chatName: "Test Group",
      repliedMessage: "spam spam spam",
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls[0][1]).toContain("#SILENCIO");
    expect(api.sendMessage.mock.calls[1][1]).toContain("spam spam spam");
  });
});

