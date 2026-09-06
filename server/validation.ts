/**
 * Request validation and normalisation for the canonical application request.
 * Ordinary server-side module: no HTTP, no provider types. Validation is
 * authoritative here; the browser performs the same checks for UX but the
 * server decides.
 */
import type { LengthPref, Mode, NormalizedRequest, Operation } from '../shared/contracts';
import { LENGTH_PREFS, MODES, OPERATIONS } from '../shared/contracts';
import {
  AVOID_MAX,
  BRIEF_MAX,
  DEFAULT_LANGUAGE,
  INSTRUCTION_MAX,
  LANGUAGE_MAX,
  NAME_MAX,
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

  const allowed = new Set(['operation', 'mode', 'brief', 'language', 'length', 'seed', 'instruction', 'avoid']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail('Unexpected field in request.');
  }

  if (typeof raw.operation !== 'string' || !OPERATIONS.includes(raw.operation as Operation)) {
    return fail('Operation must be "generate" or "refine".');
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

  const value: NormalizedRequest = { operation, mode, brief, language, length, seed, instruction, avoid };
  return { ok: true, value };
}
