import { Schema, model } from "mongoose";
import { IUser } from "../../types";
import { LEFT_WITH_WARNINGS_TTL_S } from "../../config/constants";

const userSchema = new Schema<IUser>({
  userId: {
    type: Number,
    required: true,
  },
  chatId: {
    type: Number,
    required: true,
  },
  username: {
    type: String,
  },
  name: {
    type: String,
  },
  warnings: {
    type: Number,
    default: 0,
  },
  warningReasons: {
    type: [String],
    default: [],
  },
  isMuted: {
    type: Boolean,
    default: false,
  },
  muteUntil: {
    type: Date,
  },
  isBanned: {
    type: Boolean,
    default: false,
  },
  wasBanned: {
    type: Boolean,
    default: false,
  },
  leftWithWarningsAt: {
    type: Date,
  },
  // null = checked, no photo. undefined = never checked.
  photoFileId: {
    type: String,
    default: undefined,
  },
  photoCheckedAt: {
    type: Date,
  },
  lastBioCheckAt: {
    type: Date,
  },
  bioMissCount: {
    type: Number,
    default: 0,
  },
  notMemberAt: {
    type: Date,
  },
  identityConfirmedAt: {
    type: Date,
  },
  languageGraceGivenAt: {
    type: Date,
  },
});

// Compound unique index on userId + chatId
userSchema.index({ userId: 1, chatId: 1 }, { unique: true });

// TTL index — auto-deletes documents 6 months after the user left with active warnings
userSchema.index({ leftWithWarningsAt: 1 }, { expireAfterSeconds: LEFT_WITH_WARNINGS_TTL_S, sparse: true });

// Serves the CSAM scanner's due-for-scan query, which now runs every rotation tick.
userSchema.index({ chatId: 1, isBanned: 1, notMemberAt: 1, lastBioCheckAt: 1 });

export const User = model<IUser>("User", userSchema);
