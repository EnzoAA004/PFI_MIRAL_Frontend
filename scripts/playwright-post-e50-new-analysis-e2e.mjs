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
const backendUrl = process.env.POST_E50_BACKEND_URL ?? "http://localhost:8180";
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
  const patientApiRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/patients")) patientApiRequests.push(`${request.method()} ${url}`);
    if (/\/api\/studies\/[^/]+\/patient/.test(url)) {
      legacyPatientRequests.push(`${request.method()} ${url}`);
    }
  });

  await seedSession(page);
  await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });

  // 1. La lista de trabajo abre con los Studies del fixture ya persistidos.
  await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 10000 });
  console.log("ok 1 - la lista de trabajo abre contra el Backend real");

  // 2. "Nuevo análisis" abre el drawer.
  await page.getByRole("button", { name: /Nuevo estudio/ }).click();
  await page.locator('.wl-new-study').waitFor({ state: "visible", timeout: 10000 });
  console.log("ok 2 - la vista 'Nuevo estudio' abre");

  // 3. El selector busca pacientes reales por codigo (GET /api/patients) y los muestra con su
  //    codigo visible: ahora el codigo del paciente es un dato de la pantalla, no se oculta.
  await page.getByLabel("Buscar por código o nombre").fill("PAT-86");
  await page.getByRole("list", { name: "Resultados de pacientes" }).waitFor({ timeout: 10000 });
  const results = await page.getByRole("list", { name: "Resultados de pacientes" }).innerText();
  assertTruthy(results.includes("PAT-86-A") && results.includes("PAT-86-B") && results.includes("PAT-86-C"), "la búsqueda no mostró los tres pacientes PAT-86-*");
  await page.getByLabel("Buscar por código o nombre").fill("Bruno");
  await page.waitForTimeout(700);
  assertTruthy((await page.getByRole("list", { name: "Resultados de pacientes" }).innerText()).includes("PAT-86-B"), "la búsqueda por nombre no encontró a PAT-86-B");
  console.log("ok 3 - el selector busca pacientes reales por código y por nombre");

  // 4. Seleccionar un paciente existente (PAT-86-A, el de 3 estudios).
  await page.getByLabel("Buscar por código o nombre").fill("PAT-86-A");
  await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor({ timeout: 10000 });
  assertTruthy((await page.locator('[aria-label="Paciente seleccionado"]').innerText()).includes("PAT-86-A"), "el resumen no muestra PAT-86-A");
  console.log("ok 4 - seleccionar un paciente existente muestra su resumen");

  // 5. Cambiar de paciente vuelve al selector (sin llamar a ningun endpoint de asociacion).
  await page.getByRole("button", { name: "Cambiar", exact: true }).click();
  await page.waitForSelector('div[role="radiogroup"]', { timeout: 10000 });
  console.log("ok 5 - 'Cambiar' vuelve al selector");

  // 6. El modo "Crear paciente" esta disponible (reemplaza al subjectRef manual).
  await page.getByLabel("Crear paciente").check();
  await page.waitForSelector("text=Código visible", { timeout: 10000 });
  console.log("ok 6 - el modo 'Crear paciente' está disponible");
  await page.getByLabel("Buscar existente").check();

  // 7. Un caseId nuevo se puede escribir sin paciente: continuar sin asociar es explicito y no bloquea (86-N).
  await page.getByRole("button", { name: "Continuar sin asociar paciente" }).click();
  await page.getByPlaceholder("CASE-XXXX").fill("CASE-86-E2E-PROBE");
  console.log("ok 7 - el ID de estudio se acepta continuando sin asociar paciente");

  // 8. Ningun request al endpoint legacy de asociacion; /api/patients solo para buscar (nunca crear aqui).
  assertTruthy(legacyPatientRequests.length === 0, `se observaron requests legacy: ${legacyPatientRequests.join(", ")}`);
  assertTruthy(patientApiRequests.length > 0 && patientApiRequests.every((entry) => entry.startsWith("GET ")), `/api/patients solo debía consultarse: ${patientApiRequests.join(", ")}`);
  console.log("ok 8 - legacyPatientRequests.length === 0 (nunca /api/studies/{caseId}/patient) y /api/patients solo en GET");

  // 9. Salir de la vista (con datos cargados pide confirmar) y navegar a /pacientes: la lista refleja el fixture (studyCount correcto).
  await page.getByRole("button", { name: "Volver a estudios" }).click();
  await page.getByRole("button", { name: "Salir sin guardar" }).click();
  await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 10000 });
  await page.goto(`${frontendUrl}/pacientes`, { waitUntil: "networkidle" });
  // La cantidad de pacientes depende de las fixtures sembradas en el stack (otros E2E agregan
  // las suyas): se compara contra lo que informa el Backend, no contra un numero fijo.
  const subjects = await (await fetch(`${backendUrl}/api/subjects`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assertTruthy(Array.isArray(subjects) && subjects.length >= 3, "el Backend debía informar al menos los 3 subjects de la fixture");
  await page.waitForSelector(`text=${subjects.length} pacientes`, { timeout: 10000 });
  const patientsText = await page.textContent("body");
  assertTruthy(patientsText.includes("3 estudios"), "no se ve el subject con 3 estudios (PAT-86-A tras agregar CASE-86-A3)");
  console.log("ok 9 - /pacientes refleja el studyCount actualizado (3 estudios) sin pasos de asociación");

  // 10. Abrir el historial del subject de 3 estudios: ve las 3 Studies, incluida la más nueva.
  await page.getByRole("listitem").filter({ hasText: "3 estudios" }).filter({ hasText: "Caso: CASE-86-A3" }).getByRole("button", { name: "Abrir historial" }).click();
  await page.waitForSelector("text=Línea de tiempo de estudios", { timeout: 10000 });
  const historyText = await page.textContent("body");
  assertTruthy(historyText.includes("CASE-86-A1") && historyText.includes("CASE-86-A2") && historyText.includes("CASE-86-A3"), "no se ven las 3 Studies esperadas en el historial");
  console.log("ok 10 - el historial ve las 3 Studies del subject, incluida la más reciente");

  assertTruthy(legacyPatientRequests.length === 0, "se observaron requests legacy después de navegar al historial");
  console.log("ok 11 - legacyPatientRequests sigue en 0 tras todo el recorrido (lista -> nuevo estudio -> pacientes -> historial)");

  await browser.close();
  console.log(`Post-E50 new analysis flow browser E2E (stage 86) contra ${frontendUrl}: OK`);
  console.log("Nota: la carga (POST /api/ai/inputs) y la corrida multiplanar se ejercitan en playwright-post-e50-full-product-flow-e2e.mjs y playwright-post-e50-structured-report-e2e.mjs; este script cubre selección de paciente, salida y listas.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
