import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { handleRequest, type RateLimiter, type WorkerEnv } from './index';

const validBody = { operation: 'generate', mode: 'track', brief: 'deep sub bass' };

interface Harness {
  workerEnv: WorkerEnv;
  limitSpy: Mock<(opts: { key: string }) => Promise<{ success: boolean }>>;
}

function makeEnv(options: {
  limitImpl?: (opts: { key: string }) => Promise<{ success: boolean }>;
  apiKey?: string;
  disabled?: boolean;
  noLimiter?: boolean;
  corsOrigins?: string;
} = {}): Harness {
  const limitSpy = vi.fn(options.limitImpl ?? (async () => ({ success: true })));
  const workerEnv: WorkerEnv = {
    DEEPSEEK_API_KEY: options.apiKey === undefined ? 'test-key' : options.apiKey,
    GENERATION_DISABLED: options.disabled === true ? 'true' : undefined,
    CORS_ORIGINS: options.corsOrigins,
    ...(options.noLimiter === true ? {} : ({ RATE_LIMITER: { limit: limitSpy } } as Partial<WorkerEnv>)),
  };
  return { workerEnv, limitSpy };
}

function apiRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://namegen.example/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function providerOk(names: string[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ names }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function providerStatus(status: number, bodyText = ''): Response {
  return new Response(bodyText, { status });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => providerOk(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'])),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('routing', () => {
  it('returns JSON 404 for unknown API paths with any method', async () => {
    for (const method of ['GET', 'POST', 'PUT']) {
      const response = await handleRequest(
        new Request('https://namegen.example/api/nope', { method }),
        makeEnv().workerEnv,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('returns 405 with an Allow header for non-POST generate methods', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await handleRequest(
        new Request('https://namegen.example/api/generate', { method }),
        makeEnv().workerEnv,
      );
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      const body = await readJson(response);
      expect(body.error).toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
    }
  });
});

describe('admission controls', () => {
  it('accepts JSON content types only', async () => {
    const response = await handleRequest(
      apiRequest(validBody, { 'content-type': 'text/plain' }),
      makeEnv().workerEnv,
    );
    expect(response.status).toBe(415);
    expect((await readJson(response)).error).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('enforces the 24KB body cap while reading a streamed body', async () => {
    const oversized = 'x'.repeat(25 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });
    const request = new Request('https://namegen.example/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await handleRequest(request, makeEnv().workerEnv);
    expect(response.status).toBe(413);
    expect((await readJson(response)).error).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('accepts a body just under the cap', async () => {
    const padded = ' '.repeat(24_000) + JSON.stringify(validBody);
    expect(padded.length).toBeLessThan(24 * 1024);
    const response = await handleRequest(apiRequest(padded), makeEnv().workerEnv);
    expect(response.status).toBe(200);
  });

  it('trips the kill switch before any other admission or paid call', async () => {
    const { workerEnv, limitSpy } = makeEnv({ disabled: true });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect(body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(String((body.error as { message?: unknown })?.message)).toContain('switched off');
    expect(limitSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the DeepSeek key is not configured', async () => {
    const { workerEnv, limitSpy } = makeEnv({ apiKey: '' });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(503);
    expect(limitSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and non-object payloads with 400', async () => {
    for (const bodyText of ['{not json', '[1,2]', '"str"', '42']) {
      const response = await handleRequest(apiRequest(bodyText), makeEnv().workerEnv);
      expect(response.status).toBe(400);
      expect((await readJson(response)).error).toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('validates fields before touching the limiter or provider', async () => {
    const { workerEnv, limitSpy } = makeEnv();
    const response = await handleRequest(apiRequest({ operation: 'generate', mode: 'album' }), workerEnv);
    expect(response.status).toBe(400);
    expect(limitSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rate limits by the trusted Cloudflare client IP before the paid call', async () => {
    const { workerEnv, limitSpy } = makeEnv();
    const response = await handleRequest(apiRequest(validBody, { 'cf-connecting-ip': '203.0.113.7' }), workerEnv);
    expect(response.status).toBe(200);
    expect(limitSpy).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses a neutral key when no trusted IP is present', async () => {
    const { workerEnv, limitSpy } = makeEnv();
    await handleRequest(apiRequest(validBody), workerEnv);
    expect(limitSpy).toHaveBeenCalledWith({ key: 'unknown' });
  });

  it('returns 429 with retry guidance when the limiter denies', async () => {
    const { workerEnv, limitSpy } = makeEnv({ limitImpl: async () => ({ success: false }) });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await readJson(response);
    expect(body.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(String((body.error as { message?: unknown })?.message)).toContain('Wait about a minute');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(limitSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the limiter binding is missing', async () => {
    const { workerEnv } = makeEnv({ noLimiter: true });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(503);
    expect((await readJson(response)).error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter throws', async () => {
    const { workerEnv } = makeEnv({
      limitImpl: async () => {
        throw new Error('limiter down');
      },
    });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(503);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('result mapping', () => {
  it('returns the filtered batch with no-store caching on success', async () => {
    const response = await handleRequest(apiRequest(validBody), makeEnv().workerEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await readJson(response);
    expect(body).toEqual({
      names: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
      partial: false,
    });
  });

  it('maps provider errors to sanitised JSON, never raw bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => providerStatus(500, '<html>upstream exploded</html>')));
    const response = await handleRequest(apiRequest(validBody), makeEnv().workerEnv);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await readJson(response);
    expect(body.error).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: true });
    expect(JSON.stringify(body)).not.toContain('upstream exploded');
  });

  it('maps upstream 429s with retry guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => providerStatus(429, 'slow down')));
    const response = await handleRequest(apiRequest(validBody), makeEnv().workerEnv);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('maps unusable output to 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => providerOk(['   ', ''])),
    );
    // Every candidate filters out (blanks), leaving zero valid names.
    const response = await handleRequest(apiRequest(validBody), makeEnv().workerEnv);
    expect(response.status).toBe(502);
    expect((await readJson(response)).error).toMatchObject({ code: 'UNUSABLE_OUTPUT' });
  });

  it('maps an upstream timeout to 504', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const pending = handleRequest(apiRequest(validBody), makeEnv().workerEnv);
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect((await readJson(response)).error).toMatchObject({ code: 'UPSTREAM_TIMEOUT', retryable: true });
  });
});

// Keep the RateLimiter type import referenced for interface drift checks.
const _typeCheck: RateLimiter = { limit: async () => ({ success: true }) };
void _typeCheck;

describe('cross-origin (GitHub Pages mirror)', () => {
  const PAGES_ORIGIN = 'https://megabomb420.github.io';

  it('answers preflight for an allowed origin without contacting the provider', async () => {
    const { workerEnv, limitSpy } = makeEnv({ corsOrigins: PAGES_ORIGIN });
    const request = new Request('https://namegen.example/api/generate', {
      method: 'OPTIONS',
      headers: { origin: PAGES_ORIGIN, 'access-control-request-method': 'POST' },
    });
    const response = await handleRequest(request, workerEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(limitSpy).not.toHaveBeenCalled();
  });

  it('attaches CORS headers to normal responses for an allowed origin', async () => {
    const { workerEnv } = makeEnv({ corsOrigins: PAGES_ORIGIN });
    const request = apiRequest(validBody, { origin: PAGES_ORIGIN });
    const response = await handleRequest(request, workerEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(PAGES_ORIGIN);
  });

  it('never grants CORS to a disallowed origin', async () => {
    const { workerEnv } = makeEnv({ corsOrigins: PAGES_ORIGIN });
    const response = await handleRequest(apiRequest(validBody, { origin: 'https://evil.example' }), workerEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sends no CORS headers without an Origin header, and OPTIONS stays 405', async () => {
    const { workerEnv } = makeEnv({ corsOrigins: PAGES_ORIGIN });
    const response = await handleRequest(apiRequest(validBody), workerEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const options = await handleRequest(new Request('https://namegen.example/api/generate', { method: 'OPTIONS' }), workerEnv);
    expect(options.status).toBe(405);
    expect(options.headers.get('access-control-allow-origin')).toBeNull();
  });
});
