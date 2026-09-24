/**
 * Limits and constants shared between browser and server. All length limits are
 * measured in Unicode code points. Nothing in this module may import browser,
 * node, or provider APIs.
 */
export const NAME_MAX = 60;
export const BRIEF_MAX = 2000;
export const INSTRUCTION_MAX = 160;
export const LANGUAGE_MAX = 40;
export const AVOID_MAX = 24;
export const DEFAULT_LANGUAGE = 'English';

/** Maximum accepted request-body size in bytes (spec: 24KB). */
export const REQUEST_BODY_LIMIT_BYTES = 24 * 1024;

/**
 * Album shape (release mode): the server asks for more track titles than it
 * displays, so invalid or duplicate entries still leave a full track list.
 */
export const ALBUM_TRACKS = { requested: 12, display: 10 } as const;

/** Maximum track titles a replaceTrack request may carry as context. */
export const TRACKS_MAX = 12;

/**
 * The explicit word cap for generated names (the length slider). `null` (or an
 * absent field) means no cap; the interface's "Any length" stop sends nothing.
 * The alias personas keep their own two-word shape and never receive a cap.
 */
export const MAX_WORDS_LIMIT = { min: 1, max: 6 } as const;

/**
 * Extra candidates to request when a word cap is set. The cap is enforced by
 * filtering, not by hope: with a bigger pool the displayed batch still fills
 * after over-cap candidates are dropped.
 */
export const WORD_CAP_HEADROOM = { names: 12, tracks: 16 } as const;
