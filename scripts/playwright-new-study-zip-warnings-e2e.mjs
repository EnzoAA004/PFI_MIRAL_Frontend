import { chromium } from "playwright";

/**
 * Advertencias del resultado del ZIP en "Nuevo estudio".
 *
 * La respuesta de `POST /api/ai/studies` se devuelve con una ruta de Playwright (mismo contrato
 * que `StudyIngestionResponse`) para controlar exactamente qué advertencias llegan; el resto del
 * stack es el real de `docker-compose.post-e50.yml`.
 *
 *   export $(node scripts/post-e50-e2e-seed.mjs 2>/dev/null)
 *   node scripts/playwright-new-study-zip-warnings-e2e.mjs
 *
 * Verifica que:
 * - una advertencia conocida se reformula en «Limitaciones» y su texto original queda en
 *   «Detalles técnicos»;
 * - una advertencia DESCONOCIDA se ve tal cual en «Limitaciones» (sin abrir nada), no solo en
 *   «Detalles técnicos»;
 * - el bloqueo del contrato se conserva: sin serie sagital no se puede continuar a la revisión ni
 *   analizar, y el pie dice por qué.
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const token = process.env.POST_E50_E2E_TOKEN;
if (!token) {
  console.error("POST_E50_E2E_TOKEN es obligatorio (node scripts/post-e50-e2e-seed.mjs lo imprime).");
  process.exit(1);
}

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}

const KNOWN_P107 = "solo una ponderacion sagital (T1 o T2) esta disponible para P10.7; el hallazgo se generara con una sola modalidad";
const UNKNOWN = "advertencia nueva del modulo: serie 3 con orientacion ambigua";
const NO_SAGITTAL = "no se encontro serie sagital en el estudio";

function series(plane, weighting, sliceCount, index) {
  return { inputId: `inp_synthetic_${index}`, description: `serie_sintetica_${index}`, plane, weighting, sliceCount, multiplanar: false, derived: false, analyzable: true };
}

function ingestion({ warnings, withSagittal }) {
  const found = withSagittal ? [series("sagittal", "t2", 15, 0), series("axial", "t2", 12, 1)] : [series("axial", "t2", 12, 0)];
  return {
    caseId: "CASE-WARN",
    studyId: "study-synthetic",
    seriesFound: found,
    warnings,
    ...(withSagittal ? { sagittal: { ...found[0], seriesIndex: 0 }, sagittalT2: { ...found[0], seriesIndex: 0 }, axial: { ...found[1], seriesIndex: 1 } } : { axial: { ...found[0], seriesIndex: 0 } }),
    humanReviewRequired: true,
    notClinicalDiagnosis: true,
  };
}

async function seedSession(page) {
  await page.addInitScript(({ token: accessToken }) => {
    const session = {
      accessToken, refreshToken: accessToken, tokenType: "Bearer",
      user: { id: "e2e-doctor", fullName: "Dra. E2E", email: "doctor.demo@pfi.local", licenseNumber: "MP-000", specialty: "Radiologia", institution: "Centro E2E", roles: ["ADMIN", "DOCTOR", "REVIEWER"], verified: true, approved: true, onboardingCompleted: true },
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

async function loadZip(browser, body) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.route("**/api/ai/studies", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await seedSession(page);
  await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio" }).waitFor();
  await page.getByPlaceholder("CASE-XXXX").fill("CASE-WARN");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Imágenes", level: 2 }).waitFor();
  await page.locator('.ns-zip input[type="file"]').setInputFiles({ name: "sintetico.zip", mimeType: "application/zip", buffer: Buffer.from("PK-synthetic") });
  await page.getByText(/series? detectadas?/).waitFor({ timeout: 10000 });
  return page;
}

async function main() {
  const browser = await chromium.launch();

  // 1. Advertencia conocida + desconocida.
  let page = await loadZip(browser, ingestion({ warnings: [KNOWN_P107, UNKNOWN], withSagittal: true }));
  const limitations = await page.locator(".ns-limitations").innerText();
  assertTruthy(/una sola ponderación sagital \(T1 o T2\)/.test(limitations) && /una sola modalidad/.test(limitations), "la limitación conocida debe reformularse conservando su sentido");
  assertTruthy(!/P10\.7/.test(limitations), "la jerga P10.7 no debe estar en el texto principal");
  console.log("ok 1 - advertencia conocida reformulada en «Limitaciones»");
  assertTruthy(limitations.includes(UNKNOWN), "la advertencia desconocida debe verse tal cual en «Limitaciones»");
  assertTruthy(await page.locator(".ns-limitations").getByText(UNKNOWN).isVisible(), "la advertencia desconocida debe estar visible sin abrir los detalles");
  assertTruthy((await page.locator(".ns-tech[open]").count()) === 0, "los detalles técnicos deben seguir plegados");
  console.log("ok 2 - advertencia desconocida visible en «Limitaciones» con el texto original, sin abrir nada");
  await page.locator(".ns-tech summary").click();
  const tech = await page.locator(".ns-tech").innerText();
  assertTruthy(tech.includes(KNOWN_P107) && tech.includes(UNKNOWN), "los mensajes originales deben conservarse también en «Detalles técnicos»");
  console.log("ok 3 - los mensajes originales (conocido y desconocido) siguen en «Detalles técnicos»");
  await page.close();

  // 2. Solo desconocida: la sección existe y no se pierde.
  page = await loadZip(browser, ingestion({ warnings: [UNKNOWN], withSagittal: true }));
  assertTruthy((await page.locator(".ns-limitations").innerText()).includes(UNKNOWN), "una única advertencia desconocida debe mostrarse");
  console.log("ok 4 - una única advertencia desconocida también se muestra");
  await page.close();

  // 3. Bloqueo del contrato: sin sagital no se analiza.
  page = await loadZip(browser, ingestion({ warnings: [NO_SAGITTAL], withSagittal: false }));
  const blocked = await page.locator(".ns-limitations").innerText();
  assertTruthy(/no incluye una serie sagital/.test(blocked), "debe decir que falta la serie sagital");
  assertTruthy(await page.getByRole("button", { name: "Continuar", exact: true }).isDisabled(), "sin sagital no se puede continuar a la revisión");
  assertTruthy((await page.locator(".ns-foot-hint").innerText()).includes("no incluye una serie sagital"), "el pie debe explicar el bloqueo");
  assertTruthy((await page.getByRole("button", { name: "Analizar estudio", exact: true }).count()) === 0, "«Analizar estudio» no existe fuera del último paso");
  console.log("ok 5 - sin serie sagital se conserva el bloqueo y el pie explica por qué");
  await page.close();

  // 4. Sin advertencias: no aparece el bloque.
  page = await loadZip(browser, ingestion({ warnings: [], withSagittal: true }));
  assertTruthy((await page.locator(".ns-limitations").count()) === 0, "sin advertencias no debe haber bloque de limitaciones");
  assertTruthy(await page.getByRole("button", { name: "Continuar", exact: true }).isEnabled(), "con sagital y sin advertencias se puede continuar");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).waitFor();
  assertTruthy(await page.getByRole("button", { name: "Analizar estudio", exact: true }).isEnabled(), "con sagital y sin advertencias se puede analizar");
  console.log("ok 6 - sin advertencias no hay bloque y se puede analizar");
  await page.close();

  await browser.close();
  console.log(`Advertencias del ZIP en Nuevo estudio contra ${frontendUrl}: OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
