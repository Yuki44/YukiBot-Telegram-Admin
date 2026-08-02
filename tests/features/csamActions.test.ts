import { describe, it, expect, vi } from "vitest";
import { Api } from "grammy";
import { IChat } from "../../src/types";
import {
  buildCsamCallback,
  parseCsamCallback,
  buildCsamAlert,
  buildRegistroKeyboard,
  sendCsamAlert,
  chunk,
} from "../../src/features/csamDetection/actions";
import { userRepository } from "../../src/db/repositories/userRepository";
import { CSAM_ALERT_DEDUP_MS } from "../../src/config/constants";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    claimCsamAlert: vi.fn(async () => true),
    releaseCsamAlert: vi.fn(async () => undefined),
  },
}));

describe("csam callback data", () => {
  it("round-trips ban/qsil/undo verdicts", () => {
    for (const v of ["ban", "qsil", "undo"] as const) {
      const data = buildCsamCallback(v, -1001234567890, 42);
      const parsed = parseCsamCallback(data);
      expect(parsed).toEqual({ verdict: v, chatId: -1001234567890, userId: 42 });
    }
  });

  it("rejects unrelated / malformed data", () => {
    expect(parseCsamCallback("spam_ok:-100:1")).toBeNull();
    expect(parseCsamCallback("csam_ban:notanumber:1")).toBeNull();
    expect(parseCsamCallback("")).toBeNull();
  });
});

describe("buildCsamAlert", () => {
  const base = {
    chatId: -1001111111111,
    chatName: "GayBCN",
    targetId: 8001128328,
    targetName: "Harry",
    targetUsername: "hrushbsbbd",
    matchSummary: "nomax16 + ib, cc",
  };

  it("AUTO_BAN alert carries the #CP_ALERTA tag, the id hashtag and an undo button", () => {
    const { logText, notifyText, keyboard } = buildCsamAlert("AUTO_BAN", base);
    expect(logText).toContain("#CP_ALERTA");
    expect(logText).toContain("#id8001128328");
    expect(logText).toContain("nomax16 + ib, cc");
    // The log entry must NOT ping @edjoker; only the admin-chat message does.
    expect(logText).not.toContain("@edjoker");
    expect(notifyText).toContain("@edjoker");
    const rows = keyboard.inline_keyboard;
    const datas = rows.flat().map((b) => (b as { callback_data?: string }).callback_data);
    expect(datas).toContain(buildCsamCallback("undo", base.chatId, base.targetId));
  });

  it("SILENCE alert offers ban + qsil buttons for manual review", () => {
    const { logText, keyboard } = buildCsamAlert("SILENCE", base);
    expect(logText).toContain("#CP_ALERTA");
    const datas = keyboard.inline_keyboard.flat().map((b) => (b as { callback_data?: string }).callback_data);
    expect(datas).toContain(buildCsamCallback("ban", base.chatId, base.targetId));
    expect(datas).toContain(buildCsamCallback("qsil", base.chatId, base.targetId));
  });

  it("admin-chat message is compact and ends with the @edjoker mention", () => {
    const { logText, notifyText } = buildCsamAlert("SILENCE", base);
    expect(notifyText.split("\n").length).toBeLessThan(logText.split("\n").length);
    expect(notifyText.trimEnd().endsWith("@edjoker")).toBe(true);
  });

  it("escapes HTML in the target name", () => {
    const { logText } = buildCsamAlert("SILENCE", {
      ...base,
      targetUsername: undefined,
      targetName: "<b>x</b>",
    });
    expect(logText).not.toContain("<b>x</b>");
    expect(logText).toContain("&lt;b&gt;");
  });
});

describe("sendCsamAlert notify-chat keyboard", () => {
  const alert = {
    logText: "log",
    notifyText: "notify",
    keyboard: buildCsamAlert("AUTO_BAN", {
      chatId: -1001111111111,
      chatName: "GayBCN",
      targetId: 1,
      matchSummary: "x",
    }).keyboard,
  };

  function makeChatConfig(over: Partial<IChat> = {}): IChat {
    return {
      chatId: -1001111111111,
      logsTo: -1002222222222,
      notifyChatId: -1003333333333,
      notifyFlags: { notifyCsam: true },
      ...over,
    } as unknown as IChat;
  }

  it("redirects to logsTo when the logsTo post succeeds", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 999 });
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig(), alert, "SILENCE", 42);

    const notifyCall = sendMessage.mock.calls.find((c) => c[0] === -1003333333333)!;
    const kb = notifyCall[2].reply_markup.inline_keyboard[0][0] as { url?: string };
    expect(kb.url).toBe("https://t.me/c/2222222222/999");
  });

  it("never shows the real buttons in the notify chat, even if the logsTo post fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("logsTo send failed"))
      .mockResolvedValueOnce({ message_id: 1 });
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig(), alert, "SILENCE", 42);

    const notifyCall = sendMessage.mock.calls.find((c) => c[0] === -1003333333333)!;
    expect(notifyCall[2].reply_markup).toBeUndefined();
  });

  it("falls back to the real buttons when no logsTo is configured", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig({ logsTo: undefined }), alert, "SILENCE", 42);

    const notifyCall = sendMessage.mock.calls.find((c) => c[0] === -1003333333333)!;
    expect(notifyCall[2].reply_markup).toBe(alert.keyboard);
  });

  // The image tier and the bio rotation flag the same post seconds apart; the admins were
  // getting the identical CP_ALERTA twice for a single action.
  it("stays silent when the claim says this user was already alerted", async () => {
    vi.mocked(userRepository.claimCsamAlert).mockResolvedValueOnce(false);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig(), alert, "SILENCE", 42);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("claims per chat, per verdict — an escalation is a different claim", async () => {
    vi.mocked(userRepository.claimCsamAlert).mockClear();
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig(), alert, "AUTO_BAN", 42);

    expect(userRepository.claimCsamAlert).toHaveBeenCalledWith(
      42,
      -1001111111111,
      "AUTO_BAN",
      CSAM_ALERT_DEDUP_MS
    );
  });

  // A claim that delivered nothing must not lock the other path out of alerting.
  it("releases the claim when every destination fails", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("down"));
    const api = { sendMessage } as unknown as Api;

    await sendCsamAlert(api, makeChatConfig({ notifyChatId: undefined }), alert, "SILENCE", 42);

    expect(userRepository.releaseCsamAlert).toHaveBeenCalledWith(42, -1001111111111);
  });
});

describe("buildRegistroKeyboard", () => {
  it("links to the message inside the -100-prefixed supergroup", () => {
    const kb = buildRegistroKeyboard(-1001234567890, 555);
    const btn = kb.inline_keyboard[0][0] as { text: string; url?: string };
    expect(btn.url).toBe("https://t.me/c/1234567890/555");
    expect(btn.text).toBe("📋 Ver registro");
  });
});

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one group when under the size", () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 100)).toEqual([]);
  });
});
