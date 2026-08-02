import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

/**
 * G17 guard: every false "profile changed" of the 2026-08-02 incident traced back to a second
 * place composing first_name + last_name its own way. Fails the build if one reappears.
 */

const SRC = join(__dirname, "..", "..", "src");
const HELPER = ["bot", "helpers", "fullName.ts"].join(sep);

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("fullName is the only first+last composition", () => {
  it("finds no ad-hoc first_name/last_name join outside the helper", () => {
    const offenders = tsFiles(SRC)
      .filter((file) => relative(SRC, file) !== HELPER)
      .filter((file) =>
        readFileSync(file, "utf8")
          .split(/[;\n]/)
          // Both fields referenced in one statement is the shape of a hand-rolled join.
          .some((line) => line.includes("first_name") && line.includes("last_name"))
      )
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});
