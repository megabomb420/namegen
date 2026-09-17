/**
 * Request validation and normalisation for the canonical application request.
 * Ordinary server-side module: no HTTP, no provider types. Validation is
 * authoritative here; the browser performs the same checks for UX but the
 * server decides.
 */
import type { AliasStyle, LengthPref, Mode, NormalizedRequest, Operation } from '../shared/contracts';
import { LENGTH_PREFS, MODES, OPERATIONS } from '../shared/contracts';
import {
  AVOID_MAX,
  BRIEF_MAX,
  DEFAULT_LANGUAGE,
  INSTRUCTION_MAX,
  LANGUAGE_MAX,
  NAME_MAX,
  TRACKS_MAX,
} from '../shared/limits';
import { countCodePoints, hasControlCharacter, nameKey } from '../shared/text';

export type RequestValidationResult =
  | { ok: true; value: NormalizedRequest }
  | { ok: false; message: string };

const MAX_BRIEF_MSG = `Brief exceeds ${BRIEF_MAX} characters.`;
const MAX_LANGUAGE_MSG = `Language exceeds ${LANGUAGE_MAX} characters.`;
const MAX_SEED_MSG = `Name exceeds ${NAME_MAX} characters.`;
const MAX_INSTRUCTION_MSG = `Refinement instruction exceeds ${INSTRUCTION_MAX} characters.`;
const MAX_AVOID_MSG = `The avoid list exceeds ${AVOID_MAX} names.`;
const MAX_ALBUM_TITLE_MSG = `Album title exceeds ${NAME_MAX} characters.`;
const MAX_TRACKS_MSG = `The album context exceeds ${TRACKS_MAX} tracks.`;
const INVALID_TRACK_MSG = 'Track list contains an invalid name.';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(message: string): RequestValidationResult {
  return { ok: false, message };
}

/**
 * Reads an optional string field. Returns a discriminated result: absent when
 * the field is missing or blank, invalid when it is not a string or exceeds
 * `max` code points, otherwise the trimmed value.
 */
type BoundedStringResult = { status: 'absent' } | { status: 'invalid' } | { status: 'value'; value: string };

function optionalBoundedString(raw: Record<string, unknown>, key: string, max: number): BoundedStringResult {
  const field = raw[key];
  if (field === undefined) return { status: 'absent' };
  if (typeof field !== 'string') return { status: 'invalid' };
  if (countCodePoints(field) > max) return { status: 'invalid' };
  const trimmed = field.trim();
  if (trimmed === '') return { status: 'absent' };
  return { status: 'value', value: trimmed };
}

