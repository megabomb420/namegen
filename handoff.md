# Implementation handoff — [HANDOFF]

Updated: 2026-09-06.

## Current state

- Local Git repository already exists in this directory.
- No application code, dependencies, build configuration, tests, or deployment have been created.
- Shared private GitHub repository: https://github.com/megabomb420/namegen
- These planning documents form the initial repository commit on `main`.
- `spec.md` is the consolidated, authoritative [SPEC]. Its section 13 contains [RUNTIME]; no separate runtime file is needed to start.
- This handoff reports preparation only, not an implemented or verified application.

## Working between models

Use the GitHub repository as the shared source of truth. Pull the latest changes before starting work, read `spec.md` and this handoff, and commit/push completed changes together with an updated handoff. Do not overwrite another model's changes or force-push shared history. Coordinate before editing concurrently.

## Fixed model setup

- DeepSeek V4 Flash is the only paid API model, for both coding and runtime naming.
- Initial integrated build: DeepSeek Flash High.
- Isolated fixes: DeepSeek Low; cross-component fixes: High.
- One independent release review: Astra Medium through subscription limits.
- Astra High only for a concrete unresolved decision; Grok only for a distinct adversarial role.
- No Astra or Grok API integration in the application.

## Implementation starting point

Read `spec.md` and implement the standalone PWA. Start with one complete Track-mode path through the Worker, live provider integration when credentials are available, output validation, and saving. Then complete the remaining specified scope.

Use one Cloudflare Worker with Static Assets. Keep the HTTP/admission handler separate from ordinary naming modules and keep browser persistence in the PWA. Future ChatGPT compatibility requires only a clean boundary; do not implement MCP, embedded UI, accounts, or cloud synchronization.

Important settled details:

- Request 8 initial candidates/display up to 6; request 6 refinements/display up to 4.
- Display any nonempty filtered batch; no minimum of 4/3.
- Runtime thinking disabled, JSON object mode, 800-token ceiling, no automatic retries/repair/refill calls.
- Tapping a name opens Explore locally; explicit submit makes the paid request.
- Shortlist/preferences use localStorage. Completed batches/metadata/exclusions use sessionStorage. Raw briefs, lyrics, and refinement instructions stay in memory.

## Verification and external setup

No build, type checks, automated tests, creative fixtures, live DeepSeek calls, device checks, Cloudflare deployment, or spending safeguards have been run or configured.

The implementation will need server-side DeepSeek credentials and Cloudflare deployment access. Do not place secrets in tracked files or frontend environment variables. Public release requires the spending safeguard and kill switch in [SPEC]. Finish independently testable work if external access is unavailable; report the remaining checks accurately.

Run/deploy commands: not available yet. The builder must add actual commands here after tooling is implemented.

## Update this handoff after implementation

Replace the preparation status with actual run/deploy commands, material decisions, checks performed and their results, creative-evaluation evidence, and unresolved issues. Separate mocked checks from live-provider results and emulation from physical-device checks. Briefly identify the naming-core, HTTP-handler, and browser-storage boundaries without restating the specification.
