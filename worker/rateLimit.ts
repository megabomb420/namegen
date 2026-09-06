/**
 * Global per-key (client IP) rate-limit counter implemented as a single
 * Durable Object. Authorized scope change (2026-09-06, product owner): the
 * Cloudflare rate-limit *binding* is not enforced on the account's free plan,
 * so this object enforces the hard per-IP minute cap in application code. It
 * is plan-independent and works on Workers Free.
 *
 * State is held in memory on the single global instance; counters reset only
 * if the object is evicted after idle time, which under sustained traffic does
 * not happen. The window logic itself is pure (`window.ts`).
 */
import { DurableObject } from 'cloudflare:workers';
import { pruneTimestamps, windowLimit, type WindowDecision } from './window';

export interface RateCheckInput {
  key: string;
  limit: number;
  windowSec: number;
}

export class NamingRateLimiter extends DurableObject {
  private readonly hits = new Map<string, number[]>();

  constructor(state: unknown, env: unknown) {
    super(state, env);
  }

  check(input: RateCheckInput): WindowDecision {
    const now = Date.now();
    const windowMs = input.windowSec * 1000;
    const previous = pruneTimestamps(this.hits.get(input.key) ?? [], now, windowMs);
    const decision = windowLimit(previous, now, input.limit, windowMs);
    if (decision.allowed) {
      previous.push(now);
      this.hits.set(input.key, previous);
    }
    return decision;
  }
}
