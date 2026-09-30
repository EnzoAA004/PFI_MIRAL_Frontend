# Stage 84 — Patient History / Longitudinal Timeline via `subjectRef` (Frontend)

Branch: `research/post-e50-frontend-product-analysis`. Base commit `bd4c281` (Stage 82 planning docs only, no frontend code changed since Stage 81's `457c044`). Not committed/pushed as of this document.

## 1. Inventory (84-A) — a bigger discovery than expected

`PatientHistoryView.tsx` already existed, fully built and tested (`scripts/p8e2-subject-history-tests.mjs`), calling the real, working `GET /api/subjects/{subjectRef}/history` — but it was **never wired into routing**. The route that *was* wired, `/pacientes/:id` → `PatientDetailView`, called `GET /api/patients/{id}` and `GET /api/patients/{id}/studies` — **neither endpoint exists anywhere in the Backend** (confirmed by grep: no controller maps `/api/patients` at all). That route has been non-functional since it was written, independent of what `:id` value is passed. Confirmed with the user before proceeding (a bigger architectural finding than the stage brief anticipated) and authorized to replace `PatientDetailView` with a real wiring of `PatientHistoryView` at that same route, treating `:id` as `subjectRef` rather than a separate Patient id.

`useLongitudinalComparison`/`LongitudinalComparisonPanel` (Stage 79) were already fully generic — they take plain `caseId`/`subjectRef` strings, with no dependency on being rendered inside `StudyReviewView`'s context — confirming they could be reused as-is for the "Comparar" action from the new timeline (§5).

No chart library exists in `package.json` (confirmed absent) — the evolution view is a plain table, per 84-S.

## 2. Routing (84-U)

`PatientHistoryPage.tsx` (new) is the real connection point for `/pacientes/:id`, replacing `PatientDetailView` in `App.tsx`. It fetches `fetchSubjectHistory(subjectRef)` and renders `PatientHistoryView` with the real response. `PatientDetailView.tsx`/`patientApi.ts` are left as **orphaned, untouched files** — not deleted, since they may still be referenced by their own pre-existing tests (`patient-pr4-tests.mjs`, parts of `p8d4-review-status-display-tests.mjs`/`p8e2-subject-history-tests.mjs`) that describe that (now-unused) component's own internal behavior; a future stage can remove them once confirmed nothing else needs them. `App.tsx` itself never imports `PatientHistoryView`/`fetchSubjectHistory` directly — those stay encapsulated inside `PatientHistoryPage.tsx`, preserving the exact isolation an existing regression test (`p8e2-subject-history-tests.mjs` test T, updated — see §7) already protected, just pointed at the real component instead of the broken one.

Navigation is all client-side React Router (`navigate(pathForPatient(subjectRef))`/`navigate(pathForStudy(caseId))`) — no full page reload anywhere in the new flow, confirmed by a dedicated test.

## 3. "Ver historial del paciente" from `StudyReviewView` (84-P/84-V)

New `<details>` section ("Historial del paciente") added to the "Más" tab, alongside the existing "Evolución"/"Asistente" sections (Stage 79/80's own placement convention), guarded by subjectRef presence: shows a button when a `subjectRef` exists, or the exact empty-state text "Este estudio no tiene una referencia longitudinal disponible." when it doesn't (84-V). Clicking the button navigates to the patient history page and records the current Study's `caseId` (via a new `App.tsx` state variable, `patientHistoryCurrentCaseId`) so the timeline can mark "Estudio actual" — this state is not URL-persisted, so a direct link to `/pacientes/:id` (not navigated from a Study) simply shows no "current" marker rather than breaking.

## 4. `PatientHistoryView.tsx` evolution

- **Privacy fix (84-W)**: the header no longer prints the raw `subjectRef` — `<h1>` now reads "Historial del paciente" (generic) instead of the raw reference; the decorative avatar letter no longer derives from the reference either. The one exception is `studyTraceabilityMode` (a Study with no stable subjectRef at all, shown by `caseId` instead — not sensitive the same way). `subjectRef` is still used **internally** (API calls, export filename, comparison/series requests) — it is only removed from what's *printed on screen*.
- **`productAnalysis` display (84-C/84-D/84-G/84-H)**: each timeline row now shows the post-e50 analysis status, review status (mapped from the English `pending|accepted|observed|rejected` vocabulary via a small dedicated label map — the post-e50 vocabulary is distinct from the legacy Spanish `ReviewStatus` this file already used elsewhere), measurement/corrected counts, and warnings (mapped to readable text via the same `67B2_RUNTIME_PARITY_NOT_PROVEN`-style convention Stage 77 established — never reinterpreted, never hidden). A Study with `productAnalysis: null` shows "Este estudio todavía no tiene un análisis." (exact 84-V text) rather than being hidden.
- **Current-study marker (84-P)**: a `currentCaseId` prop; the matching row gets a `"Estudio actual"` badge plus a CSS class (`patient-timeline-current`) — never relying on color alone.
- **"Comparar" action (84-T)**: each historical row (except the current one) gets a "Comparar" button. Clicking it sets local state that renders `LongitudinalComparisonPanel` (Stage 79, **unchanged logic**) with a new optional prop, `initialBaselineCaseId`, which `useLongitudinalComparison` uses to auto-select that baseline once its candidate list has loaded — the panel's own dropdown remains fully usable afterward, this is purely a convenience preselection, not a new comparison path. No delta is computed in the Frontend at any point in this flow.
- **Evolution view (84-I/84-R/84-S)**: a new `EvolutionSection` component replaces the old `EmptyLongitudinalState` placeholder in the "Tendencias en el tiempo" panel (renamed "Evolución de mediciones"). It calls the two new Backend endpoints (`fetchAvailableMeasurementSeriesKeys`/`fetchMeasurementSeries`), offers a `<select>` ("Nivel · Métrica", reusing Stage 79's own `displayMetricLabel` map — `areaMm2/majorAxisMm/minorAxisMm` → `Área/Eje mayor/Eje menor` — so the option text is human-readable, not a raw field name), and renders a plain chronological table (date, caseId, value, with "(Valor revisado: automático X)" shown inline for corrected points — the AI's original value is never hidden). No chart library added.

## 5. Empty states (84-V) — exact required text

| Case | Text |
|---|---|
| `subjectRef` null (from a Study) | "Este estudio no tiene una referencia longitudinal disponible." |
| Only 1 Study | "No hay otros estudios disponibles para comparación." |
| Study with no analysis | "Este estudio todavía no tiene un análisis." |
| No comparable series | "No hay mediciones comparables entre múltiples estudios." |

All four render via the existing `panel-hidden-placeholder honest-empty-state`/`EmptyLongitudinalState` convention — never a generic red error.

## 6. A bug found and fixed during browser E2E

The evolution selector initially showed raw metric field names (`majorAxisMm`) instead of a readable label, because the wrong existing helper (`displayMeasurementLabel`, meant for legacy `StudyRun` measurement labels) was used instead of the correct one Stage 79 already built for exactly this vocabulary (`displayMetricLabel` in `longitudinalComparisonDisplay.ts`, mapping `areaMm2/majorAxisMm/minorAxisMm` → `Área/Eje mayor/Eje menor`). Found by the real-backend browser E2E script (not by the unit tests, which didn't assert the specific label text), fixed by switching to the correct existing helper — another instance of "reuse Stage 79, don't reinvent," this time caught as a real bug rather than a design decision.

## 7. Existing tests updated (not new gaps, intentional architecture changes)

- `scripts/p8e2-subject-history-tests.mjs` test **T** previously asserted `App.tsx` rendered `<PatientDetailView` and never referenced `PatientHistoryView`/`fetchSubjectHistory` — that assertion encoded the *old* (now-corrected) decision to keep the broken component wired. Updated to assert the new, correct state: `App.tsx` renders `<PatientHistoryPage`, never `<PatientDetailView`, and still never imports `PatientHistoryView`/`fetchSubjectHistory` directly (isolation preserved, just pointed at the real component). All other pre-existing tests describing `PatientDetailView.tsx`'s own internal behavior (`patient-pr4-tests.mjs`, other `p8e2`/`p8d4` cases) were left unchanged — they still accurately describe that now-orphaned file, which was not modified.

## 8. Frontend files new/modified

**New**: `src/components/PatientHistoryPage.tsx`, `scripts/post-e50-patient-history-tests.mjs`, `scripts/playwright-post-e50-patient-history-e2e.mjs`, `docs/post_e50/84_PATIENT_HISTORY_FRONTEND.md` (this file).

**Modified**: `src/components/PatientHistoryView.tsx` (privacy fix, `productAnalysis` display, current-study marker, Comparar action, real evolution section), `src/components/StudyReviewView.tsx` (+"Historial del paciente" section, `onOpenPatientHistory` prop), `src/App.tsx` (routing swap, `patientHistoryCurrentCaseId` state), `src/routes.ts` (doc comments updated to reflect `subjectRef`, not a Patient UUID), `src/appTypes.ts` (+`PatientStudyProductAnalysis`, +`MeasurementSeries*` types), `src/subjectHistoryApi.ts` (+`productAnalysis` parsing, +2 new API functions), `src/features/reading/useLongitudinalComparison.ts` (+`initialBaselineCaseId` param), `src/features/reading/LongitudinalComparisonPanel.tsx` (+prop passthrough), `src/design/components.css` (+4 small rules), `package.json` (+1 test script), `scripts/p8e2-subject-history-tests.mjs` (test T updated, §7).

## 9. Frontend tests new / regression

31 new tests in `scripts/post-e50-patient-history-tests.mjs` (exceeds the 30+ target) — covering `productAnalysis` parsing (fail-closed on malformed data), the two new measurement-series API functions, and string-assertions against the `.tsx` surfaces for privacy/empty-states/no-clinical-language/current-marker/compare-action, following the same harness convention as every other post-e50 stage. `npx tsc -b`: clean. `npx eslint src`: clean. Full `npm test`: exit 0. `npm run build`: succeeds (1919 modules).

## 10. Docker E2E / Browser E2E

See the general Stage-84 report for the full step-by-step. Summary: real Docker stack (`docker-compose.post-e50.yml`), fresh volume, `subjectRef=PAT-84-1` with Studies A/B/C (+ `CASE-84-D` on a different subjectRef, + a null-subjectRef Study) — history returns exactly 3 Studies in `studyDate DESC` order (C, B, A), series returns 3 points in `studyDate ASC` order (A, B, C) with the corrected point's original value preserved, `CASE-84-D` and the null-subjectRef Study never appear anywhere. Real-backend Playwright browser E2E (`scripts/playwright-post-e50-patient-history-e2e.mjs`, extending Stage 81's pattern): 9/9 checks passed, including a genuine privacy verification (confirmed the raw subjectRef is never present in the rendered page's text) and the "Comparar" action correctly opening Stage 79's comparison panel from the timeline.

## 11. What Stage 84 deliberately does not do

- Does not fix the still-broken `/pacientes` list page (`PatientsView.tsx` calls `searchPatients` → `GET /api/patients`, also nonexistent) — out of scope for this stage, which entered the patient-history experience from an open Study, not from that list. Documented here as a known, separate, pre-existing gap for a future stage.
- Does not delete `PatientDetailView.tsx`/`patientApi.ts` — left orphaned rather than removed (§2).
- No chart library, no clinical trend/progression language, no color-coded semantics anywhere in the new evolution view.

## 12. Next stage (85)

- Fix or replace the `/pacientes` list page's broken `GET /api/patients` dependency — either build that endpoint for real, or repoint the list at `subjectRef`-based discovery (e.g., distinct `subjectRef` values already known from persisted Studies), consistent with this stage's "no Patient entity" decision.
- Once `PatientHistoryPage`/`PatientDetailView` overlap is fully resolved, consider removing the orphaned files and their now-purely-historical tests.
