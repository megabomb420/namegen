/**
 * Client state machine (framework-free). One active model request per client
 * instance; each request is tied to a monotonic epoch so cleared or superseded
 * work can never be resurrected by a late response. Memory holds raw text and
 * open-sheet state; validated batches/exclusions persist to sessionStorage and
 * the shortlist/preferences to localStorage through injected adapters.
 */
import type { LengthPref, Mode, NamingRequest } from '../../shared/contracts';
import { BRIEF_MAX, LANGUAGE_MAX } from '../../shared/limits';
import { countCodePoints } from '../../shared/text';
import type { WireOutcome } from '../browser/api';
import type { StoredPrefs, StoredSession } from '../browser/storage';
import { findSaved, pushAvoidNames, pushBatch } from './helpers';
import type { AppError, AppState, DisplayBatch, ExploreState, PendingRequest, SavedName, Tab } from './types';
import { SESSION_BATCH_LIMIT } from './types';

export interface StoreDeps {
  submit: (request: NamingRequest) => Promise<WireOutcome>;
  loadShortlist: () => SavedName[];
  persistShortlist: (items: SavedName[]) => boolean;
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

type Listener = () => void;

function defaultPrefs(): StoredPrefs {
  return { version: 1, ...DEFAULT_PREFS };
}

function displayToStored(batch: DisplayBatch): StoredSession['batches'][number] {
  return {
    names: batch.names,
    partial: batch.partial,
    mode: batch.mode,
    language: batch.language,
    length: batch.length,
    displayedAt: batch.displayedAt,
  };
}

export class AppStore {
  private state: AppState;
  private listeners = new Set<Listener>();
  private toastSeq = 0;

  constructor(private deps: StoreDeps) {
    const prefs = deps.loadPrefs();
    const savedPrefs = prefs ?? defaultPrefs();
    const shortlist = deps.loadShortlist();
    const session = deps.loadSession();
    const batches = (session?.batches ?? []).map(
      (b): DisplayBatch => ({
        id: deps.randomId(),
        names: b.names,
        partial: b.partial,
        mode: b.mode,
        language: b.language,
        length: b.length,
        brief: null, // Raw briefs are memory-only; a restore has none.
        displayedAt: b.displayedAt,
      }),
    );
    this.state = {
      tab: 'create',
      mode: 'track',
      brief: '',
      language: savedPrefs.language,
      length: savedPrefs.length,
      optionsOpen: false,
      batches,
      viewIndex: Math.max(0, batches.length - 1),
      avoidNames: session?.avoid ?? [],
      pending: null,
      error: null,
      errorSnapshot: null,
      explore: null,
      shortlist,
      sessionUnavailable: false,
      toast: null,
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      epoch: 0,
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
    this.set({ brief });
  }

  setLanguage(language: string): void {
    const trimmed = language.trim();
    const persistable = trimmed !== '' && countCodePoints(trimmed) <= LANGUAGE_MAX;
    if (persistable) {
      this.deps.persistPrefs({ version: 1, language: trimmed, length: this.state.length });
    }
    this.set({ language });
  }

  setLength(length: LengthPref): void {
    this.deps.persistPrefs({ version: 1, language: this.state.language, length });
    this.set({ length });
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

  generate(): void {
    const s = this.state;
    if (s.pending !== null) return;
    const briefError = this.guardBrief(s.brief);
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
    const snapshot: NamingRequest = {
      operation: 'generate',
      mode: s.mode,
      brief: s.brief.trim(),
      language: trimmedLanguage,
      length: s.length,
      avoid: [...s.avoidNames],
    };
    void this.runRequest(snapshot, 'generate');
  }

  retryFailedRequest(): void {
    const snapshot = this.state.errorSnapshot;
    if (snapshot === null || this.state.pending !== null) return;
    void this.runRequest(snapshot, 'generate');
  }

  retryExplore(): void {
    const snapshot = this.state.explore?.retrySnapshot;
    if (snapshot === null || snapshot === undefined || this.state.pending !== null) return;
    void this.runRequest(snapshot, 'refine');
  }

  private async runRequest(snapshot: NamingRequest, kind: 'generate' | 'refine'): Promise<void> {
    if (this.state.pending !== null) return;
    const epoch = this.state.epoch + 1;
    const pending: PendingRequest = { kind, epoch };
    const base: Partial<AppState> = { epoch, pending, error: null, errorSnapshot: null };
    if (kind === 'generate') {
      this.set(base);
    } else {
      const explore = this.state.explore;
      if (explore === null) return;
      this.set({ ...base, explore: { ...explore, loading: true, error: null } });
    }

    const outcome = await this.deps.submit(snapshot);

    // Late, cleared or superseded work never applies.
    const stateAfter = this.state;
    if (stateAfter.epoch !== epoch || stateAfter.pending === null || stateAfter.pending.epoch !== epoch) return;

    if (!outcome.ok) {
      const error: AppError = { code: outcome.code, message: outcome.message, retryable: outcome.retryable };
      if (kind === 'generate') {
        this.set({ pending: null, error, errorSnapshot: snapshot });
      } else {
        const explore = this.state.explore;
        if (explore === null) return;
        this.set({ pending: null, explore: { ...explore, loading: false, error, retrySnapshot: snapshot } });
      }
      return;
    }

    if (kind === 'generate') {
      const batch: DisplayBatch = {
        id: this.deps.randomId(),
        names: outcome.names,
        partial: outcome.partial,
        mode: snapshot.mode,
        language: snapshot.language ?? '',
        length: snapshot.length ?? 'auto',
        brief: snapshot.brief ?? '',
        displayedAt: this.deps.now(),
      };
      const batches = pushBatch(this.state.batches, batch, SESSION_BATCH_LIMIT);
      const avoidNames = pushAvoidNames(this.state.avoidNames, outcome.names);
      const next: Partial<AppState> = {
        pending: null,
        error: null,
        errorSnapshot: null,
        batches,
        viewIndex: batches.length - 1,
        avoidNames,
      };
      this.set(next);
      this.persistCurrentSession();
      return;
    }

    // Refinement result lives in the open Explore sheet.
    const explore = this.state.explore;
    if (explore === null || explore.seed !== snapshot.seed) return;
    const avoidNames = pushAvoidNames(this.state.avoidNames, outcome.names);
    this.set({
      pending: null,
      avoidNames,
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
    this.set({
      epoch: this.state.epoch + 1,
      pending: null,
      batches: [],
      viewIndex: 0,
      avoidNames: [],
      brief: '',
      explore: null,
      error: null,
      errorSnapshot: null,
    });
    this.deps.clearSession();
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
    const saved: SavedName = { id: this.deps.randomId(), name, mode, savedAt: this.deps.now() };
    const next = [...items, saved];
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
    const ok = await this.deps.copy(items.map((item) => item.name).join('\n'));
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
