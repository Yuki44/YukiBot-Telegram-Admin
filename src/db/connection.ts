import dns from "dns";
import mongoose from "mongoose";
import { logger } from "../utils/logger";

// Force reliable DNS servers — c-ares (used by Node.js) can pick up broken
// virtual adapter DNS entries (e.g. NordVPN NordLynx fec0:: placeholders).
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export async function connectDB(): Promise<void> {
  try {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri || mongoUri === "PLACEHOLDER") {
      throw new Error("MONGODB_URI is not set in environment variables");
    }

    logger.info({ action: "db_connect", status: "connecting to MongoDB..." });

    // Hard 15 seconds in case DNS is stuck and exceeds mongoose's own timeouts
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("MongoDB connection timed out after 15 s")), 15_000)
    );
    await Promise.race([
      mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 12_000,
        connectTimeoutMS: 12_000,
      }),
      timeout,
    ]);
    logger.info({ action: "db_connect", status: "MongoDB connected" });
  } catch (error) {
    logger.error({ action: "db_connect", error: String(error) });
    process.exit(1);
  }
}

export async function disconnectDB(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info({ action: "db_disconnect", status: "MongoDB disconnected" });
  } catch (error) {
    logger.error({ action: "db_disconnect", error: String(error) });
  }
}
