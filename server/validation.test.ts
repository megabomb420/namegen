import { describe, expect, it } from 'vitest';
import { normalizeRequest } from './validation';

const base = { operation: 'generate', mode: 'track' };
const replacement = { operation: 'replaceTrack', mode: 'release' };

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
    expect(normalizeRequest({ operation: 'sing', mode: 'track' })).toMatchObject({
      ok: false,
      message: 'Operation must be "generate", "refine", "alias" or "replaceTrack".',
    });
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

  it('rejects replaceTrack outside release mode', () => {
    const result = normalizeRequest({ operation: 'replaceTrack', mode: 'track', tracks: ['Cold Front'] });
    expect(result).toMatchObject({ ok: false, message: 'Replacement requests must use mode "release".' });
  });

  it('requires tracks to be an array on replaceTrack', () => {
    expect(normalizeRequest(replacement)).toMatchObject({
      ok: false,
      message: 'Tracks must be an array of names.',
    });
    expect(normalizeRequest({ ...replacement, tracks: 'Cold Front' })).toMatchObject({
      ok: false,
      message: 'Tracks must be an array of names.',
    });
  });

  it('accepts a replacement and normalises its album title and track context', () => {
    const result = normalizeRequest({
      ...replacement,
      albumTitle: '  Tide Book  ',
      tracks: ['  Harbor Lights ', 'HARBOR LIGHTS', '  ', 'Salt Air'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ operation: 'replaceTrack', mode: 'release' });
    expect(result.value.albumTitle).toBe('Tide Book');
    // Case/whitespace folding collapses the repeated track; blanks drop out.
    expect(result.value.tracks).toEqual(['Harbor Lights', 'Salt Air']);
  });

  it('accepts an empty replacement context and a missing album title', () => {
    const emptyTracks = normalizeRequest({ ...replacement, tracks: [] });
    expect(emptyTracks.ok).toBe(true);
    if (!emptyTracks.ok) return;
    expect(emptyTracks.value.tracks).toEqual([]);
    expect(emptyTracks.value.albumTitle).toBeNull();

    const blankTitle = normalizeRequest({ ...replacement, albumTitle: '   ', tracks: [] });
    expect(blankTitle.ok).toBe(true);
    if (!blankTitle.ok) return;
    expect(blankTitle.value.albumTitle).toBeNull();
  });

  it('bounds the replacement context: 12 tracks, 60 code points each, no control characters', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `t${i}`);
    expect(normalizeRequest({ ...replacement, tracks: thirteen })).toMatchObject({
      ok: false,
      message: 'The album context exceeds 12 tracks.',
    });
    expect(normalizeRequest({ ...replacement, tracks: ['x'.repeat(61)] })).toMatchObject({
      ok: false,
      message: 'Track list contains an invalid name.',
    });
    expect(normalizeRequest({ ...replacement, tracks: ['Fine', 'bad\u0007name'] }).ok).toBe(false);
    expect(normalizeRequest({ ...replacement, tracks: ['Fine', 42] }).ok).toBe(false);
    // Code points, not UTF-16 units: 60 emoji stay within the limit.
    expect(normalizeRequest({ ...replacement, tracks: ['🎵'.repeat(60)] }).ok).toBe(true);
    expect(normalizeRequest({ ...replacement, tracks: ['🎵'.repeat(61)] }).ok).toBe(false);
  });

  it('bounds the album title like a name and rejects control characters', () => {
    expect(normalizeRequest({ ...replacement, albumTitle: 'x'.repeat(61) })).toMatchObject({
      ok: false,
      message: 'Album title exceeds 60 characters.',
    });
    expect(normalizeRequest({ ...replacement, albumTitle: 'ok\u0000bad' }).ok).toBe(false);
    expect(normalizeRequest({ ...replacement, albumTitle: 42 }).ok).toBe(false);
    expect(normalizeRequest({ ...replacement, tracks: [], albumTitle: '🎵'.repeat(60) }).ok).toBe(true);
  });

  it('only allows albumTitle and tracks on replacement requests', () => {
    const others = [
      { operation: 'generate', mode: 'release' },
      { operation: 'refine', mode: 'release', seed: 'Cold Front' },
      { operation: 'alias', mode: 'artist' },
    ];
    for (const other of others) {
      expect(normalizeRequest({ ...other, albumTitle: 'Tide Book' })).toMatchObject({
        ok: false,
        message: 'Album title is only allowed for replacement requests.',
      });
      expect(normalizeRequest({ ...other, tracks: ['Salt Air'] })).toMatchObject({
        ok: false,
        message: 'Tracks are only allowed for replacement requests.',
      });
    }
    const generate = normalizeRequest(base);
    expect(generate.ok).toBe(true);
    if (!generate.ok) return;
    expect(generate.value.albumTitle).toBeUndefined();
    expect(generate.value.tracks).toBeUndefined();
  });

  it('rejects seed, instruction and alias style on replacement requests', () => {
    expect(normalizeRequest({ ...replacement, seed: 'Cold Front' })).toMatchObject({
      ok: false,
      message: 'Seed is only allowed for refine.',
    });
    expect(normalizeRequest({ ...replacement, instruction: 'darker' })).toMatchObject({
      ok: false,
      message: 'Instruction is only allowed for refine.',
    });
    expect(normalizeRequest({ ...replacement, aliasStyle: 'wu' })).toMatchObject({
      ok: false,
      message: 'Alias style is only allowed for alias requests.',
    });
  });
});
