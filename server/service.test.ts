import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNamingRequest } from './service';
import { SYSTEM_PROMPT } from './runtime-prompt';

const validRequest = { operation: 'generate', mode: 'track', brief: 'a kick drum that hits like a door slamming' };

interface EnvelopeOptions {
  finishReason?: string | null;
  status?: number;
  rawBody?: unknown;
}

function providerResponse(content: string, options: EnvelopeOptions = {}): Response {
  const { finishReason = 'stop', status = 200 } = options;
  const body = {
    id: 'cmpl-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
  };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okResponse(names: unknown[], options: EnvelopeOptions = {}): Response {
  return providerResponse(JSON.stringify({ names }), options);
}

function requestDeps(fetchImpl: typeof fetch, apiKey = 'test-key') {
  return { fetchImpl, apiKey };
}

type FetchSpy = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function okFetch(names: unknown[], options: EnvelopeOptions = {}): FetchSpy {
  return vi.fn(async () => okResponse(names, options));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runNamingRequest', () => {
  it('validates before contacting the provider', async () => {
    const fetchImpl = vi.fn();
    const result = await runNamingRequest({ operation: 'bogus' }, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT', retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('performs one provider call with the fixed model, prompt and JSON-mode settings', async () => {
    const fetchImpl = okFetch(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const result = await runNamingRequest(validRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: true, partial: false });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: 800,
      stream: false,
    });
    expect(body.messages[0]).toMatchObject({ role: 'system', content: SYSTEM_PROMPT });
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({
      operation: 'generate',
      mode: 'track',
      language: 'English',
      length: 'auto',
      avoid: [],
    });
    expect(payload.brief).toContain('door slamming');
    // No user-controlled model, system prompt, token limit or message history.
    for (const forbidden of ['model', 'system', 'max_tokens', 'messages']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('runs the alias operation with the Wu persona and thinking ENABLED', async () => {
    const fetchImpl = okFetch(['Iron Raven', 'Sable Oracle', 'Copper Blade', 'Velvet Vandal', 'Ash Pilgrim', 'Cedar Warden', 'Typhoon Nomad', 'Onyx Alchemist']);
    const result = await runNamingRequest(
      { operation: 'alias', mode: 'artist', brief: 'someone who rhymes about late buses' },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: true, partial: false });
    if (!result.ok) return;
    expect(result.names).toHaveLength(6);

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      max_tokens: 1500,
    });
    expect(body.messages[0].content).toContain('Keeper of the Iron Tongue');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({ operation: 'alias', mode: 'artist' });
    expect(payload).not.toHaveProperty('language');
  });

  it('rejects alias requests outside artist mode', async () => {
    const fetchImpl = vi.fn();
    const result = await runNamingRequest(
      { operation: 'alias', mode: 'track' },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends seed and instruction as structured data on refine', async () => {
    const fetchImpl = okFetch(['x', 'y', 'z', '1', '2', '3'], { finishReason: 'stop' });
    const result = await runNamingRequest(
      { operation: 'refine', mode: 'artist', seed: 'Cold Front', instruction: 'warmer and shorter' },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result.ok).toBe(true);
    const [, init] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    expect(payload).toMatchObject({ operation: 'refine', seed: 'Cold Front', instruction: 'warmer and shorter' });
  });

  it('truncated provider output is rejected and never re-requested', async () => {
    const fetchImpl = okFetch(['Half a na'], { finishReason: 'length' });
    const result = await runNamingRequest(validRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a missing or null finish reason is not treated as completion', async () => {
    const nullReason = okFetch(['Looks', 'Complete'], { finishReason: null });
    const nullResult = await runNamingRequest(validRequest, requestDeps(nullReason as unknown as typeof fetch));
    expect(nullResult).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });

    // Envelope without any finish_reason field at all.
    const missingReason = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ names: ['X'] }) } }],
        }),
        { status: 200 },
      ),
    );
    const missingResult = await runNamingRequest(validRequest, requestDeps(missingReason as unknown as typeof fetch));
    expect(missingResult).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
  });

  it('non-stop finish reasons such as content_filter are rejected', async () => {
    const fetchImpl = okFetch(['Filtered'], { finishReason: 'content_filter' });
    const result = await runNamingRequest(validRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
  });

  it('maps upstream 429 to RATE_LIMITED and other statuses to UPSTREAM_ERROR', async () => {
    const limited = vi.fn(async () => providerResponse('', { status: 429 }));
    const limitedResult = await runNamingRequest(validRequest, requestDeps(limited as unknown as typeof fetch));
    expect(limitedResult).toMatchObject({ ok: false, code: 'RATE_LIMITED', retryable: true });

    const failing = vi.fn(async () => providerResponse('', { status: 503 }));
    const failingResult = await runNamingRequest(validRequest, requestDeps(failing as unknown as typeof fetch));
    expect(failingResult).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR', retryable: true });
  });

  it('maps transport errors to UPSTREAM_ERROR', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await runNamingRequest(validRequest, requestDeps(failing as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UPSTREAM_ERROR', retryable: true });
  });

  it('treats an unreadable provider envelope as unusable output', async () => {
    const envelope = new Response('definitely not json', { status: 200 });
    const result = await runNamingRequest(validRequest, requestDeps((async () => envelope) as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
  });

  it('zero valid names is a retryable failure', async () => {
    const fetchImpl = okFetch(['', '  ', 42, 'x'.repeat(61)]);
    const result = await runNamingRequest(validRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns a partial flag when the filtered batch is below the display target', async () => {
    const fetchImpl = okFetch(['Only A Few', 'More']);
    const result = await runNamingRequest(validRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: true, partial: true });
  });

  it('times the upstream request out at the deadline and never retries', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const pending = runNamingRequest(validRequest, requestDeps(hanging as unknown as typeof fetch));
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'UPSTREAM_TIMEOUT', retryable: true });
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it('reports sanitised service telemetry through the log callback', async () => {
    const events: unknown[] = [];
    const fetchImpl = vi.fn(async () => okResponse(['A', 'B']));
    const result = await runNamingRequest(validRequest, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
      log: (e) => events.push(e),
    });
    expect(result.ok).toBe(true);
    expect(events).toHaveLength(1);
    const event = events[0] as { outcome: string; usage: { promptTokens: number }; stats: { invalid: number } };
    expect(event.outcome).toBe('success');
    expect(event.usage.promptTokens).toBe(12);
    expect(event.stats.invalid).toBe(0);
    // No names, briefs, raw bodies or provider objects in telemetry.
    expect(JSON.stringify(event)).not.toMatch(/slamming|\["A"|choices/);
  });
});
