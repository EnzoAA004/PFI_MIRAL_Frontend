import { chromium } from "playwright";

/**
 * Navegación de salida de "Nuevo estudio", contra el stack real de `docker-compose.post-e50.yml`
 * (backend real, IA simulada) con las fixtures de `post-e50-e2e-seed.mjs`.
 *
 *   export $(node scripts/post-e50-e2e-seed.mjs 2>/dev/null)
 *   node scripts/playwright-new-study-exit-e2e.mjs
 *
 * Verifica:
 * 1. Con paciente y contexto cargados, cancelar la confirmación de salida conserva los datos.
 * 2. Confirmar la salida vuelve a la lista (con sus filtros) y devuelve el foco al botón de origen.
 * 3. Durante un análisis, Volver y Cancelar están bloqueados, ni siquiera forzando el clic ni con
 *    la confirmación abierta salen de la vista, y no se puede enviar un segundo análisis.
 *
 * La corrida se retiene unos segundos con `page.route` solo para tener una ventana estable de
 * "análisis en curso"; la respuesta es la real del backend (`route.continue`).
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const token = process.env.POST_E50_E2E_TOKEN;
const caseId = process.env.POST_E50_EXIT_CASE_ID ?? `CASE-EXIT-${Date.now()}`;

if (!token) {
  console.error("POST_E50_E2E_TOKEN es obligatorio (node scripts/post-e50-e2e-seed.mjs lo imprime).");
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
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  let runRequests = 0;
  let releaseRun;
  const runHeld = new Promise((resolve) => { releaseRun = resolve; });
  await page.route("**/api/ai/multiplanar/run", async (route) => {
    runRequests += 1;
    await runHeld;
    await route.continue();
  });

  await seedSession(page);
  await page.goto(`${frontendUrl}/worklist`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 15000 });

  // La lista conserva su filtro mientras se visita la vista (se elige una prioridad real).
  const prioritySelect = page.locator("select").filter({ has: page.locator("option", { hasText: "Alta" }) }).first();
  await prioritySelect.selectOption({ label: "Alta" });

  const openButton = page.getByRole("button", { name: "Nuevo estudio" });
  await openButton.click();
  await page.getByRole("heading", { name: "Nuevo estudio" }).waitFor();

  // ---- datos: paciente + edad declarada + texto clinico + ID
  await page.getByLabel("Buscar por código o nombre").fill("PAT-87");
  await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor();
  await page.getByLabel(/Fecha del estudio/).fill("2026-10-06");
  await page.locator(".ns-clinical-details summary").click();
  await page.getByLabel("Motivo del estudio").fill("Motivo sintético de salida");
  await page.getByPlaceholder("CASE-XXXX").fill(caseId);

  // ---- 1. cancelar la confirmacion conserva todo
  await page.getByRole("button", { name: "Volver a estudios" }).click();
  await page.locator(".ns-confirm").waitFor({ timeout: 5000 });
  assertTruthy(await page.evaluate(() => document.activeElement?.textContent?.trim() === "Seguir editando"), "el foco debe ir a «Seguir editando»");
  await page.getByRole("button", { name: "Seguir editando" }).click();
  assertTruthy((await page.locator(".ns-confirm").count()) === 0, "la confirmación debe cerrarse");
  assertTruthy((await page.getByPlaceholder("CASE-XXXX").inputValue()) === caseId, "se perdió el ID del estudio");
  assertTruthy((await page.locator('[aria-label="Paciente seleccionado"]').innerText()).includes("PAT-87-A"), "se perdió el paciente");
  assertTruthy((await page.getByLabel("Motivo del estudio").inputValue()) === "Motivo sintético de salida", "se perdió el motivo");
  assertTruthy(/51 años/.test(await page.locator(".ns-age").innerText()), "se perdió la edad calculada");
  console.log("ok 1 - «Seguir editando» conserva paciente, edad, contexto e ID (confirmación desde «Volver»)");

  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.locator(".ns-confirm").waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Seguir editando" }).click();
  assertTruthy((await page.getByPlaceholder("CASE-XXXX").inputValue()) === caseId, "se perdió el ID tras Cancelar + Seguir editando");
  console.log("ok 2 - la confirmación abierta desde «Cancelar» también conserva los datos");

  // ---- 2. confirmar la salida vuelve a la lista
  await page.getByRole("button", { name: "Volver a estudios" }).click();
  await page.getByRole("button", { name: "Salir sin guardar" }).click();
  await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 5000 });
  assertTruthy((await page.locator(".wl-new-study").count()) === 0, "la vista debe cerrarse");
  assertTruthy(await page.evaluate(() => document.activeElement?.textContent?.includes("Nuevo estudio")), "el foco debe volver al botón «Nuevo estudio»");
  assertTruthy((await prioritySelect.evaluate((el) => el.selectedOptions[0].textContent)) === "Alta", "la lista perdió el filtro");
  console.log("ok 3 - «Salir sin guardar» vuelve a la lista con su filtro y devuelve el foco al botón de origen");

  await openButton.click();
  await page.getByRole("heading", { name: "Nuevo estudio" }).waitFor();
  assertTruthy((await page.getByPlaceholder("CASE-XXXX").inputValue()) === "", "al reabrir el formulario debe estar vacío");
  assertTruthy((await page.locator('[aria-label="Paciente seleccionado"]').count()) === 0, "al reabrir no debe haber paciente");
  // Sin datos, volver no pregunta.
  await page.getByRole("button", { name: "Volver a estudios" }).click();
  await page.getByRole("heading", { name: "Lista de estudios" }).waitFor({ timeout: 5000 });
  console.log("ok 4 - reabrir deja el formulario vacío y salir sin datos no pide confirmación");

  // ---- 3. durante un analisis
  await openButton.click();
  await page.getByRole("heading", { name: "Nuevo estudio" }).waitFor();
  await page.getByPlaceholder("CASE-XXXX").fill(caseId);
  await page.locator("button", { hasText: "Cargar archivos por plano" }).click();
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "exit-sagittal.dcm",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic-exit-fixture-no-patient-data"),
  });
  await page.waitForSelector("text=exit-sagittal.dcm cargado", { timeout: 10000 });

  // Abre la confirmación y, con ella abierta, lanza el análisis: no debe quedar una salida disponible.
  await page.getByRole("button", { name: "Volver a estudios" }).click();
  await page.locator(".ns-confirm").waitFor();
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.getByText("Procesando imágenes").first().waitFor({ timeout: 10000 });
  assertTruthy((await page.locator(".ns-confirm").count()) === 0 || !(await page.getByRole("button", { name: "Salir sin guardar" }).isEnabled()), "con el análisis en curso no puede quedar «Salir sin guardar» disponible");
  console.log("ok 5 - al iniciar el análisis con la confirmación abierta, la salida deja de estar disponible");

  assertTruthy(await page.getByRole("button", { name: "Volver a estudios" }).isDisabled(), "«Volver» debe estar deshabilitado");
  assertTruthy(await page.getByRole("button", { name: "Cancelar", exact: true }).isDisabled(), "«Cancelar» debe estar deshabilitado");
  assertTruthy(await page.getByPlaceholder("CASE-XXXX").isDisabled(), "el ID debe estar bloqueado");
  assertTruthy((await page.locator(".ns-foot-hint").innerText()).includes("El análisis está en curso"), "el pie debe explicar el bloqueo");
  const processing = page.getByRole("button", { name: /Procesando/ });
  assertTruthy(await processing.isDisabled(), "el botón principal debe estar deshabilitado");
  await page.getByRole("button", { name: "Volver a estudios" }).click({ force: true });
  await page.getByRole("button", { name: "Cancelar", exact: true }).click({ force: true });
  await processing.click({ force: true });
  await processing.dblclick({ force: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  assertTruthy((await page.locator(".wl-new-study").count()) === 1, "forzar Volver/Cancelar/Escape no debe salir de la vista");
  assertTruthy((await page.locator(".ns-confirm").count()) === 0, "no debe abrirse una confirmación durante el análisis");
  assertTruthy(runRequests === 1, `un solo POST de corrida, se observaron ${runRequests}`);
  console.log("ok 6 - durante el análisis Volver/Cancelar/Escape no salen ni siquiera forzados, y no hay segundo envío");

  releaseRun();
  await page.waitForURL(`${frontendUrl.replace(/\/$/, "")}/estudio/${caseId}`, { timeout: 30000 });
  assertTruthy(runRequests === 1, `tras terminar sigue habiendo un solo POST de corrida (${runRequests})`);
  console.log("ok 7 - el análisis termina, abre el estudio y no se duplicó la corrida");

  await browser.close();
  console.log(`Navegación de salida de Nuevo estudio contra ${frontendUrl}: OK (${caseId})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
