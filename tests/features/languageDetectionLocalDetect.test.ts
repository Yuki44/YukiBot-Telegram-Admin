import { describe, it, expect, beforeAll } from "vitest";
import { eld } from "eld/medium";
import { detectLocally, setDetector } from "../../src/features/languageDetection/localDetect";

beforeAll(() => {
  setDetector((text) => eld.detect(text));
});

describe("detectLocally — local pre-filter", () => {
  it("skips confidently Spanish messages", async () => {
    expect((await detectLocally("Alguien vende una PS5 aca barata mamen")).skip).toBe(true);
    expect((await detectLocally("no puedo ir hoy lo siento tio")).skip).toBe(true);
    expect((await detectLocally("alguien pa quedar hoy en madrid porfa")).skip).toBe(true);
  });

  it("skips confidently Catalan messages", async () => {
    expect((await detectLocally("Bon dia a tothom, com estas avui? Espero que molt be")).skip).toBe(true);
    expect((await detectLocally("Estic fent un cafe ara mateix")).skip).toBe(true);
  });

  // The whole point of the pre-filter: it must never swallow the messages the classifier exists to catch.
  it("never skips blatantly foreign messages", async () => {
    const foreign = [
      "My flight got delayed again, this airline is a joke honestly.",
      "How old are you please tell me",
      "Trade offers only, no scams please, thanks",
      "comment ca marche exactement",
      "dm me please right now",
      "guten morgen alle zusammen",
      "ciao ragazzi come state oggi",
      "kkkk eu quero muito isso agora",
    ];
    for (const text of foreign) {
      expect((await detectLocally(text)).skip, text).toBe(false);
    }
  });

  it("never skips a foreign sentence carrying an incidental Spanish word", async () => {
    expect((await detectLocally("I want to go to the beach with pruebas tomorrow, it will be fun")).skip).toBe(false);
    expect((await detectLocally("hola bro how are you doing today man")).skip).toBe(false);
    expect((await detectLocally("Hey guys alguien here speaks english?")).skip).toBe(false);
  });

  it("never skips short messages — that is where the loanword nuance lives", async () => {
    expect((await detectLocally("Ey bro, abre")).skip).toBe(false);
    expect((await detectLocally("ok gracias tio")).skip).toBe(false);
    expect((await detectLocally("comment ca marche")).skip).toBe(false);
  });

  it("reports the language and confidence behind a skip, for log review", async () => {
    const verdict = await detectLocally("no puedo ir hoy lo siento tio");
    expect(verdict.language).toBe("es");
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
