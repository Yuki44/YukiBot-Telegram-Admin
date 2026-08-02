import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn(),
    findAllForUser: vi.fn(async () => []),
    updateIdentity: vi.fn(async () => {}),
    syncIdentityAcrossChats: vi.fn(async () => {}),
  },
}));
vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: { findByChatId: vi.fn(async () => null) },
}));

import {
  diffIdentity,
  buildIdentityChangeMessage,
  trackIdentity,
} from "../../src/features/nameTracking";
import { userRepository } from "../../src/db/repositories/userRepository";
import { chatRepository } from "../../src/db/repositories/chatRepository";
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

  // Emoji are ordinary characters here: they must compare, and change, like any other.
  it("treats emoji as part of the name", () => {
    expect(diffIdentity({ name: "🧸" }, { name: "🧸" })).toBeNull();
    expect(diffIdentity({ name: "Ana" }, { name: "Ana 🌸" })?.nameChange).toEqual({ from: "Ana", to: "Ana 🌸" });
    expect(diffIdentity({ name: "🌸 🧸" }, { name: "🧸 🌸" })).not.toBeNull();
    expect(diffIdentity({ name: "👨‍👩‍👧" }, { name: "👨‍👩‍👧" })).toBeNull(); // ZWJ sequence kept intact
    expect(diffIdentity({ name: "❤️" }, { name: "❤️" })).toBeNull(); // variation selector kept
  });

  // Same visible name, different bytes — announcing these printed "Ana → Ana".
  it("ignores invisible differences that render identically", () => {
    expect(diffIdentity({ name: "Ana" }, { name: "Ana\u200B" })).toBeNull(); // zero-width space
    expect(diffIdentity({ name: "Ana B" }, { name: "Ana  B" })).toBeNull(); // doubled space
    expect(diffIdentity({ name: "José" }, { name: "Jose\u0301" })).toBeNull(); // NFC vs NFD
    expect(diffIdentity({ name: "Ana" }, { name: "\u200EAna" })).toBeNull(); // direction mark
  });
});

describe("buildIdentityChangeMessage", () => {
  it("name change: old name plain, new name linked, unchanged username linked on both sides", () => {
    const msg = buildIdentityChangeMessage(7807562391, { name: "Simo", username: "simo" }, { name: "Simon", username: "simo" });
    expect(msg).toContain("ha actualizado su perfil");
    expect(msg).toContain("<code>7807562391</code>");
    expect(msg).not.toContain('<a href="tg://user?id=7807562391">Simo</a>'); // old name: plain
    expect(msg).toContain('<b><a href="tg://user?id=7807562391">Simon</a></b>'); // new name: linked + bold
    expect(msg).toContain('<a href="tg://user?id=7807562391">@simo</a>'); // unchanged username: linked
    expect(msg).toContain("perfil:\n"); // the change starts on its own line
  });

  // A freed @handle can be re-registered by a stranger, and Telegram auto-links any bare
  // @handle in the text — so the replaced one must not be left as plain text.
  it("username change: old @handle is inert <code>, new @handle linked and bold", () => {
    const msg = buildIdentityChangeMessage(1, { name: "Simo", username: "simoo" }, { name: "Simo", username: "simon2" });
    expect(msg).toContain("<code>@simoo</code>");
    expect(msg).not.toContain("(@simoo)");
    expect(msg).not.toContain('<a href="tg://user?id=1">@simoo</a>');
    expect(msg).toContain('<b><a href="tg://user?id=1">@simon2</a></b>');
    expect(msg).toContain('<a href="tg://user?id=1">Simo</a>'); // unchanged name: linked, not bold
    expect(msg).not.toContain('<b><a href="tg://user?id=1">Simo</a></b>');
  });

  it("both change: only the new values are linked and bold", () => {
    const msg = buildIdentityChangeMessage(5, { name: "Ana", username: "ana" }, { name: "Ana María", username: "ana_m" });
    expect(msg).toContain("Ana ("); // old name plain
    expect(msg).toContain("<code>@ana</code>"); // old username inert
    expect(msg).toContain('<b><a href="tg://user?id=5">Ana María</a></b>');
    expect(msg).toContain('<b><a href="tg://user?id=5">@ana_m</a></b>');
  });

  it("gained a username: no leftover placeholder, new side shows the linked @handle", () => {
    const msg = buildIdentityChangeMessage(9, { name: "Ana" }, { name: "Ana María", username: "ana_m" });
    expect(msg).not.toContain("(ninguno)");
    expect(msg).toContain('<a href="tg://user?id=9">@ana_m</a>');
  });
});

