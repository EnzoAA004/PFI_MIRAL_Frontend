// EXT-04B3.5: E2E aislado en Docker para el contexto de imagen base de la evidencia visual.
//
// seed directo a la DB usado solo para preparar el estado; todo el comportamiento de lectura/renderizado bajo test usa las APIs
// reales del producto (GET /api/studies/{caseId}/report, GET /api/ai/series/{inputId}/slices/{index},
// la app React real en el browser). EvidenceRegionIngestionService todavía no tiene controller (por
// diseño para esta iteración — ver EXT_04B_BACKEND_FOUNDATION.md "Decisiones a revisar"), por lo que
// las filas de `domain_ai_evidence_regions`/`domain_ai_evidence_region_corrections` se insertan con
// SQL crudo exactamente como scripts/playwright-ext04a-longitudinal-e2e.mjs ya siembra
// `domain_ai_analysis_runs` por el mismo motivo — esto es preparación del test, no un nuevo
// endpoint productivo.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "..");
const backendRoot = process.env.EXT04B3_BACKEND_ROOT ?? resolve(frontendRoot, "..", "PFI_MVPTest_Enzo_Backend_ext04b3");
const composeFile = resolve(backendRoot, "docker-compose.ext04b3-e2e.yml");
const backendUrl = process.env.EXT04B3_BACKEND_URL ?? "http://localhost:8380";
const frontendUrl = process.env.EXT04B3_FRONTEND_URL ?? "http://localhost:8388";
const project = process.env.EXT04B3_COMPOSE_PROJECT ?? "pfi-ext04b3-e2e";
const cycles = Number(process.env.EXT04B3_E2E_CYCLES ?? "2");

