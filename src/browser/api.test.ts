import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitNaming } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('submitNaming', () => {
  it('posts the canonical request and decodes a success envelope', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ names: ['A', 'B'], partial: true }));
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, names: ['A', 'B'], partial: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/generate');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation: 'generate', mode: 'track' });
  });

  it('decodes sanitised server error envelopes', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down', retryable: true } }, 429),
    );
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED', message: 'slow down', retryable: true });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('<html>boom</html>', { status: 500 }));
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: false });
  });

  it('maps transport failures to a retryable connectivity error', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      throw new TypeError('fetch failed');
    });
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'NETWORK', retryable: true });
  });

  it('rejects an unreadable success body', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('not json', { status: 200 }));
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT' });
  });
});
