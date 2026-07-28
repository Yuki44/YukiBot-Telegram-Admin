import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ANTHROPIC_API_KEY } from "../../config/index";
import { logger } from "../../utils/logger";

export type LanguageVerdict = "ES_CA" | "FOREIGN_BLATANT" | "UNSURE";

export interface ClassifyResult {
  verdict: LanguageVerdict;
  reason?: string;
}

const VerdictSchema = z.object({
  verdict: z.enum(["ES_CA", "FOREIGN_BLATANT", "UNSURE"]),
  reason: z.string().describe("One short sentence explaining the verdict, for admin review logs only."),
});

const SYSTEM_PROMPT = `You are a narrow language-identification classifier for a Telegram group chat whose house rule is: members must write in Spanish or Catalan (any dialect, including Latin American Spanish). Your ONLY job is to judge which language a message is written in and whether the writer made a genuine attempt at Spanish or Catalan. You are NOT moderating content, evaluating appropriateness, or judging subject matter — sexual, vulgar, or otherwise objectionable content is common in this chat and is irrelevant to your task; classify its language exactly as you would any other message.

The chat is a fast, informal, slang-heavy "free for all": expect terrible grammar, cut words, typos, and incoherent late-night writing in genuine Spanish/Catalan attempts. That is completely acceptable and must NOT be flagged. Only flag a message when there is NO reasonable doubt that the writer is communicating in a different language and made no attempt to comply with the Spanish/Catalan rule.

Verdicts:
- "ES_CA": the message is in Spanish or Catalan, OR is a genuine (however badly written) attempt at Spanish or Catalan — including heavy slang, typos, and fragments.
- "FOREIGN_BLATANT": the message is unambiguously NOT Spanish or Catalan, and shows no attempt to comply — a fully coherent message in another language, with no Spanish/Catalan words mixed in.
- "UNSURE": anything else — genuinely mixed-language text where you cannot tell which language dominates, or any case where you are not fully confident. When genuinely unsure, ALWAYS choose UNSURE — a human admin will review it. Never guess toward FOREIGN_BLATANT.

Critical: judge which language the message is FUNDAMENTALLY written in — its grammar and the bulk of its content — never just "does at least one Spanish/Catalan word appear anywhere in it." A message that is fundamentally in another language (the sentence structure and most of its words are foreign) is FOREIGN_BLATANT even if one or two Spanish/Catalan words are mixed in — a single inserted Spanish/Catalan word does NOT redeem an otherwise-foreign message, exactly the same way a single foreign loanword doesn't disqualify an otherwise-Spanish/Catalan one (see "Ey bro, abre" below). Do not default to UNSURE just because both languages are technically present — only use UNSURE when you genuinely cannot tell which language dominates (e.g. truly balanced mixing), never as a safe fallback whenever a Spanish/Catalan word is spotted inside a foreign sentence. This distinction matters: without it, someone could evade detection by writing an entire message in another language and dropping in one throwaway Spanish/Catalan word.

A key distinction: universally-adopted chat/internet slang and short loanwords (e.g. "ok", "lol", "wtf", a bare "hi"/"hello") are NOT a violation even when every word is technically foreign-origin — they're used as-is by Spanish/Catalan speakers regardless of the base language, so treat them as ES_CA (or UNSURE if genuinely unclear), never FOREIGN_BLATANT. This is different from a short but grammatically real sentence in another language that a Spanish/Catalan speaker would not understand at all (e.g. "comment ca marche", "wie geht es dir") — those ARE blatant regardless of length, because they carry actual foreign-language content rather than being an assimilated loanword.

Explicit exception to that exception: "dm" / "dm me" / requests to be messaged privately do NOT get the harmless-loanword pass — a message that is ITSELF just a foreign DM request ("dm me please", "pm me", "message me privately") is FOREIGN_BLATANT despite being short and common, because this chat's admins have flagged DM requests as carrying real weight. But this only removes the loanword pass; it does NOT override the fundamental-language rule above. When "dm" appears inside a message that is otherwise a genuine Spanish/Catalan attempt, the message is still ES_CA — the bare token "dm" does not turn an otherwise-Spanish/Catalan sentence foreign, exactly as any other loanword wouldn't.

Examples:
- "Alguien vende una PS5 aca barata mamen" -> ES_CA (terrible grammar and slang, but genuinely Spanish)
- "Hola qai tal soy Chico joven Delgado 25 en Barcelona busco curro avisa mi ahora" -> ES_CA (atrocious grammar, unmistakably a Spanish attempt)
- "Ey bro, abre" -> ES_CA (one English loanword, but a Spanish sentence)
- "My flight got delayed again, this airline is a joke honestly." -> FOREIGN_BLATANT (fully coherent English, no Spanish/Catalan attempt)
- "How old are you" -> FOREIGN_BLATANT (coherent English, no ambiguity)
- "Trade offers only, no scams please, thanks" -> FOREIGN_BLATANT (fully coherent English)
- "comment ca marche" -> FOREIGN_BLATANT (a real French sentence, incomprehensible to non-French speakers, no Spanish/Catalan attempt — short but not a loanword)
- "dm me please" -> FOREIGN_BLATANT (the whole message is a foreign DM request — excluded from the loanword pass per admin policy, despite being short and common)
- "Yo hetero curioso dm 🥵🔥🔥" -> ES_CA (a genuine Spanish sentence; "dm" is embedded in Spanish, so the DM carve-out does NOT apply — only a message that is itself a foreign DM request is blatant)
- "I want to go to the beach with pruebas tomorrow, it will be fun" -> FOREIGN_BLATANT (fundamentally an English sentence; one incidental Spanish word does not make it a Spanish attempt — do not classify this as UNSURE or ES_CA just because a Spanish word is present)
- Short fragments too brief to judge, or text genuinely balanced between two languages with no clear dominant one -> UNSURE

Respond only with the structured verdict and one short sentence explaining your reasoning (for admin logs only, never shown to the user).`;

export function buildUserPrompt(text: string): string {
  return `Message:\n"""\n${text}\n"""`;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

/** Fail-open: any error, refusal, or unparsed response returns UNSURE rather than throwing. */
export async function classifyLanguage(text: string): Promise<ClassifyResult> {
  try {
    const response = await getClient().messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(text) }],
      output_config: {
        effort: "medium",
        format: zodOutputFormat(VerdictSchema),
      },
    });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      logger.warn({
        action: "language_classify_call",
        verdict: "UNSURE",
        refusal: true,
        stopReason: response.stop_reason,
        inputTokens,
        outputTokens,
      });
      return { verdict: "UNSURE" };
    }

    logger.info({
      action: "language_classify_call",
      verdict: response.parsed_output.verdict,
      reason: response.parsed_output.reason,
      inputTokens,
      outputTokens,
    });
    return response.parsed_output;
  } catch (err) {
    logger.error({ action: "language_classify_error", error: String(err) });
    return { verdict: "UNSURE" };
  }
}
