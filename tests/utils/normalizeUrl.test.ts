import { describe, it, expect } from "vitest";
import { normalizeHttpUrl } from "../../src/utils/url";

describe("normalizeHttpUrl", () => {
  it("prepends https:// to a bare domain or path", () => {
    expect(normalizeHttpUrl("t.me/micanal")).toBe("https://t.me/micanal");
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com/");
    expect(normalizeHttpUrl("  example.com/ruta  ")).toBe("https://example.com/ruta");
  });

  it("keeps an explicit http/https scheme", () => {
    expect(normalizeHttpUrl("https://t.me/x")).toBe("https://t.me/x");
    expect(normalizeHttpUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(normalizeHttpUrl("HTTPS://T.ME/x")).toBe("https://t.me/x");
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeHttpUrl("tg://resolve?domain=x")).toBeNull();
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("ftp://example.com")).toBeNull();
  });

  it("rejects empty or unparseable input", () => {
    expect(normalizeHttpUrl("")).toBeNull();
    expect(normalizeHttpUrl("   ")).toBeNull();
    expect(normalizeHttpUrl("https://")).toBeNull();
  });
});
