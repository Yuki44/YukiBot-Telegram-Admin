import { describe, it, expect } from "vitest";
import { evaluateBio, evaluateImageText, WatchConfig } from "../../src/features/csamDetection/matcher";

const config: WatchConfig = {
  handles: ["nomax16", "nomax"],
  solicitation: ["ib", "cc", "ae", "chinh", "text to my main", "cp", "buy", "for buy", "videos", "dm"],
  negation: ["no cp", "against", "report", "scam", "denuncia", "anti", "fake"],
  keywords: ["cp gei", "cp video"],
};

// Cyrillic look-alikes: о=U+043E а=U+0430 х=U+0445
const CYR = (s: string) =>
  s
    .replace(/o/g, String.fromCodePoint(0x043e))
    .replace(/a/g, String.fromCodePoint(0x0430))
    .replace(/x/g, String.fromCodePoint(0x0445));
const ZW = String.fromCodePoint(0x200b); // zero-width space

describe("evaluateBio — strict auto-ban predicate", () => {
  it("AUTO_BANs the real reported bio (handle + solicitation, no negation)", () => {
    const r = evaluateBio("pls text to my main account @nomax16 - ae ib cc chính @nomax16", config);
    expect(r.verdict).toBe("AUTO_BAN");
    expect(r.handle).toBeDefined();
    expect(r.solicitation.length).toBeGreaterThan(0);
    expect(r.negation).toEqual([]);
  });

  it("NONE when no watched handle is present", () => {
    expect(evaluateBio("just a normal person, love photography", config).verdict).toBe("NONE");
  });

  it("SILENCE when the handle is present but there is no solicitation", () => {
    expect(evaluateBio("nomax16", config).verdict).toBe("SILENCE");
  });

  it("SILENCE (not auto-ban) when a negation is present — protects the anti-CP ally", () => {
    const r = evaluateBio("beware nomax16 sells cp — no cp here, report him", config);
    expect(r.verdict).toBe("SILENCE");
    expect(r.negation.length).toBeGreaterThan(0);
  });

  it("AUTO_BANs leetspeak handle (n0max16)", () => {
    expect(evaluateBio("contact n0max16 to buy", config).verdict).toBe("AUTO_BAN");
  });

  it("AUTO_BANs separator-padded handle (n o m a x 1 6)", () => {
    expect(evaluateBio("hit me: n o m a x 1 6 for ib", config).verdict).toBe("AUTO_BAN");
  });

  it("AUTO_BANs dotted handle (n.o.m.a.x.1.6)", () => {
    expect(evaluateBio("dm n.o.m.a.x.1.6 to buy", config).verdict).toBe("AUTO_BAN");
  });

  it("AUTO_BANs Cyrillic-homoglyph handle", () => {
    expect(evaluateBio(`${CYR("nomax")}16 buy`, config).verdict).toBe("AUTO_BAN");
  });

  it("AUTO_BANs a handle broken by a zero-width character", () => {
    expect(evaluateBio(`nomax${ZW}16 for buy`, config).verdict).toBe("AUTO_BAN");
  });

  it("downgrades to SILENCE (never NONE) when solicitation is in an unlisted language", () => {
    // handle present, but the solicitation word is not in our list → still caught, just not auto-banned
    expect(evaluateBio("nomax16 продажа", config).verdict).toBe("SILENCE");
  });

  it("does not match the handle as a substring of a larger word", () => {
    expect(evaluateBio("this is autonomaxishared nonsense", config).verdict).toBe("NONE");
  });
});

describe("evaluateImageText — aggressive (silence-only) matching", () => {
  it("matches a CSAM gallery caption (handle + keyword)", () => {
    const r = evaluateImageText(">11000 videos cp gei  pls text @nomax16 for buy", config);
    expect(r.matched).toBe(true);
  });

  it("matches on a CSAM keyword alone, even without any handle", () => {
    expect(evaluateImageText("cp gei", config).matched).toBe(true);
  });

  it("matches obfuscated 'C!P n0max'", () => {
    expect(evaluateImageText("C!P n0max", config).matched).toBe(true);
  });

  it("does not match an innocent image caption", () => {
    expect(evaluateImageText("look at my cute cat photo from Barcelona", config).matched).toBe(false);
  });
});

describe("evaluateImageText — verdict tiers (OCR can now AUTO_BAN, mirroring the bio rule)", () => {
  it("AUTO_BANs the real reported gallery text (handle + sale words, no negation)", () => {
    const r = evaluateImageText(">11000 videos cp gei pls text to @Nomax16 for buy", config);
    expect(r.verdict).toBe("AUTO_BAN");
    expect(r.handle).toBeDefined();
    expect(r.solicitation.length).toBeGreaterThan(0);
  });

  it("SILENCEs (never bans) a handle with no solicitation word", () => {
    expect(evaluateImageText("contact nomax16", config).verdict).toBe("SILENCE");
  });

  it("SILENCEs (never bans) a lone CSAM keyword with no handle", () => {
    expect(evaluateImageText("cp gei", config).verdict).toBe("SILENCE");
  });

  it("downgrades handle + sale word to SILENCE when a negation is present (protect the ally)", () => {
    const r = evaluateImageText("nomax16 sells cp — report him, scam", config);
    expect(r.verdict).toBe("SILENCE");
    expect(r.negation.length).toBeGreaterThan(0);
  });

  it("NONE for an innocent image", () => {
    expect(evaluateImageText("sunset over the beach, lovely day", config).verdict).toBe("NONE");
  });
});

