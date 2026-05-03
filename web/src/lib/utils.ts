export function avClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return "yk-av-" + ((Math.abs(h) % 8) + 1);
}

export function initials(s: string): string {
  const parts = s.replace(/^@/, "").split(/[\s_-]+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() || "");
}

/**
 * Short Spanish relative-time label for a date or timestamp in the past.
 * Returns "ahora" for <1min, "hace N min/h/d/sem" otherwise.
 */
export function timeAgo(input: Date | string | number): string {
  const date = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  const min = (Date.now() - date.getTime()) / 60000;
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${Math.floor(min)} min`;
  const h = min / 60;
  if (h < 24) return `hace ${Math.floor(h)} h`;
  const d = h / 24;
  if (d < 7) return `hace ${Math.floor(d)} d`;
  return `hace ${Math.floor(d / 7)} sem`;
}

export function timeUntil(input: Date | string | number): string {
  const date = typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  const min = (date.getTime() - Date.now()) / 60000;
  if (min <= 0) return "expirado";
  if (min < 60) return `${Math.ceil(min)} min`;
  const h = min / 60;
  if (h < 24) return `${Math.ceil(h)} h`;
  const d = h / 24;
  return `${Math.ceil(d)} d`;
}

export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    return false;
  }
}
