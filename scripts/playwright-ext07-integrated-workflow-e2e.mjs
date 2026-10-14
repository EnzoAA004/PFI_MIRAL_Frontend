// EXT-07F: Integrated Clinical Workflow Simulation — isolated Docker E2E.
//
// direct DB seed used only to prepare state (Study A/B/C, corrections, evidence regions); all
// read/render/capture behavior under test uses real product APIs (report, longitudinal
// comparison, feedback capture, series slices) and the real rendered browser app — same
// convention already established and proven in EXT-04A/EXT-04B3.5.
//
// NOT training: this script never touches the AI checkpoint, never calls anything
// retraining-shaped. Feedback capture only persists structured candidates; their `status` stays
// at "captured" unless a later, separate, human-issued call moves it.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "..");
const backendRoot = process.env.EXT07_BACKEND_ROOT ?? resolve(frontendRoot, "..", "PFI_MVPTest_Enzo_Backend_ext07");
const composeFile = resolve(backendRoot, "docker-compose.ext07-e2e.yml");
const backendUrl = process.env.EXT07_BACKEND_URL ?? "http://localhost:8480";
const frontendUrl = process.env.EXT07_FRONTEND_URL ?? "http://localhost:8488";
const project = process.env.EXT07_COMPOSE_PROJECT ?? "pfi-ext07-e2e";
const cycles = Number(process.env.EXT07_E2E_CYCLES ?? "2");

const bannedClinicalTerms = [
  "patología confirmada", "lesión confirmada", "diagnóstico confirmado", "diagnostico confirmado",
  "tratamiento recomendado", "mejoró", "empeoró", "mejoro", "empeoro", "progresión", "deterioro",
  "better", "worse", "improved", "deteriorated",
];

const SAGITTAL_INPUT_ID = "inp_2822bf9640ab40a289050a30ce2fe6fd";

function compose(args, options = {}) {
  return execFileSync("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
    cwd: backendRoot,
    stdio: options.stdio ?? "pipe",
    encoding: options.encoding ?? "utf8",
  });
}

function assertOk(value, message) {
  if (!value) throw new Error(`EXT-07 E2E assertion failed: ${message}`);
}

function near(actual, expected, message, epsilon = 1e-6) {
  assertOk(typeof actual === "number", `${message}: expected number, got ${actual}`);
  assertOk(Math.abs(actual - expected) < epsilon, `${message}: expected ${expected}, got ${actual}`);
}

async function waitFor(url, label, timeoutMs = 120000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

async function authorizedFetch(cycleToken, path, init = {}) {
  return fetch(`${backendUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${cycleToken}`, ...(init.headers ?? {}) } });
}

async function token() {
  const response = await fetch(`${backendUrl}/api/auth/demo-doctor`, { method: "POST" });
  assertOk(response.ok, `demo-doctor returned HTTP ${response.status}`);
  const body = await response.json();
  return body.accessToken;
}

