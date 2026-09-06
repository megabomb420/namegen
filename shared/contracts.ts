/**
 * Application contracts shared between the browser client and the Worker naming
 * service. These types are deliberately independent of provider (DeepSeek)
 * response objects and of any browser/server storage shape. Nothing in this
 * module may import browser, node, or provider APIs.
 */

export type Operation = 'generate' | 'refine' | 'alias';
export type Mode = 'track' | 'release' | 'artist';
export type LengthPref = 'auto' | 'short';

export const OPERATIONS: readonly Operation[] = ['generate', 'refine', 'alias'];
export const MODES: readonly Mode[] = ['track', 'release', 'artist'];
export const LENGTH_PREFS: readonly LengthPref[] = ['auto', 'short'];

/**
 * The single canonical application request. The client supplies only these
 * fields; the server derives counts, model, prompt settings and provider
 * details. Every request is self-contained.
 */
export interface NamingRequest {
  operation: Operation;
  mode: Mode;
  /** Optional creative context (sound, mood, story, keywords, lyrics…). */
  brief?: string;
  /** Target language, e.g. "English", "Japanese". Defaults to English. */
  language?: string;
  /** Name length guidance. Defaults to auto. */
  length?: LengthPref;
  /** Refinement seed: an existing generated name. Required for refine. */
  seed?: string;
  /** Latest refinement instruction (empty means "more like this"). */
  instruction?: string;
  /** Recently displayed names the model should avoid, bounded and capped. */
  avoid?: string[];
}

/** Validated, defaults-applied request used by the naming service. */
export interface NormalizedRequest {
  operation: Operation;
  mode: Mode;
  brief: string;
  language: string;
  length: LengthPref;
  seed: string | null;
  instruction: string;
  avoid: string[];
}

export interface NamingSuccess {
  ok: true;
  names: string[];
  /** True when the batch has fewer names than the display target. */
  partial: boolean;
}

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'UNUSABLE_OUTPUT'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED';

export interface NamingFailure {
  ok: false;
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

export type NamingResult = NamingSuccess | NamingFailure;
