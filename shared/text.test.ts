import { describe, expect, it } from 'vitest';
import { caseFold, countCodePoints, hasControlCharacter, nameKey, normalizeDisplayWhitespace } from './text';

describe('nameKey case folding', () => {
  it('folds ß to ss so Straße and STRASSE compare equal', () => {
    expect(caseFold('Straße')).toBe('strasse');
    expect(nameKey('Straße')).toBe(nameKey('STRASSE'));
  });

  it('folds the Greek final sigma to the medial sigma', () => {
    expect(nameKey('Σ')).toBe(nameKey('σ'));
    expect(nameKey('ς')).toBe(nameKey('σ'));
    expect(nameKey('ΟΔΥΣΣΕΥΣ')).toBe(nameKey('οδυσσευς'));
  });

  it('still folds case, ligatures and whitespace', () => {
    expect(nameKey('Café')).toBe(nameKey('CAFÉ'));
    expect(nameKey('ﬁlm')).toBe(nameKey('FILM'));
    expect(nameKey('Two  Words')).toBe(nameKey('two words'));
  });

  it('keeps distinct names distinct', () => {
    expect(nameKey('Neon')).not.toBe(nameKey('Echoes'));
    // İ under NFKD lowercases to i + combining dot above; distinct from i.
    expect(nameKey('İstanbul')).not.toBe(nameKey('istanbul'));
  });

  it('never mangles astral characters', () => {
    expect(countCodePoints('🎵'.repeat(3))).toBe(3);
    expect(hasControlCharacter('ok')).toBe(false);
    expect(hasControlCharacter('bad\u0007')).toBe(true);
    expect(normalizeDisplayWhitespace('  Neon   Lights ')).toBe('Neon Lights');
  });
});