function seedSql(cycle) {
  const now = `2026-09-0${cycle}T12:00:00Z`;
  return `
DELETE FROM domain_studies WHERE case_id LIKE 'EXT07-%';

INSERT INTO domain_studies(id, case_id, status, subject_ref, study_date, modality, description, review_priority, created_at, updated_at) VALUES
('a0000000-0000-4000-8000-00000000000a', 'EXT07-STUDY-A', 'ready', 'EXT07-SUBJECT-001', '2026-01-10', 'MRI', 'EXT-07 synthetic A', 'medium', '${now}', '${now}'),
('b0000000-0000-4000-8000-00000000000b', 'EXT07-STUDY-B', 'ready', 'EXT07-SUBJECT-001', '2026-02-10', 'MRI', 'EXT-07 synthetic B', 'medium', '${now}', '${now}'),
('c0000000-0000-4000-8000-00000000000c', 'EXT07-STUDY-C', 'ready', 'EXT07-SUBJECT-001', '2026-03-10', 'MRI', 'EXT-07 synthetic C', 'medium', '${now}', '${now}'),
('d0000000-0000-4000-8000-00000000000d', 'EXT07-STUDY-NO-RUN', 'ready', 'EXT07-SUBJECT-001', '2026-04-10', 'MRI', 'EXT-07 synthetic, no analysis run', 'medium', '${now}', '${now}'),
('e0000000-0000-4000-8000-00000000000e', 'EXT07-STUDY-FAILED', 'ready', 'EXT07-SUBJECT-001', '2026-04-15', 'MRI', 'EXT-07 synthetic, failed run only', 'medium', '${now}', '${now}'),
('f0000000-0000-4000-8000-00000000000f', 'EXT07-STUDY-CROSS', 'ready', 'EXT07-SUBJECT-CROSS', '2026-02-20', 'MRI', 'EXT-07 synthetic, different subject', 'medium', '${now}', '${now}');

INSERT INTO domain_input_resources(id, study_id, plane, input_id, format, size_bytes, description, weighting, slice_count, multiplanar, derived, analyzable, created_at) VALUES
('a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-00000000000a', 'sagittal', '${SAGITTAL_INPUT_ID}', 'synthetic', 1, 'EXT-07 synthetic sagittal A', 'T2', 1, false, false, true, '${now}'),
('b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-00000000000b', 'sagittal', 'inp_2822bf9640ab40a289050a30ce2fe6fb', 'synthetic', 1, 'EXT-07 synthetic sagittal B', 'T2', 1, false, false, true, '${now}'),
('c0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-00000000000c', 'sagittal', 'inp_2822bf9640ab40a289050a30ce2fe6fc', 'synthetic', 1, 'EXT-07 synthetic sagittal C', 'T2', 1, false, false, true, '${now}');

INSERT INTO domain_study_runs(
  id, study_id, multiplanar_run_id, trace_id, requested_inference_mode, effective_inference_mode,
  sagittal_model_key, axial_model_key, sagittal_artifact_hash, axial_artifact_hash,
  sagittal_run_id, axial_run_id, assets, metrics_snapshot, status, review_status, reviewer, reviewed_at, comments, created_at, updated_at
) VALUES
('a0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-00000000000a', 'EXT07-MULTI-A', 'ext07-trace-a', 'synthetic', 'synthetic', 'ext07-sagittal', '', '', '', 'EXT07-SAG-A', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT07 reviewer', '${now}', 'synthetic', '${now}', '${now}'),
('b0000000-0000-4000-8000-000000000201', 'b0000000-0000-4000-8000-00000000000b', 'EXT07-MULTI-B', 'ext07-trace-b', 'synthetic', 'synthetic', 'ext07-sagittal', '', '', '', 'EXT07-SAG-B', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT07 reviewer', '${now}', 'synthetic corrected', '${now}', '${now}'),
('c0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-00000000000c', 'EXT07-MULTI-C', 'ext07-trace-c', 'synthetic', 'synthetic', 'ext07-sagittal', '', '', '', 'EXT07-SAG-C', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT07 reviewer', '${now}', 'synthetic', '${now}', '${now}');

INSERT INTO domain_ai_analysis_runs(id, study_id, case_id, schema_version, release_id, status, human_review_required, not_clinical_diagnosis, autonomous_diagnosis, trace_id, sagittal_input_id, axial_input_id, warnings, raw_response, created_at, completed_at) VALUES
('a0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-00000000000a', 'EXT07-STUDY-A', 'pfi.ai-product-result.v1', 'ext07-synthetic', 'completed', true, true, false, 'ext07-a', '${SAGITTAL_INPUT_ID}', NULL, '[]'::jsonb, '{}'::jsonb, '2026-01-10T10:00:00Z', '2026-01-10T10:01:00Z'),
('b0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-00000000000b', 'EXT07-STUDY-B', 'pfi.ai-product-result.v1', 'ext07-synthetic', 'completed', true, true, false, 'ext07-b', 'inp_2822bf9640ab40a289050a30ce2fe6fb', NULL, '[]'::jsonb, '{}'::jsonb, '2026-02-10T10:00:00Z', '2026-02-10T10:01:00Z'),
('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000c', 'EXT07-STUDY-C', 'pfi.ai-product-result.v1', 'ext07-synthetic', 'completed', true, true, false, 'ext07-c', 'inp_2822bf9640ab40a289050a30ce2fe6fc', NULL, '[]'::jsonb, '{}'::jsonb, '2026-03-10T10:00:00Z', '2026-03-10T10:01:00Z'),
('e0000000-0000-4000-8000-000000000301', 'e0000000-0000-4000-8000-00000000000e', 'EXT07-STUDY-FAILED', 'pfi.ai-product-result.v1', 'ext07-synthetic', 'failed', true, true, false, 'ext07-failed', NULL, NULL, '["synthetic failed run"]'::jsonb, '{}'::jsonb, '2026-04-15T10:00:00Z', '2026-04-15T10:01:00Z');

INSERT INTO domain_ai_disc_level_results(id, analysis_run_id, rank_index, level, localization_status, localization_source, localization_validated, abstention_preserved, axial_pairing_status, axial_pairing_validated, axial_pairing_experimental, axial_pairing_review_required, degenerative_findings_status, automatic_inference_enabled) VALUES
('a0000000-0000-4000-8000-000000000401', 'a0000000-0000-4000-8000-000000000301', 0, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('b0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000301', 0, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('b0000000-0000-4000-8000-000000000402', 'b0000000-0000-4000-8000-000000000301', 1, 'L3-L4', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('c0000000-0000-4000-8000-000000000401', 'c0000000-0000-4000-8000-000000000301', 0, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true);

-- L3-L4 disc level on B is reviewed rejected -- governs the rejected evidence region below,
-- independent of the run's own accepted review (89-CONT precedent: disc-level review, not
-- run-level, governs a region's discLevelResultId when it has one).
INSERT INTO domain_ai_disc_level_reviews(id, disc_level_result_id, review_status, review_comment, reviewed_by, reviewed_at, updated_at) VALUES
('b0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000402', 'rejected', 'sugerencia de IA descartada', 'dr.reviewer@pfi.local', '${now}', '${now}');

-- majorAxisMm: A=11.9 (ai_original) -> B=12.1 AI, corrected to 12.3 -> C=12.9 (ai_original).
-- Also seeds one incomparable measurement on C (structure='canal', no counterpart on B) to
-- exercise the existing "not comparable" longitudinal path without inventing new logic.
INSERT INTO domain_ai_measurement_results(id, analysis_run_id, disc_level_result_id, plane, level, structure, area_mm2, major_axis_mm, minor_axis_mm, review_required) VALUES
('a0000000-0000-4000-8000-000000000601', 'a0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', NULL, 11.9, 3.0, true),
('b0000000-0000-4000-8000-000000000601', 'b0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', NULL, 12.1, 3.1, true),
('c0000000-0000-4000-8000-000000000601', 'c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', NULL, 12.9, 3.2, true),
('c0000000-0000-4000-8000-000000000602', 'c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'canal', NULL, 180.0, NULL, true);

-- EXT-07C: professional correction of B's measurement (append-only -- 12.1 never overwritten).
INSERT INTO domain_ai_measurement_corrections(id, measurement_id, analysis_run_id, field, original_value, corrected_value, unit, comment, reviewed_by, created_at) VALUES
('b0000000-0000-4000-8000-000000000701', 'b0000000-0000-4000-8000-000000000601', 'b0000000-0000-4000-8000-000000000301', 'majorAxisMm', 12.1, 12.3, 'mm', 'EXT-07 professional synthetic correction', 'dr.reviewer@pfi.local', '2026-02-10T12:00:00Z');

-- Evidence regions -- A: AI suggested with a resolvable baseImage (slice_index=6, matching the
-- run's own sagittal_input_id). B: an AI region later corrected (BBOX -> ELLIPSE, append-only),
-- one professional-authored new finding the AI never suggested, and one AI region rejected via
-- the disc-level review above (must be excluded from visualEvidence). C: an AI region at the
-- SAME level/plane/structure as B's effective one, so the Frontend's before/after can pair them.
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, disc_level_result_id, plane, level, structure, slice_index, origin, geometry_type, geometry, model_id, model_sha256, pipeline_version, experimental, label, authored_by, created_at) VALUES
('a0000000-0000-4000-8000-000000000801', 'a0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', 6, 'ai', 'BBOX', '{"x":100,"y":120,"width":30,"height":20}'::jsonb, 'sagittal_spider', 'sha256:ext07', 'pfi.multiplanar-run.v2', false, 'Región de interés', NULL, '${now}'),
('b0000000-0000-4000-8000-000000000801', 'b0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', 6, 'ai', 'BBOX', '{"x":60,"y":60,"width":20,"height":20}'::jsonb, 'sagittal_spider', 'sha256:ext07', 'pfi.multiplanar-run.v2', false, 'Región de interés', NULL, '${now}'),
('b0000000-0000-4000-8000-000000000802', 'b0000000-0000-4000-8000-000000000301', NULL, 'sagittal', 'L5-S1', 'disc', 12, 'professional', 'POLYGON', '{"points":[{"x":40,"y":40},{"x":60,"y":40},{"x":50,"y":60}]}'::jsonb, NULL, NULL, NULL, false, 'Región de interés', 'dr.reviewer@pfi.local', '2026-02-10T12:05:00Z'),
('b0000000-0000-4000-8000-000000000803', 'b0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000402', 'sagittal', 'L3-L4', 'disc', 20, 'ai', 'BBOX', '{"x":10,"y":10,"width":15,"height":15}'::jsonb, 'sagittal_spider', 'sha256:ext07', 'pfi.multiplanar-run.v2', false, 'Región de interés', NULL, '${now}'),
('c0000000-0000-4000-8000-000000000801', 'c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000401', 'sagittal', 'L4-L5', 'disc', 6, 'ai', 'BBOX', '{"x":102,"y":118,"width":30,"height":20}'::jsonb, 'sagittal_spider', 'sha256:ext07', 'pfi.multiplanar-run.v2', false, 'Región de interés', NULL, '${now}');

INSERT INTO domain_ai_evidence_region_corrections(id, evidence_region_id, analysis_run_id, original_geometry_type, original_geometry, corrected_geometry_type, corrected_geometry, comment, reviewed_by, created_at) VALUES
('b0000000-0000-4000-8000-000000000901', 'b0000000-0000-4000-8000-000000000801', 'b0000000-0000-4000-8000-000000000301', 'BBOX', '{"x":60,"y":60,"width":20,"height":20}'::jsonb, 'ELLIPSE', '{"centerX":70,"centerY":70,"radiusX":12,"radiusY":9}'::jsonb, 'EXT-07 synthetic geometry correction', 'dr.reviewer@pfi.local', '2026-02-10T12:10:00Z');
`;
}

