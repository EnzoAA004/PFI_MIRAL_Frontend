# Stage 79 — Longitudinal comparison between Studies (Frontend)

Branch: `research/post-e50-frontend-product-analysis` (same branch as stages 77/78 — no new branch). Base commit `cbe241e` (Stage 78). Not committed/pushed/merged as of this document.

## 1. Existing patient/history UI found (79-A)

- `src/subjectHistoryApi.ts` already exports `fetchSubjectHistory(subjectRef): Promise<PatientHistoryResponse>` (`GET /api/subjects/{subjectRef}/history`), returning `PatientStudy[]` with `caseId`+`studyDate`+`subjectRef` together, already contract-validated and unit-tested (`scripts/p8e2-subject-history-tests.mjs`) — **reused as-is**, not duplicated, to list baseline candidates.
- The currently-open Study's `subjectRef` is available in `StudyReviewView.tsx` via the exact accessor already used elsewhere in that file: `selectedDetail?.study?.subjectRef ?? run.patientId ?? studyReview?.patientId ?? null`.
- `src/components/PatientHistoryView.tsx` (a *separate*, whole-patient-timeline page, not the single-study reading room) already has a "Tendencias en el tiempo" panel with a placeholder — `EmptyLongitudinalState` — explicitly stating *"No se calculan tendencias clínicas ni progresión longitudinal desde el frontend."* This confirms the field was previously and deliberately empty (the Frontend was right not to fabricate deltas before a deterministic Backend existed to compute them) and is **not extended by this stage** — see §8 for why.
- Reused as-is: `Table`/`EmptyState` conventions from `design/primitives.tsx`, the `table-wrap` + `role="region"` + `tabIndex={0}` accessible-scroll wrapper `PatientHistoryView.tsx` already established for exactly this "measurements across studies" shape, `displayStudyDate` (`src/studyDisplay.ts`, unchanged), and the `panel-hidden-placeholder honest-empty-state` empty-state convention that page already uses for "we won't fabricate a derived value" messaging — a closer match for this cross-Study feature than `ProductAnalysisV1Panel.tsx`'s own inline `rr-note`/`rr-findings-empty` (which is for a single Study's own analysis, a different concept per 79-X).
- Genuinely new (nothing existed): a client for the new `longitudinal-comparison` endpoint, any delta/percent-delta computation or type, and a same-subject/excluding-current-caseId baseline picker.

## 2. Where the feature lives

Added to `StudyReviewView.tsx`'s "Más" tab as a new `<details className="rr-more-section">` titled **"Evolución"**, right after "Reconstrucción 3D" — the same collapsible-section convention already used there, not a redesign. It is deliberately **not** merged into `ProductAnalysisV1Panel.tsx` (stage 77/78's single-Study analysis history) — 79-X explicitly separates "analysis history" (several runs of the *same* Study) from "longitudinal history" (different Studies of the *same patient*), and this stage keeps that boundary in the code, not just in prose: `LongitudinalComparisonPanel.tsx` and its state module have no dependency on `ProductAnalysisV1Panel.tsx`/`useProductAnalysisV1.ts` at all (verified by a dedicated test — see §9 item 24).

## 3. Types / API client

`src/contracts/longitudinalComparisonTypes.ts` mirrors the Backend DTO exactly: `LongitudinalComparisonResult`, `LongitudinalMeasurementComparison` (`level`/`plane` nullable, `metric`, `unit`, `baseline`/`current` as `LongitudinalEffectiveValue | null`, `deltaAbsolute`/`deltaPercent`/`trend` nullable, `comparisonStatus`), `LongitudinalEffectiveValue` (`automaticValue`/`correctedValue`/`effectiveValue`/`source`).

`src/longitudinalComparisonApi.ts`:
```ts
getLongitudinalComparison(currentCaseId, baselineCaseId): Promise<LongitudinalComparisonResult>
// GET /api/studies/{currentCaseId}/longitudinal-comparison?baselineCaseId=...

getComparableStudies(subjectRef, excludeCaseId): Promise<ComparableStudy[]>
// reuses fetchSubjectHistory, filters out excludeCaseId — no second history endpoint invented
```
Built on the same `multiplanarRequest` helper reused since stage 77 for the comparison call; `getComparableStudies` deliberately reuses the already-tested `fetchSubjectHistory` rather than adding a parallel "studies for a patient" client. `parseLongitudinalComparisonResult` is a strict, fail-closed parser (same discipline as `productAnalysisV1Api.ts`) — a response missing e.g. `baselineCaseId` or carrying an unrecognized `comparisonStatus` throws `LongitudinalComparisonContractError` rather than rendering a guessed shape.

**The Frontend never computes a delta itself** — every `deltaAbsolute`/`deltaPercent`/`trend` value comes straight from the Backend's already-deterministic calculation (79-D/79-J); this Frontend layer only formats and displays it.

## 4. State (pure, testable without mocking `fetch`)

`src/features/reading/longitudinalComparisonState.ts` — no React import, mirroring the stage-77/78 pattern (`productAnalysisV1State.ts`): phases `idle | loading_candidates | loading_comparison | ready | error`, plus `excludeCurrentCase` (79-U: the current Study never appears as its own baseline candidate) and `isSwitchingBaseline` (79-W: selecting a different baseline always triggers a fresh `loading_comparison`, never reuses the previous result). `useLongitudinalComparison.ts` is a thin hook wrapping this state with the two API calls.

## 5. UI (79-R/79-T/79-U)

