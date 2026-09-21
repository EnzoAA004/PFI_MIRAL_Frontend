# Stage 78 — Professional review/correction workflow (Frontend)

Branch: `research/post-e50-frontend-product-analysis` (same branch as stage 77 — no new branch). Base commit `c285d4e` (stage 77). Not committed/pushed/merged as of this document.

## 1. Existing review UX found (78-A)

The pre-existing multiplanar-run review UX (`App.tsx`'s review-save flow, `src/api.ts`'s `updateReview`, `src/contracts/reviewApiTypes.ts`) uses a Spanish status vocabulary (`pendiente|aceptado|observado|descartado`) tied to `PUT /api/ai/runs/{runId}/review`, and `MeasurementPanel.tsx`'s `PanelRow` already shows an editable `reviewerValue` input next to the AI's `aiValue` for manual measurement corrections on multiplanar runs. **Neither is reused directly** — both are scoped to `domain_study_runs` (the older multiplanar-run family), a different resource from `AiProductAnalysisRun` (stage 76/77). What *is* reused is the **pattern**: an editable value shown next to (never instead of) the AI value, and a simple accept/observe/reject action set — the same UX language, applied to the new contract's own ids and status vocabulary (`pending|accepted|observed|rejected`, English, matching the Backend's stage-78 DB values exactly — no Spanish translation layer was introduced for this new surface).

## 2. What changed vs. stage 77

`ProductAnalysisV1Panel.tsx` (stage 77) is **extended**, not replaced: the same "Análisis de producto" panel now also renders review actions and measurement-correction controls, wired to the Backend's new stage-78 endpoints. All three stage-77 files that model this flow are updated:

- `src/contracts/productAnalysisV1Types.ts` — `discLevelId`/`measurementId` added (opaque ids the review/correction endpoints need); `ProductAnalysisReview` gained `comment`/`reviewedBy`/`reviewedAt`; `ProductAnalysisDiscLevel` gained its own `review`; `ProductAnalysisMeasurement` gained `corrections: ProductAnalysisMeasurementCorrection[]`; new `ProductAnalysisReviewRequest`/`ProductAnalysisCorrectionRequest` request types.
- `src/productAnalysisV1Api.ts` — parsers updated to require the new ids (fail-closed: a response missing `discLevelId`/`measurementId` now throws `ProductAnalysisV1ContractError`, same discipline as every other required field); three new functions added.
- `src/features/reading/productAnalysisV1State.ts` — a `mutating`/`mutationError` sub-state and `mutation_requested`/`mutation_succeeded`/`mutation_failed` actions, kept **separate** from the stage-77 `submitting`/`error` phase so reviewing a persisted run is never confused with re-analyzing the Study.
- `src/features/reading/useProductAnalysisV1.ts` — `reviewRun`, `reviewDiscLevel`, `correctMeasurement`, each guarded by the new `canMutate`.
- `src/features/reading/productAnalysisDisplay.ts` — `REVIEW_STATUS_TEXT` updated to the real `pending|accepted|observed|rejected` vocabulary (previously an unused `in_review|completed` placeholder from stage 77, since real review didn't exist yet); new `REVIEW_ACTION_LABELS`, `REVIEW_REJECT_CONFIRMATION_TEXT`, `displayReviewedBy`, `CORRECTION_FIELD_LABELS`, `formatMeasurementFieldValue`.

## 3. API client (78-B/C/D)

```ts
reviewProductAnalysisRun(caseId, analysisId, { status, comment? }): Promise<ProductAnalysisResult>
// PATCH /api/studies/{caseId}/product-analyses/{analysisId}/review

reviewProductAnalysisDiscLevel(caseId, analysisId, discLevelId, { status, comment? }): Promise<ProductAnalysisResult>
// PATCH /api/studies/{caseId}/product-analyses/{analysisId}/disc-levels/{discLevelId}/review

correctProductAnalysisMeasurement(caseId, analysisId, measurementId, { field, correctedValue, comment? }): Promise<ProductAnalysisResult>
// POST /api/studies/{caseId}/product-analyses/{analysisId}/measurements/{measurementId}/corrections
```

All three built on the same `multiplanarRequest` helper reused since stage 77 — no new HTTP wrapper. `buildReviewRequestBody`/`buildCorrectionRequestBody` never include a reviewer/reviewedBy field (the Backend derives it from the authenticated principal) and the correction body never includes `unit` (the Backend derives it from `field`) — verified by test.

## 4. Review UI (78-F/78-I)

Each of the run-level and every disc-level's review renders through the same `ReviewSection` component: current status text (via `displayReviewStatus`, reusing the exact `pending|accepted|observed|rejected` vocabulary the Backend persists), the stored comment if any, `Revisado por: <reviewedBy>` if an identity is present, and three action buttons — **Aceptar / Observar / Rechazar**. Clicking **Aceptar** fires immediately (no modal, per 78's "no hace falta modal pesado"). Clicking **Observar** or **Rechazar** opens an inline comment `<textarea>` with **Confirmar**/**Cancelar** — for **Rechazar** specifically, a confirmation line (`REVIEW_REJECT_CONFIRMATION_TEXT`) is shown before the same Confirmar button commits it (a lightweight inline confirmation, not a separate modal dialog).

AI status and professional-review status are always rendered in **separate, clearly-labeled sections** — e.g. the disc level's own "Emparejamiento sagital-axial experimental. Requiere revisión profesional." (AI/67C) sits above a distinct "Revisión de este nivel" block with its own accept/observe/reject controls — never merged into one ambiguous badge (78-I).

## 5. Measurement correction UI (78-G)

For each of a measurement's three correctable fields (`areaMm2`/`majorAxisMm`/`minorAxisMm` — the only ones this product exposes, matching stage 76's `AiMeasurementResult`), `MeasurementFieldRow` renders:

```
Área          Valor automático: 12.30 mm²  [Corregir]
```

Clicking **Corregir** switches to an inline numeric input (pre-filled with the current value) plus **Guardar**/**Cancelar**. After saving, both values are shown together — **the automatic value is never hidden**:

