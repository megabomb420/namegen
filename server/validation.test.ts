import { describe, expect, it } from 'vitest';
import { normalizeRequest } from './validation';

const base = { operation: 'generate', mode: 'track' };

describe('normalizeRequest', () => {
  it('rejects non-object bodies', () => {
    for (const raw of [null, 'x', 3, [], true]) {
      expect(normalizeRequest(raw).ok).toBe(false);
    }
  });

  it('rejects unknown top-level fields', () => {
    const result = normalizeRequest({ ...base, system: 'evil' });
    expect(result).toMatchObject({ ok: false, message: 'Unexpected field in request.' });
  });

  it('rejects unknown operations, modes and lengths', () => {
    expect(normalizeRequest({ operation: 'sing', mode: 'track' }).ok).toBe(false);
    expect(normalizeRequest({ operation: 'generate', mode: 'album' }).ok).toBe(false);
    expect(normalizeRequest({ operation: 'generate', mode: 'track', length: 'long' }).ok).toBe(false);
  });

  it('applies defaults for generate', () => {
    const result = normalizeRequest(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      operation: 'generate',
      mode: 'track',
      brief: '',
      language: 'English',
      length: 'auto',
      seed: null,
      instruction: '',
      avoid: [],
    });
  });

  it('rejects a brief over the code-point limit (astral-safe)', () => {
    // 2001 emoji = 2001 code points but 4002 UTF-16 units.
    const result = normalizeRequest({ ...base, brief: '🎵'.repeat(2001) });
    expect(result).toMatchObject({ ok: false, message: 'Brief exceeds 2000 characters.' });
    expect(normalizeRequest({ ...base, brief: '🎵'.repeat(2000) }).ok).toBe(true);
  });

  it('rejects a non-string brief', () => {
    expect(normalizeRequest({ ...base, brief: 42 }).ok).toBe(false);
  });

  it('bounds language to 40 code points', () => {
    expect(normalizeRequest({ ...base, language: 'x'.repeat(41) }).ok).toBe(false);
    expect(normalizeRequest({ ...base, language: '日本語' })).toMatchObject({ ok: true });
  });

  it('trims surrounding whitespace from values', () => {
    const result = normalizeRequest({ ...base, brief: '  kick drum  ', language: '  French  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brief).toBe('kick drum');
    expect(result.value.language).toBe('French');
  });

  it('requires a seed for refine and rejects seeds over the name limit', () => {
    expect(normalizeRequest({ operation: 'refine', mode: 'track' }).ok).toBe(false);
    const seeded = normalizeRequest({ operation: 'refine', mode: 'track', seed: 'Cold Front' });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(seeded.value).toMatchObject({ operation: 'refine', seed: 'Cold Front' });
    expect(normalizeRequest({ operation: 'refine', mode: 'track', seed: 'x'.repeat(61) }).ok).toBe(false);
  });

  it('rejects a seed or instruction carrying control characters', () => {
    expect(normalizeRequest({ operation: 'refine', mode: 'track', seed: 'ok\u0000bad' }).ok).toBe(false);
  });

  it('only allows seed/instruction on refine', () => {
    expect(normalizeRequest({ ...base, seed: 'X' }).ok).toBe(false);
    expect(normalizeRequest({ ...base, instruction: 'darker' }).ok).toBe(false);
  });

  it('bounds refinement instructions to 160 code points', () => {
    expect(
      normalizeRequest({ operation: 'refine', mode: 'track', seed: 'X', instruction: 'x'.repeat(161) }).ok,
    ).toBe(false);
    expect(
      normalizeRequest({ operation: 'refine', mode: 'track', seed: 'X', instruction: '' }),
    ).toMatchObject({ ok: true });
  });

  it('rejects avoid lists over the cap and entries over the name limit', () => {
    const tooMany = { ...base, avoid: Array.from({ length: 25 }, (_, i) => `n${i}`) };
    expect(normalizeRequest(tooMany).ok).toBe(false);
    const tooLong = { ...base, avoid: ['x'.repeat(61)] };
    expect(normalizeRequest(tooLong).ok).toBe(false);
    const nonString = { ...base, avoid: ['fine', 7] };
    expect(normalizeRequest(nonString).ok).toBe(false);
  });

  it('deduplicates avoid entries and drops blanks', () => {
    const result = normalizeRequest({ ...base, avoid: ['  Neon  ', 'NEON', '  ', 'Copper Line'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 'Neon' and 'NEON' fold to one key; blanks are dropped.
    expect(result.value.avoid).toEqual(['Neon', 'Copper Line']);
  });
});
