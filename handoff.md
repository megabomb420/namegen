# Implementation handoff — [HANDOFF]

Updated: 2026-09-06 (implementation complete; live-provider, deployment, and device checks still unverified).

## Current state

Standalone v0.1 PWA implemented and committed on `main`: React + TypeScript + Vite frontend, one Cloudflare Worker with Static Assets (`POST /api/generate`), ordinary server-side naming modules, versioned local/session storage, deterministic tests. No ChatGPT/MCP scaffolding. No accounts, no cloud sync, no history browser.

Repository layout (each part is one boundary; see *Boundaries* below):

- `shared/` — application contract types, limits, text/normalisation helpers (imported by both sides; no HTTP/DOM/node APIs).
- `server/` — naming core: `config.ts`, `runtime-prompt.ts`, `validation.ts`, `selection.ts`, `provider.ts`, `service.ts`.
- `worker/index.ts` — HTTP routing + admission (kill switch, config check, content-type, 24KB body cap, schema validation, Cloudflare rate-limit binding, sanitised mapping).
- `src/` — PWA: `browser/` (storage, api client, clipboard), `state/` (framework-free `AppStore` + helpers), `ui/` (Create/Shortlist/Explore, a11y), `pwa.ts`, `main.tsx`.
- `scripts/` — `make-icons.mjs` (dependency-free PNG icon generator, outputs committed), `fixtures.json` (12 creative fixtures), `fixtures.live.test.ts` (live runner, self-skips without a key).
- `public/`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `package.json`.

## Run and deploy commands

```bash
npm install

# Local development (two terminals, or run each separately)
npm run dev:api     # wrangler dev  → http://localhost:8787 (needs .dev.vars)
npm run dev:web     # vite dev      → http://localhost:5173 (proxies /api → 8787)
# Or serve the built app from the Worker alone: npm run build && npm run dev:api

npm run typecheck   # tsc --noEmit over src/server/worker/shared
npm test            # 105 tests: 93 pass, 12 live-fixture tests skip without a key
npm run build       # vite build + vite-plugin-pwa (generateSW) → dist/
npm run icons       # regenerate public/icons/*.png (committed, no deps)
npm run fixtures    # run the 12 creative fixtures twice against live DeepSeek (skips without a key)

# Deploy (one Worker; config committed without secrets)
npm run build
wrangler secret put DEEPSEEK_API_KEY      # runtime secret
wrangler deploy                           # serves dist/ as static assets + /api/* to the Worker
# Optional kill switch (independent of code deploys):
wrangler secret put GENERATION_DISABLED   # value "true" disables generation, app/shortlist keep working
```

Local secrets go in `.dev.vars` (template: `.dev.vars.example`, gitignored). Cloudflare needs a `ratelimits` binding whose `namespace_id` (`"1001"` in `wrangler.jsonc`, the documentation default) is an integer unique to the account — pick your own if you deploy several rate-limited Workers.

## Boundaries (brief)

- **Naming core** (`server/`, ordinary modules, no browser/HTTP/React): owns request validation/normalisation, stable system prompt ([RUNTIME], §13 verbatim), provider settings and the single direct DeepSeek call (JSON object mode, 800-token ceiling, 20s abort), strict output validation/selection. No path here reads HTTP, cookies, storage or env; `service.runNamingRequest` is the reusable entry a future non-HTTP caller could translate without loopback.
- **HTTP handler** (`worker/index.ts`): owns parsing, routing (unknown `/api/*` JSON 404, non-POST 405 + Allow), body cap enforced while reading, content-type, kill switch (`GENERATION_DISABLED`), secret/config presence, trusted client-IP (`cf-connecting-ip`), rate-limit binding before any paid call, and status/header mapping. It calls the naming core only after every admission check passes; there is no generation path that bypasses the kill switch or the limiter, and the limiter/API-key absence fails closed (503).
- **Browser** (`src/browser/` + `src/state/` + `src/ui/`): versioned localStorage (prefs, shortlist ≤300) and sessionStorage (current/previous successful batches + ≤24 recently displayed exclusions); raw briefs, lyrics, refinement instructions, sheet and request state are memory-only. `AppStore` enforces one active request per client, epoch-guarded responses (cleared/superseded work can never reappear), explicit snapshot retries, and Explore as a purely local action. Application types in `shared/contracts.ts` are independent of provider response objects and of browser state.

## Material decisions

