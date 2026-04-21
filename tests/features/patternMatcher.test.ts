import { describe, it, expect } from "vitest";
import { matchesSpamPattern } from "../../src/features/promoSpamDetection/patternMatcher";
import { createHash } from "crypto";
import { normalizeText } from "../../src/db/repositories/spamPatternRepository";

function hashOf(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

const NO_LEARNED = new Set<string>();

describe("matchesSpamPattern — should NOT flag (false positive guard)", () => {
  it("passes a normal Spanish sentence", () => {
    const r = matchesSpamPattern("Hola, ¿cómo están todos hoy?", NO_LEARNED, hashOf("Hola, ¿cómo están todos hoy?"));
    expect(r.matched).toBe(false);
  });

  it("passes NSFW text without a contact solicitation signal", () => {
    // Adult content is permitted — only ADS with contact info get flagged
    const r = matchesSpamPattern("Me gustan las fotos de chicas", NO_LEARNED, hashOf("Me gustan las fotos de chicas"));
    expect(r.matched).toBe(false);
  });

  it("passes a random question about crypto prices", () => {
    const text = "¿Cuánto cuesta el BTC hoy?";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(false);
  });

  it("passes normal investment discussion", () => {
    const text = "Creo que Bitcoin es una buena inversión a largo plazo";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(false);
  });
});

describe("matchesSpamPattern — crypto giveaway patterns", () => {
  it("flags 'send X BTC' (English)", () => {
    const text = "Send 0.5 BTC to this address and receive double";
    const r = matchesSpamPattern(text, NO_LEARNED, hashOf(text));
    expect(r.matched).toBe(true);
    expect(r.tag).toContain("crypto");
  });

  it("flags 'duplico tu inversión' (Spanish)", () => {
    const text = "Te duplico tu inversión en crypto, escríbeme";
    const r = matchesSpamPattern(text, NO_LEARNED, hashOf(text));
    expect(r.matched).toBe(true);
  });

  it("flags 'free BTC' giveaway", () => {
    const text = "Get free BTC — limited time offer!";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags crypto airdrop with claim", () => {
    const text = "Huge airdrop — claim your free tokens now!";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });
});

describe("matchesSpamPattern — channel/group blast patterns", () => {
  it("flags 'únete a mi canal' (Spanish)", () => {
    const text = "¡Únete a mi canal de señales de trading!";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags 'join my group' (English)", () => {
    const text = "Join my group for exclusive signals";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags Russian channel invite", () => {
    const text = "Подпишитесь на наш канал для заработка";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags 'subscribe to my channel'", () => {
    const text = "Subscribe to my channel for daily tips";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });
});

describe("matchesSpamPattern — investment solicitation patterns", () => {
  it("flags 'inversión garantizada'", () => {
    const text = "Ofrezco una inversión garantizada del 30% mensual";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags 'gana X USD por día'", () => {
    const text = "Gana hasta 200 USD al día con nuestra plataforma";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags 'earn up to X USD per week'", () => {
    const text = "Earn up to 500 USD per week guaranteed";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("flags '100% profit'", () => {
    const text = "100% guaranteed profit — start today";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });
});

describe("matchesSpamPattern — adult service AD patterns (require contact signal)", () => {
  it("flags escort ad with whatsapp contact", () => {
    const text = "Acompañantes disponibles 24h, escríbeme por WhatsApp";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(true);
  });

  it("does NOT flag generic adult content without contact solicitation", () => {
    const text = "Masajes eróticos son lo mejor que existe";
    expect(matchesSpamPattern(text, NO_LEARNED, hashOf(text)).matched).toBe(false);
  });
});

describe("matchesSpamPattern — learned patterns", () => {
  it("flags text that exactly matches a learned pattern hash", () => {
    const learnedText = "Join our exclusive VIP investment group now";
    const hash = hashOf(learnedText);
    const patternId = hash.slice(0, 7);
    const learned = new Set([patternId]);

    const r = matchesSpamPattern(learnedText, learned, hash);
    expect(r.matched).toBe(true);
    expect(r.tag).toContain("aprendido");
  });

  it("does NOT flag text that is similar but not identical to a learned pattern", () => {
    const learnedText = "Join our exclusive VIP investment group now";
    const otherText = "Join our exclusive VIP investment group today";
    const learnedHash = hashOf(learnedText);
    const learned = new Set([learnedHash.slice(0, 7)]);

    const r = matchesSpamPattern(otherText, learned, hashOf(otherText));
    expect(r.matched).toBe(false);
  });
});

