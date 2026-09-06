# Implementation handoff — [HANDOFF]

Updated: 2026-09-06 (implementation complete; review findings fixed; **live DeepSeek creative run passed 12/12** — see `creative-results-2026-09-06.md`; deploy and device checks still unverified).

## Current state

Standalone v0.1 PWA implemented and committed on `main`: React + TypeScript + Vite frontend, one Cloudflare Worker with Static Assets (`POST /api/generate`), ordinary server-side naming modules, versioned local/session storage, deterministic tests. No ChatGPT/MCP scaffolding. No accounts, no cloud sync, no history browser.

The ten material findings of the external review of `90b7619` are fixed, regression-tested, and recorded in `findings.md` (each with status). This pass changed generation behaviour (explicit `thinking: disabled`; `finish_reason` must be exactly `stop`), so a live creative-fixture rerun is required once a DeepSeek key is available.

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
npm test            # 105 tests, all passing (ordinary suite; live fixtures excluded)
npm run build       # vite build + vite-plugin-pwa (generateSW) → dist/
npm run icons       # regenerate public/icons/*.png (committed, no deps)
npm run fixtures    # EXPLICIT opt-in only: runs the 12 creative fixtures twice against live
                    # DeepSeek via vitest.fixtures.config.ts; skips itself without a key

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
- DeepSeek is called with thinking explicitly disabled (`thinking: { type: "disabled" }`) and only a `finish_reason` of exactly `stop` is accepted as completion; missing/null/`length`/`content_filter` outputs are unusable (never reconstructed, never auto-retried).
- Failed/limited outputs never auto-retry at any layer; “Retry” resubmits the exact failed snapshot; editing and resubmitting is a new request.
- Transport admission is a single lock (`requestActive`) held from submission until settlement; closing Explore or clearing the session invalidates the visible work but never permits a second concurrent paid request.
- Completed refinement batches enter the same bounded (2) current/previous recovery list as generation batches, with originating metadata and names only — raw context/instructions are never persisted. Closing the sheet therefore never discards them.
- Saved names are explorable locally: they keep their saved mode and use current language/length preferences; Explore shows the missing-brief notice and its bounded context field.
- Comparison keys use NFKD + Unicode case folding (incl. ß→ss, final sigma→sigma) while displayed values keep their original spelling and diacritics (shared by server filtering, shortlist dedupe, and avoid-list management).
- The privacy disclosure is scoped to the Namegen service (which stores nothing) and explicitly disclaims control over DeepSeek retention.
- Generated icons come from a dependency-free script so the repo carries no image assets generator; PNGs are committed and self-checked on write.

## Checks performed

Automated (all deterministic, mocked, in CI form — `npm test`):
- 105 passing tests + clean `tsc --noEmit` + production build. Coverage includes: surplus selection & discard; partial batches; zero-valid output; overlength (code-point) and control-character entries; Unicode duplicates incl. full case folding; malformed/truncated provider content and missing/null/non-`stop` finish reasons rejected, never reconstructed; extra-key/overlong-array rejection; avoid+seed exclusion; provider 429/5xx/network/timeout mapping; 24KB body cap (streamed); routing 404/405; content-type 415; kill switch; missing key and missing/broken limiter fail closed; limiter deny → 429 + Retry-After; stale-response and cleared-work races; single active request enforced at the transport layer (concurrent attempts refused until settlement); retry-snapshot identity; refinement batches entering the bounded recovery list and persisting without raw context; saved-name local exploration; session-clear failure surfacing; storage corruption/blocking/full; shortlist 300-cap without eviction; the main journey (Generate → Explore → Save → Reload → Copy); network-failure UI; Explore text editing keeping keyboard focus.

Live provider (real DeepSeek key, 2026-09-06, via `npm run fixtures`):
- Full pass 12/12 fixtures × 2 runs, zero unusable runs, zero truncation. Highest completion tokens 67 (Japanese; Arabic 61; English ≤ 59) — well under the 800 ceiling, so multilingual headroom is empirically confirmed for the JP/AR fixtures. Names, per-run lists, duplicate counts and quality observations are recorded in `creative-results-2026-09-06.md`; provisional read of the ≥75% plausible-candidate gate is met for every non-cliché batch, pending the human reviewer. One transient upstream anomaly (r-artist-spanish failing under sustained load, passing in isolation and in the recorded run) is documented there; the fixtures runner prints evidence before its assertions and fails loudly, and manual single-fixture rerun is the procedure. Live smoke of a blank generate via the full HTTP-less service path also succeeded.

