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
vi.mock("../../src/db/repositories/identityObservationRepository", () => ({
  identityObservationRepository: { record: vi.fn(async () => {}), listByChat: vi.fn(async () => []) },
}));

import {
  diffIdentity,
  buildIdentityChangeMessage,
  trackIdentity,
  trackIdentityEverywhere,
} from "../../src/features/nameTracking";
import { userRepository } from "../../src/db/repositories/userRepository";
import { chatRepository } from "../../src/db/repositories/chatRepository";
import { identityObservationRepository } from "../../src/db/repositories/identityObservationRepository";
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
    expect(diffIdentity({ name: "Ana" }, { name: "Ana 🌸" })?.nameChange).toEqual({
      from: "Ana",
      to: "Ana 🌸",
    });
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
      from: "⬚",
      to: "Ana",
    });
    // The username still changes on its own, and that is what gets announced.
    expect(
      diffIdentity({ name: invisible, username: "licuadodefresas" }, { name: invisible })?.usernameChange
    ).toEqual({ from: "licuadodefresas", to: undefined });
  });

  // Production: "️h → ️" — the new name is a lone variation selector, which prints nothing.
  // Those code points must survive comparison (emoji need them) but never pass as a name.
  it("treats a name of variation selectors / ZWJ as unreadable without breaking emoji", () => {
    expect(diffIdentity({ name: "\uFE0Fh" }, { name: "\uFE0F" })?.nameChange).toEqual({
      from: "\uFE0Fh",
      to: "⬚",
    });
    expect(diffIdentity({ name: "\uFE0F" }, { name: "\u200D" })).toBeNull();
    expect(diffIdentity({ name: "❤️" }, { name: "❤️" })).toBeNull();
    expect(diffIdentity({ name: "👨‍👩‍👧" }, { name: "👨‍👩‍👧" })).toBeNull();
  });
});

