/**
 * Cloudflare Worker HTTP handler for the namegen PWA.
 *
 * Responsibility split:
 *  - This file owns HTTP parsing, status/header mapping, trusted client-IP
 *    extraction, and admission controls (kill switch, body cap, rate limit)
 *    for the single public entry point.
 *  - ../server owns validation, prompts, provider invocation, output filtering
 *    and selection — no HTTP knowledge there.
 *
 * Every /api/* path is routed to this Worker first (wrangler
 * `run_worker_first`); static assets and SPA fallback never serve /api/*.
 */
import { REQUEST_BODY_LIMIT_BYTES } from '../shared/limits';
import type { ApiErrorCode, NamingFailure, NamingResult } from '../shared/contracts';
import { normalizeRequest } from '../server/validation';
import { runValidatedNamingRequest, type ServiceReport } from '../server/service';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface WorkerEnv {
  /** DeepSeek API key. Stored as a Worker secret, never in tracked files. */
  DEEPSEEK_API_KEY?: string;
  /** Independent generation kill switch: set to "true" or "1" to disable. */
  GENERATION_DISABLED?: string;
  /** Cloudflare rate-limit binding (10 requests / 60s per client IP). */
  RATE_LIMITER?: RateLimiter;
  /**
   * Comma-separated list of browser origins allowed to call this API
   * cross-origin (e.g. the GitHub Pages mirror of the PWA). Narrow by design:
   * only these exact origins receive CORS headers; no wildcard is ever used.
   * Omit for a same-origin-only deployment.
   */
  CORS_ORIGINS?: string;
}

type LogFn = (line: string) => void;

const JSON_TYPE = 'application/json; charset=utf-8';
const NO_STORE = 'no-store';
const RETRY_AFTER = '60';

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': NO_STORE,
      ...extraHeaders,
    },
  });
}

function errorResponse(code: ApiErrorCode, message: string, retryable: boolean, status: number): Response {
  return json({ error: { code, message, retryable } }, status);
}

function failureEnvelope(failure: NamingFailure): Response {
  switch (failure.code) {
    case 'INVALID_INPUT':
      return errorResponse(failure.code, failure.message, failure.retryable, 400);
    case 'RATE_LIMITED':
      return errorResponse(failure.code, failure.message, failure.retryable, 429);
    case 'UPSTREAM_TIMEOUT':
      return errorResponse(failure.code, failure.message, failure.retryable, 504);
    case 'UPSTREAM_ERROR':
      return errorResponse(failure.code, failure.message, failure.retryable, 502);
    case 'UNUSABLE_OUTPUT':
      return errorResponse(failure.code, failure.message, failure.retryable, 502);
    case 'SERVICE_UNAVAILABLE':
      return errorResponse(failure.code, failure.message, failure.retryable, 503);
    default:
      return errorResponse(failure.code, failure.message, failure.retryable, 500);
  }
}

function trustedClientIp(request: Request): string {
  // Cloudflare sets cf-connecting-ip at the edge; we never trust a
  // caller-supplied identity header.
  const ip = request.headers.get('cf-connecting-ip');
  const trimmed = (ip ?? 'unknown').trim().toLowerCase();
  return trimmed === '' ? 'unknown' : trimmed;
}

function killSwitchActive(env: WorkerEnv): boolean {
  const value = env.GENERATION_DISABLED;
  return value === 'true' || value === '1';
}

