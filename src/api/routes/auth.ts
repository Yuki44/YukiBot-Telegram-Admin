import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { ADMIN_IDS, JWT_SECRET } from "../../config";
import { adminRepository } from "../../db/repositories/adminRepository";
import { credentialRepository } from "../../db/repositories/credentialRepository";
import { logger } from "../../utils/logger";
import { AuthUser, authenticate } from "../middleware/authenticate";

const TOKEN_TTL = "7d";
const MAX_AUTH_AGE_S = 86400; // 24h, per Telegram spec

// In-memory rate limiter for the password endpoint. Per-IP, sliding 15-min window,
// 5 attempts. Resets on successful login. Single-process — if we ever scale out
// horizontally on Railway this becomes per-instance, which is acceptable for the
// admin-tool threat model.
const PW_MAX_ATTEMPTS = 5;
const PW_WINDOW_MS = 15 * 60 * 1000;
const pwAttempts = new Map<string, { count: number; firstAt: number }>();

function ipKey(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const entry = pwAttempts.get(ip);
  if (!entry || now - entry.firstAt > PW_WINDOW_MS) {
    pwAttempts.set(ip, { count: 1, firstAt: now });
    return { ok: true };
  }
  entry.count++;
  if (entry.count > PW_MAX_ATTEMPTS) {
    return { ok: false, retryAfter: Math.ceil((entry.firstAt + PW_WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

function clearRateLimit(ip: string): void {
  pwAttempts.delete(ip);
}

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

    let hasCredential = false;
    try {
      const existing = await credentialRepository.findByUserId(data.id);
      hasCredential = !!existing;
    } catch {
      /* non-fatal — default to false */
    }

    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || undefined;
    const payload: AuthUser = {
      userId: data.id,
      username: data.username,
      name,
      isSuperAdmin,
      hasCredential,
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

    logger.info({ action: "auth.telegram", status: "ok", userId: data.id, isSuperAdmin });
    res.json({ token, user: payload });
  });

  router.post("/password", async (req: Request, res: Response) => {
    const ip = ipKey(req);
    const limit = checkRateLimit(ip);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username.length === 0 || password.length === 0) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }

    try {
      const cred = await credentialRepository.findByUsername(username);
      // Always run a bcrypt compare so the timing of "user not found" vs.
      // "wrong password" doesn't leak which case we hit.
      const dummyHash = "$2b$10$abcdefghijklmnopqrstuuJ4jUWg1Q3xS2u3v4w5x6y7z8A9B0C1D";
      const match = await bcrypt.compare(password, cred?.passwordHash ?? dummyHash);
      if (!cred || !match) {
        logger.warn({ action: "auth.password", reason: "bad_credentials", username, ip });
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }

      clearRateLimit(ip);

      const isSuperAdmin = ADMIN_IDS.includes(cred.userId);
      const payload: AuthUser = {
        userId: cred.userId,
        username: cred.username,
        name: cred.name,
        isSuperAdmin,
        hasCredential: true,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });

      logger.info({
        action: "auth.password",
        status: "ok",
        username,
        userId: cred.userId,
        isSuperAdmin,
      });
      res.json({ token, user: payload });
    } catch (err) {
      logger.error({ action: "auth.password", error: String(err), username });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/password/change", authenticate, async (req: Request, res: Response) => {
    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (currentPassword.length === 0 || newPassword.length === 0) {
      res.status(400).json({ error: "invalid_payload" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "weak_password" });
      return;
    }

    const userId = req.user!.userId;
    try {
      const cred = await credentialRepository.findByUserId(userId);
      if (!cred) {
        res.status(404).json({ error: "no_credential" });
        return;
      }
      const match = await bcrypt.compare(currentPassword, cred.passwordHash);
      if (!match) {
        logger.warn({ action: "auth.password_change", reason: "bad_current", userId });
        res.status(401).json({ error: "invalid_current_password" });
        return;
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await credentialRepository.updatePasswordHash(userId, hash);
      logger.info({ action: "auth.password_change", status: "ok", userId });
      res.status(204).end();
    } catch (err) {
      logger.error({ action: "auth.password_change", error: String(err), userId });
      res.status(500).json({ error: "internal_error" });
    }
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
