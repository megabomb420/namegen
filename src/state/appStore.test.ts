import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore, type StoreDeps } from './appStore';
import type { StoredBatch, StoredPrefs, StoredSession } from '../browser/storage';
import * as storage from '../browser/storage';
import type { WireOutcome } from '../browser/api';
import type { AlbumBatch, AppState, DisplayBatch, SavedEntry } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function successNames(names: string[], partial = false): WireOutcome {
  return { ok: true, kind: 'names', names, partial };
}

function successAlbum(title: string, tracks: string[], partial = false): WireOutcome {
  return { ok: true, kind: 'album', title, tracks, partial };
}

/** The displayed names of a batch, whichever shape it is. */
function batchNames(batch: DisplayBatch): string[] {
  return batch.kind === 'names' ? batch.names : batch.tracks;
}

/** The stored names of a batch, whichever shape it is. */
function storedNames(batch: StoredBatch): string[] {
  return batch.kind === 'album' ? batch.tracks : batch.names;
}

function albumBatch(state: AppState): AlbumBatch {
  const batch = state.batches[state.batches.length - 1];
  if (batch.kind !== 'album') throw new Error('expected the current batch to be an album');
  return batch;
}

/** Minimal Web Storage over a Map, so real storage validation can run in node. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

interface HarnessOptions {
  submitImpl?: () => Promise<WireOutcome>;
  persistShortlistImpl?: (items: SavedEntry[]) => boolean;
  persistSessionImpl?: (session: StoredSession) => boolean;
  clearSessionImpl?: () => boolean;
  loadSessionImpl?: () => StoredSession | null;
  sessionSeed?: StoredSession | null;
  shortlistSeed?: SavedEntry[];
  copyImpl?: (text: string) => Promise<boolean>;
}

interface Harness {
  store: AppStore;
  submit: ReturnType<typeof vi.fn>;
  sessionWrites: StoredSession[];
  shortlistWrites: SavedEntry[][];
  prefsWrites: StoredPrefs[];
}

function makeHarness(options: HarnessOptions = {}): Harness {
  let sessionValue: StoredSession | null = options.sessionSeed ?? null;
  let shortlistValue: SavedEntry[] = options.shortlistSeed ?? [];
  const sessionWrites: StoredSession[] = [];
  const shortlistWrites: SavedEntry[][] = [];
  const prefsWrites: StoredPrefs[] = [];
  const submit = vi.fn(options.submitImpl ?? (async () => successNames(['First', 'Second', 'Third'])));
  let idCounter = 0;
  const deps: StoreDeps = {
    submit: submit as unknown as StoreDeps['submit'],
    loadShortlist: () => shortlistValue,
    persistShortlist: (items) => {
      const ok = options.persistShortlistImpl ? options.persistShortlistImpl(items) : true;
      if (ok) {
        shortlistValue = items;
        shortlistWrites.push(items);
      }
      return ok;
    },
    loadPrefs: () => null,
    persistPrefs: (prefs) => {
      prefsWrites.push(prefs);
      return true;
    },
    loadSession: () => (options.loadSessionImpl ? options.loadSessionImpl() : sessionValue),
    persistSession: (session) => {
      const ok = options.persistSessionImpl ? options.persistSessionImpl(session) : true;
      if (ok) {
        sessionValue = session;
        sessionWrites.push(session);
      }
      return ok;
    },
    clearSession: () => {
      const ok = options.clearSessionImpl ? options.clearSessionImpl() : true;
      if (ok) sessionValue = null;
      return ok;
    },
    now: () => 1000,
    randomId: () => `id-${++idCounter}`,
    copy: options.copyImpl ?? (async () => true),
    later: () => undefined,
  };
  return { store: new AppStore(deps), submit, sessionWrites, shortlistWrites, prefsWrites };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('generate', () => {
  it('stores a successful batch, shows it, and persists names plus exclusions', async () => {
    const h = makeHarness({ submitImpl: async () => successNames(['Alpha', 'Beta', 'Gamma'], true) });
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(1);
    const request = h.submit.mock.calls[0][0];
    expect(request).toMatchObject({ operation: 'generate', mode: 'track', language: 'English', length: 'auto' });

    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const s = h.store.getState();
    expect(s.batches).toHaveLength(1);
    expect(batchNames(s.batches[0])).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(s.batches[0].brief).toBe('');
    expect(s.batches[0].partial).toBe(true);
    expect(s.error).toBeNull();
    expect(h.sessionWrites).toHaveLength(1);
    expect(storedNames(h.sessionWrites[0].batches[0])).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(h.sessionWrites[0].avoid).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('keeps the current and previous successful batches', async () => {
    const h = makeHarness();
    h.store.setBrief('first brief');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.setBrief('second brief');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const s = h.store.getState();
    expect(s.batches).toHaveLength(2);
    expect(s.viewIndex).toBe(1);
    // Only the latest batch carries its originating brief in memory.
    expect(s.batches[1].brief).toBe('second brief');
    expect(s.batches[0].brief).toBe('first brief');
  });

  it('drops the oldest batch beyond two', async () => {
    const h = makeHarness();
    for (const brief of ['a', 'b', 'c']) {
      h.store.setBrief(brief);
      h.store.generate();
      await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    }
    const s = h.store.getState();
    expect(s.batches.map((b) => b.brief)).toEqual(['b', 'c']);
  });

  it('allows only one active request per client instance', async () => {
    const d = deferred<WireOutcome>();
    const h = makeHarness({ submitImpl: () => d.promise });
    h.store.generate();
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(1);
    d.resolve(successNames(['X']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
  });

  it('keeps drafts and results on failure, records the snapshot for retry', async () => {
    const h = makeHarness({
      submitImpl: async () => ({ ok: false, code: 'UPSTREAM_ERROR', message: 'down', retryable: true }),
    });
    h.store.setBrief('my draft');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().error).not.toBeNull());
    const s = h.store.getState();
    expect(s.briefByMode.track).toBe('my draft');
    expect(s.error).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: true });
    expect(s.errorSnapshot).toMatchObject({ operation: 'generate', brief: 'my draft' });
    expect(s.batches).toHaveLength(0);
  });

  it('retry resubmits the failed request snapshot exactly', async () => {
    let calls = 0;
    const h = makeHarness({
      submitImpl: async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, code: 'UNUSABLE_OUTPUT', message: 'empty', retryable: true }
          : successNames(['Recovered']);
      },
    });
    h.store.setBrief('snapshot text');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().error).not.toBeNull());
    const firstSnapshot = h.submit.mock.calls[0][0];
    h.store.retryFailedRequest();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.submit.mock.calls[1][0]).toEqual(firstSnapshot);
    expect(h.store.getState().error).toBeNull();
  });

  it('ignores a new generate while a request is in flight', async () => {
    const d = deferred<WireOutcome>();
    const h = makeHarness({ submitImpl: () => d.promise });
    h.store.setBrief('one');
    h.store.generate();
    h.store.setBrief('two');
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(1);
    d.resolve(successNames(['Zed']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    // The batch reflects the first submitted snapshot, not the edited draft.
    expect(h.store.getState().batches[0].brief).toBe('one');
  });

  it('flags when session persistence fails', async () => {
    const h = makeHarness({ persistSessionImpl: () => false });
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.store.getState().sessionUnavailable).toBe(true);
    expect(h.store.getState().batches).toHaveLength(1);
  });
});

describe('release albums', () => {
  it('stores one album batch and persists its title and tracks', async () => {
    const h = makeHarness({
      submitImpl: async () => successAlbum('Rain On The Windscreen', ['Wipers On Low', 'Halfway Home'], true),
    });
    h.store.setMode('release');
    h.store.generate();
    expect(h.submit.mock.calls[0][0]).toMatchObject({ operation: 'generate', mode: 'release' });
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batch = h.store.getState().batches[0];
    expect(batch).toMatchObject({
      kind: 'album',
      title: 'Rain On The Windscreen',
      tracks: ['Wipers On Low', 'Halfway Home'],
      partial: true,
      mode: 'release',
      language: 'English',
      length: 'auto',
    });
    // The album title and every track join the exclusion list.
    expect(h.store.getState().avoidNames).toEqual(['Rain On The Windscreen', 'Wipers On Low', 'Halfway Home']);
    expect(h.sessionWrites[0].batches[0]).toEqual({
      kind: 'album',
      title: 'Rain On The Windscreen',
      tracks: ['Wipers On Low', 'Halfway Home'],
      partial: true,
      mode: 'release',
      language: 'English',
      length: 'auto',
      displayedAt: 1000,
    });
  });

  it('restores an album batch from a session', () => {
    const session: StoredSession = {
      version: 1,
      batches: [
        {
          kind: 'album',
          title: 'Old Album',
          tracks: ['One', 'Two'],
          partial: false,
          mode: 'release',
          language: 'Japanese',
          length: 'short',
          displayedAt: 5,
        },
      ],
      avoid: ['Old Album'],
    };
    const h = makeHarness({ sessionSeed: session });
    const batch = h.store.getState().batches[0];
    expect(batch).toMatchObject({ kind: 'album', title: 'Old Album', tracks: ['One', 'Two'], brief: null });
    expect(h.store.getState().avoidNames).toEqual(['Old Album']);
  });

  it('replaces only the targeted track and pushes the new title into exclusions', async () => {
    let call = 0;
    const h = makeHarness({
      submitImpl: async () => {
        call += 1;
        return call === 1
          ? successAlbum('Album One', ['First', 'Second', 'Third'])
          : successNames(['Replacement']);
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const before = albumBatch(h.store.getState());
    h.store.replaceTrack(before.id, 1);
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.submit.mock.calls[1][0]).toEqual({
      operation: 'replaceTrack',
      mode: 'release',
      albumTitle: 'Album One',
      tracks: ['First', 'Third'],
      brief: '',
      language: 'English',
      length: 'auto',
      avoid: ['Album One', 'First', 'Second', 'Third'],
    });

    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const s = h.store.getState();
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]).toMatchObject({ kind: 'album', id: before.id, tracks: ['First', 'Replacement', 'Third'] });
    expect(s.avoidNames).toEqual(['Album One', 'First', 'Second', 'Third', 'Replacement']);
    expect(s.replacementError).toBeNull();
    expect(storedNames(h.sessionWrites[h.sessionWrites.length - 1].batches[0])).toEqual([
      'First',
      'Replacement',
      'Third',
    ]);
  });

  it('keeps the old title and records the row error when a replacement fails', async () => {
    let call = 0;
    const h = makeHarness({
      submitImpl: async () => {
        call += 1;
        if (call === 1) return successAlbum('Album One', ['First', 'Second']);
        return { ok: false, code: 'UPSTREAM_ERROR', message: 'down', retryable: true };
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batchId = albumBatch(h.store.getState()).id;
    h.store.replaceTrack(batchId, 0);
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const s = h.store.getState();
    expect(s.batches[0]).toMatchObject({ tracks: ['First', 'Second'] });
    expect(s.replacementError).toEqual({ batchId, index: 0, message: 'down', retryable: true });
    expect(s.error).toBeNull();
    expect(s.avoidNames).toEqual(['Album One', 'First', 'Second']);
  });

  it('retryReplacement resubmits the identical snapshot', async () => {
    let call = 0;
    const h = makeHarness({
      submitImpl: async () => {
        call += 1;
        if (call === 1) return successAlbum('Album One', ['First', 'Second']);
        if (call === 2) return { ok: false, code: 'UNUSABLE_OUTPUT', message: 'empty', retryable: true };
        return successNames(['Replacement']);
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.replaceTrack(albumBatch(h.store.getState()).id, 1);
    await vi.waitFor(() => expect(h.store.getState().replacementError).not.toBeNull());
    const failed = h.submit.mock.calls[1][0];
    h.store.retryReplacement();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.submit).toHaveBeenCalledTimes(3);
    expect(h.submit.mock.calls[2][0]).toEqual(failed);
    expect(h.store.getState().batches[0]).toMatchObject({ tracks: ['First', 'Replacement'] });
    expect(h.store.getState().replacementError).toBeNull();
  });

  it('ignores a replacement while another request is in flight', async () => {
    const d = deferred<WireOutcome>();
    const h = makeHarness({
      submitImpl: async () => {
        return h.submit.mock.calls.length === 1 ? successAlbum('Album One', ['First', 'Second']) : d.promise;
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batchId = albumBatch(h.store.getState()).id;
    h.store.replaceTrack(batchId, 0);
    expect(h.store.getState().pending).toMatchObject({ kind: 'replaceTrack', batchId, trackIndex: 0 });
    h.store.replaceTrack(batchId, 1);
    expect(h.submit).toHaveBeenCalledTimes(2);
    d.resolve(successNames(['Late']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
  });

  it('opening Explore on the album title carries the album; a track row does not', async () => {
    const h = makeHarness({ submitImpl: async () => successAlbum('Album One', ['First', 'Second']) });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batch = albumBatch(h.store.getState());
    h.store.openExplore('First', batch);
    expect(h.store.getState().explore).toMatchObject({ seed: 'First', mode: 'release', album: null });
    h.store.openExplore('Album One', batch);
    expect(h.store.getState().explore?.album).toEqual({ title: 'Album One', tracks: ['First', 'Second'] });
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('toggles the whole album from the Explore sheet Save chip', async () => {
    const h = makeHarness({ submitImpl: async () => successAlbum('Album One', ['First', 'Second']) });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.openExplore('Album One', albumBatch(h.store.getState()));
    h.store.toggleExploreSave();
    const saved = h.store.getState().shortlist;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: 'album', title: 'Album One', tracks: ['First', 'Second'], mode: 'release' });
    h.store.toggleExploreSave();
    expect(h.store.getState().shortlist).toHaveLength(0);
  });

  it('clears a failed replacement with the working session but keeps the shortlist', async () => {
    let call = 0;
    const h = makeHarness({
      submitImpl: async () => {
        call += 1;
        if (call === 1) return successAlbum('Album One', ['First']);
        return { ok: false, code: 'UPSTREAM_ERROR', message: 'down', retryable: true };
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batch = albumBatch(h.store.getState());
    h.store.toggleSaveAlbum(batch);
    h.store.replaceTrack(batch.id, 0);
    await vi.waitFor(() => expect(h.store.getState().replacementError).not.toBeNull());
    h.store.clearWorkingSession();
    const s = h.store.getState();
    expect(s.replacementError).toBeNull();
    expect(s.batches).toHaveLength(0);
    expect(s.shortlist).toHaveLength(1);
  });
});

describe('stale and cleared responses', () => {
  it('cleared work cannot reappear through a late response', async () => {
    const d = deferred<WireOutcome>();
    const h = makeHarness({ submitImpl: () => d.promise });
    h.store.setBrief('will be cleared');
    h.store.generate();
    h.store.clearWorkingSession();
    d.resolve(successNames(['Late Ghost']));
    await vi.waitFor(() => expect(h.submit).toHaveBeenCalled());
    const s = h.store.getState();
    expect(s.batches).toHaveLength(0);
    expect(s.briefByMode.track).toBe('');
    expect(s.error).toBeNull();
  });

  it('cleared work cannot reappear, and transport stays locked until settlement', async () => {
    const first = deferred<WireOutcome>();
    const second = deferred<WireOutcome>();
    let call = 0;
    const h = makeHarness({
      submitImpl: () => {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      },
    });
    h.store.generate();
    h.store.clearWorkingSession();
    h.store.setBrief('fresh');
    // A new request while the invalidated one is still in flight is refused:
    // one active model request per client instance is a transport rule.
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.store.getState().requestActive).toBe(true);

    first.resolve(successNames(['Stale']));
    await vi.waitFor(() => expect(h.store.getState().requestActive).toBe(false));
    expect(h.store.getState().batches).toHaveLength(0);

    // Once settled, the next request is allowed and applies normally.
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(2);
    second.resolve(successNames(['Fresh']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(batchNames(h.store.getState().batches[0])).toEqual(['Fresh']);
    expect(h.store.getState().batches[0].brief).toBe('fresh');
    expect(h.store.getState().requestActive).toBe(false);
  });

  it('closing Explore mid-refine keeps it closed and never allows a concurrent request', async () => {
    const h = makeHarness({
      submitImpl: async () => successNames(['Base', 'Idea']),
    });
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batch = h.store.getState().batches[0];
    h.store.openExplore('Base', batch);

    const refine = deferred<WireOutcome>();
    h.submit.mockImplementation(() => refine.promise);
    h.store.submitRefine();
    expect(h.store.getState().pending?.kind).toBe('refine');
    h.store.closeExplore();

    // Refinement still in flight: a generate attempt must not start.
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.store.getState().requestActive).toBe(true);

    refine.resolve(successNames(['Ghost', 'Alt']));
    await vi.waitFor(() => expect(h.store.getState().requestActive).toBe(false));
    const s = h.store.getState();
    expect(s.explore).toBeNull();
    expect(s.pending).toBeNull();
    // The abandoned refinement is not resurrected into the recovery list.
    expect(s.batches).toHaveLength(1);
    expect(batchNames(s.batches[0])).toEqual(['Base', 'Idea']);

    // Settlement released the transport lock; a new generate is now allowed.
    h.store.generate();
    expect(h.submit).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.store.getState().batches).toHaveLength(2);
  });
});

describe('Explore (local) and refine', () => {
  it('opening Explore is entirely local and never requests', async () => {
    const h = makeHarness();
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.openExplore('First', h.store.getState().batches[0]);
    expect(h.submit).toHaveBeenCalledTimes(1);
    const s = h.store.getState();
    expect(s.explore?.seed).toBe('First');
    expect(s.explore?.brief).toBe('');
    expect(s.pending).toBeNull();
  });

  it('sends seed, snapshot context and instruction on refine, and shows alternatives', async () => {
    let seen: unknown;
    const h = makeHarness({
      submitImpl: async () => successNames(['Base', 'Idea']),
    });
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const batch = h.store.getState().batches[0];
    h.store.openExplore('Base', batch);
    h.submit.mockImplementation(async (request: unknown) => {
      seen = request;
      return successNames(['Derived A', 'Derived B', 'Derived C', 'Derived D'], true);
    });
    h.store.setExploreInstruction('shorter');
    h.store.submitRefine();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(seen).toMatchObject({
      operation: 'refine',
      mode: 'track',
      seed: 'Base',
      instruction: 'shorter',
      brief: '',
    });
    const s = h.store.getState();
    expect(s.explore?.alternatives).toEqual(['Derived A', 'Derived B', 'Derived C', 'Derived D']);
    expect(s.explore?.partial).toBe(true);
    // The completed refinement also entered the bounded recovery list, so it
    // survives closing the sheet and further exploration.
    expect(s.batches).toHaveLength(2);
    expect(batchNames(s.batches[0])).toEqual(['Base', 'Idea']);
    expect(batchNames(s.batches[1])).toEqual(['Derived A', 'Derived B', 'Derived C', 'Derived D']);
    expect(s.viewIndex).toBe(1);
    expect(s.batches[1].brief).toBe('');
    expect(s.batches[1].partial).toBe(true);

    // Closing the sheet keeps the refined batch as current; Previous still
    // reaches the batch the seed came from.
    h.store.closeExplore();
    const afterClose = h.store.getState();
    expect(afterClose.explore).toBeNull();
    expect(batchNames(afterClose.batches[afterClose.viewIndex])[0]).toBe('Derived A');
    h.store.setViewIndex(0);
    expect(batchNames(h.store.getState().batches[0])).toEqual(['Base', 'Idea']);

    // Persisted session carries the refined batch metadata but no raw context.
    const lastSession = h.sessionWrites[h.sessionWrites.length - 1];
    expect(lastSession.batches.map((b) => storedNames(b)[0])).toEqual(['Base', 'Derived A']);
    expect(JSON.stringify(lastSession)).not.toContain('shorter');
    expect(JSON.stringify(lastSession)).not.toContain('un disque');
  });

  it('explores a saved name locally with its mode and current preferences', async () => {
    const h = makeHarness();
    h.store.setLanguage('Japanese');
    h.store.setLength('short');
    h.store.toggleSave('Golden Gate', 'artist');
    const before = h.submit.mock.calls.length;
    h.store.openSavedExplore(h.store.getState().shortlist[0]);
    expect(h.submit).toHaveBeenCalledTimes(before); // local only
    const s = h.store.getState();
    expect(s.explore?.seed).toBe('Golden Gate');
    expect(s.explore?.mode).toBe('artist');
    expect(s.explore?.language).toBe('Japanese');
    expect(s.explore?.length).toBe('short');
    expect(s.explore?.brief).toBeNull();
    expect(s.explore?.album).toBeNull();
    expect(s.pending).toBeNull();

    // Refinement from a saved name uses its mode and the current preferences,
    // with the sheet's context field standing in for the missing brief.
    let seen: unknown;
    h.submit.mockImplementation(async (request: unknown) => {
      seen = request;
      return successNames(['新しい名']);
    });
    h.store.setExploreContextDraft('gate at golden hour');
    h.store.submitRefine();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(seen).toMatchObject({
      operation: 'refine',
      mode: 'artist',
      language: 'Japanese',
      length: 'short',
      seed: 'Golden Gate',
      brief: 'gate at golden hour',
    });
  });

  it('explores a saved album entry locally with its tracks', async () => {
    const h = makeHarness({ submitImpl: async () => successAlbum('Album One', ['First', 'Second']) });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.toggleSaveAlbum(albumBatch(h.store.getState()));
    const before = h.submit.mock.calls.length;
    h.store.openSavedExplore(h.store.getState().shortlist[0]);
    expect(h.submit).toHaveBeenCalledTimes(before);
    const explore = h.store.getState().explore;
    expect(explore).toMatchObject({ seed: 'Album One', mode: 'release', brief: null });
    expect(explore?.album).toEqual({ title: 'Album One', tracks: ['First', 'Second'] });
  });

  it('restored batches have no brief and refine uses the added context', async () => {
    const session: StoredSession = {
      version: 1,
      batches: [
        {
          names: ['Restored One'],
          partial: false,
          mode: 'artist',
          language: 'French',
          length: 'short',
          displayedAt: 1,
        },
      ],
      avoid: [],
    };
    const h = makeHarness({ sessionSeed: session });
    const s0 = h.store.getState();
    expect(s0.batches[0].brief).toBeNull();
    h.store.openExplore('Restored One', s0.batches[0]);
    expect(h.store.getState().explore?.mode).toBe('artist');

    let seen: unknown;
    h.submit.mockImplementation(async (request: unknown) => {
      seen = request;
      return successNames(['Nouvelle']);
    });
    h.store.setExploreContextDraft('un disque de nuit');
    h.store.submitRefine();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(seen).toMatchObject({
      operation: 'refine',
      seed: 'Restored One',
      mode: 'artist',
      language: 'French',
      length: 'short',
      brief: 'un disque de nuit',
    });
  });
});

describe('alias operation', () => {
  it('submits a wu alias request with aliasStyle wu', async () => {
    const h = makeHarness({ submitImpl: async () => successNames(['Iron Raven']) });
    h.store.setMode('artist');
    h.store.generateAlias('wu');
    expect(h.submit.mock.calls[0][0]).toEqual({
      operation: 'alias',
      mode: 'artist',
      aliasStyle: 'wu',
      brief: '',
      language: 'English',
      avoid: [],
    });
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
  });

  it('submits an emo alias request with aliasStyle emo and the brief', async () => {
    const h = makeHarness({ submitImpl: async () => successNames(['Wilted Crown']) });
    h.store.setMode('artist');
    h.store.setBrief('late buses');
    h.store.generateAlias('emo');
    expect(h.submit.mock.calls[0][0]).toEqual({
      operation: 'alias',
      mode: 'artist',
      aliasStyle: 'emo',
      brief: 'late buses',
      language: 'English',
      avoid: [],
    });
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.store.getState().batches[0]).toMatchObject({ kind: 'names', mode: 'artist' });
  });

  it('submits the brief persona with the brief and shows it as a batch', async () => {
    const h = makeHarness({ submitImpl: async () => successNames(['Iron Raven', 'Sable Oracle']) });
    h.store.setMode('artist');
    h.store.setBrief('rhymes about late buses');
    h.store.generateAlias('brief');
    expect(h.submit.mock.calls[0][0]).toMatchObject({
      operation: 'alias',
      mode: 'artist',
      aliasStyle: 'brief',
      brief: 'rhymes about late buses',
    });
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    const s = h.store.getState();
    expect(s.batches).toHaveLength(1);
    expect(batchNames(s.batches[0])).toEqual(['Iron Raven', 'Sable Oracle']);
    expect(s.batches[0].mode).toBe('artist');
  });

  it('never sends the brief persona with an empty brief', () => {
    const h = makeHarness();
    h.store.setMode('artist');
    h.store.generateAlias('brief');
    expect(h.submit).not.toHaveBeenCalled();
    const s = h.store.getState();
    expect(s.pending).toBeNull();
    expect(s.error).toBeNull();
  });

  it('routes the main artist action to the brief persona', async () => {
    const h = makeHarness({ submitImpl: async () => successNames(['Sable Oracle']) });
    h.store.setMode('artist');
    h.store.setBrief('late buses');
    h.store.generate();
    // Artist mode never sends a generate operation, and never a length hint.
    expect(h.submit.mock.calls[0][0]).toEqual({
      operation: 'alias',
      mode: 'artist',
      aliasStyle: 'brief',
      brief: 'late buses',
      language: 'English',
      avoid: [],
    });
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.store.getState().batches[0]).toMatchObject({ kind: 'names', mode: 'artist' });
  });

  it('does nothing at all when the artist brief is empty', () => {
    const h = makeHarness();
    h.store.setMode('artist');
    h.store.generate();
    expect(h.submit).not.toHaveBeenCalled();
    const s = h.store.getState();
    expect(s.error).toBeNull();
    expect(s.errorSnapshot).toBeNull();
    expect(s.pending).toBeNull();
    expect(s.requestActive).toBe(false);
  });

  it('marks the pending request with the persona that was clicked', async () => {
    const d = deferred<WireOutcome>();
    const h = makeHarness({ submitImpl: () => d.promise });
    h.store.setMode('artist');
    h.store.generateAlias('emo');
    expect(h.store.getState().pending).toMatchObject({ kind: 'alias', aliasStyle: 'emo' });
    d.resolve(successNames(['Wilted Crown']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
  });

  it('writes preferences without the removed persona field', () => {
    const h = makeHarness();
    h.store.setLanguage('Japanese');
    h.store.setLength('short');
    expect(h.prefsWrites).toEqual([
      { version: 1, language: 'Japanese', length: 'auto' },
      { version: 1, language: 'Japanese', length: 'short' },
    ]);
    expect(h.store.getState()).not.toHaveProperty('aliasStyle');
  });

  it('keeps an alias batch through a session round-trip', async () => {
    vi.stubGlobal('window', { sessionStorage: memoryStorage() });
    const h = makeHarness({
      submitImpl: async () => successNames(['Iron Raven', 'Sable Oracle']),
      persistSessionImpl: (session) => storage.persistSession(session),
    });
    h.store.setLanguage('Japanese');
    h.store.setMode('artist');
    h.store.setBrief('late buses');
    h.store.generateAlias('brief');
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.submit.mock.calls[0][0]).toMatchObject({ operation: 'alias', mode: 'artist', language: 'Japanese' });

    // Reload through the real loader: an alias batch used to be rejected here
    // because its stored batch language was empty.
    const reloaded = makeHarness({ loadSessionImpl: () => storage.loadSession() });
    const restored = reloaded.store.getState();
    expect(restored.batches).toHaveLength(1);
    expect(restored.batches[0]).toMatchObject({
      kind: 'names',
      mode: 'artist',
      language: 'Japanese',
      names: ['Iron Raven', 'Sable Oracle'],
    });
  });
});

describe('per-mode brief drafts', () => {
  it('keeps each mode brief separate and remembers it across switches', () => {
    const h = makeHarness();
    h.store.setMode('track');
    h.store.setBrief('track idea');
    h.store.setMode('release');
    expect(h.store.getState().briefByMode.track).toBe('track idea');
    expect(h.store.getState().briefByMode.release).toBe('');
    h.store.setBrief('release idea');
    h.store.setMode('artist');
    h.store.setBrief('artist idea');
    h.store.setMode('release');
    expect(h.store.getState().briefByMode.release).toBe('release idea');
    h.store.setMode('track');
    expect(h.store.getState().briefByMode.track).toBe('track idea');
    expect(h.store.getState().briefByMode.artist).toBe('artist idea');
  });

  it('generates with the active mode brief snapshot only', async () => {
    const h = makeHarness();
    h.store.setMode('release');
    h.store.setBrief('album mood');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.submit.mock.calls[0][0]).toMatchObject({ mode: 'release', brief: 'album mood' });
    h.store.setMode('track');
    expect(h.store.getState().briefByMode.track).toBe('');
  });

  it('clear working session empties every mode draft', async () => {
    const h = makeHarness();
    for (const mode of ['track', 'release', 'artist'] as const) {
      h.store.setMode(mode);
      h.store.setBrief(`${mode} text`);
    }
    h.store.clearWorkingSession();
    expect(h.store.getState().briefByMode).toEqual({ track: '', release: '', artist: '' });
  });
});

describe('shortlist', () => {
  it('saves then unsaves with the normalised same-mode duplicate rule', async () => {
    const h = makeHarness();
    h.store.toggleSave('Café', 'track');
    expect(h.store.getState().shortlist).toHaveLength(1);
    // Compatibility/case-folded duplicate removes rather than doubles.
    h.store.toggleSave('CAFÉ', 'track');
    expect(h.store.getState().shortlist).toHaveLength(0);
    // Same name under a different mode is a distinct entry.
    h.store.toggleSave('Café', 'release');
    expect(h.store.getState().shortlist).toHaveLength(1);
  });

  it('saves a whole album as exactly one entry and copies it with numbered tracks', async () => {
    const copied: string[] = [];
    const h = makeHarness({
      submitImpl: async () => successAlbum('Album One', ['First', 'Second']),
      copyImpl: async (text) => {
        copied.push(text);
        return true;
      },
    });
    h.store.setMode('release');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.toggleSaveAlbum(albumBatch(h.store.getState()));
    expect(h.store.getState().shortlist).toHaveLength(1);
    expect(h.store.getState().shortlist[0]).toMatchObject({
      kind: 'album',
      title: 'Album One',
      tracks: ['First', 'Second'],
      mode: 'release',
    });
    // Saving the album title from a row toggles that same entry.
    h.store.toggleSave('Album One', 'release');
    expect(h.store.getState().shortlist).toHaveLength(0);

    h.store.toggleSaveAlbum(albumBatch(h.store.getState()));
    h.store.toggleSave('Solo Name', 'track');
    await h.store.copyShortlist();
    // Entries are separated by a blank line; an album copies its title first.
    expect(copied[copied.length - 1]).toBe('Album One\n1. First\n2. Second\n\nSolo Name');
  });

  it('never silently evicts beyond 300 entries', async () => {
    const seeded = Array.from({ length: 300 }, (_, i) => ({
      kind: 'name' as const,
      id: `s${i}`,
      name: `Name ${i}`,
      mode: 'track' as const,
      savedAt: i,
    }));
    const h = makeHarness({ shortlistSeed: seeded });
    h.store.toggleSave('Name 301', 'track');
    const s = h.store.getState();
    expect(s.shortlist).toHaveLength(300);
    expect(s.toast?.message).toContain('Shortlist is full');
  });

  it('never silently evicts albums beyond 300 entries either', async () => {
    const seeded = Array.from({ length: 300 }, (_, i) => ({
      kind: 'album' as const,
      id: `s${i}`,
      title: `Album ${i}`,
      tracks: [`Track ${i}`],
      mode: 'release' as const,
      savedAt: i,
    }));
    const h = makeHarness({ shortlistSeed: seeded });
    h.store.toggleSaveAlbum({ title: 'Album 301', tracks: ['Track 301'] });
    const s = h.store.getState();
    expect(s.shortlist).toHaveLength(300);
    expect(s.toast?.message).toContain('Shortlist is full');
  });

  it('reports a failed save only when persistence failed', async () => {
    const h = makeHarness({ persistShortlistImpl: () => false });
    h.store.toggleSave('No Persist', 'track');
    const s = h.store.getState();
    expect(s.shortlist).toHaveLength(0);
    expect(s.toast?.message).toContain("Couldn't save");
  });
});

describe('working session controls', () => {
  it('clears results, drafts, exclusions and pending work but keeps the shortlist', async () => {
    const h = makeHarness();
    h.store.setBrief('draft');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.toggleSave('First', 'track');
    const shortlistBefore = h.store.getState().shortlist.length;
    h.store.setBrief('kept in memory until cleared');
    h.store.clearWorkingSession();
    const s = h.store.getState();
    expect(s.batches).toHaveLength(0);
    expect(s.briefByMode.track).toBe('');
    expect(s.avoidNames).toHaveLength(0);
    expect(s.error).toBeNull();
    expect(s.replacementError).toBeNull();
    expect(s.shortlist).toHaveLength(shortlistBefore);
  });

  it('restores only validated batches with no request or explore state', () => {
    const session: StoredSession = {
      version: 1,
      batches: [
        { names: ['Old'], partial: false, mode: 'track', language: 'English', length: 'auto', displayedAt: 1 },
        { names: ['Newer'], partial: true, mode: 'track', language: 'English', length: 'auto', displayedAt: 2 },
      ],
      avoid: ['Old'],
    };
    const h = makeHarness({ sessionSeed: session });
    const s = h.store.getState();
    expect(s.batches.map((b) => batchNames(b)[0])).toEqual(['Old', 'Newer']);
    expect(s.viewIndex).toBe(1);
    expect(s.avoidNames).toEqual(['Old']);
    expect(s.pending).toBeNull();
    expect(s.requestActive).toBe(false);
    expect(s.explore).toBeNull();
    expect(s.error).toBeNull();
    expect(s.briefByMode).toEqual({ track: '', release: '', artist: '' });
  });

  it('warns when the persisted session could not be removed', async () => {
    const h = makeHarness({ clearSessionImpl: () => false, persistSessionImpl: () => false });
    h.store.setBrief('draft');
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.clearWorkingSession();
    const s = h.store.getState();
    // Memory is cleared regardless…
    expect(s.batches).toHaveLength(0);
    expect(s.briefByMode.track).toBe('');
    // …and the user is told the old persisted results may come back.
    expect(s.sessionUnavailable).toBe(true);
    expect(s.toast?.message).toMatch(/couldn't be cleared/i);
  });

  it('treats a failed removal as cleared when the empty session write succeeds', async () => {
    const h = makeHarness({ clearSessionImpl: () => false });
    h.store.generate();
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    h.store.clearWorkingSession();
    const s = h.store.getState();
    expect(s.batches).toHaveLength(0);
    expect(s.toast).toBeNull();
    // The empty session overwrite prevents a reload from restoring old data.
    const lastSession = h.sessionWrites[h.sessionWrites.length - 1];
    expect(lastSession.batches).toEqual([]);
    expect(lastSession.avoid).toEqual([]);
  });
});
