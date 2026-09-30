# EXT-04B3 / EXT-04B3.5 — Visual Evidence Frontend + Image Context

Branch: `extensions/ext-04-visual-evidence-frontend`, created from `6e25a3c` (EXT-04A,
`extensions/ext-04-report-enrichment-frontend`) — **not** from
`research/post-e50-frontend-product-analysis`, whose working tree carries unrelated Stage 89
changes that must not be touched. Backend reference: `extensions/ext-04-visual-evidence-backend`
— read-only at `37bc4c1` for EXT-04B3; EXT-04B3.5 added a small, additive Backend change on that
same branch (see below) via a dedicated worktree, never touching Backend production behavior
beyond the new `baseImage` field.

Read-only iteration: shows AI-suggested and professional visual regions already computed by the
Backend. No drawing, dragging, resizing, or region creation (EXT-04B5).

## Git strategy

`research/post-e50-frontend-product-analysis`'s working tree has uncommitted Stage 89 changes
(`package.json`, `scripts/p9c4-canonical-closure-tests.mjs`, plus two untracked files) that must
survive untouched. Checking out a different branch in that same working tree risks them, so this
iteration used `git worktree add -b extensions/ext-04-visual-evidence-frontend <path> 6e25a3c`
instead — a second, fully independent working tree at the same commit, sharing the repository's
object store and refs but never touching the original working tree's index or files. Confirmed
before starting (`git status` in the original tree, before and after) that the Stage 89 changes
were unaffected.

## Backend contract actually consumed

Audited directly from the Backend source at `37bc4c1` (`git show`), not the EXT-04B1 design
draft, which used different names in places:

- `StudyReportDto.visualEvidence: List<VisualEvidenceSummary>` — additive, **always** an array
  (empty when there is nothing to show, never `null`/omitted).
- `VisualEvidenceSummary(evidenceId, plane, level, structure, geometryType, geometry, source,
  reviewStatus, label, warning, experimental)`.
- `geometryType` ∈ `BBOX | ELLIPSE | POLYGON | MASK_REFERENCE`; `geometry` is a plain map,
  always already in the canonical normalised **0..256** basis
  (`EvidenceCoordinateNormalizer`/`EvidenceGeometry.CANONICAL_MIN/MAX`) — the same basis
  `ReviewerAnnotation`/`MeasurementLayer` already render in:
  - `BBOX`: `{x, y, width, height}`
  - `ELLIPSE`: `{centerX, centerY, radiusX, radiusY}`
  - `POLYGON`: `{points: [{x, y}, ...]}` (≥3 points)
  - `MASK_REFERENCE`: `{runId, plane, assetName}` — never inline pixel data, resolved through
    the existing `/api/ai/assets/{runId}/{plane}/{assetName}` endpoint.
- `source` ∈ `ai_suggested | ai_validated | professional_corrected | professional_drawn` — the
  four EXT-04B1 DERIVED concepts (`DerivedEvidenceOrigin`), computed by
  `EffectiveAnnotationResolver`/`StudyReportService.toVisualEvidenceSummary`, **never** an
  independently persisted state. Note the DTO's actual literal for "professional validated" is
  `"ai_validated"`, not `"professional_validated"` — a naming detail that only shows up by
  reading `StudyReportService.toVisualEvidenceSummary`'s `switch`, not the enum name itself.
- `warning` is only ever non-null for `ai_suggested` (`"Sugerencia de IA sin revisión
  profesional."`), set by the Backend — this Frontend never invents its own warning text.
- **Not present** in `VisualEvidenceSummary`, despite existing on the domain-level
  `AiEvidenceRegion`: `modelId`, `modelSha256`, `pipelineVersion`, `confidence`,
  `analysisRunId`, `sliceIndex`, `reviewedBy`/`authoredBy`. See "Limitations" below.

## Types / parser

- `src/contracts/visualEvidenceTypes.ts` (new): a closed `EvidenceGeometry` union
  (`EvidenceGeometryBbox | EvidenceGeometryEllipse | EvidenceGeometryPolygon |
  EvidenceGeometryMaskReference`) mirroring the Backend's `sealed interface EvidenceGeometry`,
  and `VisualEvidenceItem`. No `any`/`Record<string, any>` anywhere in this module.