function resetStack() {
  try {
    compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  } catch {
    // First reset may run before the stack exists.
  }
}

function seed(cycle) {
  execFileSync("docker", ["compose", "-p", project, "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", "pfi_ext07", "-d", "pfi_ext07", "-v", "ON_ERROR_STOP=1"], {
    cwd: backendRoot,
    input: seedSql(cycle),
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });
}

async function assertApi(cycleToken) {
  // --- history A/B/C ---
  const historyResponse = await authorizedFetch(cycleToken, "/api/subjects/EXT07-SUBJECT-001/history");
  assertOk(historyResponse.ok, `history returned ${historyResponse.status}`);
  const historyText = JSON.stringify(await historyResponse.json());
  for (const id of ["EXT07-STUDY-A", "EXT07-STUDY-B", "EXT07-STUDY-C"]) assertOk(historyText.includes(id), `history missing ${id}`);

  // --- Study A: no previous study (first chronologically) — must not crash ---
  const reportA = await (await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-A/report")).json();
  assertOk(reportA.longitudinalHistory?.available === false, "Study A must report no available history");

  // --- Study B: AI original preserved, professional correction preserved, effective value correct ---
  const reportB = await (await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/report")).json();
  const measurementB = reportB.measurements.find((m) => m.level === "L4-L5" && m.structure === "disc");
  assertOk(measurementB, "Study B measurement missing");
  near(measurementB.automaticValue, 12.1, "Study B AI original preserved");
  near(measurementB.correctedValue, 12.3, "Study B professional correction preserved");
  near(measurementB.effectiveValue, 12.3, "Study B effective value correct");
  assertOk(measurementB.effectiveSource === "professional_correction", "Study B effective source must be professional_correction");

  // --- Study B visualEvidence: corrected geometry, new finding, rejected excluded ---
  assertOk(Array.isArray(reportB.visualEvidence), "Study B visualEvidence must be an array");
  const correctedRegion = reportB.visualEvidence.find((item) => item.source === "professional_corrected");
  assertOk(correctedRegion && correctedRegion.geometryType === "ELLIPSE", "Study B corrected region must show ELLIPSE (the corrected geometry)");
  const newFinding = reportB.visualEvidence.find((item) => item.source === "professional_drawn");
  assertOk(newFinding, "Study B professional-authored new finding missing");
  assertOk(!reportB.visualEvidence.some((item) => item.level === "L3-L4"), "Study B rejected evidence must not appear in visualEvidence");

  // --- Study C: before/after B->C ---
  const bcResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-C/longitudinal-comparison?baselineCaseId=EXT07-STUDY-B");
  assertOk(bcResponse.ok, `B->C comparison returned ${bcResponse.status}`);
  const bc = await bcResponse.json();
  const bcRow = bc.measurements.find((m) => m.level === "L4-L5" && m.structure === "disc" && m.comparisonStatus === "comparable");
  assertOk(bcRow, "B->C comparable row missing");
  near(bcRow.baseline.effectiveValue, 12.3, "B effective as baseline");
  near(bcRow.current.effectiveValue, 12.9, "C effective value");
  near(bcRow.deltaAbsolute, 0.6, "B->C absolute delta");
  const canalRow = bc.measurements.find((m) => m.structure === "canal");
  assertOk(canalRow && canalRow.comparisonStatus !== "comparable", "canal measurement (no B counterpart) must not be marked comparable");

  // --- structured report on C: history chain, before/after, safety ---
  const reportC = await (await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-C/report")).json();
  assertOk(reportC.schemaVersion === "pfi.study-report.v1", "unexpected schema");
  assertOk(reportC.longitudinalHistory?.available === true, "Study C longitudinalHistory must be available");
  const previousCaseIds = reportC.longitudinalHistory.previousStudies.map((s) => s.caseId);
  assertOk(previousCaseIds.includes("EXT07-STUDY-A") && previousCaseIds.includes("EXT07-STUDY-B"), "Study C history must include A and B");
  const reportBcRow = reportC.longitudinalHistory.comparisons.find((row) => row.previousCaseId === "EXT07-STUDY-B" && row.metric === "majorAxisMm");
  assertOk(reportBcRow, "Study C report must include the B->C comparison row");
  near(reportBcRow.previousEffectiveValue, 12.3, "report previous effective");
  near(reportBcRow.currentEffectiveValue, 12.9, "report current effective");
  near(reportBcRow.absoluteDelta, 0.6, "report absolute delta");

  // --- direct slice check (image real) ---
  const sliceResponse = await authorizedFetch(cycleToken, `/api/ai/series/${SAGITTAL_INPUT_ID}/slices/6`);
  assertOk(sliceResponse.ok, `series slice returned ${sliceResponse.status}`);
  assertOk((sliceResponse.headers.get("content-type") ?? "").startsWith("image/"), "series slice must be an image");

  // --- feedback capture (EXT-07D): capture, idempotency, fields ---
  const captureResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/feedback/capture", { method: "POST" });
  assertOk(captureResponse.ok, `feedback capture returned ${captureResponse.status}`);
  const captured = await captureResponse.json();
  assertOk(captured.length === 3, `expected 3 newly captured feedback candidates, got ${captured.length}`);

  const captureAgainResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/feedback/capture", { method: "POST" });
  const capturedAgain = await captureAgainResponse.json();
  assertOk(capturedAgain.length === 0, "re-running capture must not duplicate candidates");

  const candidatesResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/feedback-candidates");
  const candidates = await candidatesResponse.json();
  assertOk(candidates.length === 3, `expected 3 persisted feedback candidates, got ${candidates.length}`);
  const measurementCandidate = candidates.find((c) => c.source === "measurement");
  near(measurementCandidate.aiOriginalValue, 12.1, "feedback candidate AI original preserved");
  near(measurementCandidate.professionalValue, 12.3, "feedback candidate professional value preserved");
  assertOk(measurementCandidate.status === "captured", "feedback candidate must start as captured");
  const evidenceCandidate = candidates.find((c) => c.source === "evidence_region");
  assertOk(evidenceCandidate.geometryType === "ELLIPSE", "feedback candidate must preserve the corrected geometry type");
  assertOk(evidenceCandidate.aiOriginalGeometry && evidenceCandidate.professionalGeometry, "feedback candidate must preserve both geometries");
  const newFindingCandidate = candidates.find((c) => c.source === "professional_new_finding");
  assertOk(newFindingCandidate && newFindingCandidate.modelId === null, "professional_new_finding candidate must carry no AI provenance");
  const candidatesSerialized = JSON.stringify(candidates);
  assertOk(!candidatesSerialized.includes("dr.reviewer@pfi.local"), "feedback candidate API must never leak reviewedBy");

  // Reject ready_for_training explicitly (never modeled, never auto-assigned).
  const rejectStatusResponse = await authorizedFetch(cycleToken, `/api/feedback-candidates/${measurementCandidate.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ready_for_training" }),
  });
  assertOk(rejectStatusResponse.status === 400, `ready_for_training must be rejected with 400, got ${rejectStatusResponse.status}`);

  const eligibleResponse = await authorizedFetch(cycleToken, `/api/feedback-candidates/${measurementCandidate.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "eligible_for_curation" }),
  });
  assertOk(eligibleResponse.ok, `explicit status transition returned ${eligibleResponse.status}`);
  const eligible = await eligibleResponse.json();
  assertOk(eligible.status === "eligible_for_curation", "explicit human-issued status transition did not apply");

  // --- failure modes ---
  const noRunResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-NO-RUN/report");
  assertOk(noRunResponse.ok, `no-run study report returned ${noRunResponse.status}`);
  const noRunReport = await noRunResponse.json();
  assertOk(noRunReport.reportStatus === "no_effective_analysis", "study without any run must report no_effective_analysis");

  const failedResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-FAILED/report");
  assertOk(failedResponse.ok, `failed-run study report returned ${failedResponse.status}`);
  const failedReport = await failedResponse.json();
  assertOk(failedReport.reportStatus === "no_effective_analysis", "a study whose only run failed must not be treated as effective");

  const crossResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-C/longitudinal-comparison?baselineCaseId=EXT07-STUDY-CROSS");
  assertOk(crossResponse.status === 404, `cross-patient comparison must fail closed with 404, got ${crossResponse.status}`);

  const outOfRangeResponse = await authorizedFetch(cycleToken, `/api/ai/series/${SAGITTAL_INPUT_ID}/slices/9999`);
  assertOk(outOfRangeResponse.status === 400, `out-of-range slice index must fail closed with 400, got ${outOfRangeResponse.status}`);

  const invalidInputIdResponse = await authorizedFetch(cycleToken, "/api/ai/series/not-a-real-input/slices/0");
  assertOk(invalidInputIdResponse.status === 400, `invalid inputId must fail closed with 400, got ${invalidInputIdResponse.status}`);

  // No clinical wording anywhere in what a professional actually reads.
  const lowerAll = JSON.stringify({ reportB, reportC, candidates }).toLowerCase();
  for (const term of bannedClinicalTerms) assertOk(!lowerAll.includes(term.toLowerCase()), `clinical term leaked in API responses: ${term}`);

  return { reportB, reportC, candidates };
}

async function seedBrowserSession(page, cycleToken) {
  await page.addInitScript(({ accessToken }) => {
    const session = {
      accessToken, refreshToken: accessToken, tokenType: "Bearer",
      user: {
        id: "ext07-e2e-doctor", fullName: "Dra. EXT07 E2E", email: "doctor.demo@pfi.local",
        licenseNumber: "MP-EXT07", specialty: "Radiologia", institution: "PFI EXT07 E2E",
        roles: ["ADMIN", "DOCTOR", "REVIEWER"], verified: true, approved: true, onboardingCompleted: true,
      },
    };
    const request = indexedDB.open("lumbar-mri-analysis-storage", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(session), "lumbar-mri-auth-session-v1");
      tx.oncomplete = () => db.close();
    };
  }, { accessToken: cycleToken });
}

