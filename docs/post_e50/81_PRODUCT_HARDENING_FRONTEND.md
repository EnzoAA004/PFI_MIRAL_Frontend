# Stage 81 — Product E2E / Hardening / Release Candidate (Frontend)

Branch: `research/post-e50-frontend-product-analysis`. Base commit `bd4c281` (Stage 80). Not committed/pushed as of this document.

## 1. Gap inventory (81-A) — findings and resolutions

| Gap | Severity | Resolution |
|---|---|---|
| `react-router-dom` declared in `package.json` but **not actually present in `node_modules`** (`npm ls react-router-dom` → empty) — `npx tsc -b` and `npm run build` both failed with `Cannot find module 'react-router-dom'` | **CRITICAL** (a fresh clone/CI cannot build this app at all) | `npm install` — resolved, `package-lock.json` now pins it. Both `tsc -b` and `npm run build` are clean as of this stage (§6) |
| `LongitudinalComparisonPanel`'s baseline `<select>` was disabled only during `loading_candidates`, not `loading_comparison` — a rapid re-pick could fire overlapping comparison requests with no ordering guarantee | MEDIUM | Disabled condition extended to both phases (`LongitudinalComparisonPanel.tsx`) |
| `ReviewSection`'s comment `<textarea>`/`<label>` used a static `label` string (e.g. "Revisión de este nivel") as the DOM `id` — with multiple disc-level `<details>` open at once, every instance after the first got a duplicate `id`, breaking the label/textarea association for all but one | MEDIUM (real a11y bug) | New `idSuffix` prop (`discLevel.discLevelId`, or `"run"` for the single run-level instance) makes the id unique per instance (`ProductAnalysisV1Panel.tsx`) |
| No browser-rendered E2E existed for any post-e50 feature (stages 77-80 all deferred it, citing the cost of a "canonical multiplanar run" fixture) | MEDIUM (DoD item, conditional on viability) | Traced the actual precondition and built one — see §7 |

