import { Schema, model } from "mongoose";
import { IUserDomainAllowance } from "../../types";

const schema = new Schema<IUserDomainAllowance>({
  chatId: { type: Number, required: true },
  userId: { type: Number, required: true },
  domains: { type: [String], default: [] },
});

schema.index({ chatId: 1, userId: 1 }, { unique: true });

export const UserDomainAllowance = model<IUserDomainAllowance>(
  "UserDomainAllowance",
  schema
);