async function openBackendReportPanel(page) {
  await page.getByRole("tab", { name: "Contexto" }).click();
  await page.locator("summary", { hasText: "Informe y exportación" }).click();
  await page.getByTestId("backend-study-report").waitFor({ timeout: 30000 });
}

async function assertBeforeAfterAndEvidence(page) {
  const beforeAfter = page.getByTestId("before-after-comparison");
  await beforeAfter.waitFor({ timeout: 30000 });
  const text = await beforeAfter.textContent();
  assertOk(text.includes("2026-02-10") && text.includes("2026-03-10"), "before/after must show previous and current dates");
  assertOk(text.includes("12.30") && text.includes("12.90"), "before/after must show previous and current values");
  assertOk(text.includes("+0.60"), "before/after must show the absolute delta");
  const lower = text.toLowerCase();
  for (const term of bannedClinicalTerms) assertOk(!lower.includes(term.toLowerCase()), `clinical term leaked in before/after: ${term}`);

  const images = beforeAfter.locator('[data-testid="evidence-region-base-img"]');
  const imageCount = await images.count();
  assertOk(imageCount >= 1, "before/after must render at least one real base image");
  for (let i = 0; i < imageCount; i += 1) {
    const size = await images.nth(i).evaluate((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
    assertOk(size.width > 0 && size.height > 0, `before/after image ${i} did not decode`);
  }

  const evidenceList = page.getByTestId("visual-evidence-list");
  await evidenceList.waitFor({ timeout: 30000 });
  const evidenceText = await evidenceList.textContent();
  assertOk(evidenceText.includes("Región sugerida por IA"), "visual evidence section missing on Study C");
}

async function assertBrowser(cycleToken) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await seedBrowserSession(page, cycleToken);
  await page.goto(`${frontendUrl}/estudio/EXT07-STUDY-C`, { waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await assertBeforeAfterAndEvidence(page);

  // Persistence within the same session: reload and re-open the panel.
  await page.reload({ waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await assertBeforeAfterAndEvidence(page);

  await browser.close();
}

async function assertPersistenceAcrossRestart(cycleToken) {
  console.log("EXT-07: restarting backend without deleting the database volume...");
  compose(["restart", "backend"], { stdio: "inherit" });
  await waitFor(`${backendUrl}/api/system/health`, "backend health after restart");

  const historyResponse = await authorizedFetch(cycleToken, "/api/subjects/EXT07-SUBJECT-001/history");
  assertOk(historyResponse.ok, `history after restart returned ${historyResponse.status}`);

  const reportB = await (await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/report")).json();
  const measurementB = reportB.measurements.find((m) => m.level === "L4-L5" && m.structure === "disc");
  near(measurementB.automaticValue, 12.1, "AI original still preserved after restart");
  near(measurementB.effectiveValue, 12.3, "effective value still correct after restart");

  const candidatesResponse = await authorizedFetch(cycleToken, "/api/studies/EXT07-STUDY-B/feedback-candidates");
  const candidates = await candidatesResponse.json();
  assertOk(candidates.length === 3, `feedback candidates must survive restart, got ${candidates.length}`);
  assertOk(candidates.some((c) => c.status === "eligible_for_curation"), "the explicit status change must survive restart");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await seedBrowserSession(page, cycleToken);
  await page.goto(`${frontendUrl}/estudio/EXT07-STUDY-C`, { waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await assertBeforeAfterAndEvidence(page);
  await browser.close();
  console.log("EXT-07: persistence after restart confirmed (no reseed, no volume touched).");
}

async function runCycle(cycle) {
  console.log(`EXT-07 E2E cycle ${cycle}: reset/start`);
  resetStack();
  compose(["up", "-d", "--build"], { stdio: "inherit" });
  await waitFor(`${backendUrl}/api/system/health`, "backend health");
  await waitFor(`${frontendUrl}/env.js`, "frontend env");
  seed(cycle);
  const cycleToken = await token();
  await assertApi(cycleToken);
  console.log(`EXT-07 E2E cycle ${cycle}: browser`);
  await assertBrowser(cycleToken);
  if (cycle === 1) {
    await assertPersistenceAcrossRestart(cycleToken);
  }
  console.log(`EXT-07 E2E cycle ${cycle}: OK`);
}

async function main() {
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await runCycle(cycle);
  }
  compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  console.log(`EXT-07 integrated workflow Docker E2E: ${cycles} cycles OK`);
}

main().catch((error) => {
  console.error(error);
  try {
    compose(["down", "--remove-orphans"], { stdio: "inherit" });
  } catch {
    // Best effort only; do not touch volumes on failure outside explicit cycle reset.
  }
  process.exit(1);
});
