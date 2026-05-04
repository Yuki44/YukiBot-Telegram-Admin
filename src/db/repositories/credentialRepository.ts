import { Credential } from "../models/Credential";
import { ICredential } from "../../types";

export const credentialRepository = {
  async findByUsername(username: string): Promise<ICredential | null> {
    return await Credential.findOne({ username: username.toLowerCase() });
  },

  async listAll(): Promise<ICredential[]> {
    return await Credential.find({}).sort({ username: 1 });
  },

  async upsert(data: {
    username: string;
    passwordHash: string;
    userId: number;
    name?: string;
  }): Promise<ICredential> {
    const result = await Credential.findOneAndUpdate(
      { username: data.username.toLowerCase() },
      {
        $set: {
          username: data.username.toLowerCase(),
          passwordHash: data.passwordHash,
          userId: data.userId,
          name: data.name,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after" }
    );
    return result!;
  },

  async remove(username: string): Promise<boolean> {
    const r = await Credential.deleteOne({ username: username.toLowerCase() });
    return r.deletedCount > 0;
  },
};
