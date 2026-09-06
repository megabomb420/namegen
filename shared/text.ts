/**
 * Pure text helpers used by both the server (validation, filtering, dedupe,
 * exclusions) and the browser (shortlist duplicate comparison). No DOM or node
 * APIs.
 */

/** Count Unicode code points (astral characters count once). */
export function countCodePoints(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

/** Control characters (Unicode Cc category: C0, C1, DEL). */
const CONTROL_RE = /\p{Cc}/u;

export function hasControlCharacter(value: string): boolean {
  return CONTROL_RE.test(value);
}

/** Collapse any run of whitespace to one space, then trim. */
export function normalizeDisplayWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

const ESZETT = '\u00df'; // ß — full case fold target is "ss"
const FINAL_SIGMA = '\u03c2'; // ς folds to σ under full case folding

/**
 * Unicode case folding for comparison keys: compatibility normalisation
 * (NFKD), lowercasing, then the multi-code-point full-fold cases JavaScript's
 * `toLowerCase` does not cover. Displayed values keep their original spelling
 * and diacritics; only the key is folded.
 */
export function caseFold(value: string): string {
  return value.normalize('NFKD').toLowerCase().replaceAll(ESZETT, 'ss').replaceAll(FINAL_SIGMA, '\u03c3');
}

/**
 * Comparison key for duplicates and exclusions: Unicode compatibility
 * normalisation (NFKD), case folding, then whitespace normalisation.
 */
export function nameKey(value: string): string {
  return caseFold(value).trim().replace(/\s+/gu, ' ');
}
