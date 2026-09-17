/**
 * Validation and selection of the provider's raw output. Pure module: takes
 * the raw JSON text a provider returned plus operation context, returns the
 * filtered application batch or a rejection reason. No HTTP, no provider types
 * leak through; provider content is never echoed in messages.
 */
import type { NormalizedRequest } from '../shared/contracts';
import { NAME_MAX } from '../shared/limits';
import { countCodePoints, hasControlCharacter, nameKey, normalizeDisplayWhitespace } from '../shared/text';

export interface SelectionStats {
  received: number;
  invalid: number;
  duplicates: number;
  excluded: number;
  valid: number;
}

export type SelectionReason = 'not-json' | 'wrong-shape' | 'empty';

export type SelectionOutcome =
  | { ok: true; names: string[]; partial: boolean; stats: SelectionStats }
  | {
      ok: false;
      reason: SelectionReason;
      stats: SelectionStats;
    };

export type AlbumSelectionOutcome =
  | { ok: true; title: string; tracks: string[]; partial: boolean; stats: SelectionStats }
  | {
      ok: false;
      reason: SelectionReason;
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

export interface AlbumSelectionInput {
  /** Raw provider content (a JSON string) to validate, never reconstructed. */
  content: string;
  /** How many track titles the provider was asked for. */
  requestedTracks: number;
  /** How many track titles the application displays. */
  displayTracks: number;
  request: NormalizedRequest;
}

function zeroStats(): SelectionStats {
  return { received: 0, invalid: 0, duplicates: 0, excluded: 0, valid: 0 };
}

/**
 * One candidate entry, validated independently. Non-strings, blanks,
 * overlength and control-character entries are dropped — never coerced or
 * shortened into a usable name.
 */
function normalizeEntry(entry: unknown): string | null {
  if (typeof entry !== 'string') return null;
  const trimmed = entry.trim();
  if (trimmed === '') return null;
  if (countCodePoints(trimmed) > NAME_MAX || hasControlCharacter(trimmed)) return null;
  return normalizeDisplayWhitespace(trimmed);
}

/** Recently displayed names, plus the refinement seed, as comparison keys. */
function exclusionKeys(request: NormalizedRequest): Set<string> {
  const keys = new Set(request.avoid.map(nameKey));
  if (request.seed !== null) keys.add(nameKey(request.seed));
  return keys;
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

/**
 * Exactly two keys, `title` and `tracks`, and no more tracks than requested.
 * Anything else is a different response shape and is rejected whole.
 */
function recordIsAlbumOnly(v: unknown, requestedTracks: number): v is { title: unknown; tracks: unknown } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v).sort();
  if (keys.length !== 2 || keys[0] !== 'title' || keys[1] !== 'tracks') return false;
  const { title, tracks } = v as { title: unknown; tracks: unknown };
  if (typeof title !== 'string') return false;
  if (!Array.isArray(tracks)) return false;
  return tracks.length <= requestedTracks;
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

  const displayed: string[] = [];
  for (const entry of rawNames) {
    const name = normalizeEntry(entry);
    if (name === null) {
      stats.invalid += 1;
      continue;
    }
    displayed.push(name);
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
  const excludedKeys = exclusionKeys(request);
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

/**
 * Album selection: one title plus the track list of a single release. The title
 * is the batch's identity rather than a candidate, so it is validated but not
 * filtered against the avoid list — that list applies to the tracks. A title
 * that cannot be used makes the response unusable rather than yielding an
 * album without a name.
 */
export function selectAlbum(input: AlbumSelectionInput): AlbumSelectionOutcome {
  const { content, requestedTracks, displayTracks, request } = input;
  const stats = zeroStats();

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'not-json', stats };
  }
  if (!recordIsAlbumOnly(parsed, requestedTracks)) {
    return { ok: false, reason: 'wrong-shape', stats };
  }
  const { title: rawTitle, tracks: rawTracks } = parsed as { title: unknown; tracks: unknown[] };

  const title = normalizeEntry(rawTitle);
  if (title === null) return { ok: false, reason: 'wrong-shape', stats };
  stats.received = rawTracks.length;

  const excludedKeys = exclusionKeys(request);
  // The title seeds the seen set so it never reappears as one of its own tracks.
  const seen = new Set<string>([nameKey(title)]);
  const tracks: string[] = [];
  for (const entry of rawTracks) {
    const track = normalizeEntry(entry);
    if (track === null) {
      stats.invalid += 1;
      continue;
    }
    const key = nameKey(track);
    if (seen.has(key)) {
      stats.duplicates += 1;
      continue;
    }
    if (excludedKeys.has(key)) {
      stats.excluded += 1;
      continue;
    }
    seen.add(key);
    tracks.push(track);
  }
  stats.valid = tracks.length;

  if (tracks.length === 0) return { ok: false, reason: 'empty', stats };

  const displayed = tracks.slice(0, displayTracks);
  return { ok: true, title, tracks: displayed, partial: displayed.length < displayTracks, stats };
}
