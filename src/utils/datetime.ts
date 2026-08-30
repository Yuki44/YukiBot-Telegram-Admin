// Canonical date formatting for anything shown to users (logs, notices). Railway runs
// in UTC, so `Date` getters read 2h behind Spain — always format in Europe/Madrid.

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function madridParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/** e.g. "28 de Agosto 2026 a las 21:31:06" (Europe/Madrid). */
export function formatMadridDateTime(d: Date): string {
  const p = madridParts(d);
  const month = MESES_ES[Number(p.month) - 1];
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${Number(p.day)} de ${monthCap} ${p.year} a las ${p.hour}:${p.minute}:${p.second}`;
}

/** e.g. "28/08/2026" (Europe/Madrid). */
export function formatMadridShortDate(d: Date): string {
  const p = madridParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}
