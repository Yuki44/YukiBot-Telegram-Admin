import { Schema, model } from "mongoose";
import { IIdentityObservation, IDENTITY_SOURCES, IDENTITY_OUTCOMES } from "../../types";
import { IDENTITY_OBSERVATION_TTL_S } from "../../config/constants";

/** TTL'd diagnostic trail: it is evidence for missed changes, not state. */
const schema = new Schema<IIdentityObservation>({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  source: {
    type: String,
    enum: [...IDENTITY_SOURCES],
    required: true,
  },
  outcome: {
    type: String,
    enum: [...IDENTITY_OUTCOMES],
    required: true,
  },
  storedName: { type: String },
  storedUsername: { type: String },
  observedName: { type: String },
  observedUsername: { type: String },
  /** Only > 1 for the deduplicated `no_diff` rows (one per user/chat/source/day). */ count: {
    type: Number,
    default: 1,
  },
  day: { type: String },
  createdAt: { type: Date, default: () => new Date() },
  lastSeenAt: { type: Date, default: () => new Date() },
});

schema.index({ createdAt: 1 }, { expireAfterSeconds: IDENTITY_OBSERVATION_TTL_S });
schema.index({ chatId: 1, createdAt: -1 });
schema.index({ chatId: 1, outcome: 1, createdAt: -1 });
schema.index({ userId: 1, chatId: 1, source: 1, day: 1 }, { sparse: true });

export const IdentityObservation = model<IIdentityObservation>("IdentityObservation", schema);
