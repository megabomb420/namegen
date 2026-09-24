# Implementation handoff — [HANDOFF]

Updated: 2026-09-24 (fifth pass). The frontend redesign is complete and published to Sites, GitHub Pages, and the existing Cloudflare Worker. Earlier passes moved the provider model id to `deepseek-flash`, synced `spec.md` with the retired-PWA reality, and changed what Release and Artist produce (one album per release, always-alias Artist, per-track replacement), so the response contract and the client state shape were reworked — see the third-pass and fourth-pass sections below. The fifth pass is a screen pass with no source change: it closes the layout gaps the third and fourth passes left open. This document supersedes the earlier PWA deployment instructions.

## Current state and live locations

- Shared source of truth: https://github.com/megabomb420/namegen (public repository, `main`).
- Public GitHub Pages website: https://megabomb420.github.io/namegen/
- Sites website: https://namegen-studio.myby.chatgpt.site (owner-private at publication).
- Existing Worker website and naming API: https://namegen.whip-blanket.workers.dev
- Published implementation commit: `a88806c41a5d3b8b3b9cf8b351f37b433d8b4fee`. This handoff update is a subsequent documentation-only commit.
- Local implementation branch: `codex/namegen-website`. The implementation was pushed to GitHub `main` without rewriting history.
- GitHub Pages deployment succeeded: https://github.com/megabomb420/namegen/actions/runs/35275010870. Its workflow still has the historical display name “Deploy PWA mirror to GitHub Pages”; the output is now a website.

React + TypeScript + Vite remain the frontend stack. Both static hosts call the existing Worker at `POST /api/generate`; the DeepSeek key, provider calls, validation, and admission controls remain server-side. Sites does not host a second naming backend. No accounts, cloud sync, or new product features were added.

## 2026-09-17 second pass: provider model id and specification sync

- `server/config.ts` now sends `model: "deepseek-flash"`. DeepSeek released V4.1 Flash on 2026-09-10 and `deepseek-flash` is the current name for it; `deepseek-v4-flash` is retired and only temporarily routed to V4.1 Flash for compatibility, so the old id worked by accident rather than by intent. `server/service.test.ts` asserts the outbound model string, so the ordinary suite covers the rename.
- Thinking settings are unchanged and still valid for V4.1 Flash: `thinking: { type: "disabled" }` for generate/refine, and `thinking: { type: "enabled" }` with `reasoning_effort: "low"` for alias (the model family supports low/high/max effort).
- The stale comment in `server/config.ts` claiming thinking is enabled for every operation was replaced with the actual routing: the `THINKING_SETTINGS` block applies to the alias operation only.
- `spec.md` was synced with reality: the model name (§5, §6), the authoritative limiter (§9 now states the Durable Object cap of 3 requests per 60 seconds per client IP via `NAMING_LIMIT_PER_MINUTE`, with the Cloudflare binding as an extra edge layer, instead of "10 requests per 60 seconds"), the two-static-host deployment deviation, and §10, which now documents offline behaviour and service-worker retirement rather than requiring a PWA. The PWA-era wording elsewhere in the document (§1, §3, §7, §8, §11, §12) was corrected with it.
- `creative-results-2026-09-06.md` was deliberately left untouched: it is a dated record of runs performed against the model id current at that time.

## 2026-09-17 third pass: Release albums, always-alias Artist, per-track replacement

Product decisions taken by the owner, then implemented:

- **Release names one album.** `generate` + `mode: "release"` now asks for one album title plus 12 track titles and displays the title with up to 10 tracks (`ALBUM_TRACKS` in `shared/limits.ts`, `isAlbumRequest` in `server/config.ts`), instead of six interchangeable release names. The model must answer `{"title": …, "tracks": […]}`; `selectAlbum` in `server/selection.ts` validates that shape as strictly as the names shape and never reconstructs an unusable title.
- **Artist always rolls an alias.** The main Artist button issues the existing `alias` operation with the selected persona, chosen by a segmented control in place of the old "Alias tools" cards. The generic `generate` path stays available in the API for Track and Release and remains fixture-covered.
- **A whole album is one shortlist entry.** `SavedEntry` is a union (`name` | `album` with title and tracks); copying an album emits the title followed by numbered tracks. Within a mode there is still one entry per title, so the Save chip in Explore toggles the album entry itself when the sheet was opened from an album title.
- **A track can be replaced.** A per-track action issues the new `replaceTrack` operation (Release only, thinking disabled, 3 candidates from which one is used), carrying `albumTitle` and the remaining `tracks` as context and as exclusions. The old title stays visible until the replacement succeeds; on failure the row keeps it and offers an explicit Retry. No automatic retry anywhere, and the transport lock still permits only one paid request at a time.
- **Contract:** success is now `{"names":[…],"partial":…}` **or** `{"album":{"title":…,"tracks":[…]}, "partial":…}`. `NamingSuccess` carries a `kind` discriminant, and the Worker, the client decoder, the store and the session/shortlist storage were updated together.
- **Storage stayed additive:** keys and `version: 1` are unchanged and stored items without a `kind` are read as plain names, so an existing shortlist and session survive the change.
- **Bug fixed on the way:** `generateAlias` never sent `language`, so an alias batch carried `language: ""` and `validStoredBatch` then rejected the **whole** session on reload. Alias now sends `language` (and both personas were told to follow it), and the batch keeps it.

## 2026-09-17 fourth pass: alter-ego cards and a brief-driven alias

- The Artist section is now **three action cards** instead of a persona selector: **From your brief** — the model reads what you wrote and works the style out from it (`aliasStyle: "brief"`, which requires a non-empty brief) — plus **Keeper of the Iron Tongue** (`wu`) and **Nobody's Darling** (`emo`), the latter two needing no brief. Clicking a card rolls immediately, and the main Artist button does what the first card does.
- A third stable, server-side persona prompt (`ALIAS_SYSTEM_BRIEF`) joins the other two: no house style of its own, the names have to fit the brief, everything else (JSON shape, eight candidates, no real artists, 60-character limit, language) is unchanged. Validation rejects `aliasStyle: "brief"` without a brief, and the client never sends it: the card and the main button are disabled with a short explanation.
- The persona *selection* state is gone (`AppState.aliasStyle`, `setAliasStyle`, `StoredPrefs.aliasStyle`) because each card names its own style. Stored prefs that still contain the old field keep loading; written prefs no longer carry it.
- Verified: 192 tests in 11 files pass (183 before), `tsc` clean, `build:worker` succeeds. Live after deploying Worker `74dd1644-8133-4e19-8dde-737a5b080c55`: the three card labels are present in the served bundle and the old persona-selector copy is gone; `aliasStyle: "brief"` without a brief returns 400 `INVALID_INPUT` (the request never reaches the limiter or the provider); with a brief it returned six names that visibly come from it — `Silted Chorus · Quarry Lament · Drowned Arcade · Basin Static · Chalkwater Ghost · Submerged Estate` for a brief about a flooded quarry town.
- Not verified here: the card grid on a real screen — the fourth pass had no browser pass, and the row still relies on an `auto-fit` grid with a 220px minimum. **Closed 2026-09-24 by the fifth-pass screen pass below** at 390×844 (one 350px column), 768×1024 (three 229px columns) and 1440×1000 (three 271px columns), with no horizontal overflow at any of them.

## 2026-09-24 fifth pass: the screen pass the album and cards were missing

No source changed in this pass. The third pass recorded "no browser or visual pass was done for the new album, track-list and persona UI — treat the layout as unverified until it has been seen on a screen", and the fourth pass repeated it for the card grid. Both are now seen and measured, and the layout holds.

