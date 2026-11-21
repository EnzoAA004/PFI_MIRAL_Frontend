import { chromium } from "playwright";

/**
 * Stage 88: real Docker browser/API E2E for the backend-authoritative structured
 * Study report/export. This script intentionally does not intercept network
 * traffic: no page.route(), no route.fulfill(), and no frontend-side synthetic
 * report data. The uploaded file is the same minimal .dcm-shaped fixture used
 * by Stage 87; the running mock AI service owns the analysis contract.
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const backendUrl = process.env.POST_E50_BACKEND_URL ?? "http://localhost:8180";
const token = process.env.POST_E50_E2E_TOKEN;
const caseId = process.env.POST_E50_REPORT_CASE_ID ?? `CASE-88-REPORT-${Date.now()}`;
const subjectRef = process.env.POST_E50_REPORT_SUBJECT_REF ?? `SUBJ-88-REPORT-${Date.now()}`;

if (!token) {
  console.error("POST_E50_E2E_TOKEN is required (mint it with POST /api/auth/demo-doctor against the running stack).");
  process.exit(1);
}

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}

async function seedSession(page) {
  await page.addInitScript(({ token: accessToken }) => {
    const session = {
      accessToken,
      refreshToken: accessToken,
      tokenType: "Bearer",
      user: {
        id: "e2e-doctor",
        fullName: "Dra. E2E",
        email: "doctor.demo@pfi.local",
        licenseNumber: "MP-000",
        specialty: "Radiologia",
        institution: "Centro E2E",
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
  }, { token });
}

async function fetchAuthorized(path) {
  return fetch(`${backendUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const apiRequests = [];
  const legacyPatientRequests = [];

  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/")) return;
    apiRequests.push(`${request.method()} ${url}`);
    if (url.includes("/api/patients") || /\/api\/studies\/[^/]+\/patient\b/.test(url)) {
      legacyPatientRequests.push(`${request.method()} ${url}`);
    }
  });

  await seedSession(page);
  await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Lista de trabajo" }).waitFor({ timeout: 10000 });
  console.log("ok 1 - sesión profesional y worklist real abiertas");

  await page.getByRole("button", { name: /Cargar estudio/ }).click();
  await page.locator('.wl-drawer[role="dialog"]').waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Nueva referencia").check();
  await page.getByLabel(/Referencia interna del estudio/i).fill(subjectRef);
  await page.getByRole("button", { name: "Usar esta referencia" }).click();
  await page.waitForSelector("text=Referencia asociada", { timeout: 10000 });
  console.log("ok 2 - nuevo paciente/subjectRef de-identificado seleccionado");

  await page.getByPlaceholder("CASE-XXXX").fill(caseId);
  await page.locator("button", { hasText: "Cargar un archivo por plano" }).click();
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "stage-88-report-sagittal.dcm",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("stage-88-structured-report-fixture-no-patient-data"),
  });
  await page.waitForSelector("text=stage-88-report-sagittal.dcm cargado", { timeout: 10000 });
  console.log("ok 3 - input sagital cargado por flujo real");

  await page.getByRole("button", { name: "Analizar" }).click();
  await page.waitForURL(`${frontendUrl.replace(/\/$/, "")}/estudio/${caseId}`, { timeout: 30000 });
  await page.getByText(caseId, { exact: false }).first().waitFor({ timeout: 10000 });
  console.log("ok 4 - Study creado y sala de lectura abierta");

  await page.getByRole("tab", { name: "Hallazgos IA" }).click();
  await page.waitForSelector("text=Análisis de producto", { timeout: 10000 });
  await page.getByRole("button", { name: "Analizar estudio" }).click();
  await page.waitForSelector("text=Análisis parcial", { timeout: 15000 });
  const findingsText = await page.textContent("body");
  assertTruthy(findingsText.includes("L4-L5"), "el análisis de producto no expuso el nivel esperado L4-L5");
  console.log("ok 5 - análisis de producto real persistido");

  await page.getByRole("button", { name: "Aceptar" }).click();
  await page.waitForSelector("text=Aceptado por el profesional", { timeout: 10000 });
  console.log("ok 6 - revisión profesional persistida");

  await page.getByRole("tab", { name: "Más" }).click();
  await page.locator("summary", { hasText: "Informe / exportación" }).click();
  await page.getByTestId("backend-study-report").waitFor({ timeout: 15000 });
  const reportUiText = await page.getByTestId("backend-study-report").textContent();
  const fullUiText = await page.textContent("body");
  assertTruthy(reportUiText.includes("pfi.study-report.v1"), "la UI no muestra el contrato del reporte backend");
  assertTruthy(fullUiText.includes("Salida revisable"), "la UI no muestra el aviso de seguridad del reporte");
  assertTruthy(reportUiText.includes(caseId), "la UI no muestra el Study actual en el reporte");
  assertTruthy(!reportUiText.includes(subjectRef), "la UI expone subjectRef dentro del reporte");
  console.log("ok 7 - UI consume y muestra informe estructurado backend-authoritative");

  const reportResponse = await fetchAuthorized(`/api/studies/${encodeURIComponent(caseId)}/report`);
  assertTruthy(reportResponse.ok, `/report devolvió HTTP ${reportResponse.status}`);
  const report = await reportResponse.json();
  assertTruthy(report.schemaVersion === "pfi.study-report.v1", "schemaVersion inesperado");
  assertTruthy(report.caseId === caseId, "caseId inesperado en reporte");
  assertTruthy(report.review.reviewStatus === "accepted", "estado de revisión inesperado");
  assertTruthy(report.measurements.some((measurement) => measurement.unit === "mm²"), "no se preservó mm² en mediciones");
  assertTruthy(report.safety.notClinicalDiagnosis === true, "safety.notClinicalDiagnosis debe ser true");
  assertTruthy(report.safety.autonomousDiagnosis === false, "safety.autonomousDiagnosis debe ser false");
  const serializedReport = JSON.stringify(report);
  assertTruthy(!serializedReport.includes(subjectRef), "el JSON /report expone subjectRef");
  assertTruthy(!serializedReport.includes("PatientName"), "el JSON /report expone PatientName");
  assertTruthy(!serializedReport.includes("PatientID"), "el JSON /report expone PatientID");
  console.log("ok 8 - GET /report cumple contrato y privacidad");

  const jsonExport = await fetchAuthorized(`/api/studies/${encodeURIComponent(caseId)}/report.json`);
  assertTruthy(jsonExport.ok, `/report.json devolvió HTTP ${jsonExport.status}`);
  assertTruthy((jsonExport.headers.get("content-disposition") ?? "").includes(`study-report-${caseId}.json`), "filename JSON inesperado");
  const exportedJson = await jsonExport.json();
  assertTruthy(exportedJson.schemaVersion === "pfi.study-report.v1", "export JSON no conserva schemaVersion");
  console.log("ok 9 - GET /report.json descarga JSON estructurado");

  const pdfExport = await fetchAuthorized(`/api/studies/${encodeURIComponent(caseId)}/report.pdf`);
  assertTruthy(pdfExport.ok, `/report.pdf devolvió HTTP ${pdfExport.status}`);
  assertTruthy((pdfExport.headers.get("content-type") ?? "").includes("application/pdf"), "content-type PDF inesperado");
  assertTruthy((pdfExport.headers.get("content-disposition") ?? "").includes(`study-report-${caseId}.pdf`), "filename PDF inesperado");
  const pdfBytes = new Uint8Array(await pdfExport.arrayBuffer());
  const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 5));
  assertTruthy(pdfHeader === "%PDF-", "la descarga PDF no comienza con %PDF-");
  assertTruthy(pdfBytes.length > 1000, "la descarga PDF parece vacía");
  console.log("ok 10 - GET /report.pdf descarga PDF real");

  assertTruthy(legacyPatientRequests.length === 0, `se observaron requests legacy: ${legacyPatientRequests.join(", ")}`);
  assertTruthy(apiRequests.some((entry) => /\/api\/studies\/[^/]+\/report$/.test(entry)), "la UI no consultó /report");
  console.log("ok 11 - sin requests legacy /api/patients y con request UI /report observado");

  await browser.close();
  console.log(`Stage 88 structured report/export E2E contra ${frontendUrl}: OK (${caseId})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
