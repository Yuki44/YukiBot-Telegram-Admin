import { Filter } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { sendLog, LogUser } from "../helpers/sendLog";
import { handleUserJoin } from "../helpers/handleJoin";
import { fullName } from "../helpers/fullName";
import { clearRecentWelcome } from "../helpers/welcomeTracker";
import { isKickInProgress, clearKick } from "../helpers/kickTracker";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";
import { trackIdentityFromTelegramUser } from "./nameChangeTracker";

type TgUserLike = { id: number; first_name: string; last_name?: string; username?: string };

/** Convert a Telegram User-shaped object to the shared LogUser shape. */
function toLogUser(u: TgUserLike): LogUser {
  return {
    id: u.id,
    name: fullName(u),
    username: u.username,
  };
}

/** `.catch` handler factory — keeps fire-and-forget DB calls one-liners (G9). */
const logErr = (action: string, userId: number, chatId: number) => (err: unknown) =>
  logger.error({ action, userId, chatId, error: String(err) });

export async function chatMemberHandler(ctx: Filter<BotContext, "chat_member">): Promise<void> {
  try {
    if (!ctx.chatConfig) return;
    const { old_chat_member: oldM, new_chat_member: newM, from } = ctx.chatMember;
    if (newM.user.is_bot) return;

    const userId = newM.user.id;
    const username = newM.user.username;
    const firstName = newM.user.first_name; // welcome-address fallback
    const chatId = ctx.chat.id;
    const chatName = ctx.chat.title ?? "Unknown";
    const target = toLogUser(newM.user);
    if (newM.status !== "left" && newM.status !== "kicked") {
      try {
        await trackIdentityFromTelegramUser(ctx, newM.user, chatId, "chat_member");
      } catch (err) {
        logger.error({ action: "chatMember_identity", chatId, userId, error: String(err) });
      }
    }

    // --- Admin demotion / promotion ---
    const wasAdmin = oldM.status === "administrator" || oldM.status === "creator";
    const isAdminNow = newM.status === "administrator" || newM.status === "creator";

    if (wasAdmin && !isAdminNow) {
      adminRepository.remove(userId, chatId).catch(logErr("chatMember_adminRemove", userId, chatId));
    }

    if (isAdminNow) {
      adminRepository
        .upsert({
          userId,
          username: username || "",
          name: target.name || "Unknown",
          chatId,
          chatName,
          role: newM.status === "creator" ? "owner" : "admin",
        })
        .catch(logErr("chatMember_adminUpsert", userId, chatId));

      userRepository
        .findOrCreate(userId, chatId, username, target.name)
        .catch(logErr("chatMember_userUpsert", userId, chatId));

      return;
    }

    // --- Banned / Kicked ---
    // Telegram's "kicked" covers both a permanent ban (`until_date === 0`) and a
    // temporary one that auto-expires (`until_date > 0`). We diverge on whether
    // to persist `wasBanned`, but the log+activity payload to mirror an external
    // admin's action is the same shape — only the action name changes.
    if (newM.status === "kicked") {
      clearRecentWelcome(chatId, userId); // re-entry should greet again
      if (isKickInProgress(chatId, userId)) return;

      const untilDate = (newM as { until_date?: number }).until_date ?? 0;
      const isPermanent = untilDate === 0;

      if (isPermanent) {
        try {
          await userRepository.upsert({
            userId,
            chatId,
            username,
            name: target.name,
            isBanned: true,
            wasBanned: true,
          });
        } catch (err) {
          logger.error({ action: "chatMember_banSync", userId, chatId, error: String(err) });
        }
      }

      // Mirror moderation done by *other* admins/bots into the log channel and
      // the queryable ActivityLog. YukiBot's own /bn, /kk, and 3-strike autoban
      // all set from=bot (and isKickInProgress short-circuits the kick path),
      // so we never double-log.
      if (from && from.id !== ctx.me.id) {
        const actor = toLogUser(from);
        sendLog(ctx.api, ctx.chatConfig, {
          action: isPermanent ? "BAN" : "KICK",
          actor,
          target,
          chatId,
          chatName,
          chatType: ctx.chatConfig.type,
        }).catch(() => {});
        recordActivity({
          chatId,
          type: isPermanent ? "ban" : "kick",
          source: "bot",
          actor,
          target,
        });
      }
      return;
    }

    // --- Left ---
    if (newM.status === "left") {
      clearRecentWelcome(chatId, userId); // re-entry should greet again
      if (oldM.status === "kicked") {
        clearKick(chatId, userId);
        return;
      }

      let existing;
      try {
        existing = await userRepository.findByUserAndChat(userId, chatId);
      } catch {
        /* silent — the kicked branch already finalised this case if relevant */
      }
      // A banned user's exit was already handled in the kicked branch; ignore
      // the follow-up "left" service update so we don't double-log.
      if (existing?.wasBanned) return;

      sendLog(ctx.api, ctx.chatConfig, {
        action: "SALIDA_USUARIO",
        target,
        chatId,
        chatName,
        chatType: ctx.chatConfig.type,
      }).catch(() => {});

      // Preserve warnings across exits — a re-entry stamps them as returning
      // warned. Otherwise drop the User row outright.
      if ((existing?.warnings ?? 0) > 0) {
        userRepository
          .upsert({ userId, chatId, leftWithWarningsAt: new Date() })
          .catch(logErr("chatMember_leftStamp", userId, chatId));
      } else {
        userRepository.remove(userId, chatId).catch(logErr("chatMember_userRemove", userId, chatId));
      }
      return;
    }

    // --- Joined ---
    // Only an actual out → in transition is a join. Telegram fires `chat_member`
    // for every status change, including ones that happen entirely inside the
    // chat (member ↔ restricted from /sil, /elsilav, etc., or an admin being
    // demoted to plain member). Without this gate those would fall through and
    // replay the welcome on every mute.
    const wasOut = oldM.status === "left" || oldM.status === "kicked";
    if (!wasOut) return;

    // handleUserJoin is shared with newChatMembersHandler: a re-banned user is
    // banned (autoBan), otherwise greeted exactly once. Return early on
    // auto-ban (no ENTRADA log for a re-banned user) and on findOrCreate
    // failure (already logged inside the helper).
    const outcome = await handleUserJoin(ctx.api, ctx.chatConfig, ctx.me.id, chatId, chatName, {
      id: userId,
      username,
      name: firstName,
      fullName: target.name,
    });
    if (!outcome.ok || outcome.autobanned) return;

    const actor = from && from.id !== userId ? toLogUser(from) : undefined;
    const inviteLink = (ctx.chatMember as unknown as Record<string, unknown>).invite_link as
      | { creator?: TgUserLike }
      | undefined;
    const inviter = inviteLink?.creator ? toLogUser(inviteLink.creator) : undefined;

    sendLog(ctx.api, ctx.chatConfig, {
      action: "ENTRADA_USUARIO",
      actor,
      target,
      chatId,
      chatName,
      chatType: ctx.chatConfig.type,
      inviter,
    }).catch(() => {});
  } catch (err) {
    logger.error({ action: "chatMemberHandler", error: String(err) });
  }
}
