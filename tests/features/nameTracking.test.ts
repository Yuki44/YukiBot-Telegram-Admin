import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn(),
    updateIdentity: vi.fn(async () => {}),
  },
}));

import {
  diffIdentity,
  buildIdentityChangeMessage,
  trackIdentity,
} from "../../src/features/nameTracking";
import { userRepository } from "../../src/db/repositories/userRepository";
import { fullName } from "../../src/bot/helpers/fullName";
import { IChat } from "../../src/types";

describe("diffIdentity", () => {
  it("detects a rename without flagging the unchanged username", () => {
    const c = diffIdentity({ name: "Simo", username: "simo" }, { name: "Simon", username: "simo" });
    expect(c?.nameChange).toEqual({ from: "Simo", to: "Simon" });
    expect(c?.usernameChange).toBeUndefined();
  });

  it("detects a username change", () => {
    const c = diffIdentity({ name: "Simo", username: "simoo" }, { name: "Simo", username: "simon2" });
    expect(c?.usernameChange).toEqual({ from: "simoo", to: "simon2" });
  });

  it("detects a removed username (to: undefined)", () => {
    const c = diffIdentity({ name: "Simo", username: "simoo" }, { name: "Simo" });
    expect(c?.usernameChange).toEqual({ from: "simoo", to: undefined });
  });

  it("returns null when nothing changed", () => {
    expect(diffIdentity({ name: "Simo", username: "simo" }, { name: "Simo", username: "simo" })).toBeNull();
  });
});

describe("buildIdentityChangeMessage", () => {
  it("name change: old name plain, new name linked, unchanged username linked on both sides", () => {
    const msg = buildIdentityChangeMessage(7807562391, { name: "Simo", username: "simo" }, { name: "Simon", username: "simo" });
    expect(msg).toContain("ha actualizado su perfil");
    expect(msg).toContain("<code>7807562391</code>");
    expect(msg).not.toContain('<a href="tg://user?id=7807562391">Simo</a>'); // old name: plain
    expect(msg).toContain('<a href="tg://user?id=7807562391">Simon</a>'); // new name: linked
    expect(msg).toContain('<a href="tg://user?id=7807562391">@simo</a>'); // unchanged username: linked
    expect(msg).not.toContain("\n"); // one-liner
  });

  it("username change: old @handle plain, new @handle linked, unchanged name linked on both sides", () => {
    const msg = buildIdentityChangeMessage(1, { name: "Simo", username: "simoo" }, { name: "Simo", username: "simon2" });
    expect(msg).toContain("(@simoo)"); // old username: plain text
    expect(msg).not.toContain('<a href="tg://user?id=1">@simoo</a>');
    expect(msg).toContain('<a href="tg://user?id=1">@simon2</a>'); // new username: linked
    expect(msg).toContain('<a href="tg://user?id=1">Simo</a>'); // unchanged name: linked
  });

  it("both change: only the new values are linked", () => {
    const msg = buildIdentityChangeMessage(5, { name: "Ana", username: "ana" }, { name: "Ana María", username: "ana_m" });
    expect(msg).toContain("Ana ("); // old name plain
    expect(msg).toContain("(@ana)"); // old username plain
    expect(msg).toContain('<a href="tg://user?id=5">Ana María</a>');
    expect(msg).toContain('<a href="tg://user?id=5">@ana_m</a>');
  });

  it("gained a username: no leftover placeholder, new side shows the linked @handle", () => {
    const msg = buildIdentityChangeMessage(9, { name: "Ana" }, { name: "Ana María", username: "ana_m" });
    expect(msg).not.toContain("(ninguno)");
    expect(msg).toContain('<a href="tg://user?id=9">@ana_m</a>');
  });
});

describe("trackIdentity", () => {
  const chatConfig = { chatId: -100111, logsTo: -100999 } as unknown as IChat;
  const api = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as never;

  beforeEach(() => {
    vi.mocked(userRepository.findByUserAndChat).mockReset();
    vi.mocked(userRepository.updateIdentity).mockClear();
    (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mockClear();
  });

  it("announces to the group AND the log channel on a change, then persists", async () => {
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      name: "Simo",
      username: "simo",
    } as never);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    const send = (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage;
    const dests = send.mock.calls.map((c) => c[0]);
    expect(dests).toContain(-100111); // group
    expect(dests).toContain(-100999); // logsTo
    expect(userRepository.updateIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simo");
  });

  it("first sighting (no stored record) never announces, only persists — no notify loop", async () => {
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simon" });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.updateIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simon");
  });
});

describe("identity captured from the CSAM rotation", () => {
  // G17: the scanner derives the name from a getChat response, the message path from
  // ctx.from. Both must use fullName or the rotation invents phantom profile changes.
  it("derives the same name from a getChat payload as from a message sender", () => {
    const fromMessage = { first_name: "Shane", last_name: "H", username: "shanehbd" };
    const fromGetChat = { first_name: "Shane", last_name: "H", username: "shanehbd", bio: "x" };
    expect(fullName(fromGetChat)).toBe(fullName(fromMessage));
    expect(diffIdentity({ name: fullName(fromMessage) }, { name: fullName(fromGetChat) })).toBeNull();
  });

  it("still reports a real change seen only by the rotation", () => {
    const stored = { name: "Shane", username: "shanehbd" };
    const scanned = { name: fullName({ first_name: "Nomax", last_name: "16" }), username: "nomax16" };
    expect(diffIdentity(stored, scanned)).not.toBeNull();
  });
});
