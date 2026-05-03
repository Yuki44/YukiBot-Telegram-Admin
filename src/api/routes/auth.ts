import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { ADMIN_IDS, JWT_SECRET } from "../../config";
import { adminRepository } from "../../db/repositories/adminRepository";
import { logger } from "../../utils/logger";
import { AuthUser } from "../middleware/authenticate";

const TOKEN_TTL = "7d";
const MAX_AUTH_AGE_S = 86400; // 24h, per Telegram spec

interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Verifies the Telegram Login Widget HMAC.
// https://core.telegram.org/widgets/login#checking-authorization
function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...rest } = data;
  const dataCheckString = (Object.keys(rest) as (keyof typeof rest)[])
    .filter((k) => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"));
}

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/telegram", async (req: Request, res: Response) => {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      logger.error({ action: "auth.telegram", error: "BOT_TOKEN not configured" });
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    const data = req.body as TelegramAuthData;
    if (!data || typeof data.id !== "number" || typeof data.hash !== "string") {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    if (!verifyTelegramAuth(data, botToken)) {
      logger.warn({ action: "auth.telegram", reason: "bad_hash", userId: data.id });
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const ageS = Math.floor(Date.now() / 1000) - data.auth_date;
    if (ageS > MAX_AUTH_AGE_S) {
      res.status(401).json({ error: "auth_expired" });
      return;
    }

    const isSuperAdmin = ADMIN_IDS.includes(data.id);
    let canLogIn = isSuperAdmin;

    if (!canLogIn) {
      try {
        const adminRecords = await adminRepository.findByUserId(data.id);
        canLogIn = adminRecords.length > 0;
      } catch (err) {
        logger.error({ action: "auth.telegram", error: String(err), userId: data.id });
        res.status(500).json({ error: "internal_error" });
        return;
      }
    }

    if (!canLogIn) {
      logger.warn({ action: "auth.telegram", reason: "not_admin", userId: data.id });
      res.status(403).json({ error: "not_authorized" });
      return;
    }

    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
    const payload: AuthUser = {
      userId: data.id,
      username: data.username,
      name,
      isSuperAdmin,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

    logger.info({ action: "auth.telegram", status: "ok", userId: data.id, isSuperAdmin });
    res.json({ token, user: payload });
  });

  // Cheap endpoint for the dashboard to verify a stored token + fetch identity.
  router.get("/me", (req: Request, res: Response) => {
    const header = req.headers.authorization ?? "";
    const match = header.match(/^Bearer\s+(.+)$/);
    if (!match) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    try {
      const payload = jwt.verify(match[1], JWT_SECRET) as AuthUser;
      res.json({ user: payload });
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  });

  return router;
}