describe("buildIdentityChangeMessage", () => {
  it("name change: old name plain, new name linked, unchanged username linked on both sides", () => {
    const msg = buildIdentityChangeMessage(
      7807562391,
      { name: "Simo", username: "simo" },
      { name: "Simon", username: "simo" }
    );
    expect(msg).toContain("ha actualizado su nombre");
    expect(msg).toContain("<code>7807562391</code>");
    expect(msg).not.toContain('<a href="https://t.me/simo">Simo</a>'); // old name: plain
    expect(msg).toContain('<b><a href="https://t.me/simo">Simon</a></b>'); // new name: linked + bold
    expect(msg).toContain('<a href="https://t.me/simo">@simo</a>'); // unchanged username: linked
    expect(msg).toContain("nombre:\n"); // the change starts on its own line
  });

  // A freed @handle can be re-registered by a stranger, and Telegram auto-links any bare
  // @handle in the text — so the replaced one keeps neither the @ nor a link.
  it("username change: old handle inert and @-less, new @handle linked and bold", () => {
    const msg = buildIdentityChangeMessage(
      1,
      { name: "Simo", username: "simoo" },
      { name: "Simo", username: "simon2" }
    );
    expect(msg).toContain("ha actualizado su usuario");
    expect(msg).toContain("<i>@\u2060simoo</i>");
    expect(msg).not.toContain("@simoo");
    expect(msg).toContain('<b><a href="https://t.me/simon2">@simon2</a></b>');
    expect(msg).toContain('<a href="https://t.me/simon2">Simo</a>'); // unchanged name: linked, not bold
    expect(msg).not.toContain('<b><a href="https://t.me/simon2">Simo</a></b>');
  });

  it("both change: only the new values are linked and bold", () => {
    const msg = buildIdentityChangeMessage(
      5,
      { name: "Ana", username: "ana" },
      { name: "Ana María", username: "ana_m" }
    );
    expect(msg).toContain("ha actualizado su perfil");
    expect(msg).toContain("Ana ("); // old name plain
    expect(msg).toContain("<i>@\u2060ana</i>"); // old username inert
    expect(msg).toContain('<b><a href="https://t.me/ana_m">Ana María</a></b>');
    expect(msg).toContain('<b><a href="https://t.me/ana_m">@ana_m</a></b>');
  });

  it("gained a username: old side shows (vacío), new side shows the linked @handle", () => {
    const msg = buildIdentityChangeMessage(9, { name: "Ana" }, { name: "Ana María", username: "ana_m" });
    expect(msg).toContain("(vacío)");
    expect(msg).toContain('<a href="https://t.me/ana_m">@ana_m</a>');
  });

  // tg://user?id= only resolves for peers the client already knows, so it is the fallback:
  // without a handle there is nothing better, with one the t.me link always works.
  it("falls back to tg://user?id= only when the user has no handle at all", () => {
    const msg = buildIdentityChangeMessage(8776230225, { name: "Kk" }, { name: "Kl" });
    expect(msg).toContain('<b><a href="tg://user?id=8776230225">Kl</a></b>');
    expect(msg).toContain("<code>8776230225</code>");
  });

  // Group copy: the pinging tg://user?id= link is withheld, the name stays bold. A user with a
  // handle keeps their silent https link, so mentionSafe changes nothing for them.
  it("mentionSafe drops the tg:// name link but keeps it bold", () => {
    const msg = buildIdentityChangeMessage(8776230225, { name: "Kk" }, { name: "Kl" }, { mentionSafe: true });
    expect(msg).not.toContain("tg://user?id=");
    expect(msg).toContain("<b>Kl</b>");
    expect(msg).toContain("<code>8776230225</code>");
  });

  it("mentionSafe leaves an @handle user's https link untouched", () => {
    const plain = buildIdentityChangeMessage(1, { name: "Simo", username: "simo" }, { name: "Simon", username: "simo" });
    const safe = buildIdentityChangeMessage(
      1,
      { name: "Simo", username: "simo" },
      { name: "Simon", username: "simo" },
      { mentionSafe: true }
    );
    expect(safe).toBe(plain);
    expect(safe).toContain('<a href="https://t.me/simo">Simon</a>');
  });

  // Both halves said "(nombre invisible)" while the only real news was the handle.
  it("drops an unreadable name entirely when only the handle moved", () => {
    const invisible = "\u00AD\u00AD\u00AD";
    const msg = buildIdentityChangeMessage(
      7946622105,
      { name: invisible, username: "licuadodefresas" },
      { name: invisible, username: "otro" }
    );
    expect(msg).not.toContain("⬚");
    expect(msg).toContain("ha actualizado su usuario");
    expect(msg).toContain("<i>@\u2060licuadodefresas</i>");
    expect(msg).toContain('<b><a href="https://t.me/otro">@otro</a></b>');
  });

  it("handle-only notice spells out a removed handle without a bare @", () => {
    const invisible = "\u00AD";
    const msg = buildIdentityChangeMessage(
      1,
      { name: invisible, username: "licuadodefresas" },
      { name: invisible }
    );
    expect(msg).toContain("ha actualizado su usuario");
    expect(msg).toContain("<b>vacío</b>");
    expect(msg).not.toContain("@usuario");
  });
});

describe("identity observation trail", () => {
  const chat = (identityObservations: boolean): IChat =>
    ({
      chatId: -100111,
      logsTo: -100999,
      features: { trackNameChanges: true, identityObservations },
    }) as unknown as IChat;
  const api = { sendMessage: vi.fn(async () => ({ message_id: 1 })) } as never;
  const confirmed = new Date("2026-08-01T00:00:00Z");
  const record = (): ReturnType<typeof vi.mocked<typeof identityObservationRepository.record>> =>
    vi.mocked(identityObservationRepository.record);

  beforeEach(() => {
    record().mockClear();
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      userId: 42,
      chatId: -100111,
      name: "Simo",
      username: "simo",
      identityConfirmedAt: confirmed,
    } as never);
  });

  it("records nothing while its own flag is off (G16: diagnostics never ride on another flag)", async () => {
    await trackIdentity(api, chat(false), 42, -100111, { name: "Simon", username: "simo" }, "message");
    expect(record()).not.toHaveBeenCalled();
  });

  it("records the announced change with its source", async () => {
    await trackIdentity(api, chat(true), 42, -100111, { name: "Simon", username: "simo" }, "bio_rotation");
    expect(record()).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        chatId: -100111,
        source: "bio_rotation",
        outcome: "announced",
        storedName: "Simo",
        observedName: "Simon",
      })
    );
  });

  // The two ways a change goes unannounced — this is what the trail exists to tell apart.
  it("distinguishes a silent baseline adoption from an unreadable observation", async () => {
    vi.mocked(userRepository.findByUserAndChat).mockResolvedValue({
      userId: 42,
      chatId: -100111,
      name: "Simo",
      username: "simo",
    } as never);
    await trackIdentity(api, chat(true), 42, -100111, { name: "Simon", username: "simo" }, "message");
    expect(record()).toHaveBeenCalledWith(expect.objectContaining({ outcome: "baseline_adopted" }));

    record().mockClear();
    await trackIdentity(api, chat(true), 42, -100111, { name: "  " }, "presence_probe");
    expect(record()).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "blank_skipped", source: "presence_probe" })
    );
  });

  it("records a reading that matched, so 'never seen' is not confused with 'seen and equal'", async () => {
    await trackIdentity(api, chat(true), 42, -100111, { name: "Simo", username: "simo" }, "message");
    expect(record()).toHaveBeenCalledWith(expect.objectContaining({ outcome: "no_diff" }));
  });

  it("marks a confirmed change as notice_disabled when trackNameChanges is off", async () => {
    const muted = {
      chatId: -100111,
      logsTo: -100999,
      features: { trackNameChanges: false, identityObservations: true },
    } as unknown as IChat;
    await trackIdentity(api, muted, 42, -100111, { name: "Simon", username: "simo" }, "message");
    expect(record()).toHaveBeenCalledWith(expect.objectContaining({ outcome: "notice_disabled" }));
  });
});

