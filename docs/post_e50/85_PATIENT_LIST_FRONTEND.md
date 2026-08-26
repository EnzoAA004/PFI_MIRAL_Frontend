# Stage 85 — Patient List / Navegación de Pacientes (Frontend)

Branch: `research/post-e50-frontend-product-analysis`. Base commit `78e850d` (Stage 84). Not committed/pushed as of this document.

## 1. Patient entity: NOT PRESENT

`PatientsView.tsx` never talks to a `Patient` resource. It calls the real, existing `GET /api/subjects` projection (Backend: `SubjectListService`, grouped by `Study.subjectRef`) and renders one card per distinct subject. History remains exactly Stage 84's `PatientHistoryPage`/`fetchSubjectHistory(subjectRef)` — unchanged.

## 2. Inventory (85-A) — a bigger surface than the stage brief anticipated

Re-confirmed the Stage-84 finding: `PatientsView.tsx` called `searchPatients(query, 100)` → `GET /api/patients`, an endpoint that has never existed in the Backend. `PatientDetailView.tsx` was already fully orphaned since Stage 84 (nothing in `App.tsx`'s render tree referenced it).

**A second, larger finding surfaced during this stage's own inventory, out of this stage's scope**: `patientApi.ts` is *not* only consumed by the broken `/pacientes` surface. `src/features/worklist/PatientSelector.tsx` and `NewAnalysisDrawer.tsx` — the real, live "Nuevo análisis" patient-selection step, rendered by `Worklist.tsx` — call `createPatient`/`searchPatients` from the same file, and `patientStudyAssociation.ts` calls `associateStudyPatient`, all against the same nonexistent `/api/patients`/`/api/studies/{caseId}/patient` endpoints. This means the "Nuevo análisis" flow's patient-selection UI is a second, independently broken surface, unrelated to `/pacientes` and **not fixed by this stage** — fixing it would mean either building a real `Patient` entity on the Backend (which the project's own architecture decision explicitly rules out) or redesigning "Nuevo análisis"'s patient step to also key off `subjectRef` instead, a change with its own scope that deserves its own stage rather than a rushed side-fix here. **`patientApi.ts` is therefore kept** (it has real, live consumers beyond the surface this stage touches) — only the code paths this stage actually replaces were removed (§5).

## 3. Routing (85-O) — no new design needed, Stage 84 already decided this

`pathForPatient(subjectRef)` (`routes.ts`) already puts the de-identified `subjectRef` in the URL (`/pacientes/:subjectRef`), a decision Stage 84 made and documented explicitly ("no existe una entidad Patient — el segmento es el `subjectRef` de Study"). `App.tsx`'s existing wiring (`onOpenPatient={(patientId) => navigate(pathForPatient(patientId))}`) already treats its callback argument as a subjectRef, so `PatientsView.tsx` needed no App.tsx change — only its internal data source (§4) and the value it passes to `onOpenPatient` (now `patient.subjectRef`, previously `patient.id`).

## 4. `PatientsView.tsx` rewrite (85-L)

Replaced `searchPatients`/`patientApi.ts` with `fetchSubjectList()` (new, `subjectHistoryApi.ts`, calling `GET /api/subjects`). Each card shows:

```
Paciente
N estudios · Último: DATE · Caso: CASE-ID
Análisis: STATUS [· Revisión: STATUS]
[Abrir historial]
```

or "Análisis: Sin análisis" when the subject's latest Study has no effective run — a normal state, not hidden or treated as an error.

## 5. Privacy (85-I) and search (85-H)

The raw `subjectRef` is **never printed** as visible text — the card header is the generic literal `"Paciente"`, matching Stage 84's own decision to stop printing `subjectRef` on the history screen. The visible, searchable distinguishing identifier is `latestCaseId` — already shown throughout the rest of the product (worklist, routing, Study review), so this introduces no new exposure. Search filters client-side by `latestCaseId` substring; `subjectRef` is used **only** internally, as the argument to `onOpenPatient`/`pathForPatient` for navigation. Verified live in the browser: `document.body.innerText` never contains any seeded `subjectRef` on either `/pacientes` or the history page it navigates to, and the URL (`/pacientes/PAT-85-C`) carries the de-identified reference exactly as Stage 84 already established as acceptable.

## 6. Status labels (85-Q) — new local map, same pattern as Stage 84

`ANALYSIS_STATUS_LABELS`/`REVIEW_STATUS_LABELS` (local to `PatientsView.tsx`) translate the post-e50 English vocabulary (`completed/partial/failed`, `pending/accepted/observed/rejected`) to Spanish — the same "small local map, not a shared export" pattern `PatientHistoryView.tsx` already uses for `PRODUCT_ANALYSIS_REVIEW_LABELS` (Stage 84). No raw enum value is ever interpolated directly into JSX.

## 7. Clinical safety (85-R)

The list surfaces only date, Study count, analysis status, and review status — never a diagnostic, progression, or severity claim. Verified by a dedicated test asserting the component source contains none of the prohibited phrases ("paciente enfermo", "patología detectada", "normal/anormal", "mejoró/empeoró").

