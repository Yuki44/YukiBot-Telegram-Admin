import { describe, it, expect } from "vitest";
import { esc, displayName, mention } from "../../src/bot/helpers/html";

describe("esc", () => {
  it("escapes ampersands", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(esc("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;"
    );
  });

  it("handles multiple special chars in one string", () => {
    expect(esc("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });

  it("returns empty string unchanged", () => {
    expect(esc("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(esc("Hello World")).toBe("Hello World");
  });
});

describe("displayName", () => {
  it("returns name with @username when provided", () => {
    expect(displayName("John", "johndoe")).toBe("John (@johndoe)");
  });

  it("returns only escaped name when username is undefined", () => {
    expect(displayName("John")).toBe("John");
  });

  it("escapes HTML in name and username", () => {
    expect(displayName("<b>Bold</b>", "u&ser")).toBe(
      "&lt;b&gt;Bold&lt;/b&gt; (@u&amp;ser)"
    );
  });
});

describe("mention", () => {
  it("returns @username when available", () => {
    expect(mention("John", "johndoe")).toBe("@johndoe");
  });

  it("returns raw name when username is undefined", () => {
    expect(mention("John")).toBe("John");
  });
});

