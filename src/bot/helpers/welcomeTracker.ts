import { WELCOME_DEDUP_TTL_MS } from "../../config/constants";

/**
 * Short-lived, in-memory "this user was just welcomed" guard.
 *
 * The welcome is meant to fire on *every* entry to the group — a user who
 * leaves and comes back should be greeted again. So we deliberately do NOT
 * persist a once-ever flag. The only thing we must suppress is a double
 * greeting for the *same* entry, which happens because one join produces up to
 * two updates (`chat_member` + `new_chat_members`) within the same moment, and
 * Telegram can redeliver an unconfirmed update. A small TTL window keyed by
 * (chatId, userId) collapses exactly those into a single greeting while leaving
 * any later re-entry free to greet again.
 *
 * `claimRecentWelcome` is fully synchronous (check-then-set with no `await`
 * between), so under N concurrent joins for the same user exactly one caller
 * gets `true` — the JS event loop guarantees the atomicity a DB conditional
 * update used to provide.
 */
const recent = new Set<string>();

function key(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

/** Returns true for the first caller within the TTL window; false thereafter. */
export function claimRecentWelcome(chatId: number, userId: number): boolean {
  const k = key(chatId, userId);
  if (recent.has(k)) return false;
  recent.add(k);
  const t = setTimeout(() => recent.delete(k), WELCOME_DEDUP_TTL_MS);
  // Don't keep the process (or a test run) alive just for this timer.
  t.unref?.();
  return true;
}

/**
 * Drop the guard immediately. Called when the welcome send failed (so the next
 * update can retry) and when the user is observed leaving/kicked (so an
 * immediate, detected re-entry is greeted without waiting out the TTL).
 */
export function clearRecentWelcome(chatId: number, userId: number): void {
  recent.delete(key(chatId, userId));
}

/**
 * Separate guard for the auto-ban path. A re-banned user's single re-entry
 * also arrives on both `chat_member` and `new_chat_members` (plus possible
 * redelivery), and without this guard each trigger would ban, announce, and
 * log the same auto-ban — the duplicate "baneado" notice and double #AUTO_BAN
 * log entry users reported.
 *
 * It is deliberately NOT the welcome guard: `chatMemberHandler` clears the
 * welcome guard the instant it sees the user leave/kick, and the auto-ban
 * itself produces exactly such a `kicked` update — that would re-open the
 * window and let the second trigger ban again. A returning banned user is
 * rejected by Telegram anyway, so a plain time window that nothing clears
 * early is both sufficient and correct.
 */
const recentAutoban = new Set<string>();

/** Returns true for the first auto-ban caller within the TTL window. */
export function claimRecentAutoban(chatId: number, userId: number): boolean {
  const k = key(chatId, userId);
  if (recentAutoban.has(k)) return false;
  recentAutoban.add(k);
  const t = setTimeout(() => recentAutoban.delete(k), WELCOME_DEDUP_TTL_MS);
  t.unref?.();
  return true;
}

/** Test-only: wipe all state between cases. */
export function resetWelcomeTracker(): void {
  recent.clear();
  recentAutoban.clear();
}
