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

/**
 * Comparison key for duplicates and exclusions: Unicode compatibility
 * normalisation (NFKD), case folding, then whitespace normalisation. Displayed
 * values keep their original spelling and diacritics; only the key is folded.
 */
export function nameKey(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ');
}