const bannedClinicalTerms = [
  "patología confirmada", "lesión confirmada", "diagnóstico confirmado", "diagnostico confirmado",
  "tratamiento recomendado", "mejoró", "empeoró", "mejoro", "empeoro",
  "better", "worse", "improved", "deteriorated", "confirmed pathology", "confirmed diagnosis",
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
  if (!value) throw new Error(`EXT-04B3.5 E2E assertion failed: ${message}`);
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

async function authorizedFetch(cycleToken, path, init = {}) {
  return fetch(`${backendUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cycleToken}`, ...(init.headers ?? {}) },
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
DELETE FROM domain_studies WHERE case_id LIKE 'EXT04B-VISUAL-%';

INSERT INTO domain_studies(id, case_id, status, subject_ref, study_date, modality, description, review_priority, created_at, updated_at) VALUES
('90000000-0000-4000-8000-00000000001a', 'EXT04B-VISUAL-01', 'ready', 'EXT04B-VISUAL-SUBJECT', '2026-08-01', 'MRI', 'EXT-04B3.5 synthetic', 'medium', '${now}', '${now}'),
('90000000-0000-4000-8000-000000000021', 'EXT04B-VISUAL-EMPTY', 'ready', 'EXT04B-VISUAL-SUBJECT-2', '2026-08-01', 'MRI', 'EXT-04B3.5 synthetic, no evidence', 'medium', '${now}', '${now}'),
('90000000-0000-4000-8000-0000000002a1', 'EXT04B-VISUAL-MALICIOUS', 'ready', 'EXT04B-VISUAL-SUBJECT-3', '2026-08-01', 'MRI', 'EXT-04B3.5 synthetic, malicious fixture', 'medium', '${now}', '${now}');

INSERT INTO domain_ai_analysis_runs(id, study_id, case_id, schema_version, release_id, status, human_review_required, not_clinical_diagnosis, autonomous_diagnosis, trace_id, sagittal_input_id, axial_input_id, warnings, raw_response, created_at, completed_at) VALUES
('90000000-0000-4000-8000-00000000001b', '90000000-0000-4000-8000-00000000001a', 'EXT04B-VISUAL-01', 'pfi.ai-product-result.v1', 'ext04b3-synthetic', 'completed', true, true, false, 'ext04b3-trace', '${SAGITTAL_INPUT_ID}', NULL, '[]'::jsonb, '{}'::jsonb, '${now}', '${now}'),
('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000021', 'EXT04B-VISUAL-EMPTY', 'pfi.ai-product-result.v1', 'ext04b3-synthetic', 'completed', true, true, false, 'ext04b3-trace-empty', '${SAGITTAL_INPUT_ID}', NULL, '[]'::jsonb, '{}'::jsonb, '${now}', '${now}'),
('90000000-0000-4000-8000-0000000002a2', '90000000-0000-4000-8000-0000000002a1', 'EXT04B-VISUAL-MALICIOUS', 'pfi.ai-product-result.v1', 'ext04b3-synthetic', 'completed', true, true, false, 'ext04b3-trace-malicious', '${SAGITTAL_INPUT_ID}', NULL, '[]'::jsonb, '{}'::jsonb, '${now}', '${now}');

-- The Reading Room workspace (StudyReviewView) renders its full tab bar (including "Más",
-- where the structured report panel lives) only once a Study has a canonical run to show --
-- the same reason scripts/playwright-ext04a-longitudinal-e2e.mjs's own proven seed always
-- includes these two tables for every Study it navigates to in a real browser. The first
-- attempt at this harness omitted them (it only exercised the report API directly at first),
-- which surfaced as a real, reproducible Playwright timeout waiting for the "Más" tab --
-- confirmed by curl/API checks passing while the browser step failed, then fixed here by
-- matching EXT-04A's own already-working fixture shape, not by loosening the assertion.
-- domain_input_resources.input_id is UNIQUE across the whole table, so the empty-evidence
-- study needs its own distinct opaque id -- reusing SAGITTAL_INPUT_ID here would violate that
-- constraint (this second id is never used by any evidence region/baseImage assertion).
INSERT INTO domain_input_resources(id, study_id, plane, input_id, format, size_bytes, description, weighting, slice_count, multiplanar, derived, analyzable, created_at) VALUES
('90000000-0000-4000-8000-000000000031', '90000000-0000-4000-8000-00000000001a', 'sagittal', '${SAGITTAL_INPUT_ID}', 'synthetic', 1, 'EXT-04B3.5 synthetic sagittal input', 'T2', 1, false, false, true, '${now}'),
('90000000-0000-4000-8000-000000000032', '90000000-0000-4000-8000-000000000021', 'sagittal', 'inp_2822bf9640ab40a289050a30ce2fe6fe', 'synthetic', 1, 'EXT-04B3.5 synthetic sagittal input (empty)', 'T2', 1, false, false, true, '${now}');

INSERT INTO domain_study_runs(
  id, study_id, multiplanar_run_id, trace_id, requested_inference_mode, effective_inference_mode,
  sagittal_model_key, axial_model_key, sagittal_artifact_hash, axial_artifact_hash,
  sagittal_run_id, axial_run_id, assets, metrics_snapshot, status, review_status, reviewer, reviewed_at, comments, created_at, updated_at
) VALUES
('90000000-0000-4000-8000-000000000033', '90000000-0000-4000-8000-00000000001a', 'EXT04B3-MULTI-01', 'ext04b3-trace-multi', 'synthetic', 'synthetic', 'ext04b3-sagittal', '', '', '', 'EXT04B3-SAG-01', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT04B3 reviewer', '${now}', 'synthetic', '${now}', '${now}'),
('90000000-0000-4000-8000-000000000034', '90000000-0000-4000-8000-000000000021', 'EXT04B3-MULTI-EMPTY', 'ext04b3-trace-multi-empty', 'synthetic', 'synthetic', 'ext04b3-sagittal', '', '', '', 'EXT04B3-SAG-EMPTY', '', '{}'::jsonb, '{"sourceSchemaVersion":"pfi.backend-run-snapshot.v2","status":"completed","requestedPlanes":["sagittal"],"completedPlanes":["sagittal"],"planes":{"sagittal":{"measurements":[]}},"governance":{"humanReviewRequired":true,"notClinicalDiagnosis":true}}'::jsonb, 'completed', 'accepted', 'EXT04B3 reviewer', '${now}', 'synthetic', '${now}', '${now}');

-- A. BBOX, origin=ai, experimental=true, slice_index=6 -> effective source "ai_suggested",
--    baseImage resolves from the run's own sagittal_input_id.
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, plane, level, structure, slice_index, origin, geometry_type, geometry, model_id, model_sha256, pipeline_version, experimental, label, created_at) VALUES
('90000000-0000-4000-8000-00000000001c', '90000000-0000-4000-8000-00000000001b', 'sagittal', 'L4-L5', 'disc', 6, 'ai', 'BBOX', '{"x":100,"y":120,"width":30,"height":20}'::jsonb, 'sagittal_spider', 'sha256:ext04b3', 'pfi.multiplanar-run.v2', true, 'Región de interés', '${now}');

-- B. origin=ai, BBOX at insert time, corrected below to ELLIPSE -> effective source
--    "professional_corrected" with geometryType=ELLIPSE (EffectiveAnnotationResolver always
--    shows the LATEST correction's geometry, never the AI's original, once one exists).
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, plane, level, structure, slice_index, origin, geometry_type, geometry, model_id, model_sha256, pipeline_version, experimental, label, created_at) VALUES
('90000000-0000-4000-8000-00000000001d', '90000000-0000-4000-8000-00000000001b', 'sagittal', 'L3-L4', 'disc', 10, 'ai', 'BBOX', '{"x":60,"y":60,"width":20,"height":20}'::jsonb, 'sagittal_spider', 'sha256:ext04b3', 'pfi.multiplanar-run.v2', false, 'Región de interés', '${now}');

INSERT INTO domain_ai_evidence_region_corrections(id, evidence_region_id, analysis_run_id, original_geometry_type, original_geometry, corrected_geometry_type, corrected_geometry, comment, reviewed_by, created_at) VALUES
('90000000-0000-4000-8000-00000000001e', '90000000-0000-4000-8000-00000000001d', '90000000-0000-4000-8000-00000000001b', 'BBOX', '{"x":60,"y":60,"width":20,"height":20}'::jsonb, 'ELLIPSE', '{"centerX":70,"centerY":70,"radiusX":12,"radiusY":9}'::jsonb, 'EXT-04B3.5 synthetic correction', 'doctor.ext04b3@pfi.local', '${now}');

-- C. origin=professional, POLYGON, slice_index=20 -> effective source "professional_drawn".
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, plane, level, structure, slice_index, origin, geometry_type, geometry, experimental, label, authored_by, created_at) VALUES
('90000000-0000-4000-8000-00000000001f', '90000000-0000-4000-8000-00000000001b', 'sagittal', 'L5-S1', 'disc', 20, 'professional', 'POLYGON', '{"points":[{"x":40,"y":40},{"x":60,"y":40},{"x":50,"y":60}]}'::jsonb, false, 'Región de interés', 'doctor.ext04b3@pfi.local', '${now}');

