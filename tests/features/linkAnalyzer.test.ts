import { describe, it, expect } from "vitest";
import { analyzeLinks } from "../../src/features/promoSpamDetection/linkAnalyzer";

// ── Entity builders ────────────────────────────────────────────────────────
// url entities: URL is in the message text, entity has offset+length
function urlEntity(url: string) {
  return { type: "url", offset: 0, length: url.length };
}
// text_link entities: URL stored directly in entity.url
function textLinkEntity(url: string) {
  return { type: "text_link", url };
}

describe("analyzeLinks — forwarded channel messages", () => {
  it("flags forwarded channel message regardless of entities", () => {
    const result = analyzeLinks([], "", true, []);
    expect(result.flagged).toBe(true);
    expect(result.reason).toBe("mensaje_reenviado_de_canal");
  });

  it("does not flag a non-forwarded message with no entities", () => {
    expect(analyzeLinks([], "", false, []).flagged).toBe(false);
  });
});

describe("analyzeLinks — Telegram links (url entity, extracted from text)", () => {
  it("flags t.me/+INVITE invite link", () => {
    const url = "https://t.me/+AbCdEfGhIjK";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("enlace_de_telegram");
  });

  it("flags t.me/username channel link", () => {
    const url = "https://t.me/mychannel";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
  });

  it("flags t.me/joinchat/ links", () => {
    const url = "https://t.me/joinchat/AAABBB";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
  });

  it("flags telegram.me links", () => {
    const url = "https://telegram.me/channel";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
  });
});

describe("analyzeLinks — Telegram links (text_link entity)", () => {
  it("flags text_link with t.me URL", () => {
    const r = analyzeLinks([textLinkEntity("https://t.me/mychannel")], "click here", false, []);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe("enlace_de_telegram");
  });
});

describe("analyzeLinks — URL shorteners", () => {
  it("flags bit.ly (url entity)", () => {
    const url = "https://bit.ly/3xYz";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
    expect(r.reason).toContain("acortador_url");
  });

  it("flags tinyurl.com", () => {
    const url = "https://tinyurl.com/abc";
    expect(analyzeLinks([urlEntity(url)], url, false, []).flagged).toBe(true);
  });

  it("flags rb.gy", () => {
    const url = "https://rb.gy/xyz";
    expect(analyzeLinks([urlEntity(url)], url, false, []).flagged).toBe(true);
  });
});

describe("analyzeLinks — external URLs (all flagged unless whitelisted)", () => {
  it("flags youtube.com (no whitelist)", () => {
    const url = "https://youtube.com/watch?v=abc";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
    expect(r.reason).toContain("enlace_externo");
  });

  it("flags tiktok.com (no whitelist)", () => {
    const url = "https://tiktok.com/@user";
    expect(analyzeLinks([urlEntity(url)], url, false, []).flagged).toBe(true);
  });

  it("flags x.com (no whitelist)", () => {
    const url = "https://x.com/user/status/123";
    expect(analyzeLinks([urlEntity(url)], url, false, []).flagged).toBe(true);
  });

  it("passes an external URL that IS in whitelist", () => {
    const url = "https://example.com/page";
    const r = analyzeLinks([urlEntity(url)], url, false, ["example.com"]);
    expect(r.flagged).toBe(false);
  });

  it("passes subdomain of whitelisted domain", () => {
    const url = "https://sub.example.com/page";
    const r = analyzeLinks([urlEntity(url)], url, false, ["example.com"]);
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag messages with no URL entities", () => {
    // Raw text URL without entity should not be picked up
    expect(analyzeLinks([], "check out https://spam.com", false, []).flagged).toBe(false);
  });

  it("ignores non-url entity types", () => {
    const entities = [{ type: "bold" }, { type: "mention" }];
    expect(analyzeLinks(entities, "hello @user", false, []).flagged).toBe(false);
  });

  it("flags URL without https:// prefix (bare domain in entity)", () => {
    const url = "youtube.com/watch?v=abc";
    const r = analyzeLinks([urlEntity(url)], url, false, []);
    expect(r.flagged).toBe(true);
  });
});