describe("evaluateImageText — obfuscated abuse keywords (space-free tokens)", () => {
  const kw: WatchConfig = {
    handles: ["nomax16"],
    solicitation: [],
    negation: [],
    keywords: ["childporn", "zoofilia", "zoophilia", "pedofilia", "pornoinfantil", "cpgei"],
  };

  it("matches spaced 'child porn'", () => {
    expect(evaluateImageText("free child porn here", kw).matched).toBe(true);
  });

  it("matches leet + punctuation 'ch!ld p0rn'", () => {
    expect(evaluateImageText("selling ch!ld p0rn dm", kw).matched).toBe(true);
  });

  it("matches dotted 'c.h.i.l.d.p.o.r.n'", () => {
    expect(evaluateImageText("c.h.i.l.d.p.o.r.n", kw).matched).toBe(true);
  });

  it("matches Spanish 'zoofilia' and leet 'z00filia'", () => {
    expect(evaluateImageText("videos de zoofilia", kw).matched).toBe(true);
    expect(evaluateImageText("z00filia", kw).matched).toBe(true);
  });

  it("matches spaced 'porno infantil' via the space-free token", () => {
    expect(evaluateImageText("vendo porno infantil", kw).matched).toBe(true);
  });

  it("matches spaced 'cp gei'", () => {
    expect(evaluateImageText(">11000 cp gei", kw).matched).toBe(true);
  });

  it("matches the real OCR misread 'cp gei' → 'cplgei' (inserted char)", () => {
    expect(evaluateImageText("11000 cplgei pls text", kw).matched).toBe(true);
  });

  it("matches the real OCR misread 'cp gei' → 'tp geil' (c→t + inserted char)", () => {
    expect(evaluateImageText("1000 maces tp geil for buy", kw).matched).toBe(true);
  });

  it("does not match benign 'child' alone", () => {
    expect(evaluateImageText("my child drew a picture today", kw).matched).toBe(false);
  });

  it("does not match benign 'no es porno, es arte'", () => {
    expect(evaluateImageText("no es porno, es arte", kw).matched).toBe(false);
  });
});

describe("evaluateImageText — OCR handle garble (real 2026-07-27/28 gallery)", () => {
  it("AUTO_BANs a strict-tolerant garble '@Nomax:l6' (1→l via the leet path) + solicitation", () => {
    const r = evaluateImageText("pls text to @Nomax:l6 for buy", config);
    expect(r.verdict).toBe("AUTO_BAN");
    expect(r.handle).toBe("nomax16");
  });

  it("matches on the real 973-char Railway OCR read (handle survives the noise)", () => {
    const prod =
      "FA on el =— E EE 1000 Maces tp geil A CA e LI E Pls a to @Nomax:l6, EE = L 4 a Ll " +
      "== y Sh e A SE =— Th Amer) | TEEN =] Gal. pe => : 48 —- br PN Photos Collect";
    expect(evaluateImageText(prod, config).matched).toBe(true);
  });

  it("SILENCEs (never auto-bans) the edit-distance garble '@Nomax] 6' → 'nomax6' (1 dropped)", () => {
    // The exact 2026-07-28 03:41 Railway read: OCR dropped the '1' entirely. Prod watches
    // only "nomax16" (no bare "nomax"), so the strict path misses and the fuzzy path takes
    // over — lower confidence, so it silences for review rather than auto-banning.
    const prodConfig: WatchConfig = { ...config, handles: ["nomax16"] };
    const r = evaluateImageText("=piSitextito(@Nomax] 6,for buy", prodConfig);
    expect(r.verdict).toBe("SILENCE");
    expect(r.handle).toBe("nomax16");
  });

  it("SILENCEs when the misread '@' is fused to the front of the handle (Onomax16)", () => {
    const r = evaluateImageText("11000 videos cp gei ONomax16 for buy", config);
    expect(r.verdict).toBe("SILENCE");
    expect(r.handle).toBe("nomax16");
  });

  it("does not match an innocent digit/letter blob", () => {
    expect(evaluateImageText("catalogue model no. abcl6 back in stock", config).matched).toBe(false);
  });

  it("the loose handle path stays bounded — a two-edit-away token does not match", () => {
    expect(evaluateImageText("buy nomax999 gadgets today", config).matched).toBe(false);
  });
});

describe("evaluateImageText — OCR-noise tolerance (edit distance, keywords only)", () => {
  const kw: WatchConfig = {
    handles: ["nomax16"],
    solicitation: [],
    negation: [],
    keywords: ["yukibotselftest", "childporn", "pornoinfantil"],
  };

  it("matches the real OCR misread 'yuKibeotSelftest' (inserted char)", () => {
    expect(evaluateImageText("~_yuKibeotSelftest 2", kw).matched).toBe(true);
  });

  it("matches a dropped-character OCR misread 'childporn' → 'chidporn'", () => {
    expect(evaluateImageText("chidporn", kw).matched).toBe(true);
  });

  it("matches a substituted-character misread 'pornoinfantil' → 'pornoirfantil'", () => {
    expect(evaluateImageText("pornoirfantil", kw).matched).toBe(true);
  });

  it("does not fuzzily match a benign unrelated caption", () => {
    expect(evaluateImageText("great football match tonight", kw).matched).toBe(false);
  });
});
