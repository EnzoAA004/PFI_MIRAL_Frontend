import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "..");
const backendRoot = process.env.EXT04_BACKEND_ROOT ?? resolve(frontendRoot, "..", "PFI_MVPTest_Enzo_Backend");
const composeFile = resolve(backendRoot, "docker-compose.ext-e2e.yml");
const backendUrl = process.env.EXT04_BACKEND_URL ?? "http://localhost:8280";
const frontendUrl = process.env.EXT04_FRONTEND_URL ?? "http://localhost:8288";
const project = process.env.EXT04_COMPOSE_PROJECT ?? "pfi-ext04-e2e";
const cycles = Number(process.env.EXT04_E2E_CYCLES ?? "2");

const bannedClinicalTerms = [
  "better",
  "worse",
  "improved",
  "deteriorated",
  "progression",
  "mejoró",
  "empeoró",
  "progresión",
  "deterioro",
];

function compose(args, options = {}) {
  return execFileSync("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
    cwd: backendRoot,
    stdio: options.stdio ?? "pipe",
    encoding: options.encoding ?? "utf8",
  });
}

function assertOk(value, message) {
  if (!value) throw new Error(`EXT-04A E2E assertion failed: ${message}`);
}

function near(actual, expected, message, epsilon = 1e-9) {
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

async function authorizedFetch(token, path, init = {}) {
  return fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function token() {
  const response = await fetch(`${backendUrl}/api/auth/demo-doctor`, { method: "POST" });
  assertOk(response.ok, `demo-doctor returned HTTP ${response.status}`);
  const body = await response.json();
  assertOk(typeof body.accessToken === "string" && body.accessToken.length > 20, "missing accessToken");
  return body.accessToken;
}

function seedSql(cycle) {
  const now = `2026-09-0${cycle}T12:00:00Z`;
  return `
DELETE FROM domain_studies WHERE case_id LIKE 'EXT04-%';

INSERT INTO domain_studies(id, case_id, status, subject_ref, study_date, modality, description, review_priority, created_at, updated_at) VALUES
('00000000-0000-4000-8000-00000000000a', 'EXT04-STUDY-A', 'ready', 'EXT04-SUBJECT-A', '2026-01-10', 'MRI', 'EXT-04 synthetic A', 'medium', '${now}', '${now}'),
('00000000-0000-4000-8000-00000000000b', 'EXT04-STUDY-B', 'ready', 'EXT04-SUBJECT-A', '2026-03-10', 'MRI', 'EXT-04 synthetic B', 'medium', '${now}', '${now}'),
('00000000-0000-4000-8000-00000000000c', 'EXT04-STUDY-C', 'ready', 'EXT04-SUBJECT-A', '2026-06-10', 'MRI', 'EXT-04 synthetic C', 'medium', '${now}', '${now}'),
('00000000-0000-4000-8000-00000000000d', 'EXT04-STUDY-ZERO', 'ready', 'EXT04-SUBJECT-A', '2025-11-10', 'MRI', 'EXT-04 synthetic zero baseline', 'medium', '${now}', '${now}'),
('00000000-0000-4000-8000-00000000000e', 'EXT04-STUDY-NO-HISTORY', 'ready', 'EXT04-SUBJECT-NO-HISTORY', '2026-07-10', 'MRI', 'EXT-04 synthetic no history', 'medium', '${now}', '${now}'),
('00000000-0000-4000-8000-00000000000f', 'EXT04-STUDY-CROSS', 'ready', 'EXT04-SUBJECT-CROSS', '2026-02-10', 'MRI', 'EXT-04 synthetic cross subject', 'medium', '${now}', '${now}');

INSERT INTO domain_input_resources(id, study_id, plane, input_id, format, size_bytes, description, weighting, slice_count, multiplanar, derived, analyzable, created_at) VALUES
('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'sagittal', 'ext04-input-a', 'synthetic', 1, 'Synthetic sagittal A', 'T2', 1, false, false, true, '${now}'),
('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'sagittal', 'ext04-input-b', 'synthetic', 1, 'Synthetic sagittal B', 'T2', 1, false, false, true, '${now}'),
('10000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000c', 'sagittal', 'ext04-input-c', 'synthetic', 1, 'Synthetic sagittal C', 'T2', 1, false, false, true, '${now}'),
('10000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000d', 'sagittal', 'ext04-input-zero', 'synthetic', 1, 'Synthetic sagittal zero', 'T2', 1, false, false, true, '${now}'),
('10000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000e', 'sagittal', 'ext04-input-no-history', 'synthetic', 1, 'Synthetic sagittal no history', 'T2', 1, false, false, true, '${now}'),
('10000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-00000000000f', 'sagittal', 'ext04-input-cross', 'synthetic', 1, 'Synthetic sagittal cross', 'T2', 1, false, false, true, '${now}');

INSERT INTO domain_study_runs(
  id, study_id, multiplanar_run_id, trace_id, requested_inference_mode, effective_inference_mode,
  sagittal_model_key, axial_model_key, sagittal_artifact_hash, axial_artifact_hash,
  sagittal_run_id, axial_run_id, assets, metrics_snapshot, status, review_status, reviewer, reviewed_at, comments, created_at, updated_at
) VALUES
('20000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'EXT04-MULTI-A', 'ext04-trace-a', 'synthetic', 'synthetic', 'ext04-sagittal', '', '', '', 'EXT04-SAG-A', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[{"id":"legacy-a","label":"Disc height","level":"L4-L5","value":11.9,"unit":"mm"}]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT04 reviewer', '${now}', 'synthetic', '${now}', '${now}'),
('20000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'EXT04-MULTI-B', 'ext04-trace-b', 'synthetic', 'synthetic', 'ext04-sagittal', '', '', '', 'EXT04-SAG-B', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[{"id":"legacy-b","label":"Disc height","level":"L4-L5","value":12.1,"unit":"mm"}]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT04 reviewer', '${now}', 'synthetic corrected', '${now}', '${now}'),
('20000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000c', 'EXT04-MULTI-C', 'ext04-trace-c', 'synthetic', 'synthetic', 'ext04-sagittal', '', '', '', 'EXT04-SAG-C', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[{"id":"legacy-c","label":"Disc height","level":"L4-L5","value":12.9,"unit":"mm"}]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT04 reviewer', '${now}', 'synthetic', '${now}', '${now}');

INSERT INTO domain_ai_analysis_runs(id, study_id, case_id, schema_version, release_id, status, human_review_required, not_clinical_diagnosis, autonomous_diagnosis, trace_id, sagittal_input_id, axial_input_id, warnings, raw_response, created_at, completed_at) VALUES
('30000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'EXT04-STUDY-A', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-a', 'ext04-input-a', NULL, '[]'::jsonb, '{}'::jsonb, '2026-01-10T10:00:00Z', '2026-01-10T10:01:00Z'),
('30000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000000a', 'EXT04-STUDY-A', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'failed', true, true, false, 'ext04-a-failed', 'ext04-input-a', NULL, '["synthetic failed run"]'::jsonb, '{}'::jsonb, '2026-01-10T11:00:00Z', '2026-01-10T11:01:00Z'),
('30000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'EXT04-STUDY-B', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-b', 'ext04-input-b', NULL, '[]'::jsonb, '{}'::jsonb, '2026-03-10T10:00:00Z', '2026-03-10T10:01:00Z'),
('30000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000c', 'EXT04-STUDY-C', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-c', 'ext04-input-c', NULL, '[]'::jsonb, '{}'::jsonb, '2026-06-10T10:00:00Z', '2026-06-10T10:01:00Z'),
('30000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000d', 'EXT04-STUDY-ZERO', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-zero', 'ext04-input-zero', NULL, '[]'::jsonb, '{}'::jsonb, '2025-11-10T10:00:00Z', '2025-11-10T10:01:00Z'),
('30000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000e', 'EXT04-STUDY-NO-HISTORY', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-no-history', 'ext04-input-no-history', NULL, '[]'::jsonb, '{}'::jsonb, '2026-07-10T10:00:00Z', '2026-07-10T10:01:00Z'),
('30000000-0000-4000-8000-00000000000f', '00000000-0000-4000-8000-00000000000f', 'EXT04-STUDY-CROSS', 'pfi.ai-product-result.v1', 'ext04-synthetic', 'completed', true, true, false, 'ext04-cross', 'ext04-input-cross', NULL, '[]'::jsonb, '{}'::jsonb, '2026-02-10T10:00:00Z', '2026-02-10T10:01:00Z');

INSERT INTO domain_ai_disc_level_results(id, analysis_run_id, rank_index, level, localization_status, localization_source, localization_validated, abstention_preserved, axial_pairing_status, axial_pairing_validated, axial_pairing_experimental, axial_pairing_review_required, degenerative_findings_status, automatic_inference_enabled) VALUES
('40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-00000000000c', '30000000-0000-4000-8000-00000000000c', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-00000000000d', '30000000-0000-4000-8000-00000000000d', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-00000000000e', '30000000-0000-4000-8000-00000000000e', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-00000000000f', '30000000-0000-4000-8000-00000000000f', 1, 'L4-L5', 'localized', 'synthetic', true, false, 'not_required', true, false, false, NULL, true),
('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-00000000000c', 2, NULL, 'unresolved', 'synthetic', false, true, 'not_required', false, false, false, NULL, true);

INSERT INTO domain_ai_measurement_results(id, analysis_run_id, disc_level_result_id, plane, level, structure, area_mm2, major_axis_mm, minor_axis_mm, review_required) VALUES
('50000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-00000000000a', '40000000-0000-4000-8000-00000000000a', 'sagittal', 'L4-L5', 'disc', NULL, 11.9, 3.0, true),
('50000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', '40000000-0000-4000-8000-00000000000b', 'sagittal', 'L4-L5', 'disc', NULL, 12.1, 3.1, true),
('50000000-0000-4000-8000-00000000000c', '30000000-0000-4000-8000-00000000000c', '40000000-0000-4000-8000-00000000000c', 'sagittal', 'L4-L5', 'disc', NULL, 12.9, 3.2, true),
('50000000-0000-4000-8000-00000000000d', '30000000-0000-4000-8000-00000000000d', '40000000-0000-4000-8000-00000000000d', 'sagittal', 'L4-L5', 'disc', NULL, 0.0, 2.9, true),
('50000000-0000-4000-8000-00000000000e', '30000000-0000-4000-8000-00000000000e', '40000000-0000-4000-8000-00000000000e', 'sagittal', 'L4-L5', 'disc', NULL, 10.0, 3.0, true),
('50000000-0000-4000-8000-00000000000f', '30000000-0000-4000-8000-00000000000f', '40000000-0000-4000-8000-00000000000f', 'sagittal', 'L4-L5', 'disc', NULL, 99.0, 3.0, true),
('50000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-00000000000c', '40000000-0000-4000-8000-000000000010', 'sagittal', NULL, 'disc', NULL, 15.0, NULL, true);

INSERT INTO domain_ai_measurement_corrections(id, measurement_id, analysis_run_id, field, original_value, corrected_value, unit, comment, reviewed_by, created_at) VALUES
('60000000-0000-4000-8000-00000000000b', '50000000-0000-4000-8000-00000000000b', '30000000-0000-4000-8000-00000000000b', 'majorAxisMm', 12.1, 12.3, 'mm', 'EXT-04 professional synthetic correction', 'EXT04 reviewer', '2026-03-10T12:00:00Z');
`;
}

function resetStack() {
  try {
    compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  } catch {
    // The first reset may run before the stack exists.
  }
}

function seed(cycle) {
  execFileSync("docker", ["compose", "-p", project, "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", "pfi_ext04", "-d", "pfi_ext04", "-v", "ON_ERROR_STOP=1"], {
    cwd: backendRoot,
    input: seedSql(cycle),
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });
}

function findComparable(comparisons, level = "L4-L5", metric = "majorAxisMm") {
  return comparisons.find((row) => row.level === level && row.metric === metric && row.comparisonStatus === "comparable");
}

function findStatus(comparisons, status) {
  return comparisons.find((row) => row.comparisonStatus === status);
}

async function assertApi(cycleToken) {
  const listResponse = await authorizedFetch(cycleToken, "/api/subjects/EXT04-SUBJECT-A/history");
  assertOk(listResponse.ok, `history returned ${listResponse.status}`);
  const history = await listResponse.json();
  const caseIds = JSON.stringify(history);
  for (const id of ["EXT04-STUDY-A", "EXT04-STUDY-B", "EXT04-STUDY-C"]) {
    assertOk(caseIds.includes(id), `history missing ${id}`);
  }

  const abResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-B/longitudinal-comparison?baselineCaseId=EXT04-STUDY-A");
  assertOk(abResponse.ok, `A->B comparison returned ${abResponse.status}`);
  const ab = await abResponse.json();
  assertOk(ab.baselineCaseId === "EXT04-STUDY-A" && ab.currentCaseId === "EXT04-STUDY-B", "A->B case ids mismatch");
  const abRow = findComparable(ab.measurements);
  assertOk(abRow, "A->B comparable L4-L5 majorAxisMm row missing");
  near(abRow.baseline.effectiveValue, 11.9, "A effective value");
  near(abRow.current.automaticValue, 12.1, "B original AI value");
  near(abRow.current.correctedValue, 12.3, "B corrected value");
  near(abRow.current.effectiveValue, 12.3, "B effective corrected value");
  near(abRow.deltaAbsolute, 0.4, "A->B absolute delta");
  near(abRow.deltaPercent, (0.4 / 11.9) * 100, "A->B percentage delta");

  const bcResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-C/longitudinal-comparison?baselineCaseId=EXT04-STUDY-B");
  assertOk(bcResponse.ok, `B->C comparison returned ${bcResponse.status}`);
  const bc = await bcResponse.json();
  const bcRow = findComparable(bc.measurements);
  assertOk(bcRow, "B->C comparable L4-L5 majorAxisMm row missing");
  near(bcRow.baseline.effectiveValue, 12.3, "B effective as B->C baseline");
  near(bcRow.current.effectiveValue, 12.9, "C effective value");
  near(bcRow.deltaAbsolute, 0.6, "B->C absolute delta");
  near(bcRow.deltaPercent, (0.6 / 12.3) * 100, "B->C percentage delta");
  assertOk(findStatus(bc.measurements, "level_unresolved"), "null level did not produce level_unresolved");

  const zeroResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-A/longitudinal-comparison?baselineCaseId=EXT04-STUDY-ZERO");
  assertOk(zeroResponse.ok, `zero baseline comparison returned ${zeroResponse.status}`);
  const zero = await zeroResponse.json();
  const zeroRow = findComparable(zero.measurements);
  assertOk(zeroRow, "zero baseline comparable row missing");
  near(zeroRow.baseline.effectiveValue, 0, "zero baseline effective value");
  assertOk(zeroRow.deltaPercent === null, "baseline zero must yield null deltaPercent");

  const crossResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-C/longitudinal-comparison?baselineCaseId=EXT04-STUDY-CROSS");
  assertOk(crossResponse.status === 404, `cross-patient must fail closed with 404, got ${crossResponse.status}`);

  const noHistoryResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-NO-HISTORY/report");
  assertOk(noHistoryResponse.ok, `no-history report returned ${noHistoryResponse.status}`);
  const noHistoryReport = await noHistoryResponse.json();
  assertOk(noHistoryReport.longitudinalHistory?.available === false, "no-history report must be valid and unavailable");

  const reportResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-C/report");
  assertOk(reportResponse.ok, `report returned ${reportResponse.status}`);
  const report = await reportResponse.json();
  assertOk(report.schemaVersion === "pfi.study-report.v1", "unexpected report schema");
  assertOk(report.longitudinalHistory?.available === true, "longitudinalHistory missing/unavailable");
  assertOk(report.longitudinalHistory.currentStudy.caseId === "EXT04-STUDY-C", "current study mismatch");
  const previousCaseIds = report.longitudinalHistory.previousStudies.map((study) => study.caseId);
  assertOk(previousCaseIds[0] === "EXT04-STUDY-B" && previousCaseIds.includes("EXT04-STUDY-A"), "previous studies order/history mismatch");
  const reportBc = report.longitudinalHistory.comparisons.find((row) => row.previousCaseId === "EXT04-STUDY-B" && row.metric === "majorAxisMm");
  assertOk(reportBc, "report B->C comparison missing");
  near(reportBc.previousEffectiveValue, 12.3, "report previous effective value");
  near(reportBc.currentEffectiveValue, 12.9, "report current effective value");
  near(reportBc.absoluteDelta, 0.6, "report absolute delta");
  near(reportBc.percentageDelta, (0.6 / 12.3) * 100, "report percentage delta");
  assertOk(reportBc.previousValueSource === "professional_correction", "report must expose correction source");
  assertOk(reportBc.previousAutomaticValue === 12.1 && reportBc.previousCorrectedValue === 12.3, "report must keep original and corrected B values");
  const serialized = JSON.stringify(report);
  for (const forbidden of ["EXT04-SUBJECT-A", "EXT04 reviewer", "reviewedBy", "PatientName", "PatientID", "StudyInstanceUID", "C:\\\\", "/var/lib", "pfi-ext04-local-jwt-secret-only"]) {
    assertOk(!serialized.includes(forbidden), `report leaked forbidden value ${forbidden}`);
  }

  const pdfResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04-STUDY-C/report.pdf");
  assertOk(pdfResponse.ok, `PDF returned ${pdfResponse.status}`);
  assertOk((pdfResponse.headers.get("content-type") ?? "").includes("application/pdf"), "PDF content-type mismatch");
  const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
  assertOk(new TextDecoder().decode(pdfBytes.slice(0, 5)) === "%PDF-", "PDF does not start with %PDF-");
  assertOk(pdfBytes.length > 1000, "PDF is too small");
  const pdfText = new TextDecoder("latin1").decode(pdfBytes);
  assertOk(pdfText.includes("PDF") || pdfBytes.length > 1000, "PDF text sanity failed");

  return { report, ab, bc };
}

async function seedBrowserSession(page, cycleToken) {
  await page.addInitScript(({ accessToken }) => {
    const session = {
      accessToken,
      refreshToken: accessToken,
      tokenType: "Bearer",
      user: {
        id: "ext04-e2e-doctor",
        fullName: "Dra. EXT04 E2E",
        email: "doctor.demo@pfi.local",
        licenseNumber: "MP-EXT04",
        specialty: "Radiologia",
        institution: "PFI EXT04 E2E",
        roles: ["ADMIN", "DOCTOR", "REVIEWER"],
        verified: true,
        approved: true,
        onboardingCompleted: true,
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

async function assertBrowser(cycleToken) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await seedBrowserSession(page, cycleToken);
  await page.goto(`${frontendUrl}/estudio/EXT04-STUDY-C`, { waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  const reportPanel = page.getByTestId("backend-study-report");
  const text = await reportPanel.textContent();
  assertOk(text.includes("Evolución") || text.includes("comparación con estudios previos"), "longitudinal section not visible");
  // The panel renders previous studies by date/status/count (studyDisplay.displayStudyDate),
  // never by raw case id — only the current study's own caseId is printed verbatim.
  for (const expected of ["EXT04-STUDY-C", "2026-01-10", "2026-03-10", "12.3", "12.9", "0.6", "mm"]) {
    assertOk(text.includes(expected), `browser report missing ${expected}`);
  }
  const lower = text.toLowerCase();
  for (const term of bannedClinicalTerms) {
    assertOk(!lower.includes(term), `clinical term leaked in EXT-04 report section: ${term}`);
  }
  await page.reload({ waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  const reloaded = await page.getByTestId("backend-study-report").textContent();
  assertOk(reloaded.includes("12.3") && reloaded.includes("0.6"), "reload lost longitudinal history");
  await browser.close();
}

async function runCycle(cycle) {
  console.log(`EXT-04A E2E cycle ${cycle}: reset/start`);
  resetStack();
  compose(["up", "-d", "--build"], { stdio: "inherit" });
  await waitFor(`${backendUrl}/api/system/health`, "backend health");
  await waitFor(`${frontendUrl}/env.js`, "frontend env");
  seed(cycle);
  const cycleToken = await token();
  await assertApi(cycleToken);
  await assertBrowser(cycleToken);
  console.log(`EXT-04A E2E cycle ${cycle}: OK`);
}

async function main() {
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await runCycle(cycle);
  }
  compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  console.log(`EXT-04A longitudinal Docker E2E: ${cycles} cycles OK`);
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
