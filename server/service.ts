/**
 * Naming service: the single entry point ordinary server-side code exposes to
 * the Worker. It owns validation, counts/settings, payload building, provider
 * invocation and output selection. Provider types stay inside this module's
 * dependencies; the public result is the application contract only.
 */
import type { NamingResult, NormalizedRequest } from '../shared/contracts';
import { REQUEST_COUNTS, THINKING_SETTINGS } from './config';
import { ALIAS_SYSTEM, ALIAS_SYSTEM_EMO } from './alias-prompt';
import { callChatCompletions, type DeepSeekUsage, type ProviderDeps } from './provider';
import { normalizeRequest } from './validation';
import { selectNames, type SelectionStats } from './selection';

export interface ServiceReport {
  outcome:
    | 'invalid-input'
    | 'success'
    | 'provider-http'
    | 'provider-timeout'
    | 'provider-network'
    | 'provider-envelope'
    | 'provider-truncated'
    | 'selection-empty'
    | 'selection-shape';
  httpStatus?: number;
  latencyMs?: number;
  usage?: DeepSeekUsage;
  stats?: SelectionStats;
  partial?: boolean;
  kept?: number;
}

export interface NamingServiceDeps {
  apiKey: string;
  fetchImpl: typeof fetch;
  now?: () => number;
  log?: (report: ServiceReport) => void;
}

/** Human-readable task per tab, sent in the payload so the model always knows
 * exactly what it is producing in the active tab (track/release/artist/alias). */
function taskLabel(request: NormalizedRequest): string {
  if (request.operation === 'alias') {
    return request.aliasStyle === 'emo'
      ? 'You are handing out a sad, cloud-rap style artist alias.'
      : 'You are handing out a Wu-Tang-style artist alias.';
  }
  const subject =
    request.mode === 'track'
      ? 'a single track'
      : request.mode === 'release'
        ? 'an album, EP or project (a broader concept)'
        : 'an artist or producer identity';
  return request.operation === 'refine'
    ? `You are refining an existing name for ${subject}.`
    : `You are naming ${subject}.`;
}

function buildPayload(request: NormalizedRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    operation: request.operation,
    task: taskLabel(request),
    mode: request.mode,
    brief: request.brief,
    avoid: request.avoid,
  };
  if (request.operation === 'refine' && request.seed !== null) {
    payload.seed = request.seed;
    payload.instruction = request.instruction;
  }
  if (request.operation === 'alias' && request.aliasStyle !== undefined) {
    payload.aliasStyle = request.aliasStyle;
  }
  if (request.operation === 'generate' || request.operation === 'refine') {
    payload.language = request.language;
    payload.length = request.length;
  }
  return payload;
}

/**
 * Runs one self-contained naming operation: validation, then the paid call.
 * Never retries, never repairs a failed provider response, never calls the
 * provider a second time. This is the entry point for non-HTTP callers.
 */
export async function runNamingRequest(raw: unknown, deps: NamingServiceDeps): Promise<NamingResult> {
  const { log } = deps;
  const validation = normalizeRequest(raw);
  if (!validation.ok) {
    log?.({ outcome: 'invalid-input' });
    return { ok: false, code: 'INVALID_INPUT', message: validation.message, retryable: false };
  }
  return runValidatedNamingRequest(validation.value, deps);
}

/**
 * Paid-call path for callers that already ran `normalizeRequest` themselves
 * (the Worker interleaves its rate-limit admission between validation and the
 * provider call). Skips re-validation; every other safeguard still applies.
 */
export async function runValidatedNamingRequest(request: NormalizedRequest, deps: NamingServiceDeps): Promise<NamingResult> {
  const { apiKey, fetchImpl, now, log } = deps;
  const counts = REQUEST_COUNTS[request.operation];

  const providerDeps: ProviderDeps = { fetchImpl, apiKey, ...(now !== undefined ? { now } : {}) };
  // Naming (generate/refine) keeps thinking DISABLED per spec §6 — live runs
  // with thinking enabled truncated on the 1500-token ceiling and took ~25s
  // per call. The alias operation runs with thinking ENABLED and picks its
  // persona from aliasStyle (wu | emo).
  const isAlias = request.operation === 'alias';
  const aliasSystem = request.aliasStyle === 'emo' ? ALIAS_SYSTEM_EMO : ALIAS_SYSTEM;
  const result = await callChatCompletions(buildPayload(request), providerDeps, isAlias
    ? {
        systemPrompt: aliasSystem,
        thinking: THINKING_SETTINGS.thinking,
        reasoningEffort: THINKING_SETTINGS.reasoningEffort,
        maxTokens: THINKING_SETTINGS.maxTokens,
      }
    : {});

  switch (result.kind) {
    case 'timeout':
      log?.({ outcome: 'provider-timeout', latencyMs: result.latencyMs });
      return {
        ok: false,
        code: 'UPSTREAM_TIMEOUT',
        message: 'The naming service timed out. Try again.',
        retryable: true,
      };
    case 'http':
      log?.({ outcome: 'provider-http', httpStatus: result.status, latencyMs: result.latencyMs });
      if (result.status === 429) {
        return {
          ok: false,
          code: 'RATE_LIMITED',
          message: 'The naming service is receiving too many requests right now. Wait a moment, then try again.',
          retryable: true,
        };
      }
      return {
        ok: false,
        code: 'UPSTREAM_ERROR',
        message: 'The naming service is unavailable right now. Try again shortly.',
        retryable: true,
      };
    case 'network':
      log?.({ outcome: 'provider-network', latencyMs: result.latencyMs });
      return {
        ok: false,
        code: 'UPSTREAM_ERROR',
        message: 'Could not reach the naming service. Check your connection and try again.',
        retryable: true,
      };
    case 'bad-envelope':
      log?.({ outcome: 'provider-envelope', latencyMs: result.latencyMs });
      return {
        ok: false,
        code: 'UNUSABLE_OUTPUT',
        message: 'The naming service returned an unreadable response. Try again.',
        retryable: true,
      };
    case 'ok': {
      // Require exactly `stop`: a missing, null, 'length', 'content_filter'
      // or any other reason means the response did not complete normally and
      // must not be treated as output. Never reconstruct it.
      if (result.finishReason !== 'stop') {
        log?.({ outcome: 'provider-truncated', latencyMs: result.latencyMs, usage: result.usage ?? undefined });
        return {
          ok: false,
          code: 'UNUSABLE_OUTPUT',
          message: 'The naming response did not finish normally. Try again.',
          retryable: true,
        };
      }
      const selection = selectNames({
        content: result.content,
        requested: counts.requested,
        display: counts.display,
        request,
      });
      if (!selection.ok) {
        log?.({
          outcome: selection.reason === 'empty' ? 'selection-empty' : 'selection-shape',
          latencyMs: result.latencyMs,
          usage: result.usage ?? undefined,
          stats: selection.stats,
        });
        return {
          ok: false,
          code: 'UNUSABLE_OUTPUT',
          message: 'No usable names came back this time. Try again.',
          retryable: true,
        };
      }
      log?.({
        outcome: 'success',
        latencyMs: result.latencyMs,
        usage: result.usage ?? undefined,
        stats: selection.stats,
        partial: selection.partial,
        kept: selection.names.length,
      });
      return { ok: true, names: selection.names, partial: selection.partial };
    }
  }
}
