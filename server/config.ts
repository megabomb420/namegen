/**
 * Provider settings and operation counts. This is ordinary server-side
 * configuration: model/API choices live here, never in user-controlled input.
 */
import type { NormalizedRequest, Operation } from '../shared/contracts';

export const PROVIDER = {
  url: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-flash',
  /** Hard output ceiling. Headroom for multilingual names, not a guarantee. */
  maxOutputTokens: 800,
  /** Upstream deadline; the fetch is aborted when it elapses. */
  timeoutMs: 20_000,
} as const;

/** Candidates requested from the provider vs. candidates returned/displayed. */
export const REQUEST_COUNTS: Record<Operation, { requested: number; display: number }> = {
  generate: { requested: 8, display: 6 },
  refine: { requested: 6, display: 4 },
  alias: { requested: 8, display: 6 },
  replaceTrack: { requested: 3, display: 1 },
};

/**
 * A release-mode generate names one album — a title plus its track list —
 * rather than a batch of interchangeable names. The track counts live in
 * `shared/limits.ts` because the browser needs them too.
 */
export function isAlbumRequest(request: Pick<NormalizedRequest, 'operation' | 'mode'>): boolean {
  return request.operation === 'generate' && request.mode === 'release';
}

/**
 * Provider overrides for the `alias` operation only: thinking ENABLED
 * (authorized product decision, 2026-09-06). Reasoning consumes output tokens,
 * so the ceiling is raised above the 800-token naming headroom and effort is
 * kept at 'low' to bound spend. generate/refine ignore this block and run with
 * thinking disabled (spec §6) — enabling it there truncated on the ceiling at
 * ~25 s per call and was reverted the same day.
 */
export const THINKING_SETTINGS = {
  thinking: 'enabled' as const,
  reasoningEffort: 'low' as const,
  maxTokens: 2500,
};
