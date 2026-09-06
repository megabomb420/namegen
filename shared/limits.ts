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
 * Display targets per operation. The server requests more candidates than it
 * displays and discards the unused surplus after filtering/selection.
 */
export const DISPLAY_TARGETS: Record<'generate' | 'refine', number> = {
  generate: 6,
  refine: 4,
};