export function normalizeRequest(raw: unknown): RequestValidationResult {
  if (!isRecord(raw)) return fail('Request body must be a JSON object.');

  const allowed = new Set([
    'operation',
    'mode',
    'brief',
    'language',
    'length',
    'seed',
    'instruction',
    'avoid',
    'aliasStyle',
    'albumTitle',
    'tracks',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail('Unexpected field in request.');
  }

  if (typeof raw.operation !== 'string' || !OPERATIONS.includes(raw.operation as Operation)) {
    return fail('Operation must be "generate", "refine", "alias" or "replaceTrack".');
  }
  const operation = raw.operation as Operation;

  if (typeof raw.mode !== 'string' || !MODES.includes(raw.mode as Mode)) {
    return fail('Mode must be "track", "release" or "artist".');
  }
  const mode = raw.mode as Mode;

  const briefField = optionalBoundedString(raw, 'brief', BRIEF_MAX);
  if (briefField.status === 'invalid') return fail(MAX_BRIEF_MSG);
  const brief = briefField.status === 'value' ? briefField.value : '';

  const languageField = optionalBoundedString(raw, 'language', LANGUAGE_MAX);
  if (languageField.status === 'invalid') return fail(MAX_LANGUAGE_MSG);
  const language = languageField.status === 'value' ? languageField.value : DEFAULT_LANGUAGE;

  let length: LengthPref = 'auto';
  if (raw.length !== undefined) {
    if (typeof raw.length !== 'string' || !LENGTH_PREFS.includes(raw.length as LengthPref)) {
      return fail('Length must be "auto" or "short".');
    }
    length = raw.length as LengthPref;
  }

  let seed: string | null = null;
  let instruction = '';
  if (operation === 'refine') {
    const seedField = optionalBoundedString(raw, 'seed', NAME_MAX);
    if (seedField.status === 'absent') return fail('Seed is required for refine.');
    if (seedField.status === 'invalid') return fail(MAX_SEED_MSG);
    if (hasControlCharacter(seedField.value)) return fail('Seed contains invalid characters.');
    seed = seedField.value;

    const instructionField = optionalBoundedString(raw, 'instruction', INSTRUCTION_MAX);
    if (instructionField.status === 'invalid') return fail(MAX_INSTRUCTION_MSG);
    if (instructionField.status === 'value') instruction = instructionField.value;
  } else {
    if (raw.seed !== undefined && typeof raw.seed === 'string' && raw.seed.trim() !== '') {
      return fail('Seed is only allowed for refine.');
    }
    if (raw.instruction !== undefined && typeof raw.instruction === 'string' && raw.instruction.trim() !== '') {
      return fail('Instruction is only allowed for refine.');
    }
  }

  // The alias operation is artist-only: the persona always names an artist.
  if (operation === 'alias' && mode !== 'artist') {
    return fail('Alias requests must use mode "artist".');
  }

  let aliasStyle: AliasStyle | undefined;
  if (raw.aliasStyle !== undefined) {
    if (operation !== 'alias') return fail('Alias style is only allowed for alias requests.');
    if (raw.aliasStyle !== 'wu' && raw.aliasStyle !== 'emo') {
      return fail('Alias style must be "wu" or "emo".');
    }
    aliasStyle = raw.aliasStyle;
  } else if (operation === 'alias') {
    aliasStyle = 'wu';
  }

  // replaceTrack is release-only and carries the album a new track must fit:
  // the album title plus the tracks that remain. Both are data, not instruction.
  let albumTitle: string | null = null;
  let tracks: string[] = [];
  if (operation === 'replaceTrack') {
    if (mode !== 'release') return fail('Replacement requests must use mode "release".');

    const titleField = optionalBoundedString(raw, 'albumTitle', NAME_MAX);
    if (titleField.status === 'invalid') return fail(MAX_ALBUM_TITLE_MSG);
    if (titleField.status === 'value' && hasControlCharacter(titleField.value)) {
      return fail('Album title contains invalid characters.');
    }
    albumTitle = titleField.status === 'value' ? titleField.value : null;

    if (!Array.isArray(raw.tracks)) return fail('Tracks must be an array of names.');
    if (raw.tracks.length > TRACKS_MAX) return fail(MAX_TRACKS_MSG);
    const seenTracks = new Set<string>();
    for (const entry of raw.tracks) {
      if (typeof entry !== 'string') return fail(INVALID_TRACK_MSG);
      const trimmed = entry.trim();
      if (trimmed === '') continue;
      if (countCodePoints(trimmed) > NAME_MAX || hasControlCharacter(trimmed)) return fail(INVALID_TRACK_MSG);
      const key = nameKey(trimmed);
      if (!seenTracks.has(key)) {
        seenTracks.add(key);
        tracks.push(trimmed);
      }
    }
  } else {
    if (raw.albumTitle !== undefined) return fail('Album title is only allowed for replacement requests.');
    if (raw.tracks !== undefined) return fail('Tracks are only allowed for replacement requests.');
  }

  // Avoid list: bounded count, each entry bounded and clean, deduplicated by
  // comparison key. Duplicates never inflate the wire list.
  let avoid: string[] = [];
  if (raw.avoid !== undefined) {
    if (!Array.isArray(raw.avoid)) return fail('Avoid must be an array of names.');
    if (raw.avoid.length > AVOID_MAX) return fail(MAX_AVOID_MSG);
    const seen = new Set<string>();
    for (const entry of raw.avoid) {
      if (typeof entry !== 'string') return fail('Avoid list contains an invalid name.');
      const trimmed = entry.trim();
      if (trimmed === '') continue;
      if (countCodePoints(trimmed) > NAME_MAX || hasControlCharacter(trimmed)) {
        return fail('Avoid list contains an invalid name.');
      }
      const key = nameKey(trimmed);
      if (!seen.has(key)) {
        seen.add(key);
        avoid.push(trimmed);
      }
    }
  }

  const value: NormalizedRequest = {
    operation,
    mode,
    brief,
    language,
    length,
    seed,
    instruction,
    avoid,
    aliasStyle,
    ...(operation === 'replaceTrack' ? { albumTitle, tracks } : {}),
  };
  return { ok: true, value };
}
