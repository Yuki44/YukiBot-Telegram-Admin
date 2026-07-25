import { describe, it, expect } from "vitest";
import {
  buildCsamCallback,
  parseCsamCallback,
  buildCsamAlert,
} from "../../src/features/csamDetection/actions";

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
