import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../../src/features/nameTracking", () => ({
  trackIdentity: vi.fn(async () => false),
  trackIdentityEverywhere: vi.fn(async () => {}),
}));

import { nameChangeTracker } from "../../src/bot/handlers/nameChangeTracker";
import { trackIdentity, trackIdentityEverywhere } from "../../src/features/nameTracking";
import { BotContext } from "../../src/types";

const next = vi.fn(async () => {});

function ctx(features: Record<string, boolean>): BotContext {
  return {
    api: {},
    chatConfig: { chatId: -100111, features },
    message: {
      message_id: 5,
      chat: { id: -100111 },
      from: { id: 42, is_bot: false, first_name: "Simon", last_name: "B", username: "simon" },
    },
  } as unknown as BotContext;
}

beforeEach(() => vi.clearAllMocks());

describe("nameChangeTracker gate (G16/G18)", () => {
  it("tracks when trackNameChanges is on, whatever the visibility modifier says", async () => {
    await nameChangeTracker(ctx({ trackNameChanges: true, nameChangesVisible: false }), next);

    expect(trackIdentity).toHaveBeenCalledWith(expect.anything(), expect.anything(), 42, -100111, {
      name: "Simon B",
      username: "simon",
    });
    expect(next).toHaveBeenCalled();
  });

  // Refreshing the stored identity is membership bookkeeping every chat already did through
  // trackUser; only the notice is the feature, and trackIdentity is what gates it on the flag.
  it("still refreshes the identity when trackNameChanges is off", async () => {
    await nameChangeTracker(ctx({ trackNameChanges: false, nameChangesVisible: true }), next);

    expect(trackIdentity).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe("cross-chat propagation", () => {
  it("propagates a detected change to the user's other chats, skipping this one", async () => {
    vi.mocked(trackIdentity).mockResolvedValueOnce(true);

    await nameChangeTracker(ctx({ trackNameChanges: true }), next);

    expect(trackIdentityEverywhere).toHaveBeenCalledWith(
      expect.anything(),
      42,
      { name: "Simon B", username: "simon" },
      -100111
    );
  });

  it("spends nothing on other chats when the identity is unchanged", async () => {
    vi.mocked(trackIdentity).mockResolvedValueOnce(false);

    await nameChangeTracker(ctx({ trackNameChanges: true }), next);

    expect(trackIdentityEverywhere).not.toHaveBeenCalled();
  });
});