- `src/studyReportApi.ts`: `parseEvidenceGeometry(geometryType, geometry)` mirrors
  `EvidenceGeometry.fromMap` field-for-field, including the same 0..256 range check
  `EvidenceCoordinateNormalizer` guarantees on write — returns `null` (never throws) for an
  unknown `geometryType`, a malformed map, or an out-of-range coordinate.
  `parseVisualEvidenceItem`/`parseVisualEvidence` are tolerant by design: `undefined`/`null`/
  non-array → `[]`; an individual item whose geometry doesn't parse is silently dropped, never
  aborting the rest of the report. Wired into `parseStudyReport` as
  `visualEvidence: parseVisualEvidence(raw.visualEvidence)`.
- `src/contracts/studyReportTypes.ts`: `StudyReport.visualEvidence: VisualEvidenceItem[]` added,
  additive (existing fields untouched).

## Geometry rendering

`src/features/reading/EvidenceRegionOverlay.tsx` (new component) + `MASK_REFERENCE` URL builder
and labels in `src/features/reading/visualEvidenceDisplay.ts` (new).

Rendering reuses `MeasurementLayer.tsx`'s own convention rather than inventing a second one:
an SVG with `viewBox="0 0 256 256" preserveAspectRatio="none"`, absolutely positioned
(`position:absolute; inset:0; width/height:100%`) over its frame — the browser does the
0..256-to-viewport scaling, so this component never computes a CSS pixel position itself and
keeps working when the container is resized.

- `BBOX` → `<rect>`
- `ELLIPSE` → `<ellipse>`
- `POLYGON` → `<polygon>`
- `MASK_REFERENCE` → the referenced raster asset itself (`<img>` at
  `evidenceMaskAssetUrl(runId, plane, assetName)`, built only from the three already-parsed,
  already-validated identifiers — never a raw URL from the report JSON, and never a filesystem
  path). There is no additional vector shape drawn on top of it: the mask image *is* the
  geometry.

## Coordinate handling

No DICOM-physical re-interpretation, and no second normalisation: the parser passes the
Backend's already-canonical 0..256 numbers straight through, and the renderer's `viewBox`
scales them to whatever container size CSS gives it. This is the same mechanism
`MeasurementLayer.tsx` already relies on — no new coordinate transform was introduced.

## Asset loading / security

