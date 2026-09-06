import { describe, expect, it } from 'vitest';
import { composeBrief, STYLES, VARIANTS } from './styleBriefs';

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
