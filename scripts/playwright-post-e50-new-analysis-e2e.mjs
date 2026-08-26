import { chromium } from "playwright";

/**
 * Stage 86: real-backend browser E2E for "Nuevo análisis" after removing its dependency on the
 * nonexistent `/api/patients` surface, following Stage 84's `playwright-post-e50-patient-history-
 * e2e.mjs` pattern (real Frontend, real Backend, real Postgres -- `docker-compose.post-e50.yml`).
 *
 * Requires the Stage-86 fixture already seeded: `PAT-86-A` (Studies CASE-86-A1/A2/A3),
 * `PAT-86-B` (CASE-86-B1), `PAT-86-C` (CASE-86-C1) -- see `86_NEW_ANALYSIS_MVP.md`.
 *
 * Known, pre-existing, out-of-scope limitation (documented, not a Stage 86 regression): this
 * stack's `mock-ai` service only implements the newer product-analysis pipeline
 * (`POST /v1/product/analyze`), not the older multiplanar/upload pipeline `NewAnalysisDrawer.tsx`
 * still calls (`POST /api/ai/inputs`, `POST /api/ai/multiplanar/run`) -- confirmed empirically via
 * curl (502 UPSTREAM_UNAVAILABLE on `/api/ai/inputs`). Stage 86 does not touch that pipeline
 * (86-P forbids rewriting upload/DICOM ingestion), so this script verifies everything Stage 86
 * actually changed -- subject selection, no legacy requests, Study-list/history reflecting an
 * existing Study created with the target subjectRef -- without depending on a real AI run
 * completing. Not wired into `npm test` -- manual confirmation script, matching Stage 81's own
 * "no meter framework enorme" scope.
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const token = process.env.POST_E50_E2E_TOKEN;

if (!token) {
  console.error("POST_E50_E2E_TOKEN is required (a real JWT minted via POST /api/auth/demo-doctor against the running stack).");
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
        id: "e2e-doctor", fullName: "Dra. E2E", email: "doctor.demo@pfi.local", licenseNumber: "MP-000",
        specialty: "Radiologia", institution: "Centro E2E", roles: ["ADMIN", "DOCTOR", "REVIEWER"],
        verified: true, approved: true, onboardingCompleted: true,
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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const legacyPatientRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/patients") || /\/api\/studies\/[^/]+\/patient/.test(url)) {
      legacyPatientRequests.push(`${request.method()} ${url}`);
    }
  });

  await seedSession(page);
  await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });

  // 1. La lista de trabajo abre con los Studies del fixture ya persistidos.
  await page.getByRole("heading", { name: "Lista de trabajo" }).waitFor({ timeout: 10000 });
  console.log("ok 1 - la lista de trabajo abre contra el Backend real");

  // 2. "Nuevo análisis" abre el drawer.
  await page.getByRole("button", { name: /Nuevo análisis/ }).click();
  await page.locator('.wl-drawer[aria-label="Nuevo análisis"]').waitFor({ state: "visible", timeout: 10000 });
  console.log("ok 2 - el drawer 'Nuevo análisis' abre");

  // 3. El selector de paciente carga subjects reales desde GET /api/subjects (nunca /api/patients).
  await page.waitForSelector("text=Paciente existente ·", { timeout: 10000 });
  const drawerText = await page.locator(".wl-drawer").innerText();
  assertTruthy(drawerText.includes("Paciente existente ·"), "el selector no mostró ningún subject existente");
  assertTruthy(!drawerText.includes("PAT-86-A") && !drawerText.includes("PAT-86-B") && !drawerText.includes("PAT-86-C"), "el subjectRef crudo se imprimió en pantalla (86-F)");
  console.log("ok 3 - el selector muestra subjects reales con etiquetas seguras, sin subjectRef crudo");

  // 4. Seleccionar un paciente existente (el de 3 estudios, PAT-86-A).
  await page.getByRole("button", { name: /3 estudios/ }).click();
  await page.waitForSelector("text=Paciente seleccionado", { timeout: 10000 });
  console.log("ok 4 - seleccionar un paciente existente muestra 'Paciente seleccionado'");

  // 5. Cambiar de paciente vuelve al selector (sin llamar a ningún endpoint de asociación).
  await page.getByRole("button", { name: "Cambiar", exact: true }).click();
  await page.waitForSelector('div[role="radiogroup"]', { timeout: 10000 });
  console.log("ok 5 - 'Cambiar' vuelve al selector");

  // 6. Modo "Paciente nuevo" permite declarar un subjectRef manual (86-E opción A).
  await page.getByLabel("Paciente nuevo").check();
  await page.waitForSelector("text=Referencia interna del estudio (opcional)", { timeout: 10000 });
  console.log("ok 6 - el modo 'Paciente nuevo' está disponible para declarar un subjectRef manual");
  await page.getByLabel("Paciente existente").check();

  // 7. Un caseId nuevo se puede escribir sin bloquear el formulario (subject sigue opcional, 86-N).
  await page.getByPlaceholder("CASE-XXXX").fill("CASE-86-E2E-PROBE");
  console.log("ok 7 - el ID de caso se acepta sin haber seleccionado un paciente");

  // 8. Cero requests a /api/patients o /api/studies/{caseId}/patient en toda la sesión.
  assertTruthy(legacyPatientRequests.length === 0, `se observaron requests legacy: ${legacyPatientRequests.join(", ")}`);
  console.log("ok 8 - legacyPatientRequests.length === 0 (nunca /api/patients ni /api/studies/{caseId}/patient)");

  // 9. Cerrar el drawer y navegar a /pacientes: la lista refleja el fixture (studyCount correcto).
  await page.getByRole("button", { name: "Cerrar" }).click();
  await page.goto(`${frontendUrl}/pacientes`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=3 pacientes", { timeout: 10000 });
  const patientsText = await page.textContent("body");
  assertTruthy(patientsText.includes("3 estudios"), "no se ve el subject con 3 estudios (PAT-86-A tras agregar CASE-86-A3)");
  console.log("ok 9 - /pacientes refleja el studyCount actualizado (3 estudios) sin llamar a /api/patients");

  // 10. Abrir el historial del subject de 3 estudios: ve las 3 Studies, incluida la más nueva.
  await page.getByRole("button", { name: "Abrir historial" }).nth(1).click();
  await page.waitForSelector("text=Línea de tiempo de estudios", { timeout: 10000 });
  const historyText = await page.textContent("body");
  assertTruthy(historyText.includes("CASE-86-A1") && historyText.includes("CASE-86-A2") && historyText.includes("CASE-86-A3"), "no se ven las 3 Studies esperadas en el historial");
  console.log("ok 10 - el historial ve las 3 Studies del subject, incluida la más reciente");

  assertTruthy(legacyPatientRequests.length === 0, "se observaron requests legacy después de navegar al historial");
  console.log("ok 11 - legacyPatientRequests sigue en 0 tras todo el recorrido (worklist -> nuevo análisis -> pacientes -> historial)");

  await browser.close();
  console.log(`Post-E50 new analysis flow browser E2E (stage 86) contra ${frontendUrl}: OK`);
  console.log("Nota: el upload real (POST /api/ai/inputs) y la corrida multiplanar no se ejercitan acá -- este stack's mock-ai no implementa ese pipeline legacy (gap pre-existente, ver 86_NEW_ANALYSIS_MVP.md).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