Method: `npm run dev:web` at `http://localhost:5173` in a headless Chromium, driven through the real UI (mode buttons, brief field, Generate, the replace action on a track row, the alias cards). Every `POST /api/generate` was answered in-page by request interception, so **no request reached the Worker and no provider call was paid for**; the stub answered with one album (`Stub Album Title` + 10 tracks) for `generate/release`, three candidates for `replaceTrack`, and six names for every other operation. Measured at 390×844, 768×1024, 1440×1000 and 320×740, from an empty device (`localStorage` and `sessionStorage` cleared before the run).

- **One release reads as one album.** The result renders the `ALBUM TITLE` kicker, the title (27px at 390, 40px at 1440) and ten numbered track rows, each with its own `Replace “…” with a new one` action; the panel label reads `Release / 01 album · 10 tracks`. No horizontal overflow at any of the four widths (`scrollWidth === innerWidth`), and no button, row or title was clipped at 320.
- **Replacing a track touches one row.** Clicking the second row's replace action swapped `Track Bravo` → the first stubbed candidate and left the title and the other nine rows byte-identical, which is what the album workspace promised. The request that left the page was `operation: "replaceTrack"`, `mode: "release"`, carrying `albumTitle`, the nine remaining tracks in `tracks` and all eleven titles in `avoid` — no reconstruction, no automatic retry.
- **The three alter-ego cards lay out.** One 350px column at 390×844, three 229px columns at 768×1024, three 271px columns at 1440×1000, in the declared order *From your brief*, *Keeper of the Iron Tongue*, *Nobody's Darling*, each card carrying its own label, blurb and action. The Artist brief is its own field, so a brief typed in Track or Release leaves the brief card shut — correct, and visible as `Type something in the brief first`.
- **The cards roll what they say they roll.** With the artist brief empty, *From your brief* and the main `Roll from your brief` button are both disabled; typing an artist brief enables both and replaces the note with `Follow the feeling. You can refine the names next.` Clicking *Have the Keeper name you* sent `aliasStyle: "wu"`; clicking *Roll from my brief* sent `aliasStyle: "brief"` with the brief and the previous batch in `avoid`. Six names rendered each time, the batch navigator read `Older 2 / 2 Newer`, and the panel label read `Artist / 06 ideas`.
- **Clean console.** Zero page errors and no console output beyond Vite's connect lines and React's DevTools notice; no request left the dev origin.

This is viewport evidence from a headless desktop Chromium, not physical-device evidence: the paid creative-fixture pass, real Android/iOS behaviour, and the delivered-notification path remain open as listed below.

## Redesign scope

- Dark music-editorial presentation: warm ivory type, orange accents, locally hosted Manrope variable font, a spacious desktop layout, and responsive mobile layouts.
- Top navigation replaces the fixed bottom app tab bar. Create and Shortlist remain the same two working views.
- Existing controls retained: Track/Release/Artist, separate in-memory briefs, random briefs, language and length options, generation, batch navigation, exploration/refinement, both artist alias personas, saving/removing names, copying, and session clearing.
- Results use numbered rows; Explore is a centered responsive dialog. Background interaction and scrolling are disabled while it is open; keyboard focus containment and return remain supported.
- Result action menus now close on Escape or focus leaving the row.
- Lightweight CSS entrance, hover, button sweep, and signal animations; reduced-motion preferences disable animation and transitions. No animation runtime was added.
- Privacy and storage disclosures live in the footer. Shortlist data remains local to the browser.

### PWA retirement

`vite-plugin-pwa`, `workbox-window`, the manifest generation, update/install-style banners, and `src/pwa.ts` were removed. The site no longer promises offline page loading or installs itself as a PWA.

`src/retireServiceWorker.ts` unregisters only registrations whose script URL matches this site's former `sw.js`. `public/sw.js` is a retirement worker for previously installed clients: it activates, deletes matching scoped Workbox precaches, unregisters, and claims clients without forcing a reload. Do not delete it casually while old clients may still update from the PWA. This migration does not delete localStorage/sessionStorage. Existing icon assets and favicon remain in the repository.

Storage is origin-specific: an existing shortlist on GitHub Pages stays on that origin; it does not automatically appear on Sites or the Worker origin. Loading a fresh website page requires a connection; a loaded page can still show local names when offline.

