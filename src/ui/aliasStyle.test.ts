import { describe, expect, it } from 'vitest';
import { ALIAS_A, ALIAS_B, rollAlias } from './aliasGenerator';
import { composeBrief, STYLES, VARIANTS } from './styleBriefs';

describe('Wu-style alias generator', () => {
  it('rolls a two-word alias and avoids repeats', () => {
    let current = rollAlias(null);
    for (let i = 0; i < 60; i++) {
      const next = rollAlias(current);
      expect(next).toMatch(/^[A-Za-z]+ [A-Za-z]+$/);
      expect(next).not.toBe(current);
      current = next;
    }
  });

  it('never produces protected Wu-Tang names', () => {
    const protectedNames = new Set(
      ['ghostface killah', 'rza', 'gza', 'method man', 'ol dirty bastard', 'raekwon', 'u-god', 'masta killa'],
    );
    for (let i = 0; i < 500; i++) {
      expect(protectedNames.has(rollAlias(null).toLowerCase())).toBe(false);
    }
  });

  it('uses real word lists', () => {
    expect(ALIAS_A.length).toBeGreaterThanOrEqual(16);
    expect(ALIAS_B.length).toBeGreaterThanOrEqual(16);
  });
});

describe('style + variant brief composer', () => {
  it('composes a bounded, non-empty brief for every combination', () => {
    for (const style of STYLES) {
      for (const variant of VARIANTS) {
        const brief = composeBrief(style.id, variant.id);
        expect(brief.length).toBeGreaterThan(20);
        expect([...brief].length).toBeLessThanOrEqual(2000);
        // The base style description is always present (some flavour of sound).
        const hasSound =
          ['kick', 'bass', 'drums', 'stabs', 'pads', 'breakbeat', 'bleeps', 'chords', '808s', 'sample'].some((w) =>
            brief.toLowerCase().includes(w),
          );
        expect(hasSound).toBe(true);
      }
    }
  });

  it('applies the variant prefix when selected', () => {
    expect(composeBrief('wave', 'atmospheric')).toMatch(/^Atmospheric version:/);
    expect(composeBrief('dnb', 'dark')).toMatch(/^Dark version:/);
    expect(composeBrief('hip-hop', 'instrumental')).toMatch(/^Instrumental only:/);
    expect(composeBrief('uk-garage', 'none')).not.toMatch(/^Dark|^Atmospheric|^Instrumental/);
  });
});
