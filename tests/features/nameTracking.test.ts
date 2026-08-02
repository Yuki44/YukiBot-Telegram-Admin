import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/db/repositories/userRepository", () => ({
  userRepository: {
    findByUserAndChat: vi.fn(),
    findAllForUser: vi.fn(async () => []),
    confirmIdentity: vi.fn(async () => {}),
  },
}));
vi.mock("../../src/db/repositories/chatRepository", () => ({
  chatRepository: { listByChatIds: vi.fn(async () => []) },
}));
vi.mock("../../src/utils/activityLog", () => ({ recordActivity: vi.fn() }));

import {
  diffIdentity,
  buildIdentityChangeMessage,
  trackIdentity,
  trackIdentityEverywhere,
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

  // Seen in production: a name of soft hyphens printed "­­­ (@x) → ­­­", a notice with two
  // empty halves. It renders as nothing, so it must compare as nothing and show a placeholder.
  it("treats a name built from invisible characters as unreadable, not as content", () => {
    const invisible = "\u00AD\u00AD\u00AD";
    const filler = "\u3164\u115F";
    expect(diffIdentity({ name: invisible }, { name: filler })).toBeNull();
    expect(diffIdentity({ name: invisible }, { name: "Ana" })?.nameChange).toEqual({
      from: "(nombre invisible)",
      to: "Ana",
    });
    // The username still changes on its own, and that is what gets announced.
    expect(diffIdentity({ name: invisible, username: "licuadodefresas" }, { name: invisible })?.usernameChange).toEqual(
      { from: "licuadodefresas", to: undefined }
    );
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
  const config = (nameChangesVisible: boolean): IChat =>
    ({
      chatId: -100111,
      logsTo: -100999,
      features: { trackNameChanges: true, nameChangesVisible },
    }) as unknown as IChat;
  const api = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as never;

  const confirmed = new Date("2026-08-01T00:00:00Z");
  const row = (r: Record<string, unknown> | null): void => {
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(r as never);
  };
  const dests = (): unknown[] =>
    (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mock.calls.map((c) => c[0]);

  beforeEach(() => {
    vi.mocked(userRepository.findByUserAndChat).mockReset();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue(null as never);
    vi.mocked(userRepository.confirmIdentity).mockClear();
    (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mockClear();
  });

  it("sends only to the log channel while nameChangesVisible is off", async () => {
    row({ userId: 42, chatId: -100111, name: "Simo", username: "simo", identityConfirmedAt: confirmed });

    await trackIdentity(api, config(false), 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).toEqual([-100999]);
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simo");
  });

  it("adds the group once nameChangesVisible is on", async () => {
    row({ userId: 42, chatId: -100111, name: "Simo", username: "simo", identityConfirmedAt: confirmed });

    await trackIdentity(api, config(true), 42, -100111, { name: "Simon", username: "simo" });

    expect(dests()).toContain(-100111);
    expect(dests()).toContain(-100999);
  });

  // The incident: rows never verified against Telegram held a first-name-only leftover, so the
  // first honest reading looked like thousands of simultaneous renames.
  it("adopts the first confirmed reading silently, then announces the next change", async () => {
    row({ userId: 42, chatId: -100111, name: "Henry", username: "henry" });

    await trackIdentity(api, config(true), 42, -100111, { name: "Henry B", username: "henry" });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Henry B", "henry");

    row({ userId: 42, chatId: -100111, name: "Henry B", username: "henry", identityConfirmedAt: confirmed });
    await trackIdentity(api, config(true), 42, -100111, { name: "Henry C", username: "henry" });

    expect(dests()).toContain(-100111);
  });

  // Deleted accounts resolve to an empty name: announcing printed "Va (@vavabaa) → " and
  // persisting would have blanked the last good name we had for them.
  it("ignores a blank-name observation: no announcement, no write", async () => {
    row({ userId: 42, chatId: -100111, name: "Va", username: "vavabaa", identityConfirmedAt: confirmed });

    await trackIdentity(api, config(true), 42, -100111, { name: "  ", username: undefined });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.confirmIdentity).not.toHaveBeenCalled();
  });

  it("first sighting (no stored row) never announces, only persists — no notify loop", async () => {
    row(null);

    await trackIdentity(api, config(true), 42, -100111, { name: "Simon", username: "simon" });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simon");
  });

  // One profile edit used to fan out into every chat at once. Each chat now reports it once,
  // from its own observation, and touches nothing but its own row.
  it("reads and writes only the observing chat's row", async () => {
    row({ userId: 42, chatId: -100111, name: "Simo", username: "simo", identityConfirmedAt: confirmed });

    await trackIdentity(api, config(true), 42, -100111, { name: "Simon", username: "simo" });

    expect(userRepository.findByUserAndChat).toHaveBeenCalledWith(42, -100111);
    expect(userRepository.confirmIdentity).toHaveBeenCalledTimes(1);
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simo");
    expect(dests()).not.toContain(-100222);
  });

  // Refreshing the row is bookkeeping; only the notice belongs to the feature.
  it("persists without announcing when trackNameChanges is off", async () => {
    row({ userId: 42, chatId: -100111, name: "Simo", username: "simo", identityConfirmedAt: confirmed });
    const off = {
      chatId: -100111,
      logsTo: -100999,
      features: { trackNameChanges: false },
    } as unknown as IChat;

    await trackIdentity(api, off, 42, -100111, { name: "Simon", username: "simo" });

    expect((api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage).not.toHaveBeenCalled();
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simo");
  });

  // The rotation stamps lastBioCheckAt on every row of a user, so one read has to serve every
  // chat: confirming only the chat that came due left the others months behind.
  it("applies one observation to every chat the user belongs to, each against its own row", async () => {
    vi.mocked(userRepository.findAllForUser).mockResolvedValue([
      { userId: 42, chatId: -100111 },
      { userId: 42, chatId: -100222 },
    ] as never);
    vi.mocked(chatRepository.listByChatIds).mockResolvedValue([
      { chatId: -100111, logsTo: -100999, features: { trackNameChanges: true } },
      { chatId: -100222, logsTo: -100888, features: { trackNameChanges: false } },
    ] as never);
    vi.mocked(userRepository.findByUserAndChat).mockImplementation(
      async (userId: number, chatId: number) =>
        ({ userId, chatId, name: "Simo", username: "simo", identityConfirmedAt: confirmed }) as never
    );

    await trackIdentityEverywhere(api, 42, { name: "Simon", username: "simo" });

    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100111, "Simon", "simo");
    expect(userRepository.confirmIdentity).toHaveBeenCalledWith(42, -100222, "Simon", "simo");
    // Each chat still decides on its own flag (G16): only the tracking one announces.
    expect(dests()).toEqual([-100999]);
  });
  // The invisible-name case the admins saw: the notice must still say what actually changed.
  it("spells out a dropped @handle instead of silently losing the token", () => {
    const invisible = "\u00AD\u00AD\u00AD";
    const msg = buildIdentityChangeMessage(
      7946622105,
      { name: invisible, username: "licuadodefresas" },
      { name: invisible }
    );
    expect(msg).toContain("(nombre invisible)");
    expect(msg).toContain("<code>@licuadodefresas</code>");
    expect(msg).toContain("sin @usuario");
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
