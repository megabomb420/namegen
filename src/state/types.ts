/**
 * Client-side domain types for the PWA state machine. Raw briefs, lyrics,
 * refinement instructions and open-sheet state are memory-only by design; only
 * validated batch names/metadata, preferences and shortlist entries persist.
 */
import type { LengthPref, Mode, NamingRequest } from '../../shared/contracts';

export type Tab = 'create' | 'shortlist';

export interface SavedName {
  id: string;
  name: string;
  mode: Mode;
  savedAt: number;
}

/** Everything the interface needs to draw one successful batch. */
export interface DisplayBatch {
  id: string;
  names: string[];
  partial: boolean;
  mode: Mode;
  language: string;
  length: LengthPref;
  /** Originating brief snapshot. Memory only; null after a restore. */
  brief: string | null;
  displayedAt: number;
}

export interface AppError {
  code: string;
  message: string;
  retryable: boolean;
}

export type PendingRequest = { kind: 'generate' | 'refine'; epoch: number };

export interface ExploreState {
  seed: string;
  mode: Mode;
  language: string;
  length: LengthPref;
  /** Originating brief snapshot of the explored batch; null when restored. */
  brief: string | null;
  /** Bounded brief field used when the originating brief is unavailable. */
  contextDraft: string;
  instruction: string;
  loading: boolean;
  error: AppError | null;
  /** Exact refine snapshot for explicit retry. */
  retrySnapshot: NamingRequest | null;
  alternatives: string[];
  partial: boolean | null;
}

export interface Toast {
  id: number;
  message: string;
}

export interface AppState {
  tab: Tab;
  mode: Mode;
  brief: string;
  language: string;
  length: LengthPref;
  optionsOpen: boolean;
  batches: DisplayBatch[];
  /** Index into `batches` of the batch shown on the Create screen. */
  viewIndex: number;
  /** Recently displayed names sent as exclusions (bounded, ≤ 24). */
  avoidNames: string[];
  pending: PendingRequest | null;
  /** Generation error + its exact snapshot for retry. */
  error: AppError | null;
  errorSnapshot: NamingRequest | null;
  explore: ExploreState | null;
  shortlist: SavedName[];
  /** True when sessionStorage writes fail; results may not survive refresh. */
  sessionUnavailable: boolean;
  toast: Toast | null;
  online: boolean;
  /** Monotonic guard: cleared or superseded requests never apply. */
  epoch: number;
}

export const SESSION_BATCH_LIMIT = 2;
