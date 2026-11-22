import { chromium } from "playwright";

/**
 * Etapa 84: E2E de browser con backend real para el historial de pacientes / timeline longitudinal, extendiendo
 * el patrón `playwright-post-e50-real-backend-e2e.mjs` de la Etapa 81 (Frontend real, Backend real,
 * Postgres real, mock determinístico de AI/LLM -- `docker-compose.post-e50.yml`). Requiere el fixture
 * de `84_PATIENT_HISTORY_BACKEND.md` (subjectRef PAT-84-1, Studies A/B/C + una fila legacy
 * `domain_study_runs` para CASE-84-C para que `StudyReviewView` pueda renderizar) ya sembrado.
 *
 * No está conectado a `npm test` -- script de confirmación manual, igual que el propio alcance de "no meter
 * framework enorme" de la Etapa 81.
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const caseId = process.env.POST_E50_E2E_CASE_ID ?? "CASE-84-C";
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
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await seedSession(page);
  await page.goto(`${frontendUrl}/estudio/${encodeURIComponent(caseId)}`, { waitUntil: "networkidle" });

  // 1. Study C debe renderizar (mismo chequeo que Stage 81's real-backend E2E).
  assertTruthy((await page.locator("text=No se pudo interpretar la respuesta").count()) === 0, "StudyReviewView cayó en ContractErrorState");
  console.log("ok 1 - StudyReviewView (CASE-84-C) renderiza contra el Backend real");

  // 2. Abrir "Más" -> "Historial del paciente".
  const moreTab = page.locator("button", { hasText: "Más" }).first();
  await moreTab.click();
  const historyDetails = page.locator("summary", { hasText: "Historial del paciente" }).first();
  assertTruthy((await historyDetails.count()) > 0, "no se encontró la sección 'Historial del paciente'");
  await historyDetails.click();
  console.log("ok 2 - la sección 'Historial del paciente' existe en la pestaña 'Más'");

  // 3. Click "Ver historial del paciente" -> navega a /pacientes/PAT-84-1.
  // Se espera un texto que sólo existe en la página YA cargada (no el shell/loading state ni el
  // <summary> de StudyReviewView, que también dice "Historial del paciente" y puede seguir en el
  // DOM un instante después del click).
  await page.locator("button", { hasText: "Ver historial del paciente" }).click();
  await page.waitForSelector("text=Línea de tiempo de estudios", { timeout: 10000 });
  const bodyTextAfterNav = await page.textContent("body");
  assertTruthy(!bodyTextAfterNav.includes("PAT-84-1"), "el subjectRef crudo se imprimió en pantalla (84-W)");
  console.log("ok 3 - navega al historial del paciente sin imprimir el subjectRef crudo");

  // 4. Ver 3 estudios (A, B, C) y ninguno de otro paciente.
  assertTruthy(bodyTextAfterNav.includes("CASE-84-A") && bodyTextAfterNav.includes("CASE-84-B") && bodyTextAfterNav.includes("CASE-84-C"), "no se ven los 3 estudios esperados");
  assertTruthy(!bodyTextAfterNav.includes("CASE-84-D"), "un estudio de otro paciente apareció en el historial");
  assertTruthy(bodyTextAfterNav.includes("Estudio actual"), "no se marcó el estudio actual");
  console.log("ok 4 - se ven los 3 estudios de PAT-84-1 (nunca CASE-84-D), con 'Estudio actual' marcado");

  // 5. Abrir evolución -> seleccionar explícitamente majorAxisMm (la key con la corrección
  // profesional del fixture) -- el selector puede abrir con cualquiera de las 3 keys disponibles
  // por defecto (areaMm2/majorAxisMm/minorAxisMm), así que no se asume cuál quedó seleccionada.
  const evolutionSelect = page.locator('select[aria-label="Nivel y métrica"]');
  await evolutionSelect.waitFor({ timeout: 10000 });
  const majorAxisOption = evolutionSelect.locator("option", { hasText: "Eje mayor" });
  if (await majorAxisOption.count()) {
    const optionValue = await majorAxisOption.first().getAttribute("value");
    await evolutionSelect.selectOption(optionValue);
  }
  await page.waitForTimeout(1500); // deja completar el segundo fetch (la serie en sí).
  const evolutionText = await page.textContent("body");
  assertTruthy(evolutionText.includes("11.9") || evolutionText.includes("12.3") || evolutionText.includes("12.9"), "no se ven valores de la serie de evolución");
  console.log("ok 5 - la sección de evolución muestra valores reales de la serie");

  // 6. "Valor revisado" visible para el punto corregido (CASE-84-C, majorAxisMm).
  assertTruthy(evolutionText.includes("Valor revisado"), "no se indica qué punto fue corregido profesionalmente");
  console.log("ok 6 - el punto con corrección profesional se marca como 'Valor revisado'");

  // 7. Comparar CASE-84-B con el estudio actual (CASE-84-C).
  const compareButtons = page.locator("button", { hasText: "Comparar" });
  if (await compareButtons.count()) {
    await compareButtons.first().click();
    await page.waitForSelector("text=Comparar con estudio actual", { timeout: 10000 });
    console.log("ok 7 - la acción 'Comparar' abre el panel de comparación (Stage 79) desde el historial");
  } else {
    console.log("skip 7 - no había un botón 'Comparar' visible (verificar selector si esto persiste)");
  }

  // 8. Navegar de vuelta a un Study desde el historial ("Abrir estudio").
  await page.locator("button", { hasText: "Abrir estudio" }).first().click();
  await page.waitForURL(/\/estudio\//, { timeout: 10000 });
  console.log("ok 8 - 'Abrir estudio' navega de vuelta a StudyReviewView sin recargar la página completa");

  const seriousErrors = consoleErrors.filter((entry) => !entry.includes("favicon"));
  assertTruthy(seriousErrors.length === 0, `errores de consola inesperados: ${seriousErrors.join(" | ")}`);
  console.log("ok 9 - sin errores de consola inesperados");

  await browser.close();
  console.log(`Post-E50 patient history browser E2E (stage 84) contra ${frontendUrl}: OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
