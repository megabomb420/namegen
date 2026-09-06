import { describe, expect, it } from 'vitest';
import { selectNames, type SelectionInput } from './selection';
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
