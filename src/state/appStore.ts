/**
 * Client state machine (framework-free). One active model request per client
 * instance; each request is tied to a monotonic epoch so cleared or superseded
 * work can never be resurrected by a late response. Memory holds raw text and
 * open-sheet state; validated batches/exclusions persist to sessionStorage and
 * the shortlist/preferences to localStorage through injected adapters.
 */
import type { AliasStyle, LengthPref, Mode, NamingRequest } from '../../shared/contracts';
import { BRIEF_MAX, LANGUAGE_MAX } from '../../shared/limits';
import { countCodePoints } from '../../shared/text';
import { UNREADABLE_OUTPUT_MESSAGE, type WireOutcome } from '../browser/api';
import type { StoredBatch, StoredPrefs, StoredSession } from '../browser/storage';
import { entryTitle, findSaved, formatEntry, pushAvoidNames, pushBatch } from './helpers';
import type {
  AppError,
  AppState,
  DisplayBatch,
  ExploreState,
  PendingRequest,
  SavedEntry,
  Tab,
} from './types';
import { SESSION_BATCH_LIMIT } from './types';

export interface StoreDeps {
  submit: (request: NamingRequest) => Promise<WireOutcome>;
  loadShortlist: () => SavedEntry[];
  persistShortlist: (items: SavedEntry[]) => boolean;
  loadPrefs: () => StoredPrefs | null;
  persistPrefs: (prefs: StoredPrefs) => boolean;
  loadSession: () => StoredSession | null;
  persistSession: (session: StoredSession) => boolean;
  clearSession: () => boolean;
  now: () => number;
  randomId: () => string;
  copy: (text: string) => Promise<boolean>;
  later: (fn: () => void, ms: number) => unknown;
}

const DEFAULT_PREFS = { language: 'English', length: 'auto' as LengthPref };

/** A replacement target plus the exact snapshot to resubmit if it fails. */
interface ReplacementRetry {
  batchId: string;
  index: number;
  snapshot: NamingRequest;
}

type Listener = () => void;

function defaultPrefs(): StoredPrefs {
  return { version: 1, ...DEFAULT_PREFS };
}

/** Restores one stored batch. Raw briefs are memory-only; a restore has none. */
function restoreBatch(batch: StoredBatch, id: string): DisplayBatch {
  if (batch.kind === 'album') {
    return {
      kind: 'album',
      id,
      title: batch.title,
      tracks: batch.tracks,
      partial: batch.partial,
      mode: 'release',
      language: batch.language,
      length: batch.length,
      brief: null,
      displayedAt: batch.displayedAt,
    };
  }
  return {
    kind: 'names',
    id,
    names: batch.names,
    partial: batch.partial,
    mode: batch.mode,
    language: batch.language,
    length: batch.length,
    brief: null,
    displayedAt: batch.displayedAt,
  };
}

