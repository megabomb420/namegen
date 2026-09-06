/**
 * Pure sliding-window rate-limit logic, shared by the Durable Object limiter.
 * `timestamps` must be ascending request times (ms). No storage or I/O here so
 * the window boundaries are deterministically testable.
 */

export interface WindowDecision {
  allowed: boolean;
  /** Seconds the caller must wait before retrying (0 when allowed). */
  retryAfterSec: number;
}

export function windowLimit(
  timestamps: readonly number[],
  nowMs: number,
  limit: number,
  windowMs: number,
): WindowDecision {
  const from = nowMs - windowMs;
  const kept = timestamps.filter((t) => t >= from);
  if (kept.length < limit) return { allowed: true, retryAfterSec: 0 };
  // The earliest kept request expires first; that is when a slot opens.
  const retryAfterSec = Math.max(1, Math.ceil((kept[0] + windowMs - nowMs) / 1000));
  return { allowed: false, retryAfterSec };
}

export function pruneTimestamps(timestamps: readonly number[], nowMs: number, windowMs: number): number[] {
  const from = nowMs - windowMs;
  return timestamps.filter((t) => t >= from);
}
