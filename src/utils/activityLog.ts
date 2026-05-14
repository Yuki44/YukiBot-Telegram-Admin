import { activityLogRepository } from "../db/repositories/activityLogRepository";
import { ActivityLogType, ActivityLogSource, IActivityLog } from "../types";
import { logger } from "./logger";

export interface ActivityActor {
  id: number;
  name?: string;
  username?: string;
}

export interface ActivityTarget {
  id: number;
  name?: string;
  username?: string;
}

export interface RecordActivityArgs {
  chatId: number;
  type: ActivityLogType;
  source: ActivityLogSource;
  /** When undefined, the entry is silently skipped — actor is required by the schema. */
  actor: ActivityActor | undefined;
  target?: ActivityTarget;
  targetRef?: string;
  reason?: string;
  topicId?: number;
  warningsAfter?: number;
  messageText?: string;
}

/**
 * Fire-and-forget activity log writer.
 *
 * Wraps `activityLogRepository.create` in a try/catch so that callers (bot commands and
 * Express routes alike) cannot break their own flow because of a transient Mongo issue.
 *
 * Errors are logged via the structured `logger`, never thrown, never sent to the group (G10).
 *
 * Design note: this records to the *queryable* ActivityLog collection used by the dashboard.
 * The bot's existing `sendLog` (which posts to chatConfig.logsTo on Telegram) continues
 * unchanged — both run in parallel.
 */
export function recordActivity(args: RecordActivityArgs): void {
  if (!args.actor) {
    logger.warn({ action: "activityLog.skipped_missing_actor", type: args.type, chatId: args.chatId });
    return;
  }

  const entry: Partial<IActivityLog> = {
    chatId: args.chatId,
    type: args.type,
    source: args.source,
    actorId: args.actor.id,
    actorName: args.actor.name,
    actorUsername: args.actor.username,
    targetId: args.target?.id,
    targetName: args.target?.name,
    targetUsername: args.target?.username,
    targetRef: args.targetRef,
    reason: args.reason,
    topicId: args.topicId,
    warningsAfter: args.warningsAfter,
    messageText: args.messageText ? args.messageText.slice(0, 500) : undefined,
  };

  activityLogRepository.create(entry).catch((err) => {
    logger.error({
      action: "activityLog.write_failed",
      type: args.type,
      chatId: args.chatId,
      error: String(err),
    });
  });
}
