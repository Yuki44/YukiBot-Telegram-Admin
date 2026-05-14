import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../../config";
import { logger } from "../../utils/logger";

export interface AuthUser {
  userId: number;
  username?: string;
  name?: string;
  isSuperAdmin: boolean;
  /**
   * True when a password credential exists for this user. Frontend uses it to gate the
   * "Cambiar contraseña" button — Telegram-only logins have no password to change.
   * Optional on the type so older tokens (pre-rollout) don't fail verification.
   */
  hasCredential?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match) {
    res.status(401).json({ error: "missing_token" });
    return;
  }

  try {
    const payload = jwt.verify(match[1], JWT_SECRET) as AuthUser;
    if (typeof payload.userId !== "number") {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    logger.warn({ action: "auth.verify_failed", error: String(err) });
    res.status(401).json({ error: "invalid_token" });
  }
}
