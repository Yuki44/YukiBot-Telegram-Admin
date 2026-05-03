import { ActivityLog } from "../models/ActivityLog";
import { IActivityLog, ActivityLogType } from "../../types";

export interface ActivityLogQuery {
  type?: ActivityLogType | ActivityLogType[];
  /** Cursor — return entries strictly older than this Date. */
  before?: Date;
  /** Free-text search across actor/target/targetRef/reason. */
  q?: string;
  limit?: number;
}

export const activityLogRepository = {
  async create(entry: Partial<IActivityLog>): Promise<IActivityLog> {
    return await ActivityLog.create(entry);
  },

  async listByChat(chatId: number, opts: ActivityLogQuery = {}): Promise<IActivityLog[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const query: Record<string, unknown> = { chatId };
    if (opts.type) {
      query.type = Array.isArray(opts.type) ? { $in: opts.type } : opts.type;
    }
    if (opts.before) {
      query.timestamp = { $lt: opts.before };
    }
    if (opts.q) {
      const escaped = opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      query.$or = [
        { actorName: rx },
        { actorUsername: rx },
        { targetName: rx },
        { targetUsername: rx },
        { targetRef: rx },
        { reason: rx },
        { messageText: rx },
      ];
    }

    return await ActivityLog.find(query).sort({ timestamp: -1 }).limit(limit);
  },
};
