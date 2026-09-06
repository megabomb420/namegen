import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore, type StoreDeps } from './appStore';
import type { StoredSession } from '../browser/storage';
import type { WireOutcome } from '../browser/api';
import type { SavedName } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function successNames(names: string[], partial = false): WireOutcome {
  return { ok: true, names, partial };
}

interface HarnessOptions {
  submitImpl?: () => Promise<WireOutcome>;
  persistShortlistImpl?: (items: SavedName[]) => boolean;
  persistSessionImpl?: (session: StoredSession) => boolean;
  sessionSeed?: StoredSession | null;
  shortlistSeed?: SavedName[];
}

interface Harness {
  store: AppStore;
  submit: ReturnType<typeof vi.fn>;
  sessionWrites: StoredSession[];
  shortlistWrites: SavedName[][];
}

function makeHarness(options: HarnessOptions = {}): Harness {
  let sessionValue: StoredSession | null = options.sessionSeed ?? null;
  let shortlistValue: SavedName[] = options.shortlistSeed ?? [];
  const sessionWrites: StoredSession[] = [];
  const shortlistWrites: SavedName[][] = [];
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
    persistPrefs: () => true,
    loadSession: () => sessionValue,
    persistSession: (session) => {
      const ok = options.persistSessionImpl ? options.persistSessionImpl(session) : true;
      if (ok) {
        sessionValue = session;
        sessionWrites.push(session);
      }
      return ok;
    },
    clearSession: () => {
      sessionValue = null;
      return true;
    },
    now: () => 1000,
    randomId: () => `id-${++idCounter}`,
    copy: async () => true,
    later: () => undefined,
  };
  return { store: new AppStore(deps), submit, sessionWrites, shortlistWrites };
}

afterEach(() => {
  vi.useRealTimers();
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
    expect(s.batches[0].names).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(s.batches[0].brief).toBe('');
    expect(s.batches[0].partial).toBe(true);
    expect(s.error).toBeNull();
    expect(h.sessionWrites).toHaveLength(1);
    expect(h.sessionWrites[0].batches[0].names).toEqual(['Alpha', 'Beta', 'Gamma']);
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
    expect(s.brief).toBe('my draft');
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
    expect(s.brief).toBe('');
    expect(s.error).toBeNull();
  });

  it('a second request supersedes a stale first response', async () => {
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
    // Simulate a failed request being cleared out of the way by the user.
    h.store.clearWorkingSession();
    h.store.setBrief('fresh');
    h.store.generate();
    first.resolve(successNames(['Stale']));
    second.resolve(successNames(['Fresh']));
    await vi.waitFor(() => expect(h.store.getState().pending).toBeNull());
    expect(h.store.getState().batches[0].names).toEqual(['Fresh']);
    expect(h.store.getState().batches[0].brief).toBe('fresh');
  });

  it('closing Explore mid-refine keeps it closed when the response lands', async () => {
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
    refine.resolve(successNames(['Ghost', 'Alt']));
    await vi.waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2));
    const s = h.store.getState();
    expect(s.explore).toBeNull();
    expect(s.pending).toBeNull();
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
    // Main batches untouched by refinement.
    expect(s.batches[0].names).toEqual(['Base', 'Idea']);
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

  it('never silently evicts beyond 300 entries', async () => {
    const seeded = Array.from({ length: 300 }, (_, i) => ({
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
    expect(s.brief).toBe('');
    expect(s.avoidNames).toHaveLength(0);
    expect(s.error).toBeNull();
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
    expect(s.batches.map((b) => b.names[0])).toEqual(['Old', 'Newer']);
    expect(s.viewIndex).toBe(1);
    expect(s.avoidNames).toEqual(['Old']);
    expect(s.pending).toBeNull();
    expect(s.explore).toBeNull();
    expect(s.error).toBeNull();
    expect(s.brief).toBe('');
  });
});