```
Área          Valor automático: 12.30 mm²   Valor revisado: 11.80 mm²   [Corregir]
```

`formatMeasurementFieldValue` only affects what's displayed (`.toFixed(2)`) — the raw value stays exactly as the Backend returned it in state. A field with no AI value and no correction is not rendered at all (nothing to show or correct).

## 6. 67B2 / 67C / P10.7 semantics preserved (78-I)

- **67B2**: no "manual level assignment" UI was added — `professionalAssignedLevel` was explicitly deferred (see backend doc §9/§12); a `null` level still renders via the stage-77 `displayDiscLevel` fallback text regardless of any review action taken on that level.
- **67C**: `displayAxialPairingStatus` is called with the AI's own `axialPairingValidated`/`axialPairingExperimental` exactly as received, independent of the disc-level's review status — accepting a review never flips `validated` to `true` or drops the "Resultado experimental: requiere revisión profesional." note (verified by test 16/17).
- **P10.7**: `displayDegenerativeFindingsStatus("blocked_preprocessing_parity")` has no corresponding "review this finding" action anywhere in the UI — the disc-level's `ReviewSection` reviews the *level as a whole* (67B2/67C), not a fabricated P10.7 finding; there is nothing P10.7-specific to accept/reject (verified by test 18, which asserts the descriptive text never contains action language like "aceptar"/"rechazar").

## 7. Reviewer identity (78: never invented client-side either)

The Frontend never sends a reviewer name — `buildReviewRequestBody`/`buildCorrectionRequestBody` only ever include `status`/`field`/`correctedValue`/`comment`. `reviewedBy` shown in the UI comes back from the Backend's response (`review.reviewedBy`), which the Backend itself derives from the authenticated JWT (see backend doc §7) — `displayReviewedBy` returns `null` (renders nothing) rather than inventing a placeholder when the Backend reports none.

## 8. History / multiple runs (78-J)

Each entry in `state.history` carries its own `review`/`discLevels[].review` — switching runs via the existing stage-77 history list re-renders that run's own review state, never a shared one. The reducer's `mutation_succeeded` replaces only the matching `analysisRunId` entry in `history`, leaving every other run's review untouched (verified by test 8/19).

## 9. Persistence across reload (78-K)

