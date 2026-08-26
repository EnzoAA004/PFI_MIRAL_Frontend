# Stage 86 — New Analysis Flow / Patient Selector Cleanup (Frontend)

Branch: `research/post-e50-frontend-product-analysis` @ `ee3dba4` (Stage 85). Not committed/pushed as of this document.

## 1. Inventory (86-A) — the real flow, traced before touching code

`NewAnalysisDrawer.tsx` had **two independent, overlapping notions of patient identity** before this stage:

1. `selectedPatient: PatientSummary | null` — a `Patient` chosen/created via `PatientSelector.tsx`, backed by `patientApi.ts`'s `searchPatients`/`createPatient` (`GET`/`POST /api/patients` — **neither endpoint exists**). This gated the entire form (`patientReady`/`studyIdentityReady` required it before any upload was even enabled).
2. `metadata.subjectRef: string` — a free-text "Referencia interna del estudio (opcional)" field, already sent as `studyMetadata.subjectRef` in the real `POST /api/ai/multiplanar/run` request, and already the field that ends up on `Study.subjectRef` (confirmed in the Backend doc: this call was already atomic, no second request needed).

After a successful run, the drawer made a **third**, separate call — `attemptPatientAssociation` → `associatePatientAfterAnalysis` (`patientStudyAssociation.ts`) → `associateStudyPatient` (`patientApi.ts`) → `PUT /api/studies/{caseId}/patient`, **also nonexistent** — and blocked opening the finished Study on that call succeeding. In practice this meant "Nuevo análisis" could never be completed: step 1 required selecting a Patient through an endpoint that 404s/fails, and even bypassing that in a test harness, the final "asociar" step would then fail too, leaving the drawer permanently stuck on "Reintentar asociación."

## 2. The real flow, redefined (86-B)

```
Nuevo análisis
   ↓
seleccionar subject existente (opcional) o declarar uno nuevo (opcional)
   ↓
completar caseId + metadata
   ↓
subir imágenes (sin cambios — 86-P)
   ↓
POST /api/ai/multiplanar/run con studyMetadata.subjectRef ya incluido
   ↓
abrir el Study creado
```

One request creates the Study with its `subjectRef` (or without one, if none was chosen) — no second call.

## 3. `SubjectSelector.tsx` (86-C/86-L) — replaces `PatientSelector.tsx`

