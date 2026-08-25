# Stage 77 — Frontend real product-analysis integration (Post-E50)

Repo: `PFI_MVPTest_Enzo_Frontend`. Branch: `research/post-e50-frontend-product-analysis`, created from `main` @ `86991d7` (`Merge pull request #14 from EnzoAA004/agent/ui-visual-pass`). Not committed/pushed/merged as of this document.

## 1. Why `main`, not the branch this session was previously on

The session's working branch (`agent/ui-study-creation-pr2`, 2026-08-13) is **not** the most advanced frontend state: `main` already contains that branch's work (squash-merged as `9f9d1c1 UI-PR2: Improve study creation UX (#13)`) plus everything from `agent/ui-visual-pass`, `agent/p10-9-p10-7-frontend`, and several other feature branches merged since. `git merge-base --is-ancestor` confirmed `agent/ui-visual-pass` and `agent/p10-9-p10-7-frontend` are both ancestors of `main`; no remote branch is ahead of `main` by anything beyond a differently-hashed copy of an already-squash-merged commit. `main` is the correct, most current integration base — it is frozen for the upcoming demo in the sense that it must not be **modified or merged into**, not that it can't be branched **from**.

## 2. Architecture found (77-A)

- **Stack**: React 19 + Vite 7 + TypeScript 5.8, `react-router-dom` v7 (routing is a thin custom layer over it, not a `<Routes>` tree — see `src/routes.ts`). No Redux/Zustand/React Query — local component state (`useState`/`useReducer`) is the established pattern.
- **API clients**: no axios, raw `fetch`. Two parallel low-level wrappers: `src/api.ts` (`ApiError`, used by `studyApi.ts`'s hand-rolled `readJson`) and `src/multiplanarApi.ts` (`BackendApiError`, the generic `multiplanarRequest<T>(path, init)` helper — handles `X-Trace-Id`, auth headers, session hydration, 401-refresh-and-retry, and safe error mapping via `toSafeFrontendError`). `API_BASE_URL` comes from `window.__PFI_CONFIG__` / `import.meta.env.VITE_API_BASE_URL`, never hardcoded.
- **Types**: `src/contracts/*.ts`, `type` aliases (not `interface`), nullable fields typed `T | null` when the backend can explicitly return null, optional-and-absent typed `field?: T`. No schema library (zod/io-ts) — each API-client file hand-rolls its own `asRecord`/`requiredText`-style runtime parser and throws a dedicated `*ContractError` on a missing/invalid required field (fail closed, never a silent default).
- **Existing product-analysis flow (OLDER, different contract)**: `src/productAnalysisApi.ts` + `src/features/worklist/productAnalysisFlow.ts` call `POST /api/ai/v2/product/series-segmentation` and `POST /api/ai/v2/product/disc-degenerative-findings` (schema `pfi.full-series-segmentation.v1`) — this is the P10.9 per-series/disc-findings pipeline baked into the upload wizard (`NewAnalysisDrawer.tsx`), **not** the Post-E50 `pfi.ai-product-result.v1` contract this stage integrates. The two are kept deliberately separate; nothing from the old flow was touched or reused beyond its file-naming/parsing *convention*.
- **Result panels**: `src/features/reading/DiscDegenerativeFindingsPanel.tsx` and sibling panels (`DegenerativeFindingsPanel.tsx`, `MeasurementPanel.tsx`) render inside `StudyReviewView.tsx`'s "ai" tab (`ReviewInspectorPanel ... tab="ai"`), reached via `/estudio/:caseId`. This is the natural, already-established home for a new AI-result panel.
- **Tests**: no Jest/Vitest/RTL — plain Node scripts under `scripts/*.mjs` (transpile a `.ts` file's body to CJS via the TypeScript compiler API, strip `import`/`export`, run in a `vm` sandbox, assert). Wired into `package.json` as `test:<name>` and chained in `npm test`. Playwright covers real-browser e2e (`scripts/playwright-*-e2e.mjs`), mocking the backend via `page.route()` — no MSW.

## 3. API client (77-B)

New file `src/productAnalysisV1Api.ts`, built on the existing `multiplanarRequest` (reused as-is, not duplicated):

```ts
startProductAnalysis(caseId: string, request?: ProductAnalysisStartRequest): Promise<ProductAnalysisResult>
getProductAnalyses(caseId: string): Promise<ProductAnalysisHistory>
getProductAnalysis(caseId: string, analysisId: string): Promise<ProductAnalysisResult>
```

`POST /api/studies/{caseId}/product-analysis`, `GET /api/studies/{caseId}/product-analyses`, `GET /api/studies/{caseId}/product-analyses/{analysisId}` — exactly the three endpoints confirmed to exist on the Backend (`research/post-e50-spring-ai-product-contract`, stages 75/76), nothing invented beyond them. `API_BASE_URL` comes from the existing config, never hardcoded.

**Request body actually sent**: `buildStartRequestBody(request?)` returns `{ metadata }` only when `metadata` was passed, `{}` otherwise — **never** `sagittalInputId`/`axialInputId`, matching the Backend's stage-76-M contract where Spring resolves inputs internally.

Every response is run through a strict, fail-closed parser (`parseProductAnalysisResult`/`parseProductAnalysisHistory`) before it reaches any UI code — a missing `humanReviewRequired`, an unrecognized `status`, or a malformed `discLevels[]`/`measurements[]` entry throws `ProductAnalysisV1ContractError` rather than rendering a guessed shape.

## 4. Types (77-C)

`src/contracts/productAnalysisV1Types.ts` — `ProductAnalysisResult`, `ProductAnalysisDiscLevel`, `ProductAnalysisMeasurement`, `ProductAnalysisReview`, `ProductAnalysisHistory`, `ProductAnalysisStartRequest`. `level`, `localizationStatus`, `axialPairingStatus`, `degenerativeFindingsStatus`, `plane`, and every measurement value are typed `string | null` / `number | null` exactly where the Backend contract allows `null` — never coerced to optional-and-absent, never defaulted.

## 5. State (pure, testable without mocking `fetch`)

`src/features/reading/productAnalysisV1State.ts` — a plain reducer (`productAnalysisReducer`), no React import:

- Phases: `idle | loading_history | submitting | loading_detail | ready | error`.
- `classifyProductAnalysisError(error)` → `functional | not_found | upstream | network`, duck-typing `BackendApiError`'s shape (`name === "BackendApiError"`) rather than `instanceof`, so this module has **zero runtime dependency** on any other module — fully self-contained and testable.
- `canSubmit(state)` / `canRetry(state)` — the double-submit guard (77-U) and manual-retry gate (77-T) live here as pure predicates, not scattered `disabled` logic in the component.

**Important design decision**: an AI-reported `status: "failed"` (still a `200 OK`/successful parse) never produces `phase: "error"` in this reducer — that phase is reserved for actual transport/contract failures (4xx/404/5xx/network). `failed` is data to display, exactly mirroring the Backend's own Stage-75 distinction ("failed is data, not an exception"). The panel renders it as an error-styled section without ending the phase machine.

## 6. Hook

`src/features/reading/useProductAnalysisV1.ts` — `useProductAnalysisV1(caseId)`:

- Loads history automatically on mount/`caseId` change (77-P).
- `analyze(request?)` — guarded by `canSubmit`; a click while `submitting` is a no-op, never a second run.
- `openAnalysis(analysisId)` — GET detail (77-Q), so a page reload can recover a persisted result without depending on in-memory POST state.
- `retry()` — only fires when `canRetry` is true, and only on explicit user action; never automatic/silent (77-T).

## 7. Panel (77-O)

`src/features/reading/ProductAnalysisV1Panel.tsx` — receives only `caseId`, self-contained (does not touch `StudyReviewView`'s viewer/measurement/review state). Sections: Estado general (button + processing/error banners), Warnings (mapped to readable text, raw code kept in a `title` tooltip), Niveles discales (per-level `<details>`, localization/axial-pairing/degenerative-findings status text), Mediciones (flattened list, formatted `mm`/`mm²`, morphometry disclaimer), Revisión (`review.required`/`review.status`), and a collapsed history list when more than one run exists. Reuses existing `reading.css` classes (`rr-section-title`, `rr-note`, `rr-disc-*`, `rr-findings-empty`) — two small new classes added (`rr-product-analysis`, `rr-product-analysis-body`), no new design system.

**Wired into** `StudyReviewView.tsx`'s existing "ai" tab, immediately after `DiscDegenerativeFindingsPanel` and before `DegenerativeFindingsPanel` — the same place the recon identified as the natural home for AI-result panels. One line added: `{displayRun.caseId && <ProductAnalysisV1Panel caseId={displayRun.caseId} />}` (guarded because `AiRunResponse.caseId` is typed optional in this component). No other line of `StudyReviewView.tsx` was touched.

## 8. `completed` / `partial` / `failed` (77-D)

- `completed`: result renders normally, no banner.
- `partial`: an informational (not error-red) banner — "Análisis parcial: algunas capacidades no estuvieron disponibles en esta corrida" — plus the mapped warnings; the rest of the result (discLevels/measurements/review) still renders.
- `failed`: an error-styled note — "El análisis no pudo completarse para este estudio. El resto del estudio no se ve afectado." — scoped to the panel; nothing else on the Study page is touched or hidden.

## 9. 67B2 / 67C / P10.7 (77-I/J/K)

All three live in `src/features/reading/productAnalysisDisplay.ts`, pure functions with a fixed vocabulary — no free-text interpolation of backend strings beyond the already-validated status codes:

- **67B2** (`displayLocalizationStatus`): `localized` → shows the resolved level via `displayDiscLevel`; `abstained` → "El sistema se abstuvo de asignar un nivel."; `unavailable`/missing → "Localización automática no disponible." Never an error state.
- **67C** (`displayAxialPairingStatus`): never prints "Validado" when `validated=false` (test 10 asserts this by regex); `experimental=true` always appends an explicit "Resultado experimental: requiere revisión profesional." (test 11); `not_requested`/`unavailable` render the neutral base text only.
- **P10.7** (`displayDegenerativeFindingsStatus`): `blocked_preprocessing_parity` (or missing) → "Evaluación automática de hallazgos degenerativos no disponible en esta versión." — never "Normal", never "No se detectaron patologías", never a checkmark (test 12 asserts the absence of both phrases by regex).

## 10. Measurements (77-L/M)

`displayDiscLevel`/`formatLengthMm`/`formatAreaMm2` only affect what's rendered — the raw numeric value stays in `ProductAnalysisResult` untouched (e.g. `12.345678` persists in state; the panel shows `12.35 mm`). `bboxHeightMm`/`bboxWidthMm` were not modeled: the real Backend `AiMeasurementResult` contract (Stage 76) does not emit them, so the Frontend type doesn't either — inventing fields the Backend never sends was explicitly out of scope. `MORPHOMETRY_DISCLAIMER` ("Mediciones automáticas sujetas a revisión profesional.") is shown once per panel, not once per measurement.

## 11. Review (77-N)

`displayReviewStatus({required, status})` → "Pendiente de revisión." when `status === "pending"` (which the Backend's safety validator guarantees whenever `humanReviewRequired` is true), a neutral message otherwise. No accept/reject/edit workflow was built — out of scope for this stage, explicitly deferred to 78.

## 12. History / detail / reload (77-P/Q)

- On mount, `useProductAnalysisV1` calls `GET /product-analyses`; an empty list renders `PRODUCT_ANALYSIS_EMPTY_HISTORY_TEXT` ("No hay análisis registrados para este estudio.") as a plain empty state, never as an error.
- More than one run collapses into a `<details>` "Historial de análisis (N)" list; selecting one calls `GET /product-analyses/{analysisId}` and replaces the displayed result — the panel never depends solely on the in-memory POST response, so a page reload (which re-mounts the hook and re-fetches history) can recover the same result.

## 13. Error handling (77-S)

`classifyProductAnalysisError` maps: `404` → `not_found`, `400`/`422` → `functional`, `5xx`/`502`/`503`/`504` → `upstream`, anything not shaped like `BackendApiError` (a raw `fetch` `TypeError`, etc.) → `network`. The panel always shows `error.message` — which is already the sanitized message `BackendApiError`/`toSafeFrontendError` produced, never a raw stack trace or backend-internal string. `partial` is explicitly never routed through this error path.

## 14. Retry / double-submit (77-T/U)

`canRetry` is only true in `phase: "error"`; `retry()` is a no-op otherwise and only ever runs on an explicit button click — there is no automatic/timed retry anywhere in this stage. `canSubmit` is false throughout `submitting`, and the "Analizar estudio" button's `disabled` prop is bound directly to it, so a rapid double-click cannot start a second run.

## 15. Mocks (77-V)

No mock data was added to the shipped app for this flow — `ProductAnalysisV1Panel` always calls the real endpoints. The OLD `productAnalysisApi.ts`/`productAnalysisFlow.ts` and their consumer (`NewAnalysisDrawer.tsx`) were not touched, so `main`'s demo-frozen upload flow is unaffected. `src/mock/sampleRun.ts`/`src/fixtures/multiplanarRunFixtures.ts` (existing demo-mode fixtures) were not extended to include a `product-analysis` shape — demo mode simply shows the panel's real empty/error states against whatever backend (or lack thereof) is configured, which is acceptable for this stage since demo mode is frozen and out of scope to modify.

## 16. Tests (77-Y)

`scripts/post-e50-product-analysis-v1-tests.mjs` (wired as `npm run test:post-e50-product-analysis-v1`, included in `npm test`) — **32 tests**, all passing, covering the full requested list: completed/partial/failed parsing, loading/button-disabled via the reducer, `level=null` never rendering as `"null"`/`"undefined"`, 67B2 localized/abstained/unavailable, 67C `validated=false` never showing "Validado" / `experimental=true` always visible, P10.7 `blocked_preprocessing_parity` never shown as negative, warnings mapper (known + unknown fallback), measurement `mm`/`mm²` formatting without mutating the raw value, empty/non-empty history parsing, detail parsing, reload-recovers-via-`detail_loaded`, 404/422/500/network error classification, manual-retry gating, no `sagittalInputId`/`axialInputId` in the outgoing body, `metadata` passthrough, double-submit gating, review-pending text, a scan asserting no display string contains "diagnóstico automático/confirmado" language, plus two extra fail-closed parsing tests (missing `humanReviewRequired`, unknown `status` — both throw `ProductAnalysisV1ContractError` rather than silently completing).

All logic worth testing (parsing, presentation, state transitions) was deliberately placed in plain `.ts` modules with no React import, so the existing `vm`-sandbox test harness (transpile → strip imports/exports → run) could exercise it directly, exactly like `discDegenerativeFindings.ts`/`discFindingDisplay.ts` already are. The `.tsx` panel itself is a thin rendering shell over those modules and has no dedicated test file, matching the project's existing convention (`DiscDegenerativeFindingsPanel.tsx` has none either).

## 17. Regression

`npx tsc -b`: clean except the two pre-existing `Cannot find module 'react-router-dom'` errors in `App.tsx`/`main.tsx` — confirmed present on `main` **before** any Stage-77 change (verified via `git stash`), caused by `react-router-dom` missing from this environment's `node_modules`, unrelated to this stage. `npx eslint` on all 6 new files: clean, zero warnings/errors. Full `npm test` regression result: see the final report for the exact pass/fail count from this run.

## 18. Real integration smoke

Not performed: the Spring Boot backend was not started in this environment for this pass (it wasn't required — Docker/JDK setup lives outside the frontend repo, and the task explicitly allows skipping it when infeasible). No claim of a real end-to-end run against a live Backend is made.

## 19. Limits / what stage 77 deliberately does not do

- No Playwright/E2E test was added for this flow. `StudyReviewView.tsx` is a large (~2900-line), tightly-coupled reading-room component whose render path depends on a full canonical multiplanar run (`displayRun`, viewer state, measurement groups, etc.); building a realistic `page.route()` mock for all of that just to reach the "ai" tab was judged disproportionate to this stage's scope. The 32 pure-logic tests are the primary automated verification; this is a real limit, not a rounding error, and is called out explicitly rather than glossed over.
- No accept/reject/edit review workflow — only `review.required`/`review.status` are shown (77-N, by design).
- No routing change — `analysisId` is not reflected in the URL; selecting a past run only changes in-memory state. Acceptable for this stage per 77-R ("no rehacer router").
- No changes to the OLD P10.9 product flow, `NewAnalysisDrawer.tsx`, or any demo-mode fixture.
- Demo mode (`VITE_USE_MOCK=true`) was not specifically wired with mock product-analysis data; it will show the panel's real empty/error state against whatever backend is configured.

## 20. Next stage (78)

- A review workflow (accept/observe/reject a disc level or measurement) on top of `review.status`, mirroring the existing `RunReview`/`MeasurementCorrection` UI already used for multiplanar runs.
- A dedicated Playwright E2E once a lighter-weight entry point into the "ai" tab (or a route directly to it) makes mocking `StudyReviewView`'s preconditions tractable.
- Surfacing `analysisId` in the URL if/when the router is revisited for other reasons.
