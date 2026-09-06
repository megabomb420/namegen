/**
 * Browser storage boundary. All persistence goes through versioned wrappers
 * over localStorage (preferences, shortlist) and sessionStorage (current and
 * previous successful batches plus the recent-name exclusion list). Raw briefs,
 * lyrics, refinement instructions and open-sheet state never touch storage.
 *
 * Missing, corrupt, blocked or full storage must not crash the app: loaders
 * return safe defaults, persisters report success so callers can tell the
 * user only after a real write.
 */
import type { LengthPref, Mode } from '../../shared/contracts';
import { AVOID_MAX, NAME_MAX } from '../../shared/limits';
import { countCodePoints, hasControlCharacter } from '../../shared/text';
import type { SavedName } from '../state/types';

export interface StoredPrefs {
  version: 1;
  language: string;
  length: LengthPref;
}

export interface StoredBatch {
  names: string[];
  partial: boolean;
  mode: Mode;
  language: string;
  length: LengthPref;
  displayedAt: number;
}

export interface StoredSession {
  version: 1;
  batches: StoredBatch[];
  avoid: string[];
}

export const PREFS_KEY = 'namegen.prefs.v1';
export const SHORTLIST_KEY = 'namegen.shortlist.v1';
export const SESSION_KEY = 'namegen.session.v1';
export const SHORTLIST_CAP = 300;

function safeGet(storage: Storage | null, key: string): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | null, key: string, value: string): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: Storage | null, key: string): boolean {
  if (storage === null) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function validMode(v: unknown): v is Mode {
  return v === 'track' || v === 'release' || v === 'artist';
}

function validLength(v: unknown): v is LengthPref {
  return v === 'auto' || v === 'short';
}

function validName(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (countCodePoints(v) === 0 || countCodePoints(v) > NAME_MAX) return false;
  if (hasControlCharacter(v)) return false;
  return true;
}

function getLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(): StoredPrefs | null {
  const raw = safeGet(getLocal(), PREFS_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, language, length } = parsed as Record<string, unknown>;
    if (version !== 1 || typeof language !== 'string' || language === '' || !validLength(length)) {
      return null;
    }
    return { version: 1, language, length };
  } catch {
    return null;
  }
}

export function persistPrefs(prefs: StoredPrefs): boolean {
  return safeSet(getLocal(), PREFS_KEY, JSON.stringify(prefs));
}

export function loadShortlist(): SavedName[] {
  const raw = safeGet(getLocal(), SHORTLIST_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { version, items } = parsed as Record<string, unknown>;
    if (version !== 1 || !Array.isArray(items)) return [];
    const result: SavedName[] = [];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const { id, name, mode, savedAt } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !validName(name) || !validMode(mode) || typeof savedAt !== 'number') continue;
      result.push({ id, name, mode, savedAt });
    }
    return result;
  } catch {
    return [];
  }
}

export function persistShortlist(items: SavedName[]): boolean {
  return safeSet(getLocal(), SHORTLIST_KEY, JSON.stringify({ version: 1, items: items.slice(0, SHORTLIST_CAP) }));
}

function validStoredBatch(v: unknown): v is StoredBatch {
  if (typeof v !== 'object' || v === null) return false;
  const { names, partial, mode, language, length, displayedAt } = v as Record<string, unknown>;
  if (!Array.isArray(names) || names.length > 6 || names.some((n) => !validName(n))) return false;
  if (typeof partial !== 'boolean' || !validMode(mode)) return false;
  if (typeof language !== 'string' || language === '' || language.length > 40) return false;
  if (!validLength(length) || typeof displayedAt !== 'number') return false;
  return true;
}

export function loadSession(): StoredSession | null {
  const raw = safeGet(getSession(), SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { version, batches, avoid } = parsed as Record<string, unknown>;
    if (version !== 1 || !Array.isArray(batches) || batches.length > 2) return null;
    if (!Array.isArray(avoid) || avoid.length > AVOID_MAX || avoid.some((n) => !validName(n))) return null;
    if (batches.some((b) => !validStoredBatch(b))) return null;
    return { version: 1, batches: batches as StoredBatch[], avoid: avoid as string[] };
  } catch {
    return null;
  }
}

export function persistSession(session: StoredSession): boolean {
  return safeSet(getSession(), SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): boolean {
  return safeRemove(getSession(), SESSION_KEY);
}
