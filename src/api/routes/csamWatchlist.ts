import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/authenticate";
import { csamWatchlistRepository, WatchCategory } from "../../db/repositories/csamWatchlistRepository";
import {
  DEFAULT_SOLICITATION,
  DEFAULT_NEGATION,
  DEFAULT_KEYWORDS,
} from "../../features/csamDetection/config";
import { CSAM_WATCH_HANDLES } from "../../config";
import { logger } from "../../utils/logger";

const CATEGORIES: readonly WatchCategory[] = ["handles", "solicitation", "negation", "keywords"];

function isCategory(v: unknown): v is WatchCategory {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/**
 * The watchlist is a single global list shared by every chat, and its handle
 * entries identify a real offender — so editing it is limited to super-admins
 * (ADMIN_IDS), not per-chat owners.
 */
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

export function createCsamWatchlistRouter(): Router {
  const router = Router();

  router.use(authenticate);
  router.use(requireSuperAdmin);

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const stored = await csamWatchlistRepository.getStored();
      res.json({
        stored,
        // Always-on built-in tokens shown read-only so the operator sees the full
        // effective picture. Handles are never baked into source (G2) — only their
        // env-seeded count is surfaced, not the values.
        defaults: {
          solicitation: DEFAULT_SOLICITATION,
          negation: DEFAULT_NEGATION,
          keywords: DEFAULT_KEYWORDS,
        },
        envHandleCount: CSAM_WATCH_HANDLES.length,
      });
    } catch (err) {
      logger.error({ action: "csamWatchlist.get", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { category?: unknown; value?: unknown };
    if (!isCategory(body.category)) {
      res.status(400).json({ error: "invalid_category" });
      return;
    }
    const value = (typeof body.value === "string" ? body.value : "").trim();
    if (value.length < 1 || value.length > 100) {
      res.status(400).json({ error: "invalid_value" });
      return;
    }

    try {
      await csamWatchlistRepository.addTerm(body.category, value);
      logger.info({
        action: "csamWatchlist.add",
        category: body.category,
        userId: req.user!.userId,
      });
      const stored = await csamWatchlistRepository.getStored();
      res.json({ stored });
    } catch (err) {
      logger.error({ action: "csamWatchlist.add", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:category/:value", async (req: Request, res: Response) => {
    const category = req.params.category;
    if (!isCategory(category)) {
      res.status(400).json({ error: "invalid_category" });
      return;
    }
    const value = decodeURIComponent(req.params.value);

    try {
      await csamWatchlistRepository.removeTerm(category, value);
      logger.info({
        action: "csamWatchlist.remove",
        category,
        userId: req.user!.userId,
      });
      const stored = await csamWatchlistRepository.getStored();
      res.json({ stored });
    } catch (err) {
      logger.error({ action: "csamWatchlist.remove", error: String(err) });
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
