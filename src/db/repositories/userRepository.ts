import { User } from "../models/User";
import { IUser } from "../../types";
import { MAX_WARNINGS } from "../../config/constants";

export const userRepository = {
  async findByUserAndChat(userId: number, chatId: number): Promise<IUser | null> {
    return await User.findOne({ userId, chatId });
  },

  async findByUsername(username: string, chatId: number): Promise<IUser | null> {
    return await User.findOne({ username, chatId });
  },

  async upsert(user: Partial<IUser>): Promise<IUser> {
    if (!user.userId || !user.chatId) {
      throw new Error("userId and chatId are required for upsert");
    }

    return await User.findOneAndUpdate(
      { userId: user.userId, chatId: user.chatId },
      { $set: user },
      { upsert: true, returnDocument: "after" }
    );
  },

  async findOrCreate(userId: number, chatId: number, username?: string, name?: string): Promise<IUser> {
    const update: Record<string, unknown> = {
      $setOnInsert: {
        userId,
        chatId,
        warnings: 0,
        warningReasons: [],
        isBanned: false,
        wasBanned: false,
      },
    };

    const setFields: Record<string, unknown> = {};
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    if (Object.keys(setFields).length > 0) {
      update.$set = setFields;
    }

    return await User.findOneAndUpdate({ userId, chatId }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    });
  },

  async incrementWarning(
    userId: number,
    chatId: number,
    reason?: string,
    username?: string,
    name?: string
  ): Promise<IUser> {
    const update: Record<string, unknown> = {
      $setOnInsert: {
        userId,
        chatId,
        warnings: 0,
        warningReasons: [],
        isBanned: false,
        wasBanned: false,
      },
    };

    const setFields: Record<string, unknown> = {};
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    if (Object.keys(setFields).length > 0) {
      update.$set = setFields;
    }

    const user = await User.findOneAndUpdate({ userId, chatId }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    });

    user.warnings += 1;
    if (reason) user.warningReasons.push(reason);

    if (user.warnings >= MAX_WARNINGS) {
      user.isBanned = true;
      user.wasBanned = true;
    }

    await user.save();
    return user;
  },

  async remove(userId: number, chatId: number): Promise<void> {
    await User.deleteOne({ userId, chatId });
  },

  async clearLeftDate(userId: number, chatId: number): Promise<void> {
    await User.updateOne({ userId, chatId }, { $unset: { leftWithWarningsAt: "" } });
  },

  async markBanned(userId: number, chatId: number, username?: string, name?: string): Promise<IUser> {
    const setFields: Record<string, unknown> = { isBanned: true, wasBanned: true };
    if (username) setFields.username = username;
    if (name) setFields.name = name;

    return await User.findOneAndUpdate(
      { userId, chatId },
      {
        $set: setFields,
        $setOnInsert: { warnings: 0, warningReasons: [] },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
  },

  async decrementWarning(userId: number, chatId: number): Promise<IUser | null> {
    const user = await User.findOne({ userId, chatId });
    if (!user) return null;

    user.warnings = Math.max(0, user.warnings - 1);
    if (user.warningReasons.length > 0) user.warningReasons.pop();

    if (user.isBanned && user.warnings < MAX_WARNINGS) {
      user.isBanned = false;
    }

    await user.save();
    return user;
  },
};
