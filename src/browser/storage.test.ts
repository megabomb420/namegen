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

  it('writes no alias persona field', () => {
    persistPrefs({ version: 1, language: 'English', length: 'auto' });
    expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"version":1,"language":"English","length":"auto"}');
  });

  it('ignores an alias persona left behind by an older build', () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ version: 1, language: 'English', length: 'auto', aliasStyle: 'emo' }),
    );
    expect(loadPrefs()).toEqual({ version: 1, language: 'English', length: 'auto' });
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ version: 1, language: 'Japanese', length: 'short', aliasStyle: 'grunge' }),
    );
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
    persistShortlist([{ kind: 'name', id: 'a', name: 'Cold Front', mode: 'track', savedAt: 1 }]);
    expect(loadShortlist()).toEqual([{ kind: 'name', id: 'a', name: 'Cold Front', mode: 'track', savedAt: 1 }]);
  });

  it('reads entries written before albums existed as names', () => {
    window.localStorage.setItem(
      SHORTLIST_KEY,
      JSON.stringify({ version: 1, items: [{ id: 'old', name: 'Cold Front', mode: 'release', savedAt: 1 }] }),
    );
    expect(loadShortlist()).toEqual([{ kind: 'name', id: 'old', name: 'Cold Front', mode: 'release', savedAt: 1 }]);
  });

  it('round-trips an album entry as one shortlist item', () => {
    persistShortlist([
      { kind: 'album', id: 'b', title: 'Rain On The Windscreen', tracks: ['Wipers On Low', 'Halfway Home'], mode: 'release', savedAt: 2 },
    ]);
    expect(loadShortlist()).toEqual([
      { kind: 'album', id: 'b', title: 'Rain On The Windscreen', tracks: ['Wipers On Low', 'Halfway Home'], mode: 'release', savedAt: 2 },
    ]);
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
    expect(loadShortlist()).toEqual([{ kind: 'name', id: 'ok', name: 'Good Name', mode: 'artist', savedAt: 1 }]);
  });

  it('drops an album entry with a bad title or an impossible track list', () => {
    window.localStorage.setItem(
      SHORTLIST_KEY,
      JSON.stringify({
        version: 1,
        items: [
          { kind: 'album', id: 'good', title: 'Kept', tracks: ['One'], mode: 'release', savedAt: 1 },
          { kind: 'album', id: 'no-title', title: '', tracks: ['One'], mode: 'release', savedAt: 1 },
          { kind: 'album', id: 'long-title', title: 'x'.repeat(61), tracks: ['One'], mode: 'release', savedAt: 1 },
          { kind: 'album', id: 'control', title: 'Bad\u0007', tracks: ['One'], mode: 'release', savedAt: 1 },
          { kind: 'album', id: 'no-tracks', title: 'Empty', tracks: [], mode: 'release', savedAt: 1 },
          {
            kind: 'album',
            id: 'too-many',
            title: 'Thirteen',
            tracks: Array.from({ length: 13 }, (_, i) => `Track ${i}`),
            mode: 'release',
            savedAt: 1,
          },
          { kind: 'album', id: 'bad-track', title: 'Bad Track', tracks: ['ok', 7], mode: 'release', savedAt: 1 },
          { kind: 'album', id: 'wrong-mode', title: 'Wrong Mode', tracks: ['One'], mode: 'track', savedAt: 1 },
        ],
      }),
    );
    expect(loadShortlist()).toEqual([
      { kind: 'album', id: 'good', title: 'Kept', tracks: ['One'], mode: 'release', savedAt: 1 },
    ]);
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
    const items = Array.from({ length: 320 }, (_, i) => ({ kind: 'name' as const, id: `${i}`, name: `N ${i}`, mode: 'track' as const, savedAt: i }));
    expect(persistShortlist(items)).toBe(true);
    expect(loadShortlist()).toHaveLength(300);
  });
});

describe('session', () => {
  const valid = {
    version: 1 as const,
    batches: [
      { kind: 'names' as const, names: ['A Name'], partial: false, mode: 'track' as const, language: 'English', length: 'auto' as const, displayedAt: 2 },
    ],
    avoid: ['A Name'],
  };

  const album = {
    kind: 'album' as const,
    title: 'Rain On The Windscreen',
    tracks: ['Wipers On Low', 'Halfway Home'],
    partial: false,
    mode: 'release' as const,
    language: 'English',
    length: 'auto' as const,
    displayedAt: 3,
  };

  it('round-trips a valid session', () => {
    expect(persistSession(valid)).toBe(true);
    expect(loadSession()).toEqual(valid);
  });

  it('round-trips an album batch', () => {
    const session = { version: 1 as const, batches: [album], avoid: ['Rain On The Windscreen'] };
    expect(persistSession(session)).toBe(true);
    expect(loadSession()).toEqual(session);
  });

  it('reads batches written before albums existed as names', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        version: 1,
        batches: [
          { names: ['Old Name'], partial: false, mode: 'artist', language: 'English', length: 'auto', displayedAt: 1 },
        ],
        avoid: [],
      }),
    );
    expect(loadSession()).toEqual({
      version: 1,
      batches: [
        { kind: 'names', names: ['Old Name'], partial: false, mode: 'artist', language: 'English', length: 'auto', displayedAt: 1 },
      ],
      avoid: [],
    });
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

  it('rejects an album batch with a bad title or an impossible track list', () => {
    const bodies = [
      { ...album, title: '' },
      { ...album, title: 'x'.repeat(61) },
      { ...album, tracks: [] },
      { ...album, tracks: Array.from({ length: 13 }, (_, i) => `Track ${i}`) },
      { ...album, tracks: ['ok', 3] },
      { ...album, mode: 'track' },
      { ...album, language: '' },
    ];
    for (const body of bodies) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, batches: [body], avoid: [] }));
      expect(loadSession()).toBeNull();
    }
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