describe("trackIdentity", () => {
  const config = (nameChangesVisible: boolean): IChat =>
    ({
      chatId: -100111,
      logsTo: -100999,
      features: { trackNameChanges: true, nameChangesVisible },
    }) as unknown as IChat;
  const api = {
    sendMessage: vi.fn(async () => ({ message_id: 77 })),
    editMessageText: vi.fn(async () => ({ message_id: 77 })),
  } as never;

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
    (api as { editMessageText: ReturnType<typeof vi.fn> }).editMessageText.mockClear();
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

  // Ninja-edit: a username-less user's group notice is posted mention-free (bold, no tg:// link),
  // then the profile link is edited in — the edit carries the mention without pinging.
  it("posts the group copy mention-free then edits the tg:// link in, for a handle-less user", async () => {
    row({ userId: 42, chatId: -100111, name: "Kk", identityConfirmedAt: confirmed });
    const send = (api as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage;
    const edit = (api as { editMessageText: ReturnType<typeof vi.fn> }).editMessageText;

    await trackIdentity(api, config(true), 42, -100111, { name: "Kl" });

    const groupSend = send.mock.calls.find((c) => c[0] === -100111)!;
    expect(groupSend[1]).not.toContain("tg://user?id=");
    expect(groupSend[1]).toContain("<b>Kl</b>");

    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toBe(-100111);
    expect(edit.mock.calls[0][1]).toBe(77);
    expect(edit.mock.calls[0][2]).toContain('<a href="tg://user?id=42">Kl</a>');

    // The log channel keeps the full tg:// link in a single send — no edit dance there.
    const logSend = send.mock.calls.find((c) => c[0] === -100999)!;
    expect(logSend[1]).toContain('<a href="tg://user?id=42">Kl</a>');
  });

  // A user with a handle needs no trick: the https link is silent, so one send, no edit.
  it("does not edit when the user has a handle (https link never pings)", async () => {
    row({ userId: 42, chatId: -100111, name: "Simo", username: "simo", identityConfirmedAt: confirmed });
    const edit = (api as { editMessageText: ReturnType<typeof vi.fn> }).editMessageText;

    await trackIdentity(api, config(true), 42, -100111, { name: "Simon", username: "simo" });

    expect(edit).not.toHaveBeenCalled();
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
  // The invisible-name case the admins saw: the notice must still say what actually changed,
  // and with an unreadable name it is now the handle alone that carries it.
  it("spells out a dropped handle instead of silently losing the token", () => {
    const invisible = "\u00AD\u00AD\u00AD";
    const msg = buildIdentityChangeMessage(
      7946622105,
      { name: invisible, username: "licuadodefresas" },
      { name: invisible }
    );
    expect(msg).not.toContain("⬚");
    expect(msg).toContain("<i>@\u2060licuadodefresas</i>");
    expect(msg).toContain("vacío");
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