- Client sends only operation/mode/brief/language/length/seed/instruction/avoid (≤24); server derives model, counts (8→6, 6→4), prompt and token settings.
- Failed/limited outputs never auto-retry at any layer; “Retry” resubmits the exact failed snapshot; editing and resubmitting is a new request.
- Refinement results live in the open Explore sheet (save/copy/open-further supported); only generate batches become current/previous persisted results. Tapping any displayed name (including a refinement) opens Explore locally.
- Restored batches keep names/metadata with no originating brief; Explore then shows the notice and offers a bounded context field that is used as the brief for refine.
- Duplicate detection and exclusions use NFKD + case fold + whitespace fold for keys while preserving displayed diacritics/spelling (shared by server filtering, shortlist dedupe, and avoid-list management).
- DeepSeek “thinking disabled” is satisfied by using the non-thinking `deepseek-v4-flash` model without a reasoner toggle; per §14, verify the current DeepSeek API shape at integration time before changing anything.
- Generated icons come from a dependency-free script so the repo carries no image assets generator; PNGs are committed and self-checked on write.

## Checks performed

Automated (all deterministic, mocked, in CI form — `npm test`):
- 93 passing tests + clean `tsc --noEmit` + production build. Coverage includes: surplus selection & discard; partial batches; zero-valid output; overlength (code-point) and control-character entries; Unicode duplicates; malformed/truncated provider content (finish_reason `length` rejected, never reconstructed); extra-key/overlong-array rejection; avoid+seed exclusion; provider 429/5xx/network/timeout mapping; 24KB body cap (streamed); routing 404/405; content-type 415; kill switch; missing key and missing/broken limiter fail closed; limiter deny → 429 + Retry-After; stale-response and cleared-work races; single active request; retry-snapshot identity; storage corruption/blocking/full; shortlist 300-cap without eviction; the main journey (Generate → Explore → Save → Reload → Copy) and network-failure UI.

Local Worker smoke test (`wrangler dev`, workerd, real localhost HTTP, **no** DeepSeek key):
- Static SPA served 200; `/api/unknown` JSON 404; non-POST 405 + Allow; `text/plain` 415; malformed JSON 400; valid request with a dummy key performed one real outbound provider attempt and returned the sanitised 502 `UPSTREAM_ERROR` (no raw provider body, no stack). Rate-limit binding simulated fine locally.

Service-worker inspection (build output):
- Precache contains only `index.html`, hashed JS/CSS, icons, favicon, manifest; navigation fallback to `/index.html` carries `denylist: [/^\/api\//]`; no runtime API caching. (Verified by reading `dist/sw.js`, not in a browser.)

## Unverified (no credentials / devices / account access)

- **Live DeepSeek generation** — no `DEEPSEEK_API_KEY` was available in this environment. `npm run fixtures` runs the 12 committed fixtures (all modes; blank context; detailed concrete briefs; reference-as-qualities; a lyric excerpt; Japanese and Arabic input for multilingual token headroom; two refinements incl. Spanish) twice through the real naming-core modules and prints side-by-side runs, exact-duplicate counts and max completion tokens. Run it with a key; a human must then judge the ≥75% plausible-candidate gate, repeated roots/templates across runs, and multilingual truncation headroom at the 800-token ceiling. Until then the §12 quality gate is unverified.
- **Cloudflare deployment / kill switch / spending safeguard** — no Cloudflare credentials. The kill switch and limiter are code-verified but not deployed; the provider-enforced spending safeguard (or bounded prepaid funding without auto top-ups) is an external DeepSeek/billing configuration that still must be made before public launch; development calls consume the same DeepSeek funds.
- **Physical-device PWA behaviour** — Android Chrome and iOS Safari install, offline operation, and interrupted/restarted sessions were not checked on real devices (no devices/emulators here). Service-worker behaviour was verified only by static inspection of the generated worker and the local Worker run, not browser emulation — do not treat this as device evidence.

## Unresolved issues

- Verify current DeepSeek Chat Completions interface details (model name, JSON-mode constraints, any explicit “thinking disabled” flag) against §14 references before the first live call.
- Choose a per-account rate-limit `namespace_id` if the documentation default collides with other Workers under the account.
- Nothing else known-open: all tracked requirements that can be exercised without external credentials are implemented and tested.

## Working between models

GitHub remains the shared source of truth. Pull before starting, read `spec.md` and this handoff, and commit/push completed changes together with an updated handoff. Do not force-push shared history. Update the “Unverified” sections above when live checks are performed, and keep mocked/live/device evidence separate.
