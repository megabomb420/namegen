/**
 * Minimal ambient types for the `cloudflare:workers` module, so the Durable
 * Object can `extends DurableObject` (required for RPC) without pulling in the
 * full @cloudflare/workers-types package and its global DOM conflicts.
 */
declare module 'cloudflare:workers' {
  export class DurableObject {
    constructor(state: unknown, env: unknown);
  }
}
