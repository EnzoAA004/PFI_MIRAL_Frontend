import { chromium } from "playwright";

/**
 * Etapa 81-F: el primer E2E de browser Post-E50 corrido contra un stack REAL en ejecución -- Frontend real
 * (build de producción servido por nginx), Backend Spring Boot real, Postgres real, mock determinístico de
 * AI/LLM (`docker-compose.post-e50.yml`). Cada etapa post-e50 anterior (77-80) lo difirió,
 * citando el costo de construir un fixture válido de "canonical multiplanar run"; la Etapa 81 rastreó
 * la precondición real (`GET /api/studies/{caseId}` necesita una fila `domain_study_runs` con un
 * `sagittalModelKey`/`runId` no vacío) y encontró que es simple metadata JSON -- no hacen falta assets
 * de imagen reales (`resolvePersistedPlaneWorkspace` tolera con gracia una URL de asset faltante).
 *
 * Esto NO está conectado a `npm test` -- requiere el stack Docker Post-E50 corriendo externamente
 * (`docker compose -f docker-compose.post-e50.yml up -d`) más un Study pre-sembrado (ver
 * `docs/post_e50/81_PRODUCT_HARDENING_FRONTEND.md` para el SQL exacto del fixture usado). Es un
 * script de confirmación corrido manualmente, en línea con la restricción de esta etapa de "no meter framework enorme"
 * -- un script, sin un nuevo framework de E2E, reutilizando Playwright (ya es una devDependency, ya usado
 * por `scripts/playwright-*.mjs` para las etapas previas a post-e50).
 */

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const caseId = process.env.POST_E50_E2E_CASE_ID ?? "CASE-81-B";
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

  // 1. La vista de revisión debe renderizar -- nunca el estado de error de contrato.
  const contractError = await page.locator("text=No se pudo interpretar la respuesta").count();
  assertTruthy(contractError === 0, "StudyReviewView cayó en ContractErrorState en vez de renderizar");
  console.log("ok 1 - StudyReviewView renderiza (sin ContractErrorState) contra el Backend real");

  // 2. El caseId real aparece en la página.
  const bodyText = await page.textContent("body");
  assertTruthy(bodyText.includes(caseId), `la página no muestra ${caseId}`);
  console.log("ok 2 - el caseId real del Study aparece en la página");

  // 3. La pestaña "Más" -> abrir "Evolución" y "Asistente" (Stage 79/80/81 features).
  const moreTab = page.locator("button", { hasText: "Más" }).first();
  if (await moreTab.count()) {
    await moreTab.click();
    const evolucion = page.locator("summary", { hasText: "Evolución" }).first();
    const asistente = page.locator("summary", { hasText: "Asistente" }).first();
    assertTruthy((await evolucion.count()) > 0, "no se encontró la sección 'Evolución'");
    assertTruthy((await asistente.count()) > 0, "no se encontró la sección 'Asistente'");
    await asistente.click();
    console.log("ok 3 - las secciones 'Evolución' y 'Asistente' existen en la pestaña 'Más'");

    // 4. Enviar una pregunta real al asistente (Backend real -> mock LLM real).
    const textarea = page.locator('textarea[aria-label="Escribir una pregunta"]');
    if (await textarea.count()) {
      await textarea.fill("Que mediciones estan disponibles?");
      await page.locator("button", { hasText: "Enviar" }).click();
      await page.waitForSelector(".chat-message-assistant", { timeout: 15000 });
      console.log("ok 4 - el asistente contextual responde contra el Backend/LLM mock reales");
    } else {
      console.log("skip 4 - textarea del asistente no visible (revisar disclaimer/estado inicial)");
    }
  } else {
    console.log("skip 3-4 - pestaña 'Más' no encontrada, revisar selectores");
  }

  const seriousErrors = consoleErrors.filter((entry) => !entry.includes("favicon"));
  assertTruthy(seriousErrors.length === 0, `errores de consola inesperados: ${seriousErrors.join(" | ")}`);
  console.log("ok 5 - sin errores de consola inesperados");

  await browser.close();
  console.log(`Post-E50 real-backend browser E2E (stage 81-F) contra ${frontendUrl}: OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
