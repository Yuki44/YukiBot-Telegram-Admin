import { LANGUAGE_PREFILTER_MIN_CONFIDENCE, LANGUAGE_PREFILTER_MIN_WORDS } from "../../config/constants";
import { logger } from "../../utils/logger";
import { countWords } from "./preScreen";

interface EldResult {
  language: string | false;
  isReliable(): boolean;
  getScores(): Record<string, number>;
}

interface EldModule {
  eld: { detect(text: string): EldResult };
}

export type Detector = (text: string) => EldResult;

// `eld` ships ESM-only while this project compiles to CommonJS; a plain `import()` would be
// downlevelled to `require()` and fail at runtime. Wrapping it keeps the real dynamic import.
const importEsm = new Function("specifier", "return import(specifier)") as (s: string) => Promise<EldModule>;

let detector: Detector | null = null;

/**
 * Injects the detector directly. Tests use this because the `new Function` import above is
 * invisible to the test runner's module graph, so they load `eld` natively instead.
 */
export function setDetector(next: Detector | null): void {
  detector = next;
}

async function getDetector(): Promise<Detector> {
  if (!detector) {
    const mod = await importEsm("eld/medium");
    detector = (text) => mod.eld.detect(text);
  }
  return detector;
}

export interface LocalVerdict {
  /** Whether the text is confidently Spanish or Catalan, i.e. safe to skip the classifier. */
  skip: boolean;
  language?: string;
  confidence?: number;
}

const ACCEPTED = new Set(["es", "ca"]);

/**
 * Local, conservative language check that decides only whether the classifier is worth
 * calling — never whether a message is an offense. Any doubt (short text, unreliable
 * reading, non-es/ca, or a load failure) resolves to `skip: false`, which costs one
 * harmless API call and preserves today's behaviour exactly.
 */
export async function detectLocally(text: string): Promise<LocalVerdict> {
  try {
    if (countWords(text) < LANGUAGE_PREFILTER_MIN_WORDS) return { skip: false };

    const detect = await getDetector();
    const result = detect(text);
    const language = result.language;
    if (!language || !ACCEPTED.has(language) || !result.isReliable()) {
      return { skip: false, language: language || undefined };
    }

    const confidence = result.getScores()[language] ?? 0;
    return { skip: confidence >= LANGUAGE_PREFILTER_MIN_CONFIDENCE, language, confidence };
  } catch (err) {
    logger.error({ action: "language_local_detect_error", error: String(err) });
    return { skip: false };
  }
}
