import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitNaming, UNREADABLE_OUTPUT_MESSAGE } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function submit(body: unknown, status = 200) {
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body, status));
  return submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
}

describe('submitNaming', () => {
  it('posts the canonical request and decodes a success envelope', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ names: ['A', 'B'], partial: true }));
    const result = await submitNaming({ operation: 'generate', mode: 'track' }, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, kind: 'names', names: ['A', 'B'], partial: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/generate');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ operation: 'generate', mode: 'track' });
  });

  it('decodes an album success envelope', async () => {
    const result = await submit({
      album: { title: 'Rain On The Windscreen', tracks: ['Wipers On Low', 'Halfway Home'] },
      partial: false,
    });
    expect(result).toEqual({
      ok: true,
      kind: 'album',
      title: 'Rain On The Windscreen',
      tracks: ['Wipers On Low', 'Halfway Home'],
      partial: false,
    });
  });

  it('rejects a malformed album envelope as an unreadable response', async () => {
    const bodies: unknown[] = [
      { album: { tracks: ['Wipers On Low'] }, partial: false },
      { album: { title: '', tracks: ['Wipers On Low'] }, partial: false },
      { album: { title: 42, tracks: ['Wipers On Low'] }, partial: false },
      { album: { title: 'Rain On The Windscreen', tracks: [7] }, partial: false },
      { album: { title: 'Rain On The Windscreen', tracks: 'junk' }, partial: false },
      { album: 'junk', partial: false },
      { album: { title: 'Rain On The Windscreen', tracks: ['Wipers On Low'] } },
    ];
    for (const body of bodies) {
      const result = await submit(body);
      expect(result).toEqual({
        ok: false,
        code: 'UNUSABLE_OUTPUT',
        message: UNREADABLE_OUTPUT_MESSAGE,
        retryable: true,
      });
    }
  });

  it('rejects a malformed names envelope as an unreadable response', async () => {
    expect(await submit({ names: [7], partial: false })).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT' });
    expect(await submit({ names: ['A'] })).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT' });
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
