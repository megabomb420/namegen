/**
 * Test-only stand-in for the runtime `cloudflare:workers` module. Vitest runs
 * in Node where that module does not exist; the worker bundler (wrangler)
 * resolves the real module instead and never sees this file.
 */
export class DurableObject {
  constructor(_state?: unknown, _env?: unknown) {}
}
