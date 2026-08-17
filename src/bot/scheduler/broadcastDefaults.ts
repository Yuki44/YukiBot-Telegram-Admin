import { IBroadcastPost } from "../../types";

export const CANONICAL_KEYS = ["gaybcn", "catalunya"] as const;

export const DEFAULT_BUTTON_TEXT = "👉 Entrar aquí";

/** The two fixed posts, with their default captions and Madrid-hour schedules. */
export function defaultPosts(): IBroadcastPost[] {
  return [
    {
      key: "gaybcn",
      label: "GayBcn",
      caption: "¡Únete a G@Y-BCN 💜💜💜!",
      url: "",
      image: null,
      hours: [0, 8, 16],
      enabled: true,
      lastSentSlot: null,
      retryAttempts: 0,
    },
    {
      key: "catalunya",
      label: "Catalunya Gay",
      caption: "¡Únete a Catalunya Gay 🟠🟠🟠!",
      url: "",
      image: null,
      hours: [4, 12, 20],
      enabled: true,
      lastSentSlot: null,
      retryAttempts: 0,
    },
  ];
}

/** Current wall-clock hour/minute and a per-hour slot id ("YYYY-MM-DD-HH") in Europe/Madrid. */
export function madridNow(now: Date): { hour: number; minute: number; slot: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { hour, minute, slot: `${get("year")}-${get("month")}-${get("day")}-${get("hour")}` };
}

/** Minutes from the current Madrid time until the next scheduled hour in `hours`. */
export function minutesUntilNext(hours: number[], curHour: number, curMinute: number): number {
  const cur = curHour * 60 + curMinute;
  const sorted = [...hours].sort((a, b) => a - b);
  for (const h of sorted) {
    if (h * 60 > cur) return h * 60 - cur;
  }
  return 24 * 60 - cur + (sorted.length ? sorted[0] * 60 : 0);
}

/** The enabled+configured post that fires soonest, and roughly when (for display / send-now). */
export function nextPost(
  posts: IBroadcastPost[],
  now: Date
): { key: string; label: string; at: string } | null {
  const { hour, minute } = madridNow(now);
  let best: { min: number; post: IBroadcastPost } | null = null;
  for (const post of posts) {
    if (!post.enabled || !post.url || !post.hours || post.hours.length === 0) continue;
    const min = minutesUntilNext(post.hours, hour, minute);
    if (!best || min < best.min) best = { min, post };
  }
  if (!best) return null;
  return {
    key: best.post.key,
    label: best.post.label,
    at: new Date(now.getTime() + best.min * 60_000).toISOString(),
  };
}