## 8. Dead code cleanup (85-X)

| File | Classification | Action |
|---|---|---|
| `PatientDetailView.tsx` | Dead (zero real consumers — confirmed orphaned since Stage 84, only a doc-comment mention in `PatientHistoryPage.tsx`) | **Deleted** |
| `scripts/playwright-patient-pr4-e2e.mjs` | Dead (exercised the deleted component's route entirely via mocks) | **Deleted**, `test:e2e:patient-pr4` removed from `package.json` |
| `patientApi.ts` | Still live (§2 — `PatientSelector.tsx`/`NewAnalysisDrawer.tsx`/`patientStudyAssociation.ts`) | **Kept**, untouched |
| `scripts/patient-pr4-tests.mjs` | Mixed: tests 1–5 covered `patientApi.ts`'s own parsing contract (still valid); tests 6–27 covered `PatientsView.tsx`'s old search UI and `PatientDetailView.tsx`'s own rendering (both now gone) | **Trimmed** to the 6 tests that still describe real, live code |
| `scripts/p8d4-review-status-display-tests.mjs` tests F/G | Asserted the pre-Stage-85 architecture (`PatientsView` using `searchPatients`, `PatientDetailView` existing) | **Updated** to assert the current, correct state |
| `scripts/p8e2-subject-history-tests.mjs` tests `P8-E2.1 D`, M, N | Same as above | **Updated** |

## 9. Frontend files new/modified

**New**: `scripts/post-e50-patient-list-tests.mjs` (24 tests), `docs/post_e50/85_PATIENT_LIST_FRONTEND.md` (this file).

**Modified**: `src/components/PatientsView.tsx` (full rewrite, §4–§7), `src/subjectHistoryApi.ts` (+`fetchSubjectList`, +`normalizeSubjectSummary`), `src/appTypes.ts` (+`SubjectSummary`), `scripts/patient-pr4-tests.mjs` (trimmed, §8), `scripts/p8d4-review-status-display-tests.mjs` (tests F/G updated), `scripts/p8e2-subject-history-tests.mjs` (tests `P8-E2.1 D`/M/N updated), `package.json` (+`test:post-e50-patient-list`, −`test:e2e:patient-pr4`).

**Deleted**: `src/components/PatientDetailView.tsx`, `scripts/playwright-patient-pr4-e2e.mjs`.

## 10. Frontend tests new / regression

24 new tests in `scripts/post-e50-patient-list-tests.mjs` (exceeds the 20+ target, 85-W) — covering the data source, empty/error/search states, status-label translation, privacy (no raw `subjectRef`/`patientReference` text), no-clinical-language, button semantics, and `subjectHistoryApi.ts`'s new `normalizeSubjectSummary`/`fetchSubjectList` (fail-closed on an incomplete payload). Full `npm test` (54 scripts including this one): exit 0. `npx tsc -b`: clean. `npx eslint src`: clean. `npm run build`: succeeds (1919 modules).

## 11. Docker E2E / Browser E2E

See the general Stage-85 report for the full step-by-step. Summary: real Docker stack (`docker-compose.post-e50.yml`), fresh volume, fixture `PAT-85-A` (3 Studies), `PAT-85-B` (1 Study), `PAT-85-C` (2 Studies), plus a null-subjectRef Study — `GET /api/subjects` returned exactly 3 rows, ordered by `latestStudyDate DESC` (C, A, B), the null-subjectRef Study never appeared, and `GET /api/subjects/PAT-85-A/history` still returned all 3 of its Studies. Real-backend browser smoke: `/pacientes` rendered 3 cards with correct counts/dates/case IDs, search by caseId filtered correctly, clicking "Abrir historial" opened Stage 84's real timeline, "Abrir estudio" opened the real Study, navigating back to `/pacientes` still worked, zero requests to `/api/patients` were observed in the full session, and the raw `subjectRef` was confirmed absent from all visible page text on both screens.

## 12. What Stage 85 deliberately does not do

- Does not touch the "Nuevo análisis" `PatientSelector`/`patientApi.ts` surface (§2) — a separate, real, already-broken feature outside this stage's stated scope, documented here as a finding for a future stage rather than silently patched or hidden.
- No new Patient entity, no fabricated `PatientName`, no diagnostic/clinical-progression language.
- No new router redesign — reuses Stage 84's `pathForPatient`/`patientIdFromPath` exactly as they already were.
- No pagination UI — matches the Backend's own MVP-scale decision.

## 13. Next stage (86)

- Decide, as its own scoped piece of work, what to do about the "Nuevo análisis" patient-creation/selection step calling nonexistent `/api/patients`/`/api/studies/{caseId}/patient` endpoints (§2) — this is a real, live, broken core-flow gap independent of `/pacientes`, and should not be conflated with Stage 85's subjectRef-projection decision without a deliberate design choice.
- Structured report/export, per the user's own proposed sequencing, now that `Pacientes → Historial → Study → Análisis → Review → Evolución → Asistente` is fully connected.
