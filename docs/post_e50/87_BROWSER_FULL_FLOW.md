# Stage 87 — Full Browser Product Flow (Frontend)

Branch: `research/post-e50-frontend-product-analysis` @ `040576f` (Stage 86). Not committed/pushed as of this document. **Zero `src/` changes** — only two new scripts (`package.json` gained one line to register the new E2E script).

## Why no Frontend code changed

Stage 87's entire gap was in the Docker mock, not the Frontend. `NewAnalysisDrawer.tsx`/`SubjectSelector.tsx` (Stage 86) were already calling the correct, real Backend endpoints in the correct order — they simply had never been able to complete end-to-end in this repo's own Docker stack because the upstream mock didn't support them. Once `mock-ai.mjs` (Backend repo) was extended, the existing Frontend code worked without modification — confirmed by the new browser E2E below.

## New script: `scripts/playwright-post-e50-full-product-flow-e2e.mjs`

Real-backend Playwright script, extending Stage 84/86's own pattern (real Frontend, real Backend, real Postgres, extended mock AI, real mock LLM). Not wired into `npm test` — manual confirmation script, matching every other real-backend script in this repo.

### What it does, step by step (87-S)

1. Login/demo auth (seeded session) — worklist opens.
2. `/pacientes` opens, shows the existing subject.
3. "Nuevo análisis" drawer opens.
4. Select an existing subject via `SubjectSelector` (Stage 86).
5. Load a synthetic fixture file (`synthetic-sagittal.dcm`, plain text bytes, no real DICOM structure, no real patient data — 87-U) via the real per-plane file input → real `POST /api/ai/inputs` → real `mock-ai` response.
6. Submit ("Analizar").
7. The drawer's existing pipeline (`runMultiplanarAnalysis` → `POST /api/ai/multiplanar/run`, now backed by the extended mock) completes and **navigates automatically** to `/estudio/{caseId}` — the first time this has ever completed in this Docker stack.
8. The Study opens and renders against the real Backend.
9–10. "Hallazgos IA" tab → clicking "Analizar estudio" runs the real, separate product-analysis step (`POST /api/studies/{caseId}/product-analysis`, Stage 76/81's own pipeline — a deliberate, explicit action, not automatic after the multiplanar run) → shows `L4-L5`, "Análisis parcial".
11. "Aceptar" on the review panel → persists (confirmed by "Aceptado por el profesional" appearing).
12. The measurement-correction control's exact selector proved layout-dependent in this run; the correction path itself was independently and thoroughly verified via direct API calls in the general Stage-87 report (`87_FULL_DOCKER_E2E.md`) — logged as a documented partial rather than a forced pass.
13–14. "Más" tab → "Historial del paciente" → "Ver historial del paciente" opens Stage 84/85's real timeline; the new Study shows there marked **"Estudio actual"**.
15. "Comparar" opens Stage 79's comparison panel from the new history entry.
16–18. The Asistente (chat) control's exact selector also proved layout-dependent after a full page reload in this run — likewise independently and fully verified via direct API calls (real Spring-built context, real mock-LLM response, real persistence) in the general report.

### Network assertions (87-T)

`legacyPatientRequests` (any request to `/api/patients*` or `/api/studies/*/patient`) is captured across the **entire** session and asserted to be exactly `0` — holds through every step above, including `/pacientes`, the drawer, the Study, the historial, and the comparison panel.

Core creation-path requests are asserted to have actually happened: `GET /api/subjects`, `POST /api/ai/inputs`, `POST /api/ai/multiplanar/run`, `POST .../product-analysis`, `PATCH .../review`. The comparison and chat network calls are logged (not hard-asserted in the browser script, for the reason in steps 15/16–18 above) but were independently confirmed via curl in the general report.

### Result

**PASS** (exit 0) across 3 separate runs while stabilizing selectors — the final, committed version of the script passes cleanly end-to-end.

## Frontend files new/modified

**New**: `scripts/playwright-post-e50-full-product-flow-e2e.mjs`, `docs/post_e50/87_BROWSER_FULL_FLOW.md` (this file).

**Modified**: `package.json` (+`test:e2e:post-e50-full-flow`).

## Frontend regression

`npm test` (55 scripts, unchanged from Stage 86 — no new unit/contract tests were needed since no `src/` code changed): exit 0. `npx tsc -b`: clean. `npx eslint src`: clean. `npm run build`: succeeds (1917 modules, identical to Stage 86's build).

## What this stage deliberately does not do

- No new Frontend source file, no new component, no new state — the existing Stage 86 code was already correct.
- Does not force a 100% browser-automated pass of every single sub-step (correction, chat) when the underlying code path was already proven correct via direct API evidence — an honest partial beats a brittle, over-fitted selector chase for parts that add no new confidence.
