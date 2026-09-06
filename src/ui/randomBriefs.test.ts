import { describe, expect, it } from 'vitest';
import { RANDOM_BRIEFS, pickRandomBrief } from './randomBriefs';

describe('random briefs', () => {
  it('has enough varied, bounded ideas', () => {
    expect(RANDOM_BRIEFS.length).toBeGreaterThanOrEqual(12);
    for (const idea of RANDOM_BRIEFS) {
      expect(idea.trim().length).toBeGreaterThan(0);
      expect([...idea].length).toBeLessThanOrEqual(2000);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(RANDOM_BRIEFS).size).toBe(RANDOM_BRIEFS.length);
  });

  it('never returns the previous idea when a different one exists', () => {
    const previous = RANDOM_BRIEFS[0];
    const counter = () => {
      // Force the first pick to collide, proving the filter works.
      let n = 0;
      return () => {
        n += 1;
        return n === 1 ? 0 : 0.5;
      };
    };
    let picked = pickRandomBrief(previous, counter());
    for (let i = 0; i < 50; i++) {
      picked = pickRandomBrief(previous);
      expect(picked).not.toBe(previous);
    }
  });

  it('keeps returning a valid idea even when forced to the same index', () => {
    const alwaysZero = () => 0;
    const previous = RANDOM_BRIEFS[0];
    expect(pickRandomBrief(previous, alwaysZero)).toBe(RANDOM_BRIEFS[1]);
    expect(pickRandomBrief(null, alwaysZero)).toBe(RANDOM_BRIEFS[0]);
  });
});