`LongitudinalComparisonPanel.tsx`:
- A `<select>` "Comparar con" listing other Studies of the same patient (`{date} · {caseId}`, via `displayStudyDate` — unchanged), excluding the current Study.
- On selection, a comparison table (`table-wrap`/`role="region"` a11y wrapper, `worklist-table longitudinal-measurements-table` class, matching `PatientHistoryView.tsx`'s existing convention) with columns **Medición / Anterior / Actual / Cambio**.
- Each corrected value shows "(Valor revisado: automático {X})" inline — the AI's original value is never hidden, matching stage 78's own UI rule, applied here to both the baseline and current side independently (79-T).
- Non-comparable measurements (`missing_baseline`/`missing_current`/`level_unresolved`/`unit_mismatch`) are collapsed into a separate "No comparables (N)" `<details>`, each with `displayComparisonStatus`'s plain-language reason — never a raw enum string, never a 500.
- Empty states use the `panel-hidden-placeholder honest-empty-state` convention (§1): "No hay otro estudio disponible para comparar" when no candidates exist, "No hay mediciones comparables entre estos estudios" when a comparison returns zero rows, and the Backend's own functional-error message surfaced verbatim for a "no usable analysis" (422) case — none of these render as a red error toast.

## 6. No clinical color semantics (79-S)

`trendArrow` returns only `↑`/`↓`/empty — **no color is ever assigned based on trend**, and the shared `rr-*` CSS classes used for the table carry no red/green coding for this feature. The number's own sign (`formatDeltaAbsolute`/`formatDeltaPercent` prefixing `+`/`-`) is the only "direction" signal, exactly as instructed ("Mejor: flecha ↑ / ↓ sin interpretar"). `LONGITUDINAL_DISCLAIMER` ("Comparación técnica automática entre estudios. No constituye una interpretación de evolución clínica.") is shown once per comparison, not repeated per row.

## 7. Study selector (79-U)

The current Study is never offered as its own baseline (`excludeCurrentCase`, unit-tested). Candidates come pre-sorted by the Backend's existing `subjectRef`-history convention (most recent first) — the Frontend does not re-sort them.

## 8. `PatientHistoryView.tsx` was deliberately left untouched

Its "Tendencias en el tiempo" `EmptyLongitudinalState` placeholder still reads as before. Wiring stage 79's real comparison into that page (which lists a patient's *entire* history, not one current-vs-baseline pair) would require picking an implicit "current" Study out of an N-study list — a UX decision the stage brief didn't ask for and that risks silently guessing which Study a clinician means. The stage 79 UX mockup (`Estudio actual: ... / Comparar con: [dropdown]`) matches `StudyReviewView.tsx`'s single-open-Study context far better, so that is where this stage lives; extending `PatientHistoryView.tsx` is left as a candidate for a future stage once/if that page's own "current Study" selection is designed.

## 9. Tests (79-Z)

`scripts/post-e50-longitudinal-comparison-tests.mjs` (wired as `npm run test:post-e50-longitudinal-comparison`, included in `npm test`) — **27 tests**, all passing: baseline candidates load and exclude the current case, empty history, loading phase, successful comparison, absolute/percent delta formatting (including the `null`-percent case rendering as `—`, never an error), corrected value visible on both baseline and current sides with the automatic original always still present, `level=null` never rendered as the literal string `"null"`, every non-comparable status has a plain-language message, 404/422/network error classification, switching baseline always reloads (never reuses a stale result), a structural test asserting the stage-77/78 analysis-history state module and this stage's longitudinal state module know nothing about each other's concepts (79-X, enforced in code not just prose), a scan asserting no display string uses "mejoró/empeoró/diagnóstico" language or color words, plus two fail-closed parsing tests (missing `baselineCaseId`, unknown `comparisonStatus` — both throw `LongitudinalComparisonContractError`).

## 10. Regression

`npx tsc -b`: clean except the two pre-existing `Cannot find module 'react-router-dom'` errors (confirmed present before this stage too). `npx eslint` on all 6 new/changed files: clean. Full `npm test`: see the final report for the exact count from this run.

## 11. Docker E2E

Exercised for real against the Backend's stage-79 E2E setup (§Docker in the final report) — two Studies of the same patient (`PAT-P79-1`) plus a third of a different patient (`PAT-P79-2`), each with a real persisted analysis run via `POST /api/studies/{caseId}/product-analysis` against the mock-AI/real-Postgres stack, a correction applied to the current Study's measurement, then `GET .../longitudinal-comparison` called directly over HTTP (the exact contract this Frontend's `longitudinalComparisonApi.ts` also calls) confirming `baselineEffective=12.3`, `currentEffective=12.9` (corrected, not the automatic 13.1), `deltaAbsolute≈0.6` — matching the stage brief's own worked example — plus a reload returning the identical result and the different-patient Study rejected with `404`. Not attempted through the rendered browser page, for the same reason stated in stages 77/78: `StudyReviewView.tsx` requires a full canonical multiplanar run precondition to render at all, which was judged disproportionate to build just to reach this "Más" tab.

## 12. Limits / what stage 79 deliberately does not do

- `PatientHistoryView.tsx` is untouched (§8).
- No auto-baseline ("compare with previous Study automatically") — the user always picks explicitly from the dropdown, matching the Backend's own decision not to build an auto-baseline helper this stage.
- No color-coded trend indicators, no severity/threshold styling of any kind.
- No browser-rendered E2E (see §11) — covered instead by 27 frontend unit tests plus a real backend-scoped HTTP E2E.

## 13. Next stage (80)

- If `PatientHistoryView.tsx`'s own "current Study" selection is ever designed, wire the same `LongitudinalComparisonPanel`/hook into it instead of duplicating the comparison table.
- An explicit "compare with the immediately preceding Study" one-click action, once the Backend offers the auto-baseline helper it deliberately deferred.
