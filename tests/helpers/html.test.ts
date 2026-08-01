import { describe, it, expect } from "vitest";
import { esc, displayName, mention, mentionHtml, mentionFullHtml } from "../../src/bot/helpers/html";

describe("esc", () => {
  it("escapes ampersands", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(esc("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
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
    expect(displayName("<b>Bold</b>", "u&ser")).toBe("&lt;b&gt;Bold&lt;/b&gt; (@u&amp;ser)");
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

describe("mentionHtml", () => {
  it("wraps @username in a tg://user?id= link when available", () => {
    expect(mentionHtml(42, "John", "johndoe")).toBe('<a href="tg://user?id=42">@johndoe</a>');
  });

  it("falls back to the escaped name, still wrapped in a clickable link, without a username", () => {
    expect(mentionHtml(42, "<b>John</b>")).toBe('<a href="tg://user?id=42">&lt;b&gt;John&lt;/b&gt;</a>');
  });
});

describe("mentionFullHtml", () => {
  it("renders the clickable name plus the clickable @username", () => {
    expect(mentionFullHtml(42, "Harry")).toBe('<a href="tg://user?id=42">Harry</a>');
    expect(mentionFullHtml(42, "Harry", "hrush")).toBe(
      '<a href="tg://user?id=42">Harry</a> (<a href="tg://user?id=42">@hrush</a>)'
    );
  });

  it("falls back to a tap-to-copy ID only when idFallback is set", () => {
    expect(mentionFullHtml(42, "Harry", undefined, { idFallback: true })).toBe(
      '<a href="tg://user?id=42">Harry</a> (<code>42</code>)'
    );
  });

  it("escapes HTML in the name and the username", () => {
    expect(mentionFullHtml(42, "<b>H</b>", "<i>u</i>")).toBe(
      '<a href="tg://user?id=42">&lt;b&gt;H&lt;/b&gt;</a> (<a href="tg://user?id=42">@&lt;i&gt;u&lt;/i&gt;</a>)'
    );
  });
});
