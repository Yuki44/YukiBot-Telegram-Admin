import { Filter } from "grammy";
import { BotContext } from "../../types";
import { userRepository } from "../../db/repositories/userRepository";
import { adminRepository } from "../../db/repositories/adminRepository";
import { sendLog, LogUser } from "../helpers/sendLog";
import { isKickInProgress, clearKick } from "../helpers/kickTracker";
import { logger } from "../../utils/logger";
import { recordActivity } from "../../utils/activityLog";

export async function chatMemberHandler(ctx: Filter<BotContext, "chat_member">): Promise<void> {
  try {
    const { old_chat_member, new_chat_member } = ctx.chatMember;
    const { status, user } = new_chat_member;
    const oldStatus = old_chat_member.status;

    if (user.is_bot) return;
    if (!ctx.chatConfig) return;

    const userId = user.id;
    const username = user.username;
    const name = user.first_name;
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const chatId = ctx.chat.id;
    const chatName = ctx.chat.title ?? "Unknown";

    const target: LogUser = { id: userId, name: fullName, username };

    // --- Admin demotion ---
    const wasAdmin = oldStatus === "administrator" || oldStatus === "creator";
    const isAdminNow = status === "administrator" || status === "creator";

    if (wasAdmin && !isAdminNow) {
      adminRepository
        .remove(userId, chatId)
        .catch((err) =>
          logger.error({ action: "chatMember_adminRemove", userId, chatId, error: String(err) })
        );
    }

    // --- Admin promotion ---
    if (isAdminNow) {
      adminRepository
        .upsert({
          userId,
          username: username || "",
          name: fullName || "Unknown",
          chatId,
          chatName,
          role: status === "creator" ? "owner" : "admin",
        })
        .catch((err) =>
          logger.error({ action: "chatMember_adminUpsert", userId, chatId, error: String(err) })
        );

      userRepository
        .findOrCreate(userId, chatId, username, name)
        .catch((err) =>
          logger.error({ action: "chatMember_userUpsert", userId, chatId, error: String(err) })
        );
      void userRepository.syncIdentityAcrossChats(userId, {
        name: fullName || undefined,
        username: username ?? null,
      });
      return;
    }

    // --- Banned / Kicked ---
    if (status === "kicked") {
      if (isKickInProgress(chatId, userId)) return;

      const from = ctx.chatMember.from;
      const untilDate: number = (new_chat_member as { until_date?: number }).until_date ?? 0;

      if (untilDate > 0) {
        if (from && from.id !== ctx.me.id) {
          const actor: LogUser = {
            id: from.id,
            name: [from.first_name, from.last_name].filter(Boolean).join(" "),
            username: from.username,
          };
          sendLog(ctx.api, ctx.chatConfig, {
            action: "KICK",
            actor,
            target,
            chatId,
            chatName,
            chatType: ctx.chatConfig.type,
          }).catch(() => {});
          // Mirror into the queryable ActivityLog so the dashboard Registro reflects
          // kicks done by other admins/bots too — not only YukiBot's own /kk. The
          // `from !== me` guard means YukiBot command paths (which set from=bot, plus
          // the isKickInProgress short-circuit) never reach here, so no double entry.
          recordActivity({
            chatId,
            type: "kick",
            source: "bot",
            actor,
            target,
          });
        }
        return;
      }

      try {
        await userRepository.upsert({ userId, chatId, username, name, isBanned: true, wasBanned: true });
      } catch (err) {
        logger.error({ action: "chatMember_banSync", userId, chatId, error: String(err) });
      }

      if (from && from.id !== ctx.me.id) {
        const actor: LogUser = {
          id: from.id,
          name: [from.first_name, from.last_name].filter(Boolean).join(" "),
          username: from.username,
        };
        sendLog(ctx.api, ctx.chatConfig, {
          action: "BAN",
          actor,
          target,
          chatId,
          chatName,
          chatType: ctx.chatConfig.type,
        }).catch(() => {});
        // Mirror into the queryable ActivityLog so the Registro shows bans done by
        // other admins/bots too. YukiBot's own /bn and 3-strike autoban set
        // from=bot, so they're excluded here and recorded by their own paths.
        recordActivity({
          chatId,
          type: "ban",
          source: "bot",
          actor,
          target,
        });
      }
      return;
    }

    // --- Left ---
    if (status === "left") {
      if (oldStatus === "kicked") {
        clearKick(chatId, userId);
        return;
      }

      let existingUser;
      try {
        existingUser = await userRepository.findByUserAndChat(userId, chatId);
      } catch {
        /* silent */
      }

      if (existingUser?.wasBanned) return;

      if ((existingUser?.warnings ?? 0) > 0) {
        userRepository
          .upsert({ userId, chatId, leftWithWarningsAt: new Date() })
          .catch((err) =>
            logger.error({ action: "chatMember_leftStamp", userId, chatId, error: String(err) })
          );
        sendLog(ctx.api, ctx.chatConfig, {
          action: "SALIDA_USUARIO",
          target,
          chatId,
          chatName,
          chatType: ctx.chatConfig.type,
        }).catch(() => {});
        return;
      }

      sendLog(ctx.api, ctx.chatConfig, {
        action: "SALIDA_USUARIO",
        target,
        chatId,
        chatName,
        chatType: ctx.chatConfig.type,
      }).catch(() => {});
      userRepository
        .remove(userId, chatId)
        .catch((err) =>
          logger.error({ action: "chatMember_userRemove", userId, chatId, error: String(err) })
        );
      return;
    }

    // --- Joined ---
    let record;
    try {
      record = await userRepository.findOrCreate(userId, chatId, username, name);
    } catch (err) {
      logger.error({ action: "chatMember_findOrCreate", userId, chatId, error: String(err) });
      return;
    }

    if (record.leftWithWarningsAt && !record.wasBanned) {
      userRepository
        .clearLeftDate(userId, chatId)
        .catch((err) => logger.error({ action: "chatMember_clearLeft", userId, chatId, error: String(err) }));
    }

    if (ctx.chatConfig.features.autoBan && record.wasBanned) {
      try {
        await ctx.api.banChatMember(chatId, userId);
        await ctx.api.sendMessage(chatId, `🚫 @${username ?? userId} baneado.`);
      } catch (err) {
        logger.error({ action: "chatMember_autoReban", userId, chatId, error: String(err) });
      }
      sendLog(ctx.api, ctx.chatConfig, {
        action: "AUTO_BAN",
        target,
        chatId,
        chatName,
        chatType: ctx.chatConfig.type,
      }).catch(() => {});
      recordActivity({
        chatId,
        type: "autoban",
        source: "auto",
        actor: { id: ctx.me.id, name: "YukiBot" },
        target: { id: userId, name: target.name, username: target.username },
        reason: "wasBanned=true al reentrar",
      });
      return;
    }

    const wasOut = oldStatus === "left" || oldStatus === "kicked";
    if (wasOut) {
      const from = ctx.chatMember.from;
      const actor: LogUser | undefined =
        from && from.id !== userId
          ? {
              id: from.id,
              name: [from.first_name, from.last_name].filter(Boolean).join(" "),
              username: from.username,
            }
          : undefined;

      let inviter: LogUser | undefined;
      const inviteLink = (ctx.chatMember as unknown as Record<string, unknown>).invite_link as
        | { creator?: { id: number; first_name: string; last_name?: string; username?: string } }
        | undefined;
      if (inviteLink?.creator) {
        const c = inviteLink.creator;
        inviter = {
          id: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" "),
          username: c.username,
        };
      }

      sendLog(ctx.api, ctx.chatConfig, {
        action: "ENTRADA_USUARIO",
        actor,
        target,
        chatId,
        chatName,
        chatType: ctx.chatConfig.type,
        inviter,
      }).catch(() => {});
    }
  } catch (err) {
    logger.error({ action: "chatMemberHandler", error: String(err) });
  }
}
