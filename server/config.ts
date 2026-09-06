/**
 * Provider settings and operation counts. This is ordinary server-side
 * configuration: model/API choices live here, never in user-controlled input.
 */
import type { Operation } from '../shared/contracts';

export const PROVIDER = {
  url: 'https://api.deepseek.com/chat/completions',
  model: 'deepseek-v4-flash',
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
};

/**
 * Alias operation runs with provider thinking ENABLED (authorized product
 * decision) and gets a larger ceiling because reasoning consumes tokens.
 */
export const ALIAS_SETTINGS = {
  thinking: 'enabled' as const,
  reasoningEffort: 'low' as const,
  maxTokens: 1500,
};