External-review regressions (`findings.md`): all ten findings are fixed and covered — outbound body asserts `thinking: { type: "disabled" }` (F1); focus effect keyed on sheet open/close with a UI test typing in the textarea (F2); transport lock held until settlement with concurrent-attempt tests (F3); disclosure copy scoped + DeepSeek retention disclaimed (F4); refine batches persisted into recovery with Previous/Back reachable (F5); saved-name Explore UI + store tests (F6); finish-reason null/missing/content_filter rejection tests (F7); Straße/STRASSE and final-sigma fold tests (F8); clear-session failure toast/notice tests (F9); fixtures moved to an explicit opt-in config that also fails when either run produces no usable names (F10).

Local Worker smoke test (`wrangler dev`, workerd, real localhost HTTP, **no** DeepSeek key):
- Static SPA served 200; `/api/unknown` JSON 404; non-POST 405 + Allow; `text/plain` 415; malformed JSON 400; valid request with a dummy key performed one real outbound provider attempt and returned the sanitised 502 `UPSTREAM_ERROR` (no raw provider body, no stack). Rate-limit binding simulated fine locally.

Service-worker inspection (build output):
- Precache contains only `index.html`, hashed JS/CSS, icons, favicon, manifest; navigation fallback to `/index.html` carries `denylist: [/^\/api\//]`; no runtime API caching. (Verified by reading `dist/sw.js`, not in a browser.)

## Unverified / open (no credentials, devices, or account access)

- **Live creative quality — human gate.** Live runs succeeded (evidence above and in
  `creative-results-2026-09-06.md`), but the final §12 judgement (≥75% plausible candidates in
  first batches, refinement relationship/instruction quality, repeated-root inspection) is a
  human review of the recorded names that is still open. Rerun `npm run fixtures` after any
  future prompt or generation-setting change.
- **Cloudflare deployment** — **DONE 2026-09-06**: Worker + static assets live at
  https://namegen.whip-blanket.workers.dev (wrangler OAuth, account “Whip Blanket”). Verified on
  the deployed URL: SPA 200, `/api/*` JSON 404/405/415/400 behaviour, and the production kill
  switch returning 503 before any provider contact. Deployed **with `GENERATION_DISABLED=true`**
  (kill switch ON) as a staged rollout — no DeepSeek spend can occur until the switch is removed.
  To go live: (1) configure the provider-enforced spending safeguard / bounded prepaid funding in
  the DeepSeek billing panel, then (2) `wrangler secret delete GENERATION_DISABLED`. The
  rate-limit binding (`RATE_LIMITER`, 10 req/60 s per IP) deployed cleanly with namespace `1001`.
- **Physical-device PWA behaviour** — Android Chrome and iOS Safari install, offline operation,
  and interrupted/restarted sessions were not checked on real devices (no devices/emulators
  here). Service-worker behaviour was verified only by static inspection of the generated worker
  and the local Worker run, not browser emulation — do not treat this as device evidence.
- **API key hygiene** — the live key used on 2026-09-06 was pasted into a chat transcript; it
  should be rotated in the DeepSeek panel once deploy testing is done. `.dev.vars` holds the
  local copy and is gitignored; production uses `wrangler secret put DEEPSEEK_API_KEY`.

## Unresolved issues

- DeepSeek interface details re-verified during the review-fix pass against the current API reference: `deepseek-v4-flash` is a valid model, `thinking: { type: "disabled" }` is the documented way to disable thinking (default is enabled), and `finish_reason` is a required string (`stop | length | content_filter | tool_calls | insufficient_system_resource`). Remaining to verify live: JSON-mode interaction and observed multilingual token headroom at the 800-token ceiling.
- Choose a per-account rate-limit `namespace_id` if the documentation default collides with other Workers under the account.
- Nothing else known-open: all tracked requirements that can be exercised without external credentials are implemented and tested.

## Working between models

GitHub remains the shared source of truth. Pull before starting, read `spec.md` and this handoff, and commit/push completed changes together with an updated handoff. Do not force-push shared history. Update the “Unverified” sections above when live checks are performed, and keep mocked/live/device evidence separate.