-- D. origin=ai, BBOX, NO slice_index -> effective source "ai_suggested" but baseImage MUST be
--    null (fail-safe: no fabricated slice reference) -- exercises the "Imagen base no
--    disponible." fallback end to end.
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, plane, level, structure, slice_index, origin, geometry_type, geometry, model_id, model_sha256, pipeline_version, experimental, label, created_at) VALUES
('90000000-0000-4000-8000-000000000020', '90000000-0000-4000-8000-00000000001b', 'sagittal', 'L2-L3', 'disc', NULL, 'ai', 'BBOX', '{"x":10,"y":10,"width":15,"height":15}'::jsonb, 'sagittal_spider', 'sha256:ext04b3', 'pfi.multiplanar-run.v2', false, 'Región de interés', '${now}');

-- Malicious fixture (section 16): inserted directly (bypassing AiEvidenceRegion's own
-- constructor/EvidenceGeometry.fromMap validation, which only runs in the application layer,
-- never at the database level -- same light-touch convention already documented for
-- domain_ai_measurement_corrections). Proves the read path fails safe rather than serving it.
INSERT INTO domain_ai_evidence_regions(id, analysis_run_id, plane, geometry_type, geometry, origin, experimental, label, created_at) VALUES
('90000000-0000-4000-8000-0000000002a3', '90000000-0000-4000-8000-0000000002a2', 'sagittal', 'MASK_REFERENCE', '{"runId":"../../etc/passwd","plane":"sagittal","assetName":"../x.png"}'::jsonb, 'professional', false, 'Región de interés', '${now}');
`;
}

function resetStack() {
  try {
    compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  } catch {
    // El primer reset puede correr antes de que exista el stack.
  }
}

function seed(cycle) {
  execFileSync("docker", ["compose", "-p", project, "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", "pfi_ext04b3", "-d", "pfi_ext04b3", "-v", "ON_ERROR_STOP=1"], {
    cwd: backendRoot,
    input: seedSql(cycle),
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });
}

function byEvidenceId(report, evidenceId) {
  return report.visualEvidence.find((item) => item.evidenceId === evidenceId);
}

async function assertApi(cycleToken) {
  // --- main fixture: EXT04B-VISUAL-01 -------------------------------------------------
  const reportResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04B-VISUAL-01/report");
  assertOk(reportResponse.ok, `report returned ${reportResponse.status}`);
  const report = await reportResponse.json();
  assertOk(report.schemaVersion === "pfi.study-report.v1", "unexpected report schema");
  assertOk(Array.isArray(report.visualEvidence), "visualEvidence must be an array");
  assertOk(report.visualEvidence.length === 4, `expected 4 visualEvidence items, got ${report.visualEvidence.length}`);

  const regionA = byEvidenceId(report, "90000000-0000-4000-8000-00000000001c");
  assertOk(regionA, "region A (BBOX ai_suggested) missing from report");
  assertOk(regionA.geometryType === "BBOX", "region A geometryType mismatch");
  assertOk(regionA.source === "ai_suggested", "region A source mismatch");
  assertOk(regionA.experimental === true, "region A must stay marked experimental");
  assertOk(typeof regionA.warning === "string" && regionA.warning.length > 0, "region A must carry the unreviewed-AI warning");
  assertOk(regionA.baseImage && regionA.baseImage.inputId === SAGITTAL_INPUT_ID && regionA.baseImage.sliceIndex === 6, "region A baseImage mismatch");

  const regionB = byEvidenceId(report, "90000000-0000-4000-8000-00000000001d");
  assertOk(regionB, "region B (corrected) missing from report");
  assertOk(regionB.geometryType === "ELLIPSE", "region B must show the CORRECTED geometry type, not the original BBOX");
  assertOk(regionB.source === "professional_corrected", "region B source mismatch");
  assertOk(regionB.baseImage && regionB.baseImage.sliceIndex === 10, "region B baseImage mismatch");

  const regionC = byEvidenceId(report, "90000000-0000-4000-8000-00000000001f");
  assertOk(regionC, "region C (professional drawn) missing from report");
  assertOk(regionC.geometryType === "POLYGON", "region C geometryType mismatch");
  assertOk(regionC.source === "professional_drawn", "region C source mismatch");
  assertOk(regionC.baseImage && regionC.baseImage.sliceIndex === 20, "region C baseImage mismatch");

  const regionD = byEvidenceId(report, "90000000-0000-4000-8000-000000000020");
  assertOk(regionD, "region D (no sliceIndex) missing from report");
  assertOk(regionD.baseImage === null, "region D must have a null baseImage (fail-safe, no fabricated sliceIndex)");

  const serialized = JSON.stringify(report);
  for (const forbidden of ["doctor.ext04b3@pfi.local", "reviewedBy", "authoredBy", "PatientName", "StudyInstanceUID", "C:\\\\", "/var/lib"]) {
    assertOk(!serialized.includes(forbidden), `report leaked forbidden value: ${forbidden}`);
  }
  const lowerSerialized = serialized.toLowerCase();
  for (const term of bannedClinicalTerms) {
    assertOk(!lowerSerialized.includes(term.toLowerCase()), `clinical term leaked in report: ${term}`);
  }

  // --- direct mock/backend slice check (89-CONT-F style: curl before browser) -------------
  const sliceResponse = await authorizedFetch(cycleToken, `/api/ai/series/${SAGITTAL_INPUT_ID}/slices/6`);
  assertOk(sliceResponse.ok, `series slice returned ${sliceResponse.status}`);
  assertOk((sliceResponse.headers.get("content-type") ?? "").startsWith("image/"), "series slice content-type must be an image");
  const sliceBytes = new Uint8Array(await sliceResponse.arrayBuffer());
  assertOk(sliceBytes.length > 0, "series slice body is empty");
  assertOk(sliceBytes[0] === 0x89 && sliceBytes[1] === 0x50 && sliceBytes[2] === 0x4e, "series slice is not a PNG");

  // --- empty-evidence study (section 14/8): report renders, visualEvidence: [] -----------
  const emptyResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04B-VISUAL-EMPTY/report");
  assertOk(emptyResponse.ok, `empty-evidence report returned ${emptyResponse.status}`);
  const emptyReport = await emptyResponse.json();
  assertOk(Array.isArray(emptyReport.visualEvidence) && emptyReport.visualEvidence.length === 0, "empty-evidence study must report visualEvidence: []");

  // --- failure mode: sliceIndex out of range (section 15) ---------------------------------
  const outOfRangeResponse = await authorizedFetch(cycleToken, `/api/ai/series/${SAGITTAL_INPUT_ID}/slices/9999`);
  assertOk(outOfRangeResponse.status === 400, `out-of-range slice index must fail closed with 400, got ${outOfRangeResponse.status}`);

  // --- seguridad (sección 16): la geometría maliciosa sembrada directo en Postgres nunca debe
  // servirse de vuelta como un valor utilizable. El camino de lectura del reporte reconstruye AiEvidenceRegion mediante
  // su propio constructor validante, así que una fila que nunca debería haber existido hace fallar todo el
  // request del reporte en lugar de filtrar "../../etc/passwd" -- confirmado acá, no asumido.
  const maliciousResponse = await authorizedFetch(cycleToken, "/api/studies/EXT04B-VISUAL-MALICIOUS/report");
  if (maliciousResponse.ok) {
    const maliciousBody = await maliciousResponse.text();
    assertOk(!maliciousBody.includes("etc/passwd"), "malicious path traversal value must never be served");
  } else {
    assertOk(maliciousResponse.status >= 400, `malicious fixture must fail closed, got ${maliciousResponse.status}`);
  }

  return { report };
}

async function seedBrowserSession(page, cycleToken) {
  await page.addInitScript(({ accessToken }) => {
    const session = {
      accessToken,
      refreshToken: accessToken,
      tokenType: "Bearer",
      user: {
        id: "ext04b3-e2e-doctor",
        fullName: "Dra. EXT04B3 E2E",
        email: "doctor.demo@pfi.local",
        licenseNumber: "MP-EXT04B3",
        specialty: "Radiologia",
        institution: "PFI EXT04B3 E2E",
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
  await page.getByRole("tab", { name: "Más" }).click();
  await page.locator("summary", { hasText: "Informe / exportación" }).click();
  await page.getByTestId("backend-study-report").waitFor({ timeout: 30000 });
}

/**
 * Afirma toda la sección de evidencia EXT04B-VISUAL-01 en cualquier estado de página que esté actualmente en
 * pantalla (primera carga o posterior a recargar) — factorizado para que el chequeo de recarga (sección 12) pruebe que las
 * MISMAS cosas reaparecen desde cero, no un subconjunto más débil.
 */
async function assertEvidenceSection(page) {
  const evidenceList = page.getByTestId("visual-evidence-list");
  await evidenceList.waitFor({ timeout: 30000 });

  // Al menos una región (A) resuelve una imagen base real de punta a punta.
  const firstImage = evidenceList.locator('[data-testid="evidence-region-base-img"]').first();
  await firstImage.waitFor({ timeout: 30000 });
  const naturalSize = await firstImage.evaluate((img) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  assertOk(naturalSize.width > 0 && naturalSize.height > 0, `base image did not decode (naturalWidth=${naturalSize.width}, naturalHeight=${naturalSize.height})`);

  // El overlay SVG debe permanecer montado dentro del MISMO marco que la imagen (nunca un contenedor
  // separado), y debe mantener el viewBox canónico 0..256 sin importar el tamaño del viewport.
  const frame = evidenceList.locator(".evidence-region-frame").first();
  const overlaySvg = frame.locator("svg.evidence-region-overlay");
  await overlaySvg.waitFor({ timeout: 10000 });
  const viewBox = await overlaySvg.getAttribute("viewBox");
  assertOk(viewBox === "0 0 256 256", `overlay lost its canonical viewBox: ${viewBox}`);
  const overlayInsideFrame = await frame.evaluate((el) => el.contains(el.querySelector("svg.evidence-region-overlay")));
  assertOk(overlayInsideFrame, "overlay SVG is not mounted inside the image frame");
  const shapeCount = await overlaySvg.locator(".evidence-region-shape").count();
  assertOk(shapeCount >= 1, "no geometry shape rendered inside the overlay");

  // La región D (sin baseImage) muestra el fallback textual, nunca una imagen rota.
  const text = await evidenceList.textContent();
  assertOk(text.includes("Imagen base no disponible."), "missing base-image fallback for region D");
  assertOk(text.includes("Región sugerida por IA"), "missing ai_suggested label");
  assertOk(text.includes("Región corregida por profesional"), "missing professional_corrected label");
  assertOk(text.includes("Región creada por profesional"), "missing professional_drawn label");
  assertOk(text.includes("Experimental"), "missing experimental badge");
  assertOk(text.includes("Sugerencia de IA sin revisión profesional."), "missing AI-suggested warning text");
  const lower = text.toLowerCase();
  for (const term of bannedClinicalTerms) {
    assertOk(!lower.includes(term.toLowerCase()), `clinical term leaked in browser evidence section: ${term}`);
  }
}

async function assertBrowserAtViewport(cycleToken, width, height) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await seedBrowserSession(page, cycleToken);
  await page.goto(`${frontendUrl}/estudio/EXT04B-VISUAL-01`, { waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await assertEvidenceSection(page);

  // Sección 12 (persistencia/recarga): la imagen, el overlay y los datos deben volver todos de una
  // recarga completa de la página — nunca depender de un estado transitorio de React que una recarga borraría. Esto
  // vuelve a navegar por el panel de reporte desde una página en frío, no desde un estado de componente en caché.
  await page.reload({ waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await assertEvidenceSection(page);

  // El estudio con evidencia vacía muestra el mensaje de fallback neutral, no un error.
  await page.goto(`${frontendUrl}/estudio/EXT04B-VISUAL-EMPTY`, { waitUntil: "networkidle" });
  await openBackendReportPanel(page);
  await page.getByTestId("visual-evidence-empty").waitFor({ timeout: 30000 });
  const emptyText = await page.getByTestId("visual-evidence-empty").textContent();
  assertOk(emptyText.includes("No hay evidencia visual disponible para este análisis."), "missing no-evidence fallback message");

  await browser.close();
}

async function runCycle(cycle) {
  console.log(`EXT-04B3.5 E2E cycle ${cycle}: reset/start`);
  resetStack();
  compose(["up", "-d", "--build"], { stdio: "inherit" });
  await waitFor(`${backendUrl}/api/system/health`, "backend health");
  await waitFor(`${frontendUrl}/env.js`, "frontend env");
  seed(cycle);
  const cycleToken = await token();
  await assertApi(cycleToken);
  console.log(`EXT-04B3.5 E2E cycle ${cycle}: browser desktop (1280x800)`);
  await assertBrowserAtViewport(cycleToken, 1280, 800);
  console.log(`EXT-04B3.5 E2E cycle ${cycle}: browser reduced viewport (800x700)`);
  await assertBrowserAtViewport(cycleToken, 800, 700);
  console.log(`EXT-04B3.5 E2E cycle ${cycle}: OK`);
}

async function main() {
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    await runCycle(cycle);
  }
  compose(["down", "-v", "--remove-orphans"], { stdio: "inherit" });
  console.log(`EXT-04B3.5 visual evidence Docker E2E: ${cycles} cycles OK`);
}

main().catch((error) => {
  console.error(error);
  try {
    compose(["down", "--remove-orphans"], { stdio: "inherit" });
  } catch {
    // Solo best effort; no tocar volúmenes ante una falla fuera de un reset de ciclo explícito.
  }
  process.exit(1);
});