No CRITICAL frontend-only *code* gap beyond the missing dependency was found — loading/error/double-submit coverage across all 5 mutating flows, routing, API base URL configuration, and console-logging hygiene were all already sound (full detail in the inventory agent's findings, summarized into this table).

## 2. Multi-turn chat (81-C, Frontend half)

`ChatRequest` gained an optional `conversationId`. `useChat.ts`'s `ask()` now always passes `state.conversationId` (when one exists) on every subsequent call — so once a conversation has a `conversationId` (from the first answer), every further question in the same session automatically continues it. `chatState.ts` required no change to carry `conversationId` across turns: `questionSent`/`answerReceived` already spread `...state` first, so the field was never accidentally dropped — this was verified with a new test (§8) rather than assumed.

## 3. Chat history selector (81-D)

`ChatPanel.tsx` gained a `<select>` ("Conversaciones") populated by `useChat.ts`'s new `listConversations()` (wraps `getChatConversations`), labeled via a new `displayConversationLabel` helper ("Hoy HH:MM" / "DD/MM HH:MM"), plus a "Nueva conversación" button (`chatState.newConversationStarted()`, resets to the initial empty state so the next question starts a fresh Backend conversation). Deliberately simple — a native `<select>` and one button, not a ChatGPT-style sidebar, per the stage brief's own "No hacer UI compleja."

## 4. Loading/error hardening (81-G)

§1's `LongitudinalComparisonPanel` fix is the only change under this item — every other mutating flow (product-analysis, review, correction, chat) already had loading/disabled/error/no-double-submit coverage from stages 77-80, confirmed by the inventory pass rather than re-built.

## 5. HTTP error consistency (81-H)

No Frontend code change was needed here — `classifyProductAnalysisError` (unchanged since Stage 77, reused by every hook including `useChat`) already maps `400→functional`, `404→not_found`, `502/503/504→upstream`, network errors→`network`, consistently across every feature. The one consistency fix under this item was on the Backend side (`ChatService.detail()` aligned to `RunReviewException`, see Backend hardening doc §1).

## 6. Regression (81-AB)

- `npx eslint` on every Stage-80/81 file: clean.
- `npx tsc -b`: **clean** (previously 2 pre-existing `react-router-dom` errors, now resolved — §1).
- `npm run build`: **succeeds** — `1918 modules transformed`, `dist/` produced (`index.html` 1.91kB, largest chunk `vendor-three` 734kB/190kB gzip). This is the first time this build has actually been exercised and confirmed working in this project's post-e50 stages (prior docs only ran `tsc -b`, not `vite build`).
- `npm test`: full chain exits 0, no `not ok` lines. New Stage-81 additions to `scripts/post-e50-contextual-chat-tests.mjs`: 8 new tests (multi-turn conversationId persistence across turns, history-selector label formatting incl. invalid-date fallback, "Nueva conversación" reset, reload-replaces-not-merges) — file now at 34 tests total (up from 26 at Stage-80 HEAD).

## 7. Browser E2E (81-F) — first real-backend run

**Traced the actual precondition** (previously just described as "disproportionate" in stages 77-80): `StudyReviewView` is reached via `/estudio/{caseId}` → `GET /api/studies/{caseId}` → `selectReviewableRunFromDetail` requires at least one `runs[]` entry with a non-empty `runId`/`modelKey`/plane. This is the **legacy** `domain_study_runs` table (pre-post-e50, unrelated to `AiProductAnalysisRun`) — not something any post-e50 stage's own code touches. Critically, `resolvePersistedPlaneWorkspace` tolerates a **missing asset URL** gracefully (renders an "unavailable" image state, never crashes) — so the fixture needed is pure JSON metadata, no real DICOM/PNG files.

Fixture SQL used (run against the Post-E50 stack's Postgres):
```sql
INSERT INTO domain_study_runs (
  id, study_id, multiplanar_run_id, trace_id, requested_inference_mode, effective_inference_mode,
  sagittal_model_key, axial_model_key, sagittal_run_id, axial_run_id, assets, metrics_snapshot, status, created_at, updated_at
) VALUES (
  '<uuid>', '<study-uuid>', 'mock-multiplanar-run-81', 'trace-e2e-81f', 'contract', 'contract',
  'mock-sagittal-model', 'mock-axial-model', 'mock-sag-run-81', 'mock-axial-run-81', '{}'::jsonb, '{}'::jsonb, 'completed', now(), now()
);
```
(alongside the same `domain_studies`/`domain_input_resources` rows used throughout this stage's other E2E steps).

**New script**: `scripts/playwright-post-e50-real-backend-e2e.mjs` — reuses Playwright (already a devDependency, already used by 6 pre-post-e50 `scripts/playwright-*.mjs` scripts) rather than introducing a new E2E framework. Unlike every prior Playwright script in this repo (all fully `page.route`-mocked), this one drives the **real** running Post-E50 Docker stack: seeds a real JWT (from `POST /api/auth/demo-doctor`) into IndexedDB, navigates to `/estudio/{caseId}`, and asserts: (1) no `ContractErrorState`, (2) the real `caseId` renders, (3) the "Evolución"/"Asistente" sections exist in the "Más" tab, (4) a real question submitted through the UI gets a real answer back from the Backend/mock-LLM round trip, (5) no unexpected console errors. **Result: all 5 checks passed** against the live stack. Not wired into `npm test` — it requires the external Docker stack running and a real minted token passed via env vars (`POST_E50_FRONTEND_URL`, `POST_E50_E2E_CASE_ID`, `POST_E50_E2E_TOKEN`), matching this stage's "no meter framework enorme" constraint — one manually-run script, not a new CI-integrated E2E tier.

## 8. Frontend files new/modified

**New**: `scripts/playwright-post-e50-real-backend-e2e.mjs`, `docs/post_e50/81_PRODUCT_HARDENING_FRONTEND.md` (this file).

**Modified**: `src/contracts/chatTypes.ts` (+`conversationId`), `src/features/reading/chatState.ts` (+`newConversationStarted`), `src/features/reading/chatDisplay.ts` (+`displayConversationLabel`/`CHAT_NEW_CONVERSATION_LABEL`/`CHAT_CONVERSATIONS_EMPTY_TEXT`), `src/features/reading/useChat.ts` (auto-continue + `startNewConversation`/`listConversations`), `src/features/reading/ChatPanel.tsx` (conversation selector + "Nueva conversación"), `src/features/reading/reading.css` (+`.chat-conversations-bar`), `src/features/reading/ProductAnalysisV1Panel.tsx` (§1 a11y fix), `src/features/reading/LongitudinalComparisonPanel.tsx` (§1 race-condition fix), `scripts/post-e50-contextual-chat-tests.mjs` (+8 tests), `package.json`/`package-lock.json` (dependency install fix, §1).

## 9. Frontend tests new / regression

8 new tests in `scripts/post-e50-contextual-chat-tests.mjs` (34 total, up from 26). Full `npm test`: exit 0, no `not ok`. `npx tsc -b`: clean. `npx eslint`: clean. `npm run build`: succeeds (§6).

## 10. What Stage 81 deliberately does not do

- No visible "past conversations" UI beyond the simple selector (§3) — no thread search, no rename, no delete.
- No new E2E framework or CI wiring for the real-backend Playwright script (§7) — it is a manual confirmation tool for this stage, matching the brief's own constraint.
- `PatientHistoryView.tsx` remains untouched, consistent with every prior post-e50 stage's decision.

## 11. Next stage (82)

- Consider wiring `playwright-post-e50-real-backend-e2e.mjs` into an optional CI job once the Post-E50 Docker stack has a stable, scripted bring-up/seed/teardown wrapper (today it's manual, matching this stage's scope).
- Extend the browser E2E script's coverage (measurement correction, longitudinal baseline selection) once the manual-run pattern proves stable in practice.
