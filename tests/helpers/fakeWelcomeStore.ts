import { vi } from "vitest";

/**
 * In-memory stand-in for the `User` Mongoose model's `updateOne`, used to prove
 * the welcome claim is exactly-once under concurrency. The read-check-write is
 * synchronous (no `await` inside the critical section) so — exactly like a
 * single-document update in MongoDB — only one of N concurrent callers can flip
 * `welcomedAt` from absent to set. An optional jitter `await` BEFORE the
 * critical section interleaves callers without breaking that guarantee (JS is
 * single-threaded, so each resumed caller runs its check-write to completion
 * atomically).
 */
export interface FakeUserModel {
  store: Map<string, { welcomedAt?: Date }>;
  updateOne: ReturnType<typeof vi.fn>;
}

function key(userId: number, chatId: number): string {
  return `${userId}:${chatId}`;
}

export function makeFakeUserModel(
  seed: Array<{ userId: number; chatId: number; welcomedAt?: Date }> = [],
  opts: { jitter?: boolean } = {}
): FakeUserModel {
  const store = new Map<string, { welcomedAt?: Date }>();
  for (const s of seed) {
    store.set(key(s.userId, s.chatId), s.welcomedAt ? { welcomedAt: s.welcomedAt } : {});
  }

  const updateOne = vi.fn(
    async (
      filter: { userId: number; chatId: number; welcomedAt?: { $exists: boolean } },
      update: { $set?: { welcomedAt?: Date }; $unset?: { welcomedAt?: string } }
    ) => {
      if (opts.jitter) {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
      }
      // ---- critical section: synchronous, no await below ----
      const k = key(filter.userId, filter.chatId);
      const entry = store.get(k);

      if (update.$set && "welcomedAt" in update.$set) {
        const requiresUnset = filter.welcomedAt?.$exists === false;
        if (!entry) return { matchedCount: 0, modifiedCount: 0 };
        if (requiresUnset && entry.welcomedAt !== undefined) {
          return { matchedCount: 1, modifiedCount: 0 };
        }
        entry.welcomedAt = update.$set.welcomedAt;
        return { matchedCount: 1, modifiedCount: 1 };
      }

      if (update.$unset && "welcomedAt" in update.$unset) {
        if (!entry) return { matchedCount: 0, modifiedCount: 0 };
        const had = entry.welcomedAt !== undefined;
        delete entry.welcomedAt;
        return { matchedCount: 1, modifiedCount: had ? 1 : 0 };
      }

      return { matchedCount: 0, modifiedCount: 0 };
    }
  );

  return { store, updateOne };
}
