import { Api } from "grammy";
import { IChat } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { sendLog, LogUser } from "./sendLog";
import { sendWelcome } from "./sendWelcome";
import { claimRecentWelcome, clearRecentWelcome } from "./welcomeTracker";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

export interface JoinUser {
  id: number;
  username?: string;
  /** First name (used as the welcome fallback when there's no @username). */
  name?: string;
  /** "First Last" — used for logs/activity records. */
  fullName: string;
}

export interface JoinOutcome {
  /** false when findOrCreate failed (already logged). */
  ok: boolean;
  /** true when the user was a previously-banned re-entrant and got auto-banned. */
  autobanned: boolean;
}

/**
 * The shared "a user is now in the chat" path: re-ban a returning banned user
 * (when `autoBan` is on) or, failing that, greet them once with the configured
 * welcome message.
 *
 * Extracted so it can run from BOTH triggers a join can arrive on:
 *  - `chat_member` — delivered only to *admin* bots; the only signal for a
 *    self-join via public link in a supergroup.
 *  - `message:new_chat_members` — the "X joined" service message, delivered
 *    even when the bot is not an admin and the canonical signal when a user is
 *    *added* by someone else.
 *
 * Relying on `chat_member` alone meant neither welcome nor auto-ban fired for
 * the added-user case (and not at all when the bot lacked admin). Running the
 * same logic from both triggers closes that gap. The short-window
 * `claimRecentWelcome` guard makes the overlap safe — a single entry yields one
 * greeting even when both updates arrive — while still greeting the user again
 * on any later re-entry. Re-banning an already-banned user is harmless.
 */
export async function handleUserJoin(
  api: Api,
  chatConfig: IChat,
  meId: number,
  chatId: number,
  chatName: string,
  user: JoinUser
): Promise<JoinOutcome> {
  const { id: userId, username } = user;
  const name = user.name;
  const target: LogUser = { id: userId, name: user.fullName, username };

  let record;
  try {
    record = await userRepository.findOrCreate(userId, chatId, username, name);
  } catch (err) {
    logger.error({ action: "handleUserJoin_findOrCreate", userId, chatId, error: String(err) });
    return { ok: false, autobanned: false };
  }

  if (record.leftWithWarningsAt && !record.wasBanned) {
    userRepository
      .clearLeftDate(userId, chatId)
      .catch((err) =>
        logger.error({ action: "handleUserJoin_clearLeft", userId, chatId, error: String(err) })
      );
  }

  if (chatConfig.features.autoBan && record.wasBanned) {
    try {
      await api.banChatMember(chatId, userId);
      await api.sendMessage(chatId, `🚫 @${username ?? userId} baneado.`);
    } catch (err) {
      logger.error({ action: "handleUserJoin_autoReban", userId, chatId, error: String(err) });
    }
    sendLog(api, chatConfig, {
      action: "AUTO_BAN",
      target,
      chatId,
      chatName,
      chatType: chatConfig.type,
    }).catch(() => {});
    recordActivity({
      chatId,
      type: "autoban",
      source: "auto",
      actor: { id: meId, name: "YukiBot" },
      target: { id: userId, name: target.name, username: target.username },
      reason: "wasBanned=true al reentrar",
    });
    return { ok: true, autobanned: true };
  }

  // --- Welcome message ---
  // claimRecentWelcome is an atomic per-(chat,user) guard over a short window:
  // under concurrent joins (Telegram update redelivery, or the chat_member +
  // new_chat_members overlap for one entry) exactly one caller wins and sends,
  // while a genuine later re-entry greets again. Skip entirely when nothing is
  // configured so a later configured join can still welcome. On send failure we
  // drop the claim so the next update retries (a transient 429 must not suppress
  // the greeting for this entry).
  const welcome = chatConfig.welcome;
  if (chatConfig.features.welcomeMessage && welcome && welcome.message.trim().length > 0) {
    try {
      if (claimRecentWelcome(chatId, userId)) {
        const ok = await sendWelcome(
          api,
          chatId,
          welcome,
          { id: userId, username, name: name || user.fullName || String(userId) },
          chatName
        );
        if (!ok) clearRecentWelcome(chatId, userId);
      }
    } catch (err) {
      logger.error({ action: "handleUserJoin_welcome", userId, chatId, error: String(err) });
    }
  }

  return { ok: true, autobanned: false };
}