## Repository boundaries

- `shared/`: contracts, limits, Unicode normalization helpers; shared by browser and server.
- `server/`: naming configuration, prompts, validation, provider invocation, filtering and selection. Unchanged by the redesign.
- `worker/index.ts`: HTTP routing, CORS, kill switch, body/content validation, limiter admission and sanitized error mapping. `worker/rateLimit.ts` and `worker/window.ts` implement the hard request cap. Unchanged by the redesign.
- `src/browser/`: API client, clipboard and versioned browser storage. Unchanged by the redesign.
- `src/state/`: framework-free AppStore and state helpers. Unchanged by the redesign.
- `src/ui/`: Create, Shortlist, Explore, result rows, icons and existing curated random briefs.
- `src/styles.css`: responsive visual system and reduced-motion support.
- `src/main.tsx`, `src/retireServiceWorker.ts`, `public/sw.js`: startup and retirement of the former PWA worker.
- `public/fonts/`: Manrope Latin variable WOFF2 (24,836 bytes) and its OFL license; no third-party font request at runtime.
- `vite.config.ts`: build base paths, API origin selection and development proxy.
- `.openai/hosting.json`: existing Sites identity and static output directory. Preserve its `project_id`.
- `.github/workflows/`: GitHub Pages build/deploy workflow, triggered by pushes to `main`.
- `scripts/`: icon generation and opt-in live creative fixtures.

## Run and build

```bash
npm ci
npm run dev:web       # Vite, port 5173; /api proxies to the LIVE Worker
npm run typecheck     # TypeScript check
npm test              # 131 deterministic tests in 11 files at the last verification
npm run build         # Sites static build: root base, external Worker API
npm run build:pages   # GitHub Pages: /namegen/ base, external Worker API
npm run build:worker  # Worker website: root base, same-origin /api
npm run preview      # Serves the last build; it does not implement a local naming API
npm run icons        # Regenerates the retained PNG icons
npm run fixtures     # Explicit opt-in: paid live creative suite; skips without a key
```

All build targets overwrite `dist/`. Choose the correct target before publishing. For a local static preview with working generation, use a Sites build; a Worker build needs the Worker runtime to serve `/api`.

**Development proxy change:** `npm run dev:web` now calls the production Worker through Vite. Generation/refinement/alias actions therefore use the real provider and production rate limits. `npm run dev:api` still starts Wrangler on port 8787 with `.dev.vars`, but Vite does not currently point at it. To work on the backend locally, temporarily set Vite's proxy target to `http://localhost:8787`, or run `npm run build:worker` and serve the built site with `npm run dev:api`.

On this Windows machine the `npm`/`npx` launcher was broken during the work. The installed npm CLI worked when invoked through Node at `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`. Direct local Vite, TypeScript, Vitest and Wrangler entrypoints also worked. This was a local launcher issue, not a repository requirement; GitHub Actions completed `npm ci` and the Pages build normally.

## Publication

### GitHub Pages

Push the finished source to `origin/main`; the existing workflow installs dependencies, runs `npm run build:pages`, uploads `dist/`, and deploys Pages. Wait for a successful deployment and verify the actual page references the new hashed bundle. No secret belongs in the static build. The 2026-09-17 deployment returned HTTP 200 with the redesigned title and expected JavaScript asset.

### Cloudflare Worker

`npm run deploy` runs `build:worker` and `wrangler deploy`. Preserve the runtime secret and the existing limiter bindings. The final 2026-09-17 Worker deployment succeeded with version `0bf6232d-acbe-4731-a55c-48fd0c2852c0`.

`wrangler.jsonc` now allows exactly these external browser origins:

- `https://megabomb420.github.io`
- `https://namegen-studio.myby.chatgpt.site`

The Worker also accepts its own origin. Do not replace the allow-list with a wildcard. Sites-origin OPTIONS preflight was verified as 204 with the exact allowed origin.

