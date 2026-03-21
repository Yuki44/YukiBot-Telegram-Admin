import { Schema, model } from "mongoose";
import { IAdmin } from "../../types";

const adminSchema = new Schema<IAdmin>({
  userId: {
    type: Number,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  chatId: {
    type: Number,
    required: true,
  },
  role: {
    type: String,
    enum: ["owner", "admin"],
    required: true,
  },
});

// Compound unique index on userId + chatId
adminSchema.index({ userId: 1, chatId: 1 }, { unique: true });

export const Admin = model<IAdmin>("Admin", adminSchema);
