import { IdentityObservation } from "../models/IdentityObservation";
import { IdentityObservationInput } from "../../types";
import { logger } from "../../utils/logger";

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export const identityObservationRepository = {
  /** Diagnostics must never cost a notice, so writes swallow their own failures. */
  async record(obs: IdentityObservationInput): Promise<void> {
    try {
      const now = new Date();
      if (obs.outcome === "no_diff") {
        await IdentityObservation.updateOne(
          {
            userId: obs.userId,
            chatId: obs.chatId,
            source: obs.source,
            day: dayKey(now),
            outcome: "no_diff",
          },
          {
            $setOnInsert: { createdAt: now },
            $set: {
              lastSeenAt: now,
              observedName: obs.observedName,
              observedUsername: obs.observedUsername,
              storedName: obs.storedName,
              storedUsername: obs.storedUsername,
            },
            $inc: { count: 1 },
          },
          { upsert: true }
        );
        return;
      }
      await IdentityObservation.create({ ...obs, day: dayKey(now), createdAt: now, lastSeenAt: now });
    } catch (err) {
      logger.error({ action: "identity_observation_record", userId: obs.userId, error: String(err) });
    }
  },

  async listByChat(chatId: number, since: Date): Promise<IdentityObservationInput[]> {
    try {
      return await IdentityObservation.find({ chatId, createdAt: { $gte: since } })
        .sort({ createdAt: 1 })
        .lean();
    } catch (err) {
      logger.error({ action: "identity_observation_list", chatId, error: String(err) });
      return [];
    }
  },

  /** Users with at least one reading — diff against the chat's User rows to find the blind spots. */
  async observedUserIds(chatId: number, since: Date): Promise<number[]> {
    try {
      return await IdentityObservation.distinct("userId", { chatId, createdAt: { $gte: since } });
    } catch (err) {
      logger.error({ action: "identity_observation_users", chatId, error: String(err) });
      return [];
    }
  },
};
