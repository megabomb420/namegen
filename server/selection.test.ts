import { describe, expect, it } from 'vitest';
import { selectAlbum, selectNames, type AlbumSelectionInput, type SelectionInput } from './selection';
import type { NormalizedRequest } from '../shared/contracts';

function request(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    operation: 'generate',
    mode: 'track',
    brief: '',
    language: 'English',
    length: 'auto',
    seed: null,
    instruction: '',
    avoid: [],
    ...overrides,
  };
}

function select(content: string, input: Partial<SelectionInput> = {}) {
  return selectNames({
    content,
    requested: 8,
    display: 6,
    request: request(input.request),
    ...input,
  });
}

const names = (n: string[]) => JSON.stringify({ names: n });

const album = (title: unknown, tracks: unknown) => JSON.stringify({ title, tracks });

/** Track titles "Track 1"…"Track n" — distinct, valid and easy to count. */
const trackList = (n: number) => Array.from({ length: n }, (_, i) => `Track ${i + 1}`);

function selectRelease(content: string, input: Partial<AlbumSelectionInput> = {}) {
  return selectAlbum({
    content,
    requestedTracks: 12,
    displayTracks: 10,
    request: request({ operation: 'generate', mode: 'release' }),
    ...input,
  });
}

describe('selectNames', () => {
  it('keeps valid names in provider order and hides the surplus', () => {
    const outcome = select(names(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']));
    expect(outcome).toMatchObject({ ok: true, partial: false });
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    expect(outcome.stats).toMatchObject({ received: 8, valid: 8 });
  });

  it('flags a partial batch when fewer names remain than the display target', () => {
    const outcome = select(names(['A', 'B', 'C']));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['A', 'B', 'C']);
    expect(outcome.partial).toBe(true);
  });

  it('accepts a single valid name', () => {
    const outcome = select(names(['Only']));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['Only']);
  });

  it('rejects non-JSON, truncated-looking content without reconstructing it', () => {
    expect(select('{"names": ["Cut off').ok).toBe(false);
    expect(select('not json at all').ok).toBe(false);
    expect(select('').ok).toBe(false);
  });

  it('rejects wrong shapes: extra keys, non-arrays, arrays over the request count', () => {
    expect(select(JSON.stringify({ names: ['a'], extra: 1 })).ok).toBe(false);
    expect(select(JSON.stringify({ names: 'a' })).ok).toBe(false);
    expect(select(JSON.stringify([])).ok).toBe(false);
    expect(select(JSON.stringify({})).ok).toBe(false);
    // Generate is asked for 8; 9 is rejected wholesale.
    const nine = Array.from({ length: 9 }, (_, i) => `n${i}`);
    expect(select(names(nine)).ok).toBe(false);
  });

  it('drops non-strings, blanks, overlength and control-character entries', () => {
    const mixed = JSON.stringify({
      names: ['Good', 42, null, '   ', 'x'.repeat(61), 'bad\u0007name', 'Keep  Me', 0],
    });
    const outcome = select(mixed);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['Good', 'Keep Me']);
    expect(outcome.stats.invalid).toBe(6);
  });

  it('measures overlength by Unicode code points, not UTF-16 units', () => {
    // 31 emoji = 62 UTF-16 units but only 31 code points — must stay.
    const emoji = '🎵'.repeat(31);
    const outcome = select(names([emoji]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual([emoji]);
    // 61 code points are dropped.
    expect(select(names(['x'.repeat(61)])).ok).toBe(false);
  });

  it('normalises display whitespace without stripping diacritics', () => {
    const outcome = select(names(['  Neon   Lights ', 'Café']));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['Neon Lights', 'Café']);
  });

  it('deduplicates with compatibility normalisation, case folding and whitespace folding', () => {
    const outcome = select(names(['Café', 'CAFÉ', 'Two  Words', 'Two Words', 'ﬁlm', 'film', 'Neon', 'neon']));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // First readable spelling wins; display values keep their original form.
    expect(outcome.names).toEqual(['Café', 'Two Words', 'ﬁlm', 'Neon']);
    expect(outcome.stats.duplicates).toBe(4);
  });

  it('removes names matching the avoid list and the refinement seed', () => {
    const outcome = select(names(['Cold Front', 'Warm Static', 'Cold  Front', 'Keep This']), {
      request: request({ avoid: ['Cold Front'], seed: 'Warm Static' }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 'Cold  Front' folds equal to the avoided 'Cold Front' (dedupe eats the
    // second copy first); the seed is removed too.
    expect(outcome.names).toEqual(['Keep This']);
    expect(outcome.stats).toMatchObject({ duplicates: 1, excluded: 2 });
  });

  it('reports an empty batch when nothing valid remains after filtering', () => {
    const empty = select(names(['', '   ', '\u0000']));
    expect(empty).toMatchObject({ ok: false, reason: 'empty' });
    const allExcluded = select(names(['A', 'a']), { request: request({ avoid: ['A'] }) });
    expect(allExcluded).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('keeps only the display target for refine (4 of 6)', () => {
    const outcome = selectNames({
      content: names(['a', 'b', 'c', 'd', 'e', 'f']),
      requested: 6,
      display: 4,
      request: request({ operation: 'refine' }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.names).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('selectAlbum', () => {
  it('keeps the title and the first ten tracks from a full album', () => {
    const outcome = selectRelease(album('Tide Book', trackList(12)));
    expect(outcome).toMatchObject({ ok: true, partial: false });
    if (!outcome.ok) return;
    expect(outcome.title).toBe('Tide Book');
    expect(outcome.tracks).toEqual(trackList(10));
    expect(outcome.stats).toMatchObject({ received: 12, invalid: 0, duplicates: 0, excluded: 0, valid: 12 });
  });

  it('flags a partial album below the display target and not at exactly ten', () => {
    const nine = selectRelease(album('Tide Book', trackList(9)));
    expect(nine.ok).toBe(true);
    if (!nine.ok) return;
    expect(nine.tracks).toHaveLength(9);
    expect(nine.partial).toBe(true);

    const ten = selectRelease(album('Tide Book', trackList(10)));
    expect(ten.ok).toBe(true);
    if (!ten.ok) return;
    expect(ten.tracks).toHaveLength(10);
    expect(ten.partial).toBe(false);
  });

  it('rejects any shape that is not exactly title plus tracks', () => {
    expect(selectRelease(JSON.stringify({ title: 'Tide Book', tracks: ['A'], extra: 1 }))).toMatchObject({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(selectRelease(JSON.stringify({ title: 'Tide Book', tracks: 'A' }))).toMatchObject({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(selectRelease(JSON.stringify({ tracks: ['A'] }))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease(JSON.stringify({ title: 'Tide Book' }))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    // Not an object at all.
    expect(selectRelease(JSON.stringify(['Tide Book', 'A']))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease('"Tide Book"')).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease('null')).toMatchObject({ ok: false, reason: 'wrong-shape' });
    // Generate asks for 12 tracks; 13 is rejected wholesale.
    expect(selectRelease(album('Tide Book', trackList(13)))).toMatchObject({ ok: false, reason: 'wrong-shape' });
  });

  it('rejects an unusable title rather than dropping it', () => {
    expect(selectRelease(album(42, ['A']))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease(album('   ', ['A']))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease(album('x'.repeat(61), ['A']))).toMatchObject({ ok: false, reason: 'wrong-shape' });
    expect(selectRelease(album('bad\u0000title', ['A']))).toMatchObject({ ok: false, reason: 'wrong-shape' });
  });

  it('rejects non-JSON content', () => {
    expect(selectRelease('{"title": "Tide Book", "tracks": ["Cut')).toMatchObject({ ok: false, reason: 'not-json' });
    expect(selectRelease('not json at all')).toMatchObject({ ok: false, reason: 'not-json' });
    expect(selectRelease('')).toMatchObject({ ok: false, reason: 'not-json' });
  });

  it('deduplicates tracks against the title and against each other', () => {
    const outcome = selectRelease(
      album('Tide Book', ['Harbor Lights', 'HARBOR LIGHTS', '  Tide   Book  ', 'Salt Air', 'Salt Air']),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tracks).toEqual(['Harbor Lights', 'Salt Air']);
    expect(outcome.stats).toMatchObject({ received: 5, invalid: 0, duplicates: 3, excluded: 0, valid: 2 });
  });

  it('removes tracks matching the avoid list', () => {
    const outcome = selectRelease(album('Tide Book', ['Harbor Lights', 'Salt Air', 'Last Ferry']), {
      request: request({ operation: 'generate', mode: 'release', avoid: ['Salt Air'] }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tracks).toEqual(['Harbor Lights', 'Last Ferry']);
    expect(outcome.stats).toMatchObject({ excluded: 1, valid: 2 });
  });

  it('drops invalid tracks and applies the 60-code-point limit', () => {
    const emoji = '🎵'.repeat(60);
    const outcome = selectRelease(album('Tide Book', ['Good', 42, '   ', 'x'.repeat(61), 'bad\u0007name', emoji]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.tracks).toEqual(['Good', emoji]);
    expect(outcome.stats).toMatchObject({ received: 6, invalid: 4, valid: 2 });
  });

  it('reports an empty album when nothing usable remains', () => {
    expect(selectRelease(album('Tide Book', []))).toMatchObject({ ok: false, reason: 'empty' });
    expect(selectRelease(album('Tide Book', ['   ', 42]))).toMatchObject({ ok: false, reason: 'empty' });
    expect(selectRelease(album('Tide Book', ['Tide Book', '  tide   book  ']))).toMatchObject({
      ok: false,
      reason: 'empty',
    });
    const allAvoided = selectRelease(album('Tide Book', ['Salt Air']), {
      request: request({ operation: 'generate', mode: 'release', avoid: ['Salt Air'] }),
    });
    expect(allAvoided).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('counts received, invalid, duplicate, excluded and valid tracks', () => {
    const outcome = selectRelease(
      album('  Tide  Book ', [
        'Harbor Lights',
        'hArbor   lights',
        'x'.repeat(61),
        'Salt Air',
        'Salt Air',
        'Tide Book',
        'Last Ferry',
      ]),
      { request: request({ operation: 'generate', mode: 'release', avoid: ['Last Ferry'] }) },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.title).toBe('Tide Book');
    expect(outcome.tracks).toEqual(['Harbor Lights', 'Salt Air']);
    expect(outcome.stats).toEqual({ received: 7, invalid: 1, duplicates: 3, excluded: 1, valid: 2 });
  });
});
