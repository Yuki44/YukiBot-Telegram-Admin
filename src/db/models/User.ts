import { Schema, model } from "mongoose";
import { IUser } from "../../types";

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
  warnings: {
    type: Number,
    default: 0,
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
});

// Compound unique index on userId + chatId
userSchema.index({ userId: 1, chatId: 1 }, { unique: true });

export const User = model<IUser>("User", userSchema);
