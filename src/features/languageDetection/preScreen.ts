import { LANGUAGE_MIN_WORDS } from "../../config/constants";

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Hard word-count gate, the only check that runs before the local detector. Kept at 2 (not
 * 3) so a short-but-fully-foreign phrase like "comment ca marche" still reaches the
 * classifier, which tells an assimilated loanword ("dm me") from a genuine foreign sentence
 * far better than a word count can.
 */
export function isCandidate(text: string): boolean {
  return countWords(text) > LANGUAGE_MIN_WORDS;
}
