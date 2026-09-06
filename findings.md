# Review findings — namegen v0.1 (commit `90b7619`)

Record of the external review of `90b7619` on `main`, with resolution status after the
fix pass. P1 = fix before release; P2 = functional or validation defect. Review confirmed the
reusable backend boundary, the stable runtime prompt, spec §13 match, and that persistence write
paths exclude briefs and refinement instructions. It also confirmed 93 deterministic tests,
type checking, and the production build at review time.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | P1 | Thinking is enabled by default — `thinking: { type: "disabled" }` missing from the provider body | Fixed, verified |
| 2 | P1 | Editing Explore steals keyboard focus (focus effect reruns on every sheet-state change) | Fixed, verified |
| 3 | P1 | Closing pending work permits concurrent paid requests (no transport lock until settlement) | Fixed, verified |
| 4 | P1 | Privacy disclosure makes an unsupported retention promise (“Nothing is stored on a server”) | Fixed, verified |
| 5 | P2 | Successful refinement batches are discarded (not in the bounded recovery mechanism) | Fixed, verified |
| 6 | P2 | Saved names cannot be explored | Fixed, verified |
| 7 | P2 | Missing completion status (`finish_reason` null/missing) is accepted as success | Fixed, verified |
| 8 | P2 | Lowercasing does not implement Unicode case folding (`Straße` vs `STRASSE`) | Fixed, verified |
| 9 | P2 | Failed session clearing is silently ignored | Fixed, verified |
| 10 | P2 | Creative verification workflow broken (`run-fixtures.mjs` missing); live test joins ordinary suite and can pass failed runs | Fixed, verified |

## Original findings

1. **P1 — Thinking is enabled by default.** `server/provider.ts:94` omits
   `thinking: { type: "disabled" }`. DeepSeek documents thinking as enabled by default for this
   API, which violates SPEC and risks consuming the 800-token allowance before producing usable
   names. Configuration defect confirmed; live failure frequency unverified.
   [DeepSeek API documentation](https://api-docs.deepseek.com/api/create-chat-completion/)

2. **P1 — Editing Explore steals keyboard focus.** `src/ui/ExploreSheet.tsx:56` reruns its focus
   effect whenever the `explore` object changes, including every text edit, and focuses Close.
   Browser reproduction: entering an instruction moves focus to Close and subsequent keystrokes
   miss the textarea. Focus setup/cleanup must run on opening/closing only.

3. **P1 — Closing pending work permits concurrent paid requests.** `src/state/appStore.ts:367`
   clears `pending` without cancelling or waiting for the request; `clearWorkingSession` does the
   same. Executed reproduction: start refinement → close Explore → Generate produces two
   unresolved submissions. Epoch guards prevent stale display updates but do not enforce one
   active request. Transport admission must stay locked until settlement.

4. **P1 — Privacy disclosure makes an unsupported retention promise.** `src/ui/CreateView.tsx:113`
   shows “Nothing is stored on a server” right after describing transmission to DeepSeek. The app
   cannot establish that provider-wide claim. Scope the statement to verified application storage
   behaviour.

5. **P2 — Successful refinement batches are discarded.** `src/state/appStore.ts:279` keeps
   alternatives only in the open sheet; session persistence includes generation batches alone.
   Browser reproduction: refine successfully → close Explore; alternatives disappear with no
   Previous/Back recovery. Include completed refinement batches in the bounded recovery
   mechanism with their originating metadata, without persisting raw context.

6. **P2 — Saved names cannot be explored.** `src/ui/ShortlistView.tsx:71` renders names as inert
   text with only Copy and Remove. Add a local Explore action using the saved mode, current
   preferences, and the missing-brief context field.

7. **P2 — Missing completion status is accepted as success.** `server/service.ts:124` explicitly
   allows `finishReason === null`; the provider parser maps missing or invalid values to null.
   Require exactly `stop`; reject missing, null, and unexpected values.

8. **P2 — Lowercasing does not implement Unicode case folding.** `shared/text.ts:31` uses NFKD
   plus `toLowerCase()`. `Straße` and `STRASSE` produce different keys. Use Unicode case folding
   while preserving displayed spelling and accents.

9. **P2 — Failed session clearing is silently ignored.** `src/state/appStore.ts:392` discards the
   boolean from `clearSession()`. Handle deletion failure explicitly.

10. **P2 — The creative verification workflow is broken and can pass failed runs.**
    `package.json` points at a missing `scripts/run-fixtures.mjs`; `fixtures.live.test.ts` joins
    ordinary tests whenever a key exists (potentially 24 paid calls) and its only assertion
    checks truncation. Provide a working, explicitly opted-in live command and require
    successful outputs.

## Unverified at review time (unchanged)

Real Android/iOS installed behaviour, update activation during active work, deployed Cloudflare
controls, provider spending protection, and live creative quality (75% gate, repeated templates,
refinement quality, multilingual token headroom). No live output samples were available.