Production secrets are managed through Wrangler, not Git. Local secrets belong in ignored `.dev.vars` (template `.dev.vars.example`). `GENERATION_DISABLED=true` is the independent kill switch; missing API-key/limiter configuration fails closed.

### Sites

**Out of scope for NameGen's own releases (owner, 2026-09-17): this copy exists only as a surface
for other assistants (GPT Sol / Astra).** It is not part of this app's release path, a stale Sites
build is not a defect, and no release work should block on republishing it. The published build
predates the album contract, so Release on that host will fail until someone republishes it
deliberately — that is expected and accepted.

- Existing project: `appgprj_6aac50c2b9a481918ca525abf14e9a29`.
- Static output: `dist`, as declared in `.openai/hosting.json`.
- Published version 1: `appgprj_6aac50c2b9a481918ca525abf14e9a29~appgver_8ebdd8eb8b3c8191acc02a40a29fb618`.
- Successful deployment: `appgdep_6aac566d32088191a000ee3dcdbe98fc`.

Reuse this Site; do not create another identity for updates. Preserve owner-private access unless the user requests a change. Publish via the Sites tools: build, push the exact source to the Site's returned repository/branch using a temporary per-command credential, package the matching build with `.openai/hosting.json`, save a version, deploy, and confirm terminal success. Never persist credentials in files, Git configuration or remote URLs.

The Sites plugin's local helper files disappeared during the session. The fallback used the normal Vite build and a tar archive containing only `.openai/hosting.json` and `dist/`; the native connector accepted it and reported deployment success. Temporary staging/archive files are under ignored `.sites-release/`. Do not reuse that archive after source changes. The plugin was absent from the later available-skills list; check availability before the next Sites publication. A documentation-only update does not require rebuilding the already deployed website.

## Naming behavior to preserve

- Generate asks for 8 candidates and displays up to 6; refine asks for 6 and displays up to 4; alias asks for 8 and displays up to 6; a Release generate asks for one album title plus 12 track titles and displays the title with up to 10 tracks; replaceTrack asks for 3 and uses 1.
- Every naming request — generate, refine, album and replaceTrack — keeps thinking disabled with the configured 800-token ceiling. Alias uses thinking enabled, low effort and a 2,500-token ceiling, with one of three stable personas: `wu`, `emo`, or `brief`, which reads the brief and works the style out from it. `server/service.ts` determines this per operation, and `server/config.ts` documents the alias-only scope of `THINKING_SETTINGS`.
- Only a provider finish reason of exactly `stop` is accepted. Invalid/truncated outputs are not reconstructed or automatically retried.
- Failed requests retry only on explicit user action, using the failed snapshot. Editing and generating is a new request.
- One request remains active until settlement, even when visible work is cleared or Explore is closed. Epoch checks prevent stale responses restoring invalidated state.
- Refinement batches enter the same bounded recovery history as generation. Raw briefs and instructions remain memory-only; successful batches and metadata are restored from sessionStorage.
- An album batch is one unit: its title row saves the whole release as a single entry, its track rows behave exactly like names, and a track replacement never removes a title before the new one arrives.
- Shortlist is versioned localStorage, capped at 300 entries without silently evicting them. Save, copy and opening Explore do not themselves call the provider.
- Comparison keys use NFKD and Unicode case folding; display spelling/diacritics are preserved.
- The authoritative cap is the existing Durable Object: 3 requests/minute per client IP, fail-closed on missing/broken binding; denied requests return 429 and Retry-After. The Cloudflare rate-limit binding remains an additional layer. The original live cap test is recorded in the historical notes below.
- NameGen keeps no server copy of briefs/results. This does not assert anything about DeepSeek's own retention.

## Verification evidence

### 2026-09-17 redesign and publication