describe("trackIdentity", () => {
  const chatConfig = {
    chatId: -100111,
    logsTo: -100999,
    features: { trackNameChanges: true },
  } as unknown as IChat;
  const api = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as never;

  const rows = (...r: Record<string, unknown>[]): void => {
    vi.mocked(userRepository.findAllForUser).mockResolvedValue(r as never);
  };
  const otherChat = (trackNameChanges: boolean): void => {
    vi.mocked(chatRepository.findByChatId).mockResolvedValue({
      chatId: -100222,
      features: { trackNameChanges },
    } as never);
  };
  const dests = (): unknown[] =>
    (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    vi.mocked(userRepository.findAllForUser).mockReset();
    vi.mocked(userRepository.findAllForUser).mockResolvedValue([]);
    vi.mocked(userRepository.updateIdentity).mockClear();
    vi.mocked(userRepository.syncIdentityAcrossChats).mockClear();
    vi.mocked(chatRepository.findByChatId).mockReset();
    vi.mocked(chatRepository.findByChatId).mockResolvedValue(null);
    (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mockClear();
  });

  it("announces to the group AND the log channel on a change, then persists", async () => {
    rows({ userId: 42, chatId: -100111, name: "Simo", username: "simo" });

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).toContain(-100111); // group
    expect(dests()).toContain(-100999); // logsTo
    expect(userRepository.syncIdentityAcrossChats).toHaveBeenCalledWith(42, {
      name: "Simon",
      username: "simo",
    });
  });

  // Deleted accounts resolve to an empty name: announcing printed "Va (@vavabaa) → " and
  // persisting would have blanked the last good name we had for them.
  it("ignores a blank-name observation: no announcement, no write", async () => {
    rows({ userId: 42, chatId: -100111, name: "Va", username: "vavabaa" });

    await trackIdentity(api, chatConfig, 42, -100111, { name: "  ", username: undefined });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.syncIdentityAcrossChats).not.toHaveBeenCalled();
    expect(userRepository.updateIdentity).not.toHaveBeenCalled();
  });

  it("first sighting (no stored record) never announces, only persists — no notify loop", async () => {
    rows();

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simon" });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.updateIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simon");
  });

  // Finding #2: updating only the observing chat's row left the other chat stale, so the
  // same change was announced again days later from that chat's own rotation turn.
  it("persists to every row of the user, not just the observing chat's", async () => {
    rows(
      { userId: 42, chatId: -100111, name: "Simo", username: "simo" },
      { userId: 42, chatId: -100222, name: "Simo", username: "simo" }
    );
    otherChat(false);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    expect(userRepository.syncIdentityAcrossChats).toHaveBeenCalledWith(42, {
      name: "Simon",
      username: "simo",
    });
  });

  // Finding #4: the second chat's rows were stamped by the first chat's scan, so they never
  // came due and that chat never announced anything.
  it("announces in every tracking chat whose stored row is stale", async () => {
    rows(
      { userId: 42, chatId: -100111, name: "Simo", username: "simo" },
      { userId: 42, chatId: -100222, name: "Simo", username: "simo" }
    );
    otherChat(true);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).toContain(-100111);
    expect(dests()).toContain(-100222);
  });

  it("never announces in a chat the user has left", async () => {
    rows(
      { userId: 42, chatId: -100111, name: "Simo", username: "simo" },
      { userId: 42, chatId: -100222, name: "Simo", username: "simo", notMemberAt: new Date() }
    );
    otherChat(true);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).not.toContain(-100222);
  });

  // G16: each chat's own flag governs its notice — the observing chat's flag doesn't leak.
  it("stays silent in a chat that has trackNameChanges off", async () => {
    rows(
      { userId: 42, chatId: -100111, name: "Simo", username: "simo" },
      { userId: 42, chatId: -100222, name: "Simo", username: "simo" }
    );
    otherChat(false);

    await trackIdentity(api, chatConfig, 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).not.toContain(-100222);
    expect(dests()).toContain(-100111);
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
