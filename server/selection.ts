/**
 * Validation and selection of the provider's raw output. Pure module: takes
 * the raw JSON text a provider returned plus operation context, returns the
 * filtered application batch or a rejection reason. No HTTP, no provider types
 * leak through; provider content is never echoed in messages.
 */
import { countCodePoints, hasControlCharacter, nameKey, normalizeDisplayWhitespace } from '../shared/text';
import type { NormalizedRequest } from '../shared/contracts';

export interface SelectionStats {
  received: number;
  invalid: number;
  duplicates: number;
  excluded: number;
  valid: number;
}

export type SelectionOutcome =
  | { ok: true; names: string[]; partial: boolean; stats: SelectionStats }
  | {
      ok: false;
      reason: 'not-json' | 'wrong-shape' | 'empty';
      stats: SelectionStats;
    };

export interface SelectionInput {
  /** Raw provider content (a JSON string) to validate, never reconstructed. */
  content: string;
  /** How many candidates the provider was asked for. */
  requested: number;
  /** How many candidates the application displays. */
  display: number;
  request: NormalizedRequest;
}

function zeroStats(): SelectionStats {
  return { received: 0, invalid: 0, duplicates: 0, excluded: 0, valid: 0 };
}

function recordIsNamesOnly(v: unknown, requested: number): v is { names: unknown } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 1 || keys[0] !== 'names') return false;
  const { names } = v as { names: unknown };
  if (!Array.isArray(names)) return false;
  // Arrays longer than the requested operation count are rejected wholesale.
  return names.length <= requested;
}

export function selectNames(input: SelectionInput): SelectionOutcome {
  const { content, requested, display, request } = input;
  const stats = zeroStats();

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'not-json', stats };
  }
  if (!recordIsNamesOnly(parsed, requested)) {
    return { ok: false, reason: 'wrong-shape', stats };
  }
  const rawNames = (parsed as { names: unknown[] }).names;
  stats.received = rawNames.length;

  // Independent candidate validation: drop non-strings, empty, overlength and
  // control-character-containing entries. Never coerce or shorten an invalid
  // entry into a name.
  const displayed: string[] = [];
  for (const entry of rawNames) {
    if (typeof entry !== 'string') {
      stats.invalid += 1;
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed === '') {
      stats.invalid += 1;
      continue;
    }
    if (countCodePoints(trimmed) > 60 || hasControlCharacter(trimmed)) {
      stats.invalid += 1;
      continue;
    }
    displayed.push(normalizeDisplayWhitespace(trimmed));
  }

  // Deduplicate with Unicode compatibility normalisation, case folding and
  // whitespace normalisation. Preserve the first readable spelling.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of displayed) {
    const key = nameKey(name);
    if (seen.has(key)) {
      stats.duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(name);
  }

  // Remove exclusions: recently displayed names and (for refine) the seed.
  const excludedKeys = new Set(request.avoid.map(nameKey));
  if (request.seed !== null) excludedKeys.add(nameKey(request.seed));
  const remaining: string[] = [];
  for (const name of unique) {
    const key = nameKey(name);
    if (excludedKeys.has(key)) {
      stats.excluded += 1;
      continue;
    }
    remaining.push(name);
  }
  stats.valid = remaining.length;

  if (remaining.length === 0) return { ok: false, reason: 'empty', stats };

  const names = remaining.slice(0, display);
  return { ok: true, names, partial: names.length < display, stats };
}