- All 131 deterministic tests in 11 files passed, including a final run after PWA dependency removal. TypeScript checking passed.
- Sites and Pages production builds succeeded. Sites bundle: approximately 71.79 KB gzip JavaScript, 5.46 KB gzip CSS, plus the 24.8 KB local font. These are transfer-size measurements, not a Lighthouse or real-device performance score.
- Browser layout checks at 1440×1000, 768×1024, 390×844 and 320×740. A narrow-screen overflow was fixed; the final 320px check found no horizontally clipped controls. These are desktop browser viewport checks, not physical-device tests.
- Real generation through the local frontend and production Worker returned six names. Refining “Sawtooth Sunrise” returned four alternatives. Saving, copying with success feedback, reload persistence, random briefs, Artist tools and options were checked. The test-created saved entry was removed afterward; the pre-existing saved entry was retained.
- No browser errors were reported in the inspected error log. Existing automated tests cover retry behavior, request locking, storage failures and focus preservation.
- Production dependency audit reported zero known vulnerabilities. The all-dependency install output reported three high-severity development dependency advisories; remediation was not part of this frontend pass.
- Sites native deployment status was `succeeded`; the live Sites interface was not independently exercised end-to-end. Worker publication succeeded and the Sites CORS preflight was checked. GitHub Pages workflow succeeded and its deployed HTML/new bundle were verified.
- No full live creative-fixture rerun was done for this frontend-only change.

### 2026-09-17 second pass: model id and specification sync