- Base image for `MASK_REFERENCE` items only: `evidenceMaskAssetUrl` builds
  `${API_BASE_URL}/api/ai/assets/{runId}/{plane}/{assetName}` from three identifiers the parser
  already validated (including the same path-traversal guard `EvidenceGeometry.MaskReference`'s
  compact constructor enforces on the Backend: reject if `runId`/`assetName` contain `..`, `/`,
  or `\`). Never accepts or forwards an arbitrary URL from the JSON.
- `aiAssetUrl` in `multiplanarApi.ts` was **not** reused directly: its `assetName` parameter is
  typed to the closed multiplanar-run vocabulary (`"input.png" | "overlay.png" |
  "mask-preview.png"`), which a `MASK_REFERENCE`'s free-form (but guarded) `assetName` does not
  necessarily satisfy. `evidenceMaskAssetUrl` duplicates the same URL template with a
  correctly-scoped type instead of widening that existing type.

## Derived states / visual language

Labels (`displayEvidenceSource` in `visualEvidenceDisplay.ts`), verbatim as requested:

| `source` (Backend) | Label shown |
|---|---|
| `ai_suggested` | "Región sugerida por IA" |
| `ai_validated` | "Región revisada por profesional" |
| `professional_corrected` | "Región corregida por profesional" |
| `professional_drawn` | "Región creada por profesional" |

No independent state machine is modeled — `source` is displayed as-is, never re-derived from
`reviewStatus`/`experimental` on the Frontend (that derivation already happened on the Backend,
per EXT-04B1 principle 1).

## Experimental / warning handling

`item.experimental` → an "Experimental" badge (`EXPERIMENTAL_BADGE_TEXT`), always shown
alongside the source label, never replacing it. `item.warning` (only ever non-null for
`ai_suggested`) is rendered as its own line. Neither is elevated or reinterpreted as validated —
this Frontend never sets or clears `experimental` itself; it only displays whatever the Backend
sent.

## Colours

`--ai` (already the app-wide "AI origin" token, e.g. `.mri-measure-ai`) for `ai_suggested`
regions, `--clinical-accent` for the three professional-derived sources, `--warning` for the
experimental badge — the same token the rest of the app already uses for "needs attention
before trusting this," not a severity scale. AI regions are additionally dashed
(`stroke-dasharray: 4 2`), professional regions solid — origin is never colour-only (mirrors
`.mri-measure-ai`'s own precedent of pairing colour with stroke style).

## Provenance

Only what the real DTO sends is shown: `source`, `reviewStatus`, `experimental`, `label`,
`level`, `plane`, `structure`. `evidenceAriaLabel` composes a screen-reader-first string, e.g.
"Región sugerida por IA — L4-L5 — Sagital — experimental". No reviewer identity, model SHA,
paths, tokens, hostnames, or DICOM UIDs are ever rendered — verified by test 14/15 (the parsed
`VisualEvidenceItem` object has no `modelId`/`reviewedBy`/`authoredBy` key even when a raw JSON
payload maliciously or accidentally includes them).

## Structured report integration

`StudyReviewView.tsx`'s existing "Informe / exportación" panel gained an "Evidencia visual"
section (`data-testid="visual-evidence-list"` / `data-testid="visual-evidence-empty"`), placed
after "Warnings / limitations" and before "Exportar desde Backend" — following the panel's
existing `rr-section-title` convention rather than a new sub-component wrapper. Renders one
`EvidenceRegionOverlay` per item, or `NO_VISUAL_EVIDENCE_MESSAGE` ("No hay evidencia visual
disponible para este análisis.") treated as a normal state, not an error.

## Accessibility

- `aria-label` on the whole figure and on the image frame (`role="img"`), composed by
  `evidenceAriaLabel` — never colour-dependent.
- Text badges/labels always accompany colour (`evidence-region-badge` text + the dashed/solid
  stroke distinction).
- No `tabIndex` on the frame: it is genuinely non-interactive in this read-only iteration
  (`role="img"` is not a focusable role; ESLint's `jsx-a11y/no-noninteractive-tabindex`
  confirmed this during development).

## Responsive

The frame is `aspect-ratio: 1/1` with `width: min(220px, 100%)`, and the SVG's
`preserveAspectRatio="none"` viewBox scales automatically with it — the same mechanism the main
MRI viewer already relies on for zoom. Not separately tested at a mobile breakpoint in this
iteration (no dedicated mobile layout requirement was given for the report panel, which already
scrolls as a `<details>` section).

## Tests

`scripts/ext04b3-visual-evidence-tests.mjs` (new, wired into `npm test` as
`test:ext04b3-visual-evidence`), following the existing transpile-and-vm-load convention used by
`scripts/post-e50-structured-report-tests.mjs` (this repo has no jsdom/testing-library/vitest —
all "tests" here exercise pure parser/display functions, not rendered JSX; the same precedent
`MeasurementLayer.tsx` itself sets by having no direct test file, only its logic helpers tested).
28 checks, all passing (21 from EXT-04B3 + 7 added for EXT-04B3.5's `baseImage`), covering:
evidence absent/`null`; BBOX/ELLIPSE/POLYGON/MASK_REFERENCE parsing (plus a path-traversal-
rejection case); unknown-geometry fail-safe (one bad region dropped, not the report); all four
derived-source labels; experimental badge survives parsing; no clinical wording in any label/
message; provenance fields never exposed; reviewer id never exposed; coordinates stay in the
0..256 basis (no CSS-pixel conversion, no silent clamping of an out-of-range value); report
integration; multiple regions preserved; the parser never invents regions Backend didn't send;
backward compatibility with a pre-EXT-04B2 report (`visualEvidence` key absent entirely);
accessible aria-label composition; `baseImage` parsing (valid, absent/null, malformed
sliceIndex/inputId — all fail-safe to `null`); backward compatibility with a pre-EXT-04B3.5 item
(`baseImage` key absent); `evidenceBaseImageSliceUrl` builds the real
`/api/ai/series/{inputId}/slices/{index}` URL.

### E2E — executed, 2/2 cycles green

`docker-compose.ext04b3-e2e.yml` (Backend worktree) + `scripts/playwright-ext04b3-visual-
evidence-e2e.mjs` (this worktree), modeled directly on EXT-04A's own proven
`docker-compose.ext-e2e.yml`/`playwright-ext04a-longitudinal-e2e.mjs` — distinct project name
(`pfi-ext04b3-e2e`), ports (8380/8388/55415), network, and volume, so it can run alongside the
EXT-04A harness without conflict; the historical `docker-compose.ext-e2e.yml` was not touched.
Adds a `mock-ai` service (`docker/post-e50-mocks/mock-ai.mjs`, built from the `extensions/
ext-04-visual-evidence-backend` branch) so `GET /api/ai/series/{inputId}/slices/{index}` has
something real to proxy to; `PFI_AI_SERVICE_URL` points at it. Seeds `EXT04B-VISUAL-01` (4
regions: BBOX ai_suggested+experimental with a resolvable `baseImage`, a region corrected to
ELLIPSE → professional_corrected, a POLYGON professional_drawn, and a `sliceIndex`-less region
to exercise the "Imagen base no disponible." fallback), `EXT04B-VISUAL-EMPTY` (no regions,
exercises the "No hay evidencia visual disponible" fallback), and `EXT04B-VISUAL-MALICIOUS`
(one region with a path-traversal payload inserted directly via SQL — see "Security" below) —
all via raw `psql` `INSERT`s against `domain_ai_evidence_regions`/
`domain_ai_evidence_region_corrections` (plus, as of the real run below, `domain_studies`/
`domain_ai_analysis_runs`/`domain_input_resources`/`domain_study_runs`), explicitly **test
setup only**: every assertion in the script reads through real product APIs (`GET /api/studies/
{caseId}/report`, `GET /api/ai/series/{inputId}/slices/{index}`) and the real rendered browser
app, never a mocked response. Runs 2 full cycles (reset → up → seed → API assertions → browser
assertions at two viewports, plus a `page.reload()` persistence check), then tears the stack
down (`down -v`, scoped to its own named volume only).

**Executed for real in this session, after Docker Desktop's engine became available.** Two real,
harness-only bugs were found and fixed along the way (never product code — see the checklist
below):

1. `docker/post-e50-mocks/mock-ai.mjs` at this Backend branch's own commit lineage predates the
   Stage 89-CONT fix (on a *different*, uncommitted working tree) that added `GET /inputs/
   {inputId}/slices/{index}` — so the very first real run 404'd on that route. Ported the
   already-proven route (same fixed 1×1 PNG, same stateless behavior) into this branch's mock
   as harness-only test setup.
2. The Reading Room workspace only renders its tab bar (where the report panel with the
   evidence section lives) once a Study has a canonical run — `domain_input_resources`/
   `domain_study_runs` rows, which the seed initially omitted (unlike EXT-04A's own proven
   fixture, which always includes them). Added matching rows for `EXT04B-VISUAL-01`/`-EMPTY`.

With both fixed, **2/2 cycles passed** — API assertions (report shape, all four sources incl.
`baseImage`, the direct `/api/ai/series/.../slices/6` call, the out-of-range-index 400, the
empty-evidence report, the malicious-fixture fail-closed check) and browser assertions (real
decoded image, `naturalWidth`/`naturalHeight` > 0, SVG `viewBox="0 0 256 256"` mounted inside
the same frame as the image, all four labels, the experimental badge, the AI-suggested warning,
the "Imagen base no disponible." fallback, the empty-evidence fallback) at both 1280×800 and
800×700, plus persistence across a full `page.reload()` — for both cycles, from a clean
`down -v` reset each time. Final teardown left no `pfi-ext04b3-*` container/network/volume
behind (verified with `docker ps -a`/`docker volume ls`/`docker network ls`).

Full regression also run and green: `npx tsc -b`, `npx eslint src --ext .ts,.tsx`, `npm test`
(all pre-existing suites, unchanged, plus the new one — 742 checks total), `npm run build`,
`git diff --check`.

## EXT-04B3.5 — image context resolved

The EXT-04B3 limitation above ("no base slice image for BBOX/ELLIPSE/POLYGON") is now closed.

**Backend change** (worktree `PFI_MVPTest_Enzo_Backend_ext04b3`, branch
`extensions/ext-04-visual-evidence-backend`, on top of `37bc4c1`): audited before writing any
code (`AiEvidenceRegion` already has `analysisRunId`/`plane`/`sliceIndex`; the existing asset
endpoint `GET /api/ai/assets/{runId}/{plane}/{assetName}` turned out to key on a *different*
pipeline's `planeRunId` — `AiProductAnalysisRun` has no such id, only `sagittalInputId`/
`axialInputId`, the same opaque identifier the already-existing
`GET /api/ai/series/{inputId}/slices/{index}` endpoint already validates and serves). Added
`StudyReportDto.VisualEvidenceSummary.baseImage: BaseImageRef(String inputId, Integer
sliceIndex)` — additive, nullable, resolved in `StudyReportService.baseImageRef(region, run)`
from `run.sagittalInputId()`/`run.axialInputId()` (by `region.plane()`) and
`region.sliceIndex()`. `null` (never fabricated) when the region has no `sliceIndex`, an
unrecognised `plane`, or the run has no inputId for that plane. See
`EXT_04B_BACKEND_FOUNDATION.md` "Image context (EXT-04B3.5)" for the full trace. No new asset
mechanism, no change to geometry/coordinate/review/append-only logic.

**Frontend change** (this worktree, unchanged branch): `EvidenceBaseImageRef` type +
`parseEvidenceBaseImage` (tolerant: missing/null/malformed → `null`, same rule as the rest of
this parser) in `visualEvidenceTypes.ts`/`studyReportApi.ts`. `evidenceBaseImageSliceUrl` in
`visualEvidenceDisplay.ts` builds the same `GET /api/ai/series/{inputId}/slices/{index}` URL the
multi-slice viewer already calls (Stage 87/89) — no new endpoint, no URL from the JSON.

**Real bug found and fixed while wiring this**: `EvidenceRegionOverlay.tsx`'s EXT-04B3 draft
rendered the `MASK_REFERENCE` asset as a plain `<img src={backendUrl}>`. That never actually
works against a real Backend — the assets endpoint requires an `Authorization` header, which a
bare `<img>` tag cannot send, so the request would 401 before ever reaching this session's own
mock. Fixed by routing both `MASK_REFERENCE` and the new `baseImage` slice through
`useAuthenticatedImageUrl` (`authenticatedAssets.ts`) — the same authenticated-fetch/object-URL/
cache mechanism `MriSliceViewer.tsx` already uses for every other protected asset. This was only
caught because this iteration finally exercised a real image end-to-end; the EXT-04B3 unit tests
alone could not have caught it (they never touch `fetch`).

`NO_BASE_IMAGE_MESSAGE = "Imagen base no disponible."` renders whenever `resolveBaseImageUrl`
returns `undefined` (no `baseImage` and not a `MASK_REFERENCE`) — a normal state, not an error.

## Limitations (decisions pending for EXT-04B4/EXT-04B5)

1. **Resolved — Docker E2E executed, 2/2 cycles green.** See "EXT-04B3.5 → E2E" above for the
   full account, including the two harness-only bugs (missing mock route; missing canonical-run
   seed rows) found and fixed to get there.
2. **No live-viewer overlay yet.** This iteration only integrates evidence into the Structured
   Report panel, not into the interactive `MriSliceViewer`/`MeasurementLayer` slice-by-slice
   view (which *does* have image/plane/index context available). `EvidenceRegionOverlay` was
   built as a self-contained, reusable component specifically so a later iteration can render it
   there too without rework.
3. **EXT-04B1's ingestion path is still unwired.** Per the EXT-04B2 commit message,
   `EvidenceRegionIngestionService` has no controller yet — there is currently no way to create
   real `AiEvidenceRegion` rows through the running product except by writing directly to
   Postgres, explicitly sanctioned as TEST SETUP ONLY for the EXT-04B3.5 E2E harness (per the
   iteration's own instructions) — never as a productive endpoint. A real ingestion flow belongs
   after EXT-04B2/EXT-04B5 get their controller.
4. **MASK_REFERENCE has no additional vector shape drawn on top of it** — the mask itself is
   already the rendered raster asset (not vector geometry this component controls), so there is
   nothing more to overlay in this iteration. (The earlier limitation about it being a plain,
   unauthenticated `<img>` is resolved — see "EXT-04B3.5" above.)
5. No dedicated mobile-breakpoint visual QA beyond the two E2E viewport sizes the Playwright
   script actually exercised and passed (1280×800 desktop, 800×700 reduced) — no true
   mobile-width (<768px) layout was designed or tested.
