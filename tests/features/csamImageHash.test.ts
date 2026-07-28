import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  computeImageHash,
  hammingDistance,
  findNearestHash,
  HashRow,
} from "../../src/features/csamDetection/imageHash";

/**
 * Deterministic photo-like image: gradients + soft blobs placed by `seed`; the
 * optional white band models the "same image, slightly edited text" case.
 */
async function makeImage(opts: {
  width: number;
  height: number;
  overlay?: boolean;
  seed?: number;
}): Promise<Buffer> {
  const { width, height, overlay = false, seed = 0 } = opts;
  const blobs = Array.from({ length: 5 }, (_, k) => ({
    cx: ((seed * 131 + k * 197) % 100) / 100,
    cy: ((seed * 73 + k * 151) % 100) / 100,
    r: 0.18 + ((seed + k) % 4) * 0.06,
  }));
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      let lum = 40 + (140 * x) / width + (60 * y) / height;
      for (const b of blobs) {
        const dx = x / width - b.cx;
        const dy = y / height - b.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < b.r) lum += 90 * (1 - d / b.r);
      }
      raw[i] = Math.min(255, lum);
      raw[i + 1] = Math.min(255, lum * 0.8);
      raw[i + 2] = Math.min(255, 255 - lum * 0.5);
    }
  }
  let img = sharp(raw, { raw: { width, height, channels: 3 } });
  if (overlay) {
    const bandH = Math.floor(height / 12);
    const svg = `<svg width="${width}" height="${height}"><rect x="0" y="${Math.floor(height / 2 - bandH / 2)}" width="${width}" height="${bandH}" fill="white"/></svg>`;
    img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(svg) }]);
  }
  return img.png().toBuffer();
}

describe("computeImageHash", () => {
  it("is stable across re-encoding and resizing (the alt-account re-upload case)", async () => {
    const original = await makeImage({ width: 640, height: 640 });
    const reencoded = await sharp(original).jpeg({ quality: 70 }).toBuffer();
    const resized = await sharp(original).resize(320, 320).jpeg({ quality: 80 }).toBuffer();

    const h1 = await computeImageHash(original);
    const h2 = await computeImageHash(reencoded);
    const h3 = await computeImageHash(resized);

    expect(h1).toHaveLength(16);
    expect(hammingDistance(h1, h2)).toBeLessThanOrEqual(4);
    expect(hammingDistance(h1, h3)).toBeLessThanOrEqual(6);
  });

  it("keeps a small distance for a minor overlay edit but a large one for a different image", async () => {
    const base = await computeImageHash(await makeImage({ width: 640, height: 640 }));
    const edited = await computeImageHash(await makeImage({ width: 640, height: 640, overlay: true }));
    const other = await computeImageHash(await makeImage({ width: 640, height: 640, seed: 3 }));

    expect(hammingDistance(base, edited)).toBeLessThanOrEqual(12);
    expect(hammingDistance(base, other)).toBeGreaterThan(16);
  });
});

describe("hammingDistance", () => {
  it("counts differing bits", () => {
    expect(hammingDistance("00", "00")).toBe(0);
    expect(hammingDistance("0f", "00")).toBe(4);
    expect(hammingDistance("ffff", "0000")).toBe(16);
  });

  it("returns Infinity for malformed or mismatched input (never a false 0-distance)", () => {
    expect(hammingDistance("abc", "abcd")).toBe(Infinity);
    expect(hammingDistance("", "")).toBe(Infinity);
    expect(hammingDistance("zz", "00")).toBe(Infinity);
  });
});

describe("findNearestHash", () => {
  const rows: HashRow[] = [
    { hash: "00000000000000ff", verdict: "SILENCE" },
    { hash: "0000000000000000", verdict: "AUTO_BAN" },
  ];

  it("returns the closest row within the gate", () => {
    // 1 bit from the AUTO_BAN row, 7 from the SILENCE row.
    const m = findNearestHash("0000000000000001", rows, 12);
    expect(m).toEqual({ verdict: "AUTO_BAN", distance: 1 });
  });

  it("returns null when nothing is inside the gate", () => {
    expect(findNearestHash("ffffffffffffffff", rows, 12)).toBeNull();
  });
});