- `npm run typecheck` clean and `npm test` 131 tests in 11 files passed after the model-id change (the outbound model string is asserted in `server/service.test.ts`).
- Model id verified live on 2026-09-17 after deploying: one `POST /api/generate` to production returned HTTP 200 with six names in 1.24 s (`Last Bus, Cold Hands | Screen Crack Shuffle | Two Fare Stops | Hands Like Ice | Bus Shelter Bass | Cracked Glass Glow`), so `deepseek-flash` is accepted by the real provider. This is a single smoke call, not a creative-quality pass: the paid 12-fixture rerun is still outstanding.
- Deployed Worker version `cdcec77d-1bde-446b-80b3-6e2fdaac476d`; GitHub Pages workflow run 35280310430 succeeded for the same commit. No `.dev.vars` and no DeepSeek key existed in the repository checkout used for that pass, so no local provider call was possible. *Corrected 2026-09-24: an ignored `.dev.vars` does exist in an older local checkout of this repository kept outside it (under the owner's OneDrive Documents), so a local `wrangler dev` with a real key is possible from there; its contents were not read, and the key-rotation item below is still open.*
- The model id lives only in `server/config.ts` on the Worker. The Pages and Sites copies are static frontends that call the same Worker and carry no provider settings, so they need no rebuild for this change.

### 2026-09-17 third pass: album, always-alias Artist, per-track replacement

- `npm run typecheck` clean, `npm test` **183 tests in 11 files** pass (131 before this change), `npm run build:worker` succeeds.
- The release journey is covered end to end in jsdom: the album renders as a title plus numbered tracks, replacing one track swaps only that row, the album saves as a single shortlist entry, a reload restores it, and copying emits the title with numbered tracks.
- No browser or visual pass was done for the new album, track-list and persona UI — only that jsdom journey and the stylesheet by construction. Treat the layout as unverified until it has been seen on a screen. **Closed 2026-09-24 — see the fifth-pass screen pass below.**
- Verified live on 2026-09-17 after deploying (final Worker version `dab9edbb-2b6d-42c3-a1c4-72a24792b69f`):
  - a release request returned `{"album":{"title":"The Pit Takes Its Time","tracks":[10 tracks]},"partial":false}` in 1.7 s, and a second one returned `Tide Shed Sessions` with ten tracks in 1.4 s (81 completion tokens for 12 tracks, so the 800-token ceiling is nowhere near);
  - a track replacement returned `{"names":["Salt Line at the High Water Mark"]}` in 1.1 s (31 completion tokens, `received: 3`);
  - an Artist roll returned six two-word names in 7.4 s (thinking enabled), e.g. `Sullen Dubplate · Rainy Metronome · Bruised Bassline · Hollow Antenna · Ashen Two-Step · Concrete Lullaby`.
- **Bug found by that live check, and fixed:** the first replacement call failed with a 502 `UNUSABLE_OUTPUT`. The Worker log showed `selection-shape` with `received: 0` — the model had answered a replacement request with the *album* shape, because the payload carried `mode: "release"` plus an album title and track list while the prompt described the shapes only by request kind. Every request now carries an explicit `responseShape` field (`names` | `album`) that the prompt treats as authoritative, and a shape rejection records how many entries arrived, so such a failure is answerable from the log. Both changes are covered by tests and by the live re-run above; `spec.md` §6 and §13 record them.
- Still unverified: the paid creative-fixture pass (now 14 fixtures, including an album and a replacement) and any human quality read of album output.

### 2026-09-24 fifth pass: screen pass for the album, replacement and cards

- `npm test` **192 tests in 11 files** pass and `npm run typecheck` is clean on the tree this pass was run against. No source changed in this pass, so nothing had to be rebuilt for correctness; the push of this documentation did trigger the Pages workflow, which republished the same assets (see below).
- Both run scripts and their raw output are throwaway (they live outside the repository); the measurements they produced are quoted in the fifth-pass section above. API responses were stubbed in the page, so the pass cost nothing and the Worker's limiter was never exercised.
- Screens captured: `390-release-album`, `390-release-replaced`, `390-artist-cards`, `390-artist-with-brief`, `390-artist-alias-names`, `768-artist-cards`, `1440-artist-cards`, `1440-release-album`, `320-release-album`.
- What this pass does **not** cover: the real provider (spend), the deployed origins, physical Android/iOS, and the shortlist/Explore journeys, which the existing 192 tests cover in jsdom.
- Publication unchanged by this documentation commit: `npm run build:pages` from the pushed tree produced `dist/assets/index-aEgMhcqP.js` (237.64 kB / 73.32 kB gzip) and `dist/assets/index-DJs2vxrR.css`, the exact asset names the GitHub Pages deployment serves after run `36045659175` (success), so the deployed build is the build of the current source. `https://megabomb420.github.io/namegen/` and `https://namegen.whip-blanket.workers.dev/` both answered 200. The Worker was not redeployed: no server source changed.

### Retained historical evidence: 2026-09-06

- `creative-results-2026-09-06.md` contains the full 12-fixture × 2-run provider pass, including a transient upstream anomaly and its isolated rerun. Human naming-quality approval remains distinct from technical success.
- `findings.md` records ten fixed external-review findings and their regression evidence.
- Original deployed Worker smoke checks covered static 200, API routing/errors, the kill switch, and real blank/coastal-release generation.
- The hard limiter was added after live tests found the approximate Cloudflare binding unenforced on the account's free plan. The Durable Object was then verified live: first three requests 200, fourth 429 with Retry-After. It was preserved, not stress-tested again in this redesign.

## Remaining checks and known limitations

- Human creative-quality review remains open. Rerun the explicitly paid live fixtures after future prompt/provider-setting changes.
- Physical Android/iOS browser behavior, old installed-PWA migration and offline recovery have not been verified on real devices. PWA installation is no longer a product requirement.
- The earlier handoff recorded that a DeepSeek key had been pasted into a chat and should be rotated. Rotation was not verified during this redesign; preserve this unresolved operational item without copying the key into documentation.
- The GitHub workflow emitted Node 20 action-runtime deprecation warnings, but its Node 24 build and deployment succeeded. Modernizing action versions can be a separate maintenance change.
- `spec.md` was synced on 2026-09-17 with the redesigned reality (§9 limiter, §10 offline/service-worker retirement, no PWA installation requirement). It remains the product specification, not a description of the deployed artifacts: use this handoff for deployment state and the source for current behaviour.

## Working between sessions

Pull GitHub before starting; read this handoff, `spec.md`, and relevant source. Keep changes focused, preserve naming behavior, and update the handoff with completed work. Commit/push finished changes together with their documentation; do not force-push shared history. Distinguish mocked tests, real provider checks, deployment status, viewport testing and physical-device evidence. Never commit secrets or temporary publication artifacts.
