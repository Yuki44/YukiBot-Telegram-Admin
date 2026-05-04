import { Schema, model } from "mongoose";
import { ICredential } from "../../types";

const credentialSchema = new Schema<ICredential>({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  userId: { type: Number, required: true },
  name: { type: String },
  createdAt: { type: Date, default: () => new Date(), required: true },
});

export const Credential = model<ICredential>("Credential", credentialSchema);
