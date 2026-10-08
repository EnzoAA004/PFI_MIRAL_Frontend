import { chromium } from "playwright";

/**
 * Recorrido de "Nuevo estudio" en tres pasos contra el stack real de
 * `docker-compose.post-e50.yml` (backend real, IA simulada).
 *
 *   export $(node scripts/post-e50-e2e-seed.mjs 2>/dev/null)
 *   node scripts/playwright-new-study-steps-e2e.mjs
 *
 * Tres recorridos completos, cada uno hasta analizar una sola vez y abrir el visor:
 * A. con paciente existente, edad calculada y contexto clínico;
 * B. con paciente nuevo (diálogo), volviendo entre pasos y cambiando el ID después de cargar
 *    imágenes (hay que volver a cargarlas);
 * C. sin asociación, con edad declarada.
 *
 * En todos: cambiar de paso no analiza ni crea pacientes, y lo guardado se recupera del backend.
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const backendUrl = process.env.POST_E50_BACKEND_URL ?? "http://localhost:8180";
const token = process.env.POST_E50_E2E_TOKEN;
const stamp = Date.now().toString().slice(-7);

if (!token) {
  console.error("POST_E50_E2E_TOKEN es obligatorio (node scripts/post-e50-e2e-seed.mjs lo imprime).");
  process.exit(1);
}

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}

async function api(path) {
  return fetch(`${backendUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

const next = (page) => page.getByRole("button", { name: "Continuar", exact: true });
const back = (page) => page.getByRole("button", { name: "Atrás", exact: true });
const stepper = (page) => page.getByRole("navigation", { name: "Pasos de Nuevo estudio" });
const heading = (page, name) => page.getByRole("heading", { name, level: 2 });

async function loadPlaneFile(page, name, expandFirst = true) {
  if (expandFirst) await page.locator("button", { hasText: "Cargar archivos por plano" }).click();
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic-steps-fixture-no-patient-data"),
  });
  await page.waitForSelector(`text=${name} cargado`, { timeout: 10000 });
}

async function main() {
  const browser = await chromium.launch();
  const counts = { run: 0, upload: 0, patientPost: 0 };

  async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (/\/api\/ai\/multiplanar\/run$/.test(request.url())) counts.run += 1;
      if (/\/api\/ai\/inputs$/.test(request.url())) counts.upload += 1;
      if (/\/api\/patients$/.test(request.url())) counts.patientPost += 1;
    });
    await seedSession(page);
    await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Nuevo estudio" }).click();
    await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
    return page;
  }

  /* ============================== A. paciente existente ============================== */
  const caseA = `CASE-STEPS-A-${stamp}`;
  let page = await newPage();
  await page.getByLabel("Buscar paciente por código o nombre").fill("PAT-87");
  await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor();
  assertTruthy((await page.locator(".ns-summary").innerText()).includes("PAT-87-A"), "el resumen lateral debe mostrar el paciente");
  assertTruthy(!(await page.locator(".ns-summary").innerText()).includes("ID del estudio"), "el resumen no muestra un ID que todavía no existe");
  await page.getByLabel(/Fecha del estudio/).fill("2026-10-06");
  await page.getByPlaceholder("CASE-XXXX").fill(caseA);
  assertTruthy(await next(page).isEnabled(), "con ID válido se puede continuar");
  await next(page).click();
  await heading(page, "Imágenes").waitFor();
  assertTruthy(await next(page).isDisabled(), "sin imágenes no se puede continuar");
  assertTruthy((await page.locator(".ns-summary").innerText()).includes("Sin cargar"), "el resumen marca las imágenes sin cargar");
  await loadPlaneFile(page, "steps-a-sagittal.dcm");
  assertTruthy((await page.locator(".ns-summary").innerText()).includes("Cargadas"), "el resumen marca las imágenes cargadas");
  await next(page).click();
  await heading(page, "Contexto y revisión").waitFor();
  await page.getByLabel("Motivo del estudio").fill("Lumbalgia sintética A");
  await page.getByLabel("Síntomas").fill("Dolor sintético");
  await page.getByLabel("Tiempo de evolución").fill("2 meses");
  await page.getByLabel("Antecedentes relevantes").fill("Sin antecedentes sintéticos");
  const ageText = await page.locator(".ns-age").innerText();
  assertTruthy(/51 años/.test(ageText) && /Calculada/.test(ageText), `edad calculada esperada 51 (${ageText})`);
  const review = await page.locator(".ns-review").innerText();
  assertTruthy(review.includes("PAT-87-A") && review.includes(caseA) && review.includes("06/10/2026"), "la revisión resume paciente, estudio y fecha");
  assertTruthy(counts.run === 0 && counts.patientPost === 0, "recorrer los pasos no analiza ni crea pacientes");
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(`${frontendUrl.replace(/\/$/, "")}/estudio/${caseA}`, { timeout: 30000 });
  assertTruthy(counts.run === 1, `un solo análisis (${counts.run})`);
  let context = await (await api(`/api/studies/${caseA}/context`)).json();
  assertTruthy(context.patient?.patientReference === "PAT-87-A" && context.clinicalContext?.ageAtStudy === 51 && context.clinicalContext?.ageProvenance === "calculated" && context.clinicalContext?.clinicalReason === "Lumbalgia sintética A" && context.clinicalContext?.symptomDuration === "2 meses", `contexto A persistido: ${JSON.stringify(context)}`);
  console.log("ok 1 - recorrido con paciente existente: edad calculada, contexto, un análisis, visor y contexto persistido");
  await page.close();

  /* ============================== B. paciente nuevo ============================== */
  const caseB = `CASE-STEPS-B-${stamp}`;
  const caseBOld = `CASE-STEPS-B-OLD-${stamp}`;
  const newCode = `STEPS-${stamp}`;
  page = await newPage();
  const postsBefore = counts.patientPost;
  await page.getByRole("button", { name: "Crear paciente" }).click();
  const dialog = page.getByRole("dialog", { name: "Crear paciente" });
  await dialog.waitFor();
  assertTruthy(await page.evaluate(() => document.activeElement?.id === "new-patient-reference"), "el foco entra al primer campo del diálogo");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assertTruthy(counts.patientPost === postsBefore, "cancelar el diálogo no crea paciente");
  assertTruthy(await page.evaluate(() => document.activeElement?.textContent?.includes("Crear paciente")), "al cerrar el diálogo el foco vuelve a «Crear paciente»");
  await page.getByRole("button", { name: "Crear paciente" }).click();
  await dialog.waitFor();
  await dialog.locator("#new-patient-reference").fill(newCode);
  await dialog.locator("#new-patient-first-name").fill("Nora");
  await dialog.locator("#new-patient-last-name").fill("Nueva");
  await dialog.locator("#new-patient-birth-date").fill("1990-05-05");
  await dialog.getByRole("button", { name: "Crear paciente" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor();
  assertTruthy(counts.patientPost === postsBefore + 1, "el paciente se crea una sola vez");
  assertTruthy((await heading(page, "Paciente y estudio").count()) === 1, "crear el paciente no avanza el flujo: sigue en el paso 1");
  const selectedText = await page.locator('[aria-label="Paciente seleccionado"]').innerText();
  assertTruthy(selectedText.includes("Nora Nueva") && selectedText.includes(newCode) && selectedText.includes("05/05/1990"), `resumen del paciente creado: ${selectedText}`);
  assertTruthy(counts.run === 1, "crear el paciente no dispara análisis");
  await page.getByLabel(/Fecha del estudio/).fill("2026-10-06");
  await page.getByPlaceholder("CASE-XXXX").fill(caseBOld);
  await next(page).click();
  await heading(page, "Imágenes").waitFor();
  const uploadsBefore = counts.upload;
  await loadPlaneFile(page, "steps-b-sagittal.dcm");
  assertTruthy(counts.upload === uploadsBefore + 1, "una carga");
  await next(page).click();
  await heading(page, "Contexto y revisión").waitFor();
  await page.getByLabel("Motivo del estudio").fill("Motivo B");

  // volver entre pasos: no reinicia cargas ni pierde el contexto
  await back(page).click();
  await heading(page, "Imágenes").waitFor();
  assertTruthy(counts.upload === uploadsBefore + 1, "volver a Imágenes no reinicia la carga");
  assertTruthy((await page.locator("text=steps-b-sagittal.dcm").count()) >= 1, "el archivo sigue visible");
  await back(page).click();
  await heading(page, "Paciente y estudio").waitFor();
  assertTruthy((await page.locator('[aria-label="Paciente seleccionado"]').innerText()).includes(newCode), "el paciente se conserva al volver");

  // modificar el ID después de cargar imágenes: lo posterior se invalida y se explica
  await page.getByPlaceholder("CASE-XXXX").fill(caseB);
  const notes = await stepper(page).innerText();
  assertTruthy(/Hay que volver a cargarlas/.test(notes), `la navegación debe decir que hay que recargar: ${notes.replace(/\n/g, " | ")}`);
  assertTruthy(await stepper(page).getByRole("button", { name: /Contexto y revisión/ }).isDisabled(), "Contexto vuelve a quedar bloqueado hasta recargar");
  assertTruthy((await page.locator(".ns-summary").innerText()).includes("Hay que volver a cargarlas"), "el resumen también lo dice");
  await next(page).click();
  await heading(page, "Imágenes").waitFor();
  assertTruthy((await page.locator(".ns-notice").innerText()).includes("volvé a cargar las imágenes"), "el paso explica qué hay que rehacer");
  assertTruthy(await next(page).isDisabled(), "sin recargar no se puede continuar");
  await loadPlaneFile(page, "steps-b-sagittal-2.dcm", false);
  assertTruthy(counts.upload === uploadsBefore + 2, "recargar es explícito: una carga más");
  await next(page).click();
  await heading(page, "Contexto y revisión").waitFor();
  assertTruthy((await page.getByLabel("Motivo del estudio").inputValue()) === "Motivo B", "el contexto se conserva tras recargar imágenes");
  assertTruthy(/36 años/.test(await page.locator(".ns-age").innerText()), "edad calculada con la fecha de nacimiento del paciente creado");
  const runsBeforeB = counts.run;
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(`${frontendUrl.replace(/\/$/, "")}/estudio/${caseB}`, { timeout: 30000 });
  assertTruthy(counts.run === runsBeforeB + 1, "un solo análisis");
  context = await (await api(`/api/studies/${caseB}/context`)).json();
  assertTruthy(context.patient?.patientReference === newCode && context.clinicalContext?.ageAtStudy === 36 && context.clinicalContext?.clinicalReason === "Motivo B", `contexto B persistido: ${JSON.stringify(context)}`);
  assertTruthy((await api(`/api/studies/${caseBOld}`)).status === 404, "el ID viejo no llegó a crear ningún estudio");
  console.log("ok 2 - paciente nuevo por diálogo, volver entre pasos, ID cambiado tras cargar (recarga explícita), contexto conservado y un análisis");
  await page.close();

  /* ============================== C. sin asociación ============================== */
  const caseC = `CASE-STEPS-C-${stamp}`;
  page = await newPage();
  const postsBeforeC = counts.patientPost;
  await page.getByRole("button", { name: "Continuar sin asociar paciente" }).click();
  assertTruthy((await page.locator(".ns-summary").innerText()).includes("Sin asociación"), "el resumen dice «Sin asociación»");
  await page.getByPlaceholder("CASE-XXXX").fill(caseC);
  await next(page).click();
  await heading(page, "Imágenes").waitFor();
  await loadPlaneFile(page, "steps-c-sagittal.dcm");
  await next(page).click();
  await heading(page, "Contexto y revisión").waitFor();
  const unknownAge = await page.locator(".ns-age").innerText();
  assertTruthy(/No hay paciente con fecha de nacimiento y falta la fecha del estudio/.test(unknownAge), `motivo real de la edad: ${unknownAge}`);
  await page.getByPlaceholder("Años").fill("62");
  assertTruthy(/Declarada/.test(await page.locator(".ns-age").innerText()), "edad declarada");
  assertTruthy(/Sin asociación/.test(await page.locator(".ns-review").innerText()), "la revisión dice Sin asociación");
  const runsBeforeC = counts.run;
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(`${frontendUrl.replace(/\/$/, "")}/estudio/${caseC}`, { timeout: 30000 });
  assertTruthy(counts.run === runsBeforeC + 1 && counts.patientPost === postsBeforeC, "un análisis y ningún paciente creado");
  context = await (await api(`/api/studies/${caseC}/context`)).json();
  assertTruthy(context.patient === null && context.clinicalContext?.ageAtStudy === 62 && context.clinicalContext?.ageProvenance === "reported", `contexto C persistido: ${JSON.stringify(context)}`);
  console.log("ok 3 - recorrido sin asociación: edad declarada, un análisis, ningún paciente creado");
  await page.close();

  await browser.close();
  console.log(`Recorrido de Nuevo estudio en tres pasos contra ${frontendUrl}: OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
