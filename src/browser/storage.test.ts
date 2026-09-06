// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  loadPrefs,
  loadSession,
  loadShortlist,
  persistPrefs,
  persistSession,
  persistShortlist,
  PREFS_KEY,
  SESSION_KEY,
  SHORTLIST_KEY,
} from './storage';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('preferences', () => {
  it('round-trips valid versioned preferences', () => {
    expect(persistPrefs({ version: 1, language: 'Japanese', length: 'short' })).toBe(true);
    expect(loadPrefs()).toEqual({ version: 1, language: 'Japanese', length: 'short' });
  });

  it('returns null for missing, corrupt or wrong-version data', () => {
    expect(loadPrefs()).toBeNull();
    window.localStorage.setItem(PREFS_KEY, '{corrupt');
    expect(loadPrefs()).toBeNull();
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ version: 99, language: 'English', length: 'auto' }));
    expect(loadPrefs()).toBeNull();
  });
});

describe('shortlist', () => {
  it('round-trips saved names', () => {
    persistShortlist([{ id: 'a', name: 'Cold Front', mode: 'track', savedAt: 1 }]);
    expect(loadShortlist()).toEqual([{ id: 'a', name: 'Cold Front', mode: 'track', savedAt: 1 }]);
  });

  it('drops malformed entries instead of crashing', () => {
    window.localStorage.setItem(
      SHORTLIST_KEY,
      JSON.stringify({
        version: 1,
        items: [
          { id: 'ok', name: 'Good Name', mode: 'artist', savedAt: 1 },
          { id: 'bad', name: 'x'.repeat(200), mode: 'track', savedAt: 1 },
          { id: 'bad2', name: 'no-mode', mode: 'album', savedAt: 1 },
          'garbage',
        ],
      }),
    );
    expect(loadShortlist()).toEqual([{ id: 'ok', name: 'Good Name', mode: 'artist', savedAt: 1 }]);
  });

  it('returns an empty list when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadShortlist()).toEqual([]);
    expect(persistShortlist([])).toBe(false);
  });

  it('caps writes at 300 entries', () => {
    const items = Array.from({ length: 320 }, (_, i) => ({ id: `${i}`, name: `N ${i}`, mode: 'track' as const, savedAt: i }));
    expect(persistShortlist(items)).toBe(true);
    expect(loadShortlist()).toHaveLength(300);
  });
});

describe('session', () => {
  const valid = {
    version: 1 as const,
    batches: [
      { names: ['A Name'], partial: false, mode: 'track' as const, language: 'English', length: 'auto' as const, displayedAt: 2 },
    ],
    avoid: ['A Name'],
  };

  it('round-trips a valid session', () => {
    expect(persistSession(valid)).toBe(true);
    expect(loadSession()).toEqual(valid);
  });

  it('rejects corrupt sessions wholesale', () => {
    window.sessionStorage.setItem(SESSION_KEY, '{broken');
    expect(loadSession()).toBeNull();
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, batches: [{ names: [7], partial: false }], avoid: [] }),
    );
    expect(loadSession()).toBeNull();
  });

  it('rejects sessions with more than two batches or an oversized avoid list', () => {
    const three = {
      ...valid,
      batches: [valid.batches[0], valid.batches[0], valid.batches[0]],
    };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(three));
    expect(loadSession()).toBeNull();
    const manyAvoid = { ...valid, avoid: Array.from({ length: 25 }, (_, i) => `x${i}`) };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(manyAvoid));
    expect(loadSession()).toBeNull();
  });

  it('clearSession removes the record', () => {
    persistSession(valid);
    expect(clearSession()).toBe(true);
    expect(loadSession()).toBeNull();
  });
});
