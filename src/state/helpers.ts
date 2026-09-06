/**
 * Pure client helpers for shortlist, exclusion and batch bookkeeping. No DOM,
 * no storage: unit-testable in isolation.
 */
import type { LengthPref, Mode } from '../../shared/contracts';
import { AVOID_MAX, NAME_MAX } from '../../shared/limits';
import { countCodePoints, hasControlCharacter, nameKey } from '../../shared/text';
import type { SavedName } from './types';

export function savedKey(name: string, mode: Mode): string {
  return `${mode}\u0000${nameKey(name)}`;
}

/** Same-mode duplicate comparison using the shared normalised key. */
export function findSaved(items: readonly SavedName[], name: string, mode: Mode): number {
  const target = savedKey(name, mode);
  return items.findIndex((item) => savedKey(item.name, item.mode) === target);
}

export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === '') return false;
  if (countCodePoints(trimmed) > NAME_MAX) return false;
  if (hasControlCharacter(trimmed)) return false;
  return true;
}

/**
 * Appends just-displayed names to the recent-name exclusion list. Bounded to
 * 24, deduplicated by comparison key, most recent last.
 */
export function pushAvoidNames(existing: readonly string[], displayed: readonly string[]): string[] {
  const list = existing.filter((n) => isValidDisplayName(n));
  const seen = new Set(list.map(nameKey));
  for (const name of displayed) {
    if (!isValidDisplayName(name)) continue;
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(name);
  }
  while (list.length > AVOID_MAX) list.shift();
  return list;
}

export function pushBatch<T extends DisplayBatchLike>(existing: readonly T[], batch: T, limit: number): T[] {
  const next: T[] = [...existing, batch];
  return next.slice(-limit);
}

export interface DisplayBatchLike {
  names: string[];
  partial: boolean;
  mode: Mode;
  language: string;
  length: LengthPref;
  brief: string | null;
  displayedAt: number;
}

export function toRefineRequest(input: {
  seed: string;
  mode: Mode;
  language: string;
  length: LengthPref;
  brief: string | null;
  contextDraft: string;
  instruction: string;
  avoid: readonly string[];
}): {
  request: { operation: 'refine'; seed: string; mode: Mode; language: string; length: LengthPref; brief: string; instruction: string; avoid: string[] };
  /** True when the originating brief was unavailable and context was used. */
  usedContextFallback: boolean;
} {
  const usedContextFallback = input.brief === null;
  const brief = input.brief ?? input.contextDraft;
  return {
    usedContextFallback,
    request: {
      operation: 'refine',
      seed: input.seed,
      mode: input.mode,
      language: input.language,
      length: input.length,
      brief,
      instruction: input.instruction,
      avoid: [...input.avoid],
    },
  };
}

export function emptyShortlist(): SavedName[] {
  return [];
}