New component, same interaction shape as the old `PatientSelector.tsx` (a "Paciente existente"/"Paciente nuevo" radiogroup — kept per 86-L's "mantener si cambiarlo genera demasiado churn," since the shape itself is fine and users already know it) but with a corrected data source and contract:

- **Existente**: calls `fetchSubjectList()` (`GET /api/subjects`, Stage 85) instead of `searchPatients`. Each row shows `Paciente existente · N estudios · Último: DATE · Caso: CASE-ID` — the same privacy-safe label convention `PatientsView.tsx` already established (86-F: never the raw `subjectRef`, never a fabricated name). Search filters by `latestCaseId`, never `subjectRef` (86-T, same rule as Stage 85).
- **Nuevo**: a manual `subjectRef` text field (86-E option A) — this already existed as the drawer's own "Referencia interna del estudio (opcional)" input; Stage 86 folds it into the same component instead of keeping two separate, confusing fields. Validated with the **existing** `validateSubjectRef` helper (`src/studyMetadata.ts`) — no new rule (86-H).
- The component's only output is a plain `subjectRef: string` via `onChange` — `NewAnalysisDrawer.tsx` feeds it straight into `metadata.subjectRef`, the same field that was already wired into the real run payload.

## 4. `NewAnalysisDrawer.tsx` changes (86-M)

- Removed `selectedPatient` state, `PatientSelector`, the `patientReady`/`studyIdentityReady` gate on it, and the "Referencia interna del estudio (opcional)" standalone field (now inside `SubjectSelector`).
- Removed `attemptPatientAssociation`/`retryPatientAssociation`, the `AssociationState` type/state, the "Asociando al paciente" progress step, and the association UI section entirely.
- `studyIdentityReady` is now just `caseIdReady` (86-N: subject is optional, matching the domain's own nullable `subjectRef` and the field's pre-existing "(opcional)" label — this also fixes a pre-existing inconsistency where the UI required a Patient even though the underlying field was always optional).
- On a successful run, the drawer now opens the Study directly once the product-analysis extensions finish (`["completed","degraded"].includes(phase)`) — no association step in between.
- Upload/DICOM ingestion (`uploadAiInput`, `uploadStudyArchive`) is completely untouched, per 86-P.

## 5. Existing subject → Study creation (86-D)

Selecting an existing subject sets `metadata.subjectRef` to that subject's real `subjectRef`; it travels in the same `POST /api/ai/multiplanar/run` request as everything else. No second call, no `/api/studies/{caseId}/patient`.

## 6. New subject (86-E)

Option **A** ("usuario ingresa una referencia técnica") was already available in the codebase as the free-text field — Stage 86 reuses it rather than inventing a generation mechanism (B) or deriving one from other metadata (C), both of which the spec said to avoid without a concrete need. No `Patient` is created; the very next Study created with that `subjectRef` establishes the subject for `GET /api/subjects` to pick up automatically (Stage 85's projection).

## 7. Null subject (86-N)

Explicitly permitted: a Study can be created with no `subjectRef` (unchanged domain behavior). No UX change was made to the domain; the pre-existing "(opcional)" labeling already communicated this correctly. This also naturally covers the empty-subject-list case (86-S): "Nuevo análisis" was never disabled by an empty list, since selection was never mandatory.

## 8. Duplicate subject (86-O)

Not a new concept: typing an existing `subjectRef` into the "Nuevo" field simply produces a Study that groups with the existing subject in Stage 85's list/history (case-insensitive, trimmed — same `SubjectListService` rule). No duplicate-detection UI was added; the existing "Paciente existente" search path is the intended way to reuse a subject, and Stage 85's grouping already makes a manually-typed duplicate reference harmless rather than a new record.

## 9. Dead code removed (86-J/86-K/86-X)

Full audit of every remaining reference to the legacy Patient surface:

| File | Classification | Action |
|---|---|---|
| `PatientSelector.tsx` | Superseded by `SubjectSelector.tsx`, zero remaining consumers | **Deleted** |
| `patientStudyAssociation.ts` | Existed only to call the nonexistent association endpoint | **Deleted** |
| `patientApi.ts` | All 8 exported functions traced: every real consumer was `PatientSelector.tsx`/`NewAnalysisDrawer.tsx`/`patientStudyAssociation.ts`, all now gone. Zero real consumers left. | **Deleted** |
| `scripts/patient-pr3-tests.mjs` (43 tests) | Entirely about `patientApi.ts`'s create/search/associate functions and the old selector/association UI | **Deleted** |
| `scripts/playwright-patient-pr3-e2e.mjs` | Real-backend-shaped but fully mocked E2E of the same retired flow | **Deleted** |
| `scripts/patient-pr4-tests.mjs` (Stage 85's trimmed 6 tests) | Tested `patientApi.ts`'s parsing contract — that file is now gone too | **Deleted** |
| `scripts/ui-pr2-study-creation-tests.mjs` | Covers other Worklist/drawer concerns beyond Patient (columns, responsive, progress) — still valid | **Updated** (association-specific tests replaced) |
| `scripts/playwright-ui-pr2-e2e.mjs` | Same — broader Worklist E2E, mocked `/api/patients`/association | **Updated** (mocks removed, `legacyPatient` counter added, subject picked via `GET /api/subjects` mock) |
| `scripts/p8e2-subject-history-tests.mjs` tests `P8-E2.1 D`, N | Asserted the pre-Stage-85 architecture and `patientApi.ts`'s continued existence, both now stale | **Updated** |

Confirmed by a repo-wide search: no remaining import of `patientApi`, no reference to `PatientSelector`/`patientStudyAssociation` outside historical doc comments explicitly noting the retirement.

## 10. Privacy (86-F)

Same policy as Stage 85: the generic `Paciente existente` label, never the raw `subjectRef`, never a fabricated name. Verified live in the browser (§ general report): the raw fixture `subjectRef`s never appeared in any visible text throughout the whole "Nuevo análisis" flow.

## 11. Loading/error/auth (86-Q/86-R/86-S/86-U)

- `SubjectSelector` shows "Buscando pacientes…" while `fetchSubjectList()` is in flight, "No se pudieron buscar pacientes." on failure, and "No se encontraron pacientes." on an empty/filtered result — same convention as `PatientsView.tsx`.
- A stale response is discarded via the same `cancelled` closure pattern already used throughout this codebase's other fetch effects.
- `run()`'s existing `runInFlightRef`/`running` double-submit guard is untouched.
- No new auth was added or needed (`GET /api/subjects` and `POST /api/ai/multiplanar/run` were already behind the same `AuthFilter` default).

## 12. Frontend files new/modified

**New**: `src/features/worklist/SubjectSelector.tsx`, `scripts/post-e50-new-analysis-flow-tests.mjs` (29 tests), `scripts/playwright-post-e50-new-analysis-e2e.mjs`, `docs/post_e50/86_NEW_ANALYSIS_FRONTEND.md` (this file).

**Modified**: `src/features/worklist/NewAnalysisDrawer.tsx` (§4), `package.json` (test script chain), `scripts/ui-pr2-study-creation-tests.mjs`, `scripts/playwright-ui-pr2-e2e.mjs`, `scripts/p8e2-subject-history-tests.mjs`.

**Deleted**: `src/features/worklist/PatientSelector.tsx`, `src/features/worklist/patientStudyAssociation.ts`, `src/patientApi.ts`, `scripts/patient-pr3-tests.mjs`, `scripts/patient-pr4-tests.mjs`, `scripts/playwright-patient-pr3-e2e.mjs`.

## 13. Frontend tests new / regression

29 new tests in `scripts/post-e50-new-analysis-flow-tests.mjs` (exceeds the 25+ target, 86-W) — covering the selector's data source, privacy, search, the removal of the association step, the "sin subject" path, error/loading handling, keyboard semantics, and confirming the retired files are actually gone. Full `npm test` (54 scripts): exit 0. `npx tsc -b`: clean. `npx eslint src`: clean. `npm run build`: succeeds (1917 modules).

## 14. A finding, explicitly out of scope: this Docker stack cannot run a real analysis today

Empirically confirmed via curl against the running `docker-compose.post-e50.yml` stack: `POST /api/ai/inputs` returns `502 UPSTREAM_UNAVAILABLE`. This stack's `mock-ai` service only implements the newer product-analysis pipeline (`/v1/product/analyze`); it has no route for the older multiplanar/upload pipeline (`/inputs`, `/multiplanar/run`, `/v2/multiplanar/run`) that `NewAnalysisDrawer.tsx` still calls. This is a **pre-existing gap in the E2E mock infrastructure**, not something Stage 86 introduced or could fix within its own scope (86-P explicitly forbids touching the upload/AI pipeline). See §15 for how the Docker/Browser E2E evidence was gathered despite this, and the general Stage-86 report for the recommendation.

## 15. Docker E2E / Browser E2E

See the general Stage-86 report for the full step-by-step. Summary: real Docker stack, fresh volume, fixture `PAT-86-A` (Studies A1/A2, then A3 added mid-test), `PAT-86-B` (B1), `PAT-86-C` (new subject, C1) — `GET /api/subjects` and `GET /api/subjects/{subjectRef}/history` correctly reflected every change; a direct DB query confirmed `Study.subject_ref` and the total absence of any `patient`-named table/column. Real-backend Playwright script (`scripts/playwright-post-e50-new-analysis-e2e.mjs`): 11/11 checks passed — `SubjectSelector` loaded real subjects with safe labels, selecting/changing a subject worked, the "Paciente nuevo" mode was available, and `legacyPatientRequests.length === 0` held across the entire session (worklist → drawer → `/pacientes` → historial). The real file-upload/analysis-run step itself was not exercised (§14) — this is the one demo-flow step this stage could not demonstrate end-to-end in this particular stack, for reasons outside its own scope.

## 16. What Stage 86 deliberately does not do

- No `Patient` entity, no migration, no new Backend endpoint.
- Does not touch upload, DICOM ingestion, or the AI multiplanar pipeline itself.
- Does not fix the `mock-ai` service's missing multiplanar/upload routes (§14) — flagged for a future stage, not silently worked around by weakening test coverage.
- No new auth.

## 17. Next stage (87)

- If genuine browser-driven, upload-through-analysis E2E coverage of "Nuevo análisis" is needed, extend `docker/post-e50-mocks/mock-ai.mjs` with the multiplanar/upload routes first — that is test infrastructure, not product code, and was judged out of scope for this stage's own patient-selector cleanup.
- Structured report/export, per the user's own proposed sequencing, now that both `/pacientes` (Stage 85) and "Nuevo análisis" (Stage 86) are free of the legacy Patient dependency.
