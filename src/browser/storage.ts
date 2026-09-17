/**
 * Browser storage boundary. All persistence goes through versioned wrappers
 * over localStorage (preferences, shortlist) and sessionStorage (current and
 * previous successful batches plus the recent-name exclusion list). Raw briefs,
 * lyrics, refinement instructions and open-sheet state never touch storage.
 *
 * Missing, corrupt, blocked or full storage must not crash the app: loaders
 * return safe defaults, persisters report success so callers can tell the
 * user only after a real write.
 *
 * Records written before albums existed carry no `kind`; they are read as
 * names, so the album migration is additive and loses no stored data.
 */
import type { LengthPref, Mode } from '../../shared/contracts';
import { AVOID_MAX, NAME_MAX, TRACKS_MAX } from '../../shared/limits';
import { countCodePoints, hasControlCharacter } from '../../shared/text';
import type { SavedEntry } from '../state/types';

/**
 * Preferences. Records written before artist action cards carried an
 * `aliasStyle` field alongside these; it is ignored on read, so they still load.
 */
export interface StoredPrefs {
  version: 1;
  language: string;
  length: LengthPref;
}

export interface StoredNamesBatch {
  /** Absent on records written before albums existed. */
  kind?: 'names';
  names: string[];
  partial: boolean;
  mode: Mode;
  language: string;
  length: LengthPref;
  displayedAt: number;
}

export interface StoredAlbumBatch {
  kind: 'album';
  title: string;
  tracks: string[];
  partial: boolean;
  mode: 'release';
  language: string;
  length: LengthPref;
  displayedAt: number;
}

export type StoredBatch = StoredNamesBatch | StoredAlbumBatch;

export interface StoredSession {
  version: 1;
  batches: StoredBatch[];
  avoid: string[];
}

export const PREFS_KEY = 'namegen.prefs.v1';
export const SHORTLIST_KEY = 'namegen.shortlist.v1';
export const SESSION_KEY = 'namegen.session.v1';
export const SHORTLIST_CAP = 300;

/** Names a batch of flat names may hold; albums use the shared track limit. */
const NAMES_MAX = 6;

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

function validTracks(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > TRACKS_MAX) return false;
  return v.every((track) => validName(track));
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
    // Any other field on the record (an older `aliasStyle`) is ignored, not a
    // reason to discard the preferences.
    return { version: 1, language, length };
  } catch {
    return null;
  }
}

export function persistPrefs(prefs: StoredPrefs): boolean {
  return safeSet(getLocal(), PREFS_KEY, JSON.stringify(prefs));
}

export function loadShortlist(): SavedEntry[] {
  const raw = safeGet(getLocal(), SHORTLIST_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { version, items } = parsed as Record<string, unknown>;
    if (version !== 1 || !Array.isArray(items)) return [];
    const result: SavedEntry[] = [];
    for (const item of items) {
      // Invalid entries are dropped one by one; the rest of the list loads.
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const { kind, id, mode, savedAt } = record;
      if (typeof id !== 'string' || !validMode(mode) || typeof savedAt !== 'number') continue;
      if (kind === 'album') {
        if (mode !== 'release' || !validName(record.title) || !validTracks(record.tracks)) continue;
        result.push({ kind: 'album', id, title: record.title, tracks: record.tracks, mode: 'release', savedAt });
        continue;
      }
      if (kind !== undefined && kind !== 'name') continue;
      if (!validName(record.name)) continue;
      result.push({ kind: 'name', id, name: record.name, mode, savedAt });
    }
    return result;
  } catch {
    return [];
  }
}

export function persistShortlist(items: SavedEntry[]): boolean {
  return safeSet(getLocal(), SHORTLIST_KEY, JSON.stringify({ version: 1, items: items.slice(0, SHORTLIST_CAP) }));
}

function validStoredBatch(v: unknown): v is StoredBatch {
  if (typeof v !== 'object' || v === null) return false;
  const record = v as Record<string, unknown>;
  const { kind, partial, mode, language, length, displayedAt } = record;
  if (typeof partial !== 'boolean' || !validMode(mode)) return false;
  if (typeof language !== 'string' || language === '' || language.length > 40) return false;
  if (!validLength(length) || typeof displayedAt !== 'number') return false;
  if (kind === 'album') {
    return mode === 'release' && validName(record.title) && validTracks(record.tracks);
  }
  if (kind !== undefined && kind !== 'names') return false;
  const { names } = record;
  if (!Array.isArray(names) || names.length > NAMES_MAX || names.some((n) => !validName(n))) return false;
  return true;
}

function normalizeBatch(batch: StoredBatch): StoredBatch {
  if (batch.kind === 'album') return batch;
  return {
    kind: 'names',
    names: batch.names,
    partial: batch.partial,
    mode: batch.mode,
    language: batch.language,
    length: batch.length,
    displayedAt: batch.displayedAt,
  };
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
    return { version: 1, batches: (batches as StoredBatch[]).map(normalizeBatch), avoid: avoid as string[] };
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
