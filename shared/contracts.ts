/**
 * Application contracts shared between the browser client and the Worker naming
 * service. These types are deliberately independent of provider (DeepSeek)
 * response objects and of any browser/server storage shape. Nothing in this
 * module may import browser, node, or provider APIs.
 */

export type Operation = 'generate' | 'refine' | 'alias' | 'replaceTrack';
export type Mode = 'track' | 'release' | 'artist';
export type LengthPref = 'auto' | 'short';
/**
 * Alias flavour. `wu` and `emo` are stable personas that need no brief; `brief`
 * reads the supplied brief and works the style out from it, so it requires a
 * non-empty brief.
 */
export type AliasStyle = 'wu' | 'emo' | 'brief';

export const OPERATIONS: readonly Operation[] = ['generate', 'refine', 'alias', 'replaceTrack'];
export const MODES: readonly Mode[] = ['track', 'release', 'artist'];
export const LENGTH_PREFS: readonly LengthPref[] = ['auto', 'short'];
export const ALIAS_STYLES: readonly AliasStyle[] = ['wu', 'emo', 'brief'];

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
  /** Which alias persona to use (alias operation only). Defaults to "wu". */
  aliasStyle?: AliasStyle;
  /** Album title a replacement track must fit (replaceTrack only). */
  albumTitle?: string;
  /** The album's remaining track titles to fit and never repeat (replaceTrack only). */
  tracks?: string[];
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
  /** Present on alias requests only. */
  aliasStyle?: AliasStyle;
  /** Present (or null) on replaceTrack requests only. */
  albumTitle?: string | null;
  /** Present (possibly empty) on replaceTrack requests only. */
  tracks?: string[];
}

/** A flat batch of interchangeable names (track/artist naming, refine, alias). */
export interface NamingSuccessNames {
  ok: true;
  kind: 'names';
  names: string[];
  /** True when the batch has fewer names than the display target. */
  partial: boolean;
}

/** One release: a single album title plus its track list. */
export interface NamingSuccessAlbum {
  ok: true;
  kind: 'album';
  title: string;
  tracks: string[];
  /** True when the track list is shorter than the display target. */
  partial: boolean;
}

export type NamingSuccess = NamingSuccessNames | NamingSuccessAlbum;

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
