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
  it("renders a single line: old/new as tap-to-profile links, id as tap-to-copy", () => {
    const msg = buildIdentityChangeMessage(7807562391, { nameChange: { from: "Simo", to: "Simon" } });
    expect(msg).toContain('<a href="tg://user?id=7807562391">Simo</a>');
    expect(msg).toContain('<a href="tg://user?id=7807562391">Simon</a>');
    expect(msg).toContain("<code>7807562391</code>");
    expect(msg).not.toContain("\n"); // one-liner — must not take vertical space
  });

  it("renders a username change with @handles", () => {
    const msg = buildIdentityChangeMessage(1, { usernameChange: { from: "simoo", to: "simon2" } });
    expect(msg).toContain("@simoo");
    expect(msg).toContain("@simon2");
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