/** Reads the request body, enforcing the 24KB cap while reading. */
async function readBodyLimited(request: Request): Promise<{ ok: true; text: string } | { ok: false; reason: 'too-large' | 'read-failed' }> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > REQUEST_BODY_LIMIT_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  const body = request.body;
  if (body === null) return { ok: true, text: '' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > REQUEST_BODY_LIMIT_BYTES) {
          await reader.cancel();
          return { ok: false, reason: 'too-large' };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

async function handleGenerate(request: Request, env: WorkerEnv, log: LogFn): Promise<Response> {
  // 1. Kill switch: fail closed, preserve static app and shortlist access.
  if (killSwitchActive(env)) {
    log('generate rejected: kill switch active');
    return errorResponse(
      'SERVICE_UNAVAILABLE',
      'Generation is switched off right now. The app and your shortlist keep working.',
      false,
      503,
    );
  }

  // 2. Required configuration before any paid request.
  const apiKey = env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    log('generate rejected: DeepSeek API key not configured');
    return errorResponse('SERVICE_UNAVAILABLE', 'The naming service is not fully configured yet.', false, 503);
  }

  // 3. JSON only.
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) {
    return errorResponse('INVALID_INPUT', 'Request Content-Type must be application/json.', false, 415);
  }

  // 4. Body cap enforced while reading.
  const body = await readBodyLimited(request);
  if (!body.ok) {
    if (body.reason === 'too-large') {
      return errorResponse('INVALID_INPUT', `Request body must be at most ${REQUEST_BODY_LIMIT_BYTES / 1024}KB.`, false, 413);
    }
    return errorResponse('INVALID_INPUT', 'Request body could not be read.', false, 400);
  }

  // 5. Parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return errorResponse('INVALID_INPUT', 'Request body must be valid JSON.', false, 400);
  }

  // 6. Validate before the rate-limit binding or any provider contact.
  const validation = normalizeRequest(parsed);
  if (!validation.ok) {
    return errorResponse('INVALID_INPUT', validation.message, false, 400);
  }

  // 7. Cloudflare rate-limit binding before the paid request. Fail closed when
  //    the limiter or its binding is unavailable.
  const limiter = env.RATE_LIMITER;
  if (limiter === undefined) {
    log('generate rejected: rate limiter binding unavailable');
    return errorResponse(
      'SERVICE_UNAVAILABLE',
      'Request limiting is not configured. Try again later.',
      false,
      503,
    );
  }
  const key = trustedClientIp(request);
  let limited: boolean;
  try {
    const outcome = await limiter.limit({ key });
    limited = !outcome.success;
  } catch (error) {
    log(`rate limiter error: ${error instanceof Error ? error.name : 'unknown'}`);
    return errorResponse('SERVICE_UNAVAILABLE', 'Request limiting is unavailable. Try again later.', false, 503);
  }
  if (limited) {
    log('generate rejected: rate limited');
    const response = errorResponse(
      'RATE_LIMITED',
      'Too many requests from this network. Wait about a minute, then try again.',
      true,
      429,
    );
    response.headers.set('retry-after', RETRY_AFTER);
    return response;
  }

  // 8. The paid naming call, sanitised mapping of its results.
  const result: NamingResult = await runValidatedNamingRequest(validation.value, {
    apiKey,
    fetchImpl: fetch,
    log: (report: ServiceReport) => {
      const line: Record<string, unknown> = { event: 'naming', outcome: report.outcome };
      if (report.httpStatus !== undefined) line.httpStatus = report.httpStatus;
      if (report.latencyMs !== undefined) line.latencyMs = report.latencyMs;
      if (report.usage !== undefined) {
        line.promptTokens = report.usage.promptTokens;
        line.completionTokens = report.usage.completionTokens;
      }
      if (report.stats !== undefined) line.stats = report.stats;
      if (report.partial !== undefined) line.partial = report.partial;
      if (report.kept !== undefined) line.kept = report.kept;
      log(JSON.stringify(line));
    },
  });

  if (!result.ok) {
    const response = failureEnvelope(result);
    if (result.code === 'RATE_LIMITED') {
      response.headers.set('retry-after', RETRY_AFTER);
    }
    return response;
  }
  return json({ names: result.names, partial: result.partial }, 200);
}

async function route(request: Request, env: WorkerEnv, log: LogFn): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path !== '/api/generate') {
    // Every unknown /api path is a JSON 404; API paths never return HTML.
    if (path.startsWith('/api/')) {
      return errorResponse('NOT_FOUND', 'Not found.', false, 404);
    }
    // Defensive: with run_worker_first only /api/* reaches this Worker.
    return errorResponse('NOT_FOUND', 'Not found.', false, 404);
  }

  if (request.method !== 'POST') {
    const response = errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', false, 405);
    response.headers.set('allow', 'POST');
    return response;
  }

  return await handleGenerate(request, env, log);
}

// ----- Cross-origin support for the GitHub Pages mirror --------------------
// Narrow by design: only origins listed in CORS_ORIGINS (plus the Worker's own
// origin) receive CORS headers. No wildcard is ever used.

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function corsOriginFor(request: Request, env: WorkerEnv): string | null {
  const raw = request.headers.get('origin');
  if (raw === null || raw === '') return null;
  const origin = normalizeOrigin(raw);
  if (origin === new URL(request.url).origin) return origin;
  const configured = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((o) => o !== '');
  return configured.includes(origin) ? origin : null;
}

function applyCors(request: Request, env: WorkerEnv, response: Response): Response {
  const origin = corsOriginFor(request, env);
  if (origin !== null) {
    response.headers.set('access-control-allow-origin', origin);
    response.headers.set('vary', 'Origin');
  }
  return response;
}

function preflightResponse(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'vary': 'Origin',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'cache-control': NO_STORE,
    },
  });
}

export async function handleRequest(request: Request, env: WorkerEnv, log: LogFn = (line) => console.log(line)): Promise<Response> {
  try {
    const url = new URL(request.url);
    // CORS preflight for the API before any routing decision.
    if (request.method === 'OPTIONS' && url.pathname === '/api/generate') {
      const origin = corsOriginFor(request, env);
      if (origin !== null) return preflightResponse(origin);
    }
    return applyCors(request, env, await route(request, env, log));
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    const message = error instanceof Error ? error.message : 'unknown';
    // No stack traces, no bodies, no request content in logs.
    console.log(JSON.stringify({ event: 'http-failure', name, message }));
    return applyCors(request, env, errorResponse('SERVICE_UNAVAILABLE', 'Something went wrong. Try again.', true, 500));
  }
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
