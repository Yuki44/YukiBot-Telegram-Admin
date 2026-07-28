import sharp from "sharp";

/**
 * 64-bit DCT pHash for the known-bad-image blacklist: grayscale → 32×32 → DCT-II →
 * 8×8 low-frequency block → bit per coefficient above the AC median. Survives
 * re-encoding, resizing and small overlay-text edits (how the same ad returns from
 * a fresh alt account); unrelated images land ~30+ bits away. Only the 16-hex-char
 * hash is ever stored — never image bytes (S-rules).
 */

const SIZE = 32;
const LOW = 8;

const COS: number[][] = Array.from({ length: SIZE }, (_, u) =>
  Array.from({ length: SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)))
);

export async function computeImageHash(input: Buffer): Promise<string> {
  const pixels = await sharp(input).grayscale().resize(SIZE, SIZE, { fit: "fill" }).raw().toBuffer();

  const rows: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    rows.push(Array.from({ length: SIZE }, (_, x) => pixels[y * SIZE + x]));
  }
  const coeffs: number[] = [];
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          sum += rows[y][x] * COS[u][x] * COS[v][y];
        }
      }
      coeffs.push(sum);
    }
  }

  // Median over the AC coefficients only — the DC term just encodes brightness.
  const sorted = [...coeffs.slice(1)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let hex = "";
  for (let i = 0; i < coeffs.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      nibble = (nibble << 1) | (coeffs[i + j] > median ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

/** Differing bits between two same-length hex hashes (Infinity when malformed/mismatched). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i], 16);
    const xb = parseInt(b[i], 16);
    if (Number.isNaN(xa) || Number.isNaN(xb)) return Infinity;
    let x = xa ^ xb;
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

export interface HashRow {
  hash: string;
  verdict: "AUTO_BAN" | "SILENCE";
}

export interface HashMatch {
  verdict: "AUTO_BAN" | "SILENCE";
  distance: number;
}

/** Closest known-bad hash within `maxDistance`, or null. */
export function findNearestHash(hash: string, rows: HashRow[], maxDistance: number): HashMatch | null {
  let best: HashMatch | null = null;
  for (const row of rows) {
    const distance = hammingDistance(hash, row.hash);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) {
      best = { verdict: row.verdict, distance };
    }
  }
  return best;
}