function displayToStored(batch: DisplayBatch): StoredBatch {
  if (batch.kind === 'album') {
    return {
      kind: 'album',
      title: batch.title,
      tracks: batch.tracks,
      partial: batch.partial,
      mode: 'release',
      language: batch.language,
      length: batch.length,
      displayedAt: batch.displayedAt,
    };
  }
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

/** Albums and their track titles are all sent as exclusions. */
function batchAvoidNames(outcome: Extract<WireOutcome, { ok: true }>): string[] {
  return outcome.kind === 'album' ? [outcome.title, ...outcome.tracks] : outcome.names;
}

export class AppStore {
  private state: AppState;
  private listeners = new Set<Listener>();
  private toastSeq = 0;
  /** Exact snapshot of the last failed replacement, for explicit retry only. */
  private replacementRetry: ReplacementRetry | null = null;

  constructor(private deps: StoreDeps) {
    const prefs = deps.loadPrefs();
    const savedPrefs = prefs ?? defaultPrefs();
    const shortlist = deps.loadShortlist();
    const session = deps.loadSession();
    const batches = (session?.batches ?? []).map((batch) => restoreBatch(batch, deps.randomId()));
    this.state = {
      tab: 'create',
      mode: 'track',
      briefByMode: { track: '', release: '', artist: '' },
      language: savedPrefs.language,
      length: savedPrefs.length,
      optionsOpen: false,
      batches,
      viewIndex: Math.max(0, batches.length - 1),
      avoidNames: session?.avoid ?? [],
      pending: null,
      error: null,
      errorSnapshot: null,
      replacementError: null,
      explore: null,
      shortlist,
      sessionUnavailable: false,
      toast: null,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      epoch: 0,
      requestActive: false,
    };
  }

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: Partial<AppState>): void {
    this.state = { ...this.state, ...next };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  // ----- plain UI setters -------------------------------------------------

  setTab(tab: Tab): void {
    if (this.state.tab !== tab) this.set({ tab });
  }

  setMode(mode: Mode): void {
    this.set({ mode });
  }

  setBrief(brief: string): void {
    this.set({ briefByMode: { ...this.state.briefByMode, [this.state.mode]: brief } });
  }

  setLanguage(language: string): void {
    const trimmed = language.trim();
    const persistable = trimmed !== '' && countCodePoints(trimmed) <= LANGUAGE_MAX;
    if (persistable) {
      this.persistPrefs({ language: trimmed, length: this.state.length });
    }
    this.set({ language });
  }

  setLength(length: LengthPref): void {
    this.persistPrefs({ language: this.state.language, length });
    this.set({ length });
  }

  private persistPrefs(prefs: Omit<StoredPrefs, 'version'>): boolean {
    return this.deps.persistPrefs({ version: 1, ...prefs });
  }

  toggleOptions(): void {
    this.set({ optionsOpen: !this.state.optionsOpen });
  }

  setViewIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.state.batches.length - 1));
    if (clamped !== this.state.viewIndex) this.set({ viewIndex: clamped });
  }

  setOnline(online: boolean): void {
    if (this.state.online !== online) this.set({ online });
  }

  dismissToast(): void {
    if (this.state.toast !== null) this.set({ toast: null });
  }

  private showToast(message: string): void {
    const id = ++this.toastSeq;
    this.set({ toast: { id, message } });
    this.deps.later(() => {
      if (this.state.toast?.id === id) this.set({ toast: null });
    }, 3000);
  }

  // ----- generation and refinement ---------------------------------------

  private guardBrief(brief: string): string | null {
    if (countCodePoints(brief) > BRIEF_MAX) {
      return `Brief is over the ${BRIEF_MAX}-character limit.`;
    }
    return null;
  }

  /** Active-mode submit: track/release generate, or an artist alias roll. */
  generate(): void {
    const s = this.state;
    if (s.pending !== null) return;
    const brief = s.briefByMode[s.mode];
    const trimmedBrief = brief.trim();
    // The brief card reads the brief; with nothing written the main artist
    // action does nothing at all and the cards below explain why.
    if (s.mode === 'artist' && trimmedBrief === '') return;
    const briefError = this.guardBrief(brief);
    if (briefError !== null) {
      this.set({
        error: { code: 'INVALID_INPUT', message: briefError, retryable: false },
        errorSnapshot: null,
      });
      return;
    }
    const trimmedLanguage = s.language.trim();
    if (trimmedLanguage === '' || countCodePoints(trimmedLanguage) > LANGUAGE_MAX) {
      this.set({
        error: { code: 'INVALID_INPUT', message: 'Language must be 1–40 characters.', retryable: false },
        errorSnapshot: null,
      });
      return;
    }
    // Artist mode rolls the brief persona — the same action as the first card;
    // release mode asks for one album instead of a flat list.
    const snapshot: NamingRequest =
      s.mode === 'artist'
        ? {
            operation: 'alias',
            mode: 'artist',
            aliasStyle: 'brief',
            brief: trimmedBrief,
            language: trimmedLanguage,
            avoid: [...s.avoidNames],
          }
        : {
            operation: 'generate',
            mode: s.mode,
            brief: trimmedBrief,
            language: trimmedLanguage,
            length: s.length,
            avoid: [...s.avoidNames],
          };
    void this.runRequest(snapshot, s.mode === 'artist' ? 'alias' : 'generate');
  }

  retryFailedRequest(): void {
    const snapshot = this.state.errorSnapshot;
    if (snapshot === null || this.state.requestActive) return;
    const kind = snapshot.operation === 'alias' ? 'alias' : snapshot.operation === 'refine' ? 'refine' : 'generate';
    void this.runRequest(snapshot, kind);
  }

  /**
   * Alias roll from one of the artist cards: paid DeepSeek call (thinking
   * enabled), artist mode. Every style carries the brief, but only the brief
   * persona needs one — with the field empty it never leaves the client.
   */
  generateAlias(style: AliasStyle = 'wu'): void {
    const s = this.state;
    if (s.requestActive || s.pending !== null) return;
    const brief = s.briefByMode.artist.trim();
    if (style === 'brief' && brief === '') return;
    const language = s.language.trim();
    const snapshot: NamingRequest = {
      operation: 'alias',
      mode: 'artist',
      aliasStyle: style,
      brief,
      ...(language === '' ? {} : { language }),
      avoid: [...s.avoidNames],
    };
    void this.runRequest(snapshot, 'alias');
  }

  /** One new title for a single album slot; the old title stays until it lands. */
  replaceTrack(batchId: string, index: number): void {
    const s = this.state;
    if (s.requestActive || s.pending !== null) return;
    const batch = s.batches.find((candidate) => candidate.id === batchId);
    if (batch === undefined || batch.kind !== 'album' || batch.tracks[index] === undefined) return;
    const snapshot: NamingRequest = {
      operation: 'replaceTrack',
      mode: 'release',
      albumTitle: batch.title,
      tracks: batch.tracks.filter((_track, position) => position !== index),
      brief: batch.brief ?? '',
      language: batch.language,
      length: batch.length,
      avoid: [...s.avoidNames],
    };
    void this.runRequest(snapshot, 'replaceTrack', { batchId, trackIndex: index });
  }

  /** Resubmits the exact failed replacement snapshot; never automatic. */
  retryReplacement(): void {
    const retry = this.replacementRetry;
    if (retry === null || this.state.requestActive || this.state.pending !== null) return;
    void this.runRequest(retry.snapshot, 'replaceTrack', { batchId: retry.batchId, trackIndex: retry.index });
  }

  retryExplore(): void {
    const snapshot = this.state.explore?.retrySnapshot;
    if (snapshot === null || snapshot === undefined || this.state.pending !== null) return;
    void this.runRequest(snapshot, 'refine');
  }

  private async runRequest(
    snapshot: NamingRequest,
    kind: PendingRequest['kind'],
    target?: { batchId: string; trackIndex: number },
  ): Promise<void> {
    // Transport admission: locked from submission until settlement, so work
    // invalidated mid-flight (closing Explore, clearing the session) can never
    // permit a second concurrent paid request.
    if (this.state.requestActive || this.state.pending !== null) return;
    const epoch = this.state.epoch + 1;
    // The persona travels with the snapshot, so the card that was clicked —
    // or retried — is the one that shows the busy state.
    const pending: PendingRequest = {
      kind,
      epoch,
      ...(snapshot.aliasStyle === undefined ? {} : { aliasStyle: snapshot.aliasStyle }),
      ...(target ?? {}),
    };
    const base: Partial<AppState> = { epoch, requestActive: true, pending, error: null, errorSnapshot: null };
    if (kind === 'refine') {
      const explore = this.state.explore;
      if (explore === null) return;
      this.set({ ...base, explore: { ...explore, loading: true, error: null } });
    } else {
      this.set(base);
    }

    try {
      const outcome = await this.deps.submit(snapshot);

      // Late, cleared or superseded work never applies.
      const stateAfter = this.state;
      if (stateAfter.epoch !== epoch || stateAfter.pending === null || stateAfter.pending.epoch !== epoch) return;

      if (!outcome.ok) {
        const error: AppError = { code: outcome.code, message: outcome.message, retryable: outcome.retryable };
        if (kind === 'generate' || kind === 'alias') {
          this.set({ pending: null, error, errorSnapshot: snapshot });
        } else if (kind === 'replaceTrack') {
          this.failReplacement(target, snapshot, error);
        } else {
          const explore = this.state.explore;
          if (explore === null) return;
          this.set({ pending: null, explore: { ...explore, loading: false, error, retrySnapshot: snapshot } });
        }
        return;
      }

      if (kind === 'generate' || kind === 'alias') {
        // The batch language falls back to the current preference: an alias
        // snapshot may omit it, and an empty language would make the stored
        // session unreadable on the next reload.
        const language = (snapshot.language ?? this.state.language).trim();
        const length = snapshot.length ?? 'auto';
        const brief = snapshot.brief ?? '';
        const batch: DisplayBatch =
          outcome.kind === 'album'
            ? {
                kind: 'album',
                id: this.deps.randomId(),
                title: outcome.title,
                tracks: outcome.tracks,
                partial: outcome.partial,
                mode: 'release',
                language,
                length,
                brief,
                displayedAt: this.deps.now(),
              }
            : {
                kind: 'names',
                id: this.deps.randomId(),
                names: outcome.names,
                partial: outcome.partial,
                mode: snapshot.mode,
                language,
                length,
                brief,
                displayedAt: this.deps.now(),
              };
        const batches = pushBatch(this.state.batches, batch, SESSION_BATCH_LIMIT);
        const avoidNames = pushAvoidNames(this.state.avoidNames, batchAvoidNames(outcome));
        this.set({
          pending: null,
          error: null,
          errorSnapshot: null,
          batches,
          viewIndex: batches.length - 1,
          avoidNames,
        });
        this.persistCurrentSession();
        return;
      }

      if (kind === 'replaceTrack') {
        if (target === undefined || outcome.kind !== 'names' || outcome.names.length === 0) {
          this.failReplacement(target, snapshot, {
            code: 'UNUSABLE_OUTPUT',
            message: UNREADABLE_OUTPUT_MESSAGE,
            retryable: true,
          });
          return;
        }
        const newTitle = outcome.names[0];
        const batch = this.state.batches.find((candidate) => candidate.id === target.batchId);
        if (batch === undefined || batch.kind !== 'album' || batch.tracks[target.trackIndex] === undefined) {
          // The batch or the slot is gone; nothing to replace.
          this.set({ pending: null });
          return;
        }
        const tracks = batch.tracks.map((track, position) => (position === target.trackIndex ? newTitle : track));
        const batches = this.state.batches.map((candidate) =>
          candidate.id === batch.id ? { ...batch, tracks } : candidate,
        );
        const avoidNames = pushAvoidNames(this.state.avoidNames, [newTitle]);
        this.replacementRetry = null;
        this.set({
          pending: null,
          error: null,
          errorSnapshot: null,
          batches,
          avoidNames,
          replacementError: null,
        });
        this.persistCurrentSession();
        return;
      }

      // Refinement: keep the alternatives in the open sheet and place the
      // completed batch in the bounded recovery list so closing the sheet (or
      // further exploration) never discards it. Raw context is not persisted.
      const explore = this.state.explore;
      if (explore === null || explore.seed !== snapshot.seed) return;
      if (outcome.kind !== 'names') {
        this.set({
          pending: null,
          explore: {
            ...explore,
            loading: false,
            error: { code: 'UNUSABLE_OUTPUT', message: UNREADABLE_OUTPUT_MESSAGE, retryable: true },
            retrySnapshot: snapshot,
          },
        });
        return;
      }
      const refineBatch: DisplayBatch = {
        kind: 'names',
        id: this.deps.randomId(),
        names: outcome.names,
        partial: outcome.partial,
        mode: snapshot.mode,
        language: snapshot.language ?? explore.language,
        length: snapshot.length ?? explore.length,
        brief: snapshot.brief ?? '',
        displayedAt: this.deps.now(),
      };
      const batches = pushBatch(this.state.batches, refineBatch, SESSION_BATCH_LIMIT);
      const avoidNames = pushAvoidNames(this.state.avoidNames, outcome.names);
      this.set({
        pending: null,
        error: null,
        errorSnapshot: null,
        avoidNames,
        batches,
        viewIndex: batches.length - 1,
        explore: {
          ...explore,
          loading: false,
          error: null,
          retrySnapshot: snapshot,
          alternatives: outcome.names,
          partial: outcome.partial,
        },
      });
      this.persistCurrentSession();
    } finally {
      const after = this.state;
      const stillMine = after.pending !== null && after.pending.epoch === epoch;
      if (after.requestActive || stillMine) {
        this.set({ requestActive: false, ...(stillMine ? { pending: null } : {}) });
      }
    }
  }

  /** Records a failed replacement for its row; the old title is untouched. */
  private failReplacement(
    target: { batchId: string; trackIndex: number } | undefined,
    snapshot: NamingRequest,
    error: AppError,
  ): void {
    if (target === undefined) return;
    this.replacementRetry = { batchId: target.batchId, index: target.trackIndex, snapshot };
    this.set({
      pending: null,
      replacementError: {
        batchId: target.batchId,
        index: target.trackIndex,
        message: error.message,
        retryable: error.retryable,
      },
    });
  }

  private persistCurrentSession(): void {
    const ok = this.deps.persistSession({
      version: 1,
      batches: this.state.batches.slice(-SESSION_BATCH_LIMIT).map(displayToStored),
      avoid: this.state.avoidNames,
    });
    if (!ok && !this.state.sessionUnavailable) {
      this.set({ sessionUnavailable: true });
    }
  }

  // ----- Explore (local) --------------------------------------------------

  openExplore(seed: string, batch: DisplayBatch): void {
    const isAlbumTitle = batch.kind === 'album' && seed === batch.title;
    const explore: ExploreState = {
      seed,
      mode: batch.mode,
      language: batch.language,
      length: batch.length,
      brief: batch.brief,
      contextDraft: '',
      instruction: '',
      loading: false,
      error: null,
      retrySnapshot: null,
      alternatives: [],
      partial: null,
      album: isAlbumTitle && batch.kind === 'album' ? { title: batch.title, tracks: [...batch.tracks] } : null,
    };
    this.set({ explore });
  }

  /**
   * Explore from a saved shortlist entry: it keeps its saved mode and uses the
   * current language/length preferences; no originating brief exists, so the
   * sheet offers its bounded context field. Entirely local, never a request.
   * An album entry carries its tracks so the Save chip toggles the release.
   */
  openSavedExplore(entry: SavedEntry): void {
    const explore: ExploreState = {
      seed: entryTitle(entry),
      mode: entry.mode,
      language: this.state.language,
      length: this.state.length,
      brief: null,
      contextDraft: '',
      instruction: '',
      loading: false,
      error: null,
      retrySnapshot: null,
      alternatives: [],
      partial: null,
      album: entry.kind === 'album' ? { title: entry.title, tracks: [...entry.tracks] } : null,
    };
    this.set({ explore });
  }

  setExploreInstruction(instruction: string): void {
    const explore = this.state.explore;
    if (explore === null) return;
    this.set({ explore: { ...explore, instruction } });
  }

  setExploreContextDraft(contextDraft: string): void {
    const explore = this.state.explore;
    if (explore === null) return;
    this.set({ explore: { ...explore, contextDraft } });
  }

  submitRefine(): void {
    const explore = this.state.explore;
    if (explore === null || this.state.pending !== null) return;
    if (countCodePoints(explore.instruction) > 160) return;
    if (explore.brief === null && countCodePoints(explore.contextDraft) > BRIEF_MAX) return;
    const { request } = toRefinePayload(explore, this.state.avoidNames);
    void this.runRequest(request, 'refine');
  }

  /**
   * Tap another displayed name inside Explore: it becomes the new seed, still
   * bound to the same batch context. Entirely local, no request.
   */
  exploreAnotherName(seed: string): void {
    const explore = this.state.explore;
    if (explore === null) return;
    if (this.state.pending !== null && this.state.pending.kind === 'refine') return;
    this.set({
      explore: {
        ...explore,
        seed,
        instruction: '',
        loading: false,
        error: null,
        retrySnapshot: null,
        alternatives: [],
        partial: null,
        album: null,
      },
    });
  }

  closeExplore(): void {
    if (this.state.pending?.kind === 'refine') {
      // A refine may still be in flight; the epoch guard plus the null check
      // below keep its late response from resurrecting the sheet.
      this.set({ explore: null, pending: null });
      return;
    }
    this.set({ explore: null });
  }

  // ----- working session ---------------------------------------------------

  /** Clears session records, in-memory drafts/results and pending work. */
  clearWorkingSession(): void {
    this.replacementRetry = null;
    this.set({
      epoch: this.state.epoch + 1,
      pending: null,
      batches: [],
      viewIndex: 0,
      avoidNames: [],
      briefByMode: { track: '', release: '', artist: '' },
      explore: null,
      error: null,
      errorSnapshot: null,
      replacementError: null,
    });
    // requestActive intentionally stays set: the transport lock remains held
    // until the in-flight request settles, even though its work is invalidated.
    const cleared = this.deps.clearSession();
    if (!cleared) {
      // Removal failed; try overwriting with an empty session instead.
      const overwritten = this.deps.persistSession({ version: 1, batches: [], avoid: [] });
      if (!overwritten) {
        this.set({ sessionUnavailable: true });
        this.showToast(
          "The saved session couldn't be cleared in this browser — your earlier results may come back after a refresh.",
        );
      }
    }
  }

  // ----- shortlist ---------------------------------------------------------

  toggleSave(name: string, mode: Mode): void {
    const items = this.state.shortlist;
    // Duplicate comparison uses the shared normalised key within each mode.
    const index = findSaved(items, name, mode);
    if (index !== -1) {
      this.removeSaved(items[index].id);
      return;
    }
    if (items.length >= 300) {
      this.showToast('Shortlist is full (300 names). Remove some first — nothing was saved.');
      return;
    }
    const saved: SavedEntry = { kind: 'name', id: this.deps.randomId(), name, mode, savedAt: this.deps.now() };
    this.persistSave([...items, saved]);
  }

  /** Saves or removes a whole release as a single shortlist entry. */
  toggleSaveAlbum(album: { title: string; tracks: string[] }): void {
    const items = this.state.shortlist;
    const index = findSaved(items, album.title, 'release');
    if (index !== -1) {
      this.removeSaved(items[index].id);
      return;
    }
    if (items.length >= 300) {
      this.showToast('Shortlist is full (300 names). Remove some first — nothing was saved.');
      return;
    }
    const saved: SavedEntry = {
      kind: 'album',
      id: this.deps.randomId(),
      title: album.title,
      tracks: [...album.tracks],
      mode: 'release',
      savedAt: this.deps.now(),
    };
    this.persistSave([...items, saved]);
  }

  /** Explore-sheet Save chip: toggles the album when the seed is its title. */
  toggleExploreSave(): void {
    const explore = this.state.explore;
    if (explore === null) return;
    if (explore.album !== null) {
      this.toggleSaveAlbum(explore.album);
      return;
    }
    this.toggleSave(explore.seed, explore.mode);
  }

  /** Writes the store only after the write succeeded; failures toast. */
  private persistSave(next: SavedEntry[]): void {
    const persisted = this.deps.persistShortlist(next);
    if (!persisted) {
      this.showToast("Couldn't save: browser storage is unavailable. Your shortlist lives in this browser only.");
      return;
    }
    this.set({ shortlist: next });
  }

  removeSaved(id: string): void {
    const current = this.state.shortlist;
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length) return;
    const persisted = this.deps.persistShortlist(next);
    if (!persisted) {
      this.showToast("Couldn't remove: browser storage is unavailable.");
      return;
    }
    this.set({ shortlist: next });
  }

  clearShortlist(): void {
    if (this.state.shortlist.length === 0) return;
    const persisted = this.deps.persistShortlist([]);
    if (!persisted) {
      this.showToast("Couldn't clear: browser storage is unavailable.");
      return;
    }
    this.set({ shortlist: [] });
  }

  async copyName(name: string): Promise<void> {
    const ok = await this.deps.copy(name);
    this.showToast(ok ? 'Copied.' : "Copy isn't available here — select the name to copy it.");
  }

  async copyShortlist(): Promise<void> {
    const items = this.state.shortlist;
    if (items.length === 0) {
      this.showToast('Nothing to copy yet.');
      return;
    }
    const ok = await this.deps.copy(items.map(formatEntry).join('\n\n'));
    this.showToast(ok ? 'Copied.' : "Copy isn't available here — select the names to copy them.");
  }
}

function toRefinePayload(
  explore: ExploreState,
  avoid: readonly string[],
): { request: NamingRequest } {
  const brief = explore.brief ?? explore.contextDraft;
  return {
    request: {
      operation: 'refine',
      mode: explore.mode,
      language: explore.language,
      length: explore.length,
      seed: explore.seed,
      brief,
      instruction: explore.instruction,
      avoid: [...avoid],
    },
  };
}
