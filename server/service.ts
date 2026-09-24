/**
 * Naming service: the single entry point ordinary server-side code exposes to
 * the Worker. It owns validation, counts/settings, payload building, provider
 * invocation and output selection. Provider types stay inside this module's
 * dependencies; the public result is the application contract only.
 */
import type { NamingResult, NormalizedRequest } from '../shared/contracts';
import { ALBUM_TRACKS, WORD_CAP_HEADROOM } from '../shared/limits';
import { isAlbumRequest, REQUEST_COUNTS, THINKING_SETTINGS } from './config';
import { ALIAS_SYSTEM, ALIAS_SYSTEM_BRIEF, ALIAS_SYSTEM_EMO } from './alias-prompt';
import { callChatCompletions, type DeepSeekUsage, type ProviderDeps } from './provider';
import { normalizeRequest } from './validation';
import { selectAlbum, selectNames, type SelectionStats } from './selection';

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
    | 'selection-shape'
    | 'selection-generic'
    | 'selection-over-cap';
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
 * exactly what it is producing in the active tab (track/release/artist/alias/
 * track replacement). */
function taskLabel(request: NormalizedRequest): string {
  if (request.operation === 'alias') {
    if (request.aliasStyle === 'brief') {
      return 'You are naming an artist from the brief they wrote about their own music.';
    }
    return request.aliasStyle === 'emo'
      ? 'You are handing out a sad, cloud-rap style artist alias.'
      : 'You are handing out a Wu-Tang-style artist alias.';
  }
  if (request.operation === 'replaceTrack') {
    return 'You are replacing one track title on an album, keeping it consistent with the record it belongs to.';
  }
  if (isAlbumRequest(request)) {
    return 'You are naming an album, EP or project: one title plus its track list.';
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

/**
 * The task line the model reads in the user message. The word cap is restated
 * here as well as in the runtime prompt, because a limit buried in a long
 * system prompt is followed less reliably than one attached to the task; live
 * runs returned three-word names for a two-word cap until this was added.
 */
function taskWithWordCap(request: NormalizedRequest): string {
  const task = taskLabel(request);
  if (request.maxWords === null || request.operation === 'alias') return task;
  const unit = request.maxWords === 1 ? 'word' : 'words';
  return `${task} Hard limit, over every other preference: every name must be at most ${request.maxWords} ${unit} — shorten the idea, never the limit.`;
}

function buildPayload(request: NormalizedRequest, count: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    operation: request.operation,
    task: taskWithWordCap(request),
    /** How many entries this request expects, in the terms the shape uses. */
    count,
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
  if (request.operation === 'replaceTrack') {
    payload.albumTitle = request.albumTitle ?? '';
    payload.tracks = request.tracks ?? [];
  }
  // The shape is never inferred by the model from the mode: an album request is
  // the only one that returns {"title","tracks"}, and a replacement — which also
  // carries an album title and tracks — must still answer with {"names":[…]}.
  payload.responseShape = isAlbumRequest(request) ? 'album' : 'names';
  // The requested language applies to every operation, aliases included.
  // Length guidance does not apply to the two-word alias personas.
  payload.language = request.language;
  if (request.operation !== 'alias') {
    payload.length = request.length;
    // The length slider travels as an explicit cap, and only when the person
    // set one: an absent field means the model keeps its own judgement.
    if (request.maxWords !== null) payload.maxWords = request.maxWords;
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
  // A word cap is enforced by filtering, so a capped request asks for a bigger
  // pool than it displays: the batch still fills after over-cap names are gone.
  const capped = request.maxWords !== null && request.operation !== 'alias';
  const requestedNames = capped ? Math.max(counts.requested, WORD_CAP_HEADROOM.names) : counts.requested;
  const requestedTracks = capped ? Math.max(ALBUM_TRACKS.requested, WORD_CAP_HEADROOM.tracks) : ALBUM_TRACKS.requested;
  const count = isAlbumRequest(request) ? requestedTracks : requestedNames;

  const providerDeps: ProviderDeps = { fetchImpl, apiKey, ...(now !== undefined ? { now } : {}) };
  // Naming requests (generate, refine, replaceTrack and album requests) keep
  // thinking DISABLED per spec §6 — live runs with thinking enabled truncated
  // on the token ceiling and took ~25s per call. The alias operation runs with
  // thinking ENABLED and picks its persona from aliasStyle (wu | emo).
  const isAlias = request.operation === 'alias';
  const aliasSystem =
    request.aliasStyle === 'emo'
      ? ALIAS_SYSTEM_EMO
      : request.aliasStyle === 'brief'
        ? ALIAS_SYSTEM_BRIEF
        : ALIAS_SYSTEM;
  const result = await callChatCompletions(buildPayload(request, count), providerDeps, isAlias
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
      // A release-mode generate names one album: a title plus its track list.
      if (isAlbumRequest(request)) {
        const album = selectAlbum({
          content: result.content,
          requestedTracks,
          displayTracks: ALBUM_TRACKS.display,
          request,
        });
        if (!album.ok) {
          log?.({
            outcome:
              album.reason === 'empty'
                ? 'selection-empty'
                : album.reason === 'generic'
                  ? 'selection-generic'
                  : album.reason === 'over-cap'
                    ? 'selection-over-cap'
                    : 'selection-shape',
            latencyMs: result.latencyMs,
            usage: result.usage ?? undefined,
            stats: album.stats,
          });
          return {
            ok: false,
            code: 'UNUSABLE_OUTPUT',
            message: 'No usable album came back this time. Try again.',
            retryable: true,
          };
        }
        log?.({
          outcome: 'success',
          latencyMs: result.latencyMs,
          usage: result.usage ?? undefined,
          stats: album.stats,
          partial: album.partial,
          kept: album.tracks.length,
        });
        return { ok: true, kind: 'album', title: album.title, tracks: album.tracks, partial: album.partial };
      }

      const selection = selectNames({
        content: result.content,
        requested: requestedNames,
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
      return { ok: true, kind: 'names', names: selection.names, partial: selection.partial };
    }
  }
}