Nothing review-related is held only in React state: `mutation_succeeded` updates `state.selected`/`state.history` from the Backend's own response, and a real page reload re-mounts `useProductAnalysisV1`, which re-fetches history/detail from the Backend — the same mechanism stage 77 already relied on for the AI result itself. Verified for real (not just unit-tested) in the Docker E2E run (§12).

## 10. Tests (78-Q)

`scripts/post-e50-professional-review-tests.mjs` (wired as `npm run test:post-e50-professional-review`, included in `npm test`) — **20 tests**, all passing, covering the full requested list: pending visible, accept/observe/reject reflected after a mutation, loading (`mutating=true`), double-submit blocked (`canMutate`), comment included/omitted in the request body, review persisted across a simulated reload (history entry replaced by id), corrected value parsed and displayable, original AI value still present after a correction, `unit` never sent by the client, 404/422/500 classification, a successful mutation clearing a prior error, 67C still experimental/not-validated regardless of review, P10.7 blocked never offers a review action of its own, switching runs never mixes reviews, and a static check that the panel never uses `dangerouslySetInnerHTML` (comments render as plain React text, never raw HTML). The pre-existing stage-77 `post-e50-product-analysis-v1-tests.mjs` (32 tests) was updated only to add the new required fixture fields (`discLevelId`, `measurementId`, `review`, `corrections`) — all 32 still pass unchanged in substance.

## 11. Regression

`npx tsc -b`: clean except the two pre-existing `Cannot find module 'react-router-dom'` errors (confirmed present before this stage's changes too — an environment install gap, unrelated). `npx eslint` on all 6 changed/new files: clean. Full `npm test` (all chained scripts including the two new ones): see the final report for the exact pass count from this run.

## 12. Docker E2E (78-L, backend-scoped)

A real backend-scoped E2E was run (see the final report's Docker section for the exact transcript): `docker compose up -d postgres` (the project's own compose file, Postgres service only — the real `ai-module`/`frontend` services were **not** built, per the stage's explicit "no gastar horas en setup de IA" guidance), a synthetic Study+input seeded directly via SQL (no official/validation studies), a minimal Node HTTP stub standing in for FastAPI's `POST /v1/product/analyze` (returning a fixed `partial` response), and the real Spring Boot backend run locally against both. Exercised for real over HTTP: POST product-analysis → persisted run, GET history/detail, PATCH review (`accepted`, `reviewedBy` correctly derived from the demo JWT — never invented), a second GET confirming the review survived a reload, POST a measurement correction, a third GET confirming both the original AI value and the corrected value were still present together, plus negative cases (cross-Study 404, invalid status 400, non-finite correction value 400, missing auth 401).

**Not attempted**: driving this same flow through the real Frontend in a browser. `StudyReviewView.tsx` requires a full canonical multiplanar run to render at all (same blocker documented in stage 77's E2E section) — building that precondition just to reach the "ai" tab where this panel lives was judged disproportionate to this stage, exactly as in stage 77. The backend-scoped E2E above still exercises the exact same HTTP contract this Frontend's `productAnalysisV1Api.ts` calls, so the integration surface itself was verified for real, just not through a rendered page.

All Docker resources used for this were torn down afterward (`docker compose down`, the local backend process and mock-AI stub killed) — no volumes were deleted (`postgres-data` and sibling project volumes were left intact, per the "no borrar volumes sin revisar" instruction).

## 13. Limits / what stage 78 deliberately does not do

- No `professionalAssignedLevel` manual-level UI (deferred, matching the Backend).
- No full audit/history view of past review changes — only the current review state is shown (matching the Backend's upsert-not-append model).
- No browser-driven E2E (see §12) — covered instead by 20 new frontend unit tests plus a real backend-scoped HTTP E2E.
- Comment input is a plain `<textarea>`, length/markup validation is enforced server-side (the client only trims and omits an empty comment) — no client-side character counter was added.

## 14. Next stage (79)

- A `professionalAssignedLevel` UI once the Backend models it, kept visually and contractually distinct from 67B2's own `level`.
- Surfacing correction/review history (not just current state) if that becomes a product requirement.
- A rendered-browser E2E once a lighter entry point into the reading room's "ai" tab exists.
