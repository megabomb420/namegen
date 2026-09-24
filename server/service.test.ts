import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNamingRequest } from './service';
import { SYSTEM_PROMPT } from './runtime-prompt';

const validRequest = { operation: 'generate', mode: 'track', brief: 'a kick drum that hits like a door slamming' };
const releaseRequest = { operation: 'generate', mode: 'release', brief: 'a coastal EP cut from field recordings' };

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

function albumResponse(title: unknown, tracks: unknown[], options: EnvelopeOptions = {}): Response {
  return providerResponse(JSON.stringify({ title, tracks }), options);
}

function albumFetch(title: unknown, tracks: unknown[], options: EnvelopeOptions = {}): FetchSpy {
  return vi.fn(async () => albumResponse(title, tracks, options));
}

const albumTracks = (n: number) => Array.from({ length: n }, (_, i) => `Tide ${i + 1}`);

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
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: 800,
      stream: false,
    });
    expect(body.messages[0]).toMatchObject({ role: 'system', content: SYSTEM_PROMPT });
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({
      operation: 'generate',
      task: 'You are naming a single track.',
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
    if (!result.ok || result.kind !== 'names') return;
    expect(result.names).toHaveLength(6);

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      max_tokens: 2500,
    });
    expect(body.messages[0].content).toContain('Keeper of the Iron Tongue');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({ operation: 'alias', mode: 'artist' });
    // The alias personas follow the requested language, but carry no length
    // guidance: their names are always two words.
    expect(payload.language).toBe('English');
    expect(payload).not.toHaveProperty('length');
  });

  it('sends the requested language to the alias personas and never a length', async () => {
    const fetchImpl = okFetch([
      'Rincón Suave',
      'Luz de Bus',
      'Papel Ahumado',
      'Radio Vieja',
      'Pan de Nube',
      'Sur Lejano',
      'Cinta Azul',
      'Último Andén',
    ]);
    const result = await runNamingRequest(
      { operation: 'alias', mode: 'artist', language: 'Spanish', brief: 'un alias para la madrugada' },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: true, kind: 'names', partial: false });

    const [, init] = fetchImpl.mock.calls[0];
    const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    expect(payload.language).toBe('Spanish');
    expect(payload).not.toHaveProperty('length');
    expect(payload).not.toHaveProperty('albumTitle');
    expect(payload).not.toHaveProperty('tracks');
  });

  it('uses the emo cloud-rap persona when aliasStyle is emo', async () => {
    const fetchImpl = okFetch(['Wilted Crown', 'Freezer Burn', 'Rain Room', 'Pillow Case', 'Low Orbit', 'Mourning Dew', 'Clouded', 'Last Bus Home']);
    const result = await runNamingRequest(
      { operation: 'alias', mode: 'artist', aliasStyle: 'emo', brief: 'sad boy who records at 3am' },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: true, partial: false });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content).toContain('Nobody');
    expect(body.messages[0].content).toContain('cloud-rap');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.task).toContain('sad, cloud-rap');
    expect(payload.aliasStyle).toBe('emo');
  });

  it('works the style out from the brief when aliasStyle is brief', async () => {
    const fetchImpl = okFetch([
      'Quarry Ledger',
      'Lime Dust Choir',
      'Pump House',
      'Blue Rung',
      'Night Shift Whistle',
      'Flood Line',
      'Cold Meal',
      'Rafters',
    ]);
    const result = await runNamingRequest(
      {
        operation: 'alias',
        mode: 'artist',
        aliasStyle: 'brief',
        brief: 'producer making melancholy UK garage about a flooded quarry town',
      },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: true, partial: false });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    // Same paid alias path: thinking enabled, its own persona, the brief read.
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.max_tokens).toBe(2500);
    expect(body.messages[0].content).toContain('no house style');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.task).toContain('from the brief');
    expect(payload.aliasStyle).toBe('brief');
    expect(payload.brief).toContain('flooded quarry town');
    expect(payload).not.toHaveProperty('length');
  });

  it('rejects an unknown aliasStyle', async () => {
    const fetchImpl = vi.fn();
    const result = await runNamingRequest(
      { operation: 'alias', mode: 'artist', aliasStyle: 'metal' as never },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it('names one album for a release-mode generate and returns its title and tracks', async () => {
    const fetchImpl = albumFetch('Tide Book', albumTracks(12));
    const result = await runNamingRequest(releaseRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: true, kind: 'album', partial: false });
    if (!result.ok || result.kind !== 'album') return;
    expect(result.title).toBe('Tide Book');
    expect(result.tracks).toEqual(albumTracks(10));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 800 });
    expect(body).not.toHaveProperty('reasoning_effort');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({
      operation: 'generate',
      mode: 'release',
      task: 'You are naming an album, EP or project: one title plus its track list.',
      language: 'English',
      length: 'auto',
      responseShape: 'album',
    });
    expect(payload.brief).toContain('field recordings');
  });

  it('treats a names batch as unusable output for a release request', async () => {
    const fetchImpl = okFetch(['Tide Book', 'Salt Air']);
    const result = await runNamingRequest(releaseRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({
      ok: false,
      code: 'UNUSABLE_OUTPUT',
      message: 'No usable album came back this time. Try again.',
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats an album whose title cannot be used as unusable output', async () => {
    const fetchImpl = albumFetch('x'.repeat(61), ['Track 1']);
    const result = await runNamingRequest(releaseRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('flags a partial album when fewer than ten tracks survive', async () => {
    const fetchImpl = albumFetch('Tide Book', albumTracks(9));
    const result = await runNamingRequest(releaseRequest, requestDeps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: true, kind: 'album', partial: true });
    if (!result.ok || result.kind !== 'album') return;
    expect(result.tracks).toEqual(albumTracks(9));
  });

  it('sends the album context for replaceTrack and keeps a single candidate', async () => {
    const fetchImpl = okFetch(['Third Rail', 'Signal Fog', 'Last Ferry']);
    const result = await runNamingRequest(
      {
        operation: 'replaceTrack',
        mode: 'release',
        brief: 'the missing middle track',
        albumTitle: 'Tide Book',
        tracks: ['Harbor Lights', 'Salt Air'],
      },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: true, kind: 'names', partial: false });
    if (!result.ok || result.kind !== 'names') return;
    expect(result.names).toEqual(['Third Rail']);

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 800 });
    expect(body).not.toHaveProperty('reasoning_effort');
    const payload = JSON.parse(body.messages[1].content);
    expect(payload).toMatchObject({
      operation: 'replaceTrack',
      mode: 'release',
      task: 'You are replacing one track title on an album, keeping it consistent with the record it belongs to.',
      albumTitle: 'Tide Book',
      tracks: ['Harbor Lights', 'Salt Air'],
      language: 'English',
      length: 'auto',
      responseShape: 'names',
    });
    for (const forbidden of ['seed', 'instruction', 'aliasStyle']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('accepts only the three candidates it asked the provider for on replaceTrack', async () => {
    const fetchImpl = okFetch(['A', 'B', 'C', 'D']);
    const result = await runNamingRequest(
      { operation: 'replaceTrack', mode: 'release', tracks: [] },
      requestDeps(fetchImpl as unknown as typeof fetch),
    );
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it('sends the word cap on naming operations and never to the alias personas', async () => {
    const naming = okFetch(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    await runNamingRequest({ ...validRequest, maxWords: 2 }, requestDeps(naming as unknown as typeof fetch));
    const [, init] = naming.mock.calls[0];
    const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    expect(payload.maxWords).toBe(2);
    // The cap is restated on the task line the model reads, not only in the
    // system prompt: live runs ignored a two-word cap that lived only there.
    expect(payload.task).toBe(
      'You are naming a single track. Hard limit, over every other preference: every name must be at most 2 words — shorten the idea, never the limit.',
    );

    // A capped request asks for a bigger pool than it displays, so the batch
    // still fills after over-cap names are filtered out.
    expect(payload.count).toBe(12);

    const plain = okFetch(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    await runNamingRequest(validRequest, requestDeps(plain as unknown as typeof fetch));
    const [, plainInit] = plain.mock.calls[0];
    const plainPayload = JSON.parse(JSON.parse(String(plainInit?.body)).messages[1].content);
    expect(plainPayload).not.toHaveProperty('maxWords');
    expect(plainPayload.count).toBe(8);

    const cappedAlbum = albumFetch('Waterline', albumTracks(12));
    await runNamingRequest({ ...releaseRequest, maxWords: 2 }, requestDeps(cappedAlbum as unknown as typeof fetch));
    const [, albumInit] = cappedAlbum.mock.calls[0];
    const albumPayload = JSON.parse(JSON.parse(String(albumInit?.body)).messages[1].content);
    expect(albumPayload.count).toBe(16);

    const alias = okFetch(['Iron Raven', 'Sable Oracle', 'Copper Blade', 'Velvet Candle', 'Ash Pilgrim', 'Cedar Warden', 'Typhoon Nomad', 'Onyx Alchemist']);
    await runNamingRequest(
      { operation: 'alias', mode: 'artist', aliasStyle: 'wu', brief: 'dusty drums', maxWords: 1 },
      requestDeps(alias as unknown as typeof fetch),
    );
    const [, aliasInit] = alias.mock.calls[0];
    const aliasPayload = JSON.parse(JSON.parse(String(aliasInit?.body)).messages[1].content);
    expect(aliasPayload).not.toHaveProperty('maxWords');
    expect(aliasPayload).not.toHaveProperty('length');
  });

  it('drops the clichés a provider still wrote and reports how many went', async () => {
    const events: unknown[] = [];
    const fetchImpl = okFetch(['Iron Raven', 'Midnight', 'Sable Oracle', 'Neon Dreams', 'Copper Blade', 'Cedar Warden', 'Typhoon Nomad', 'Onyx Alchemist']);
    const result = await runNamingRequest(validRequest, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
      log: (e) => events.push(e),
    });
    expect(result).toMatchObject({ ok: true, kind: 'names', partial: false });
    if (!result.ok || result.kind !== 'names') return;
    expect(result.names).toEqual(['Iron Raven', 'Sable Oracle', 'Copper Blade', 'Cedar Warden', 'Typhoon Nomad', 'Onyx Alchemist']);
    const event = events[0] as { outcome: string; stats: { generic: number; valid: number }; kept: number };
    expect(event.outcome).toBe('success');
    expect(event.stats.generic).toBe(2);
    expect(event.kept).toBe(6);
  });

  it('refuses a whole album whose title is a cliché instead of shipping it', async () => {
    const events: unknown[] = [];
    const fetchImpl = albumFetch('Neon Dreams', albumTracks(12));
    const result = await runNamingRequest(releaseRequest, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'k',
      log: (e) => events.push(e),
    });
    expect(result).toMatchObject({ ok: false, code: 'UNUSABLE_OUTPUT', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const event = events[0] as { outcome: string };
    expect(event.outcome).toBe('selection-generic');
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
