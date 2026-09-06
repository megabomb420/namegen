import { describe, expect, it } from 'vitest';
import { pruneTimestamps, windowLimit } from './window';

const MINUTE = 60_000;

describe('windowLimit', () => {
  it('allows requests up to the limit inside the window', () => {
    const now = 1_000_000;
    const times = [now - 50_000, now - 20_000];
    expect(windowLimit(times, now, 3, MINUTE)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(windowLimit([now - 50_000, now - 20_000, now - 1_000], now, 3, MINUTE)).toEqual({
      allowed: false,
      retryAfterSec: 10,
    });
  });

  it('computes retry-after from the earliest request still inside the window', () => {
    const now = 1_000_000;
    // Three hits at t-59s, t-30s, t-10s: the slot frees when the oldest exits.
    const times = [now - 59_000, now - 30_000, now - 10_000];
    expect(windowLimit(times, now, 3, MINUTE)).toEqual({ allowed: false, retryAfterSec: 1 });
  });

  it('forgets requests outside the window (sliding window)', () => {
    const now = 1_000_000;
    const times = [now - 90_000, now - 70_000, now - 61_000];
    expect(windowLimit(times, now, 3, MINUTE)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(pruneTimestamps(times, now, MINUTE)).toEqual([]);
  });

  it('opens a slot as soon as the oldest in-window request expires', () => {
    const now = 1_000_000;
    const times = [now - 45_000, now - 30_000, now - 20_000];
    expect(windowLimit(times, now, 3, MINUTE)).toEqual({ allowed: false, retryAfterSec: 15 });
    // 16s later that oldest request is gone -> allowed again.
    const later = now + 16_000;
    const pruned = pruneTimestamps(times, later, MINUTE);
    expect(pruned).toHaveLength(2);
    expect(windowLimit(pruned, later, 3, MINUTE)).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it('handles limit 1 and empty histories', () => {
    expect(windowLimit([], 5, 1, MINUTE)).toEqual({ allowed: true, retryAfterSec: 0 });
    expect(windowLimit([4], 5, 1, MINUTE)).toEqual({ allowed: false, retryAfterSec: 60 });
  });
});
