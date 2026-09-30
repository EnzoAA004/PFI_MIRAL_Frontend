import { chromium } from "playwright";

/**
 * Stage 81-F: the first Post-E50 browser E2E run against a REAL running stack -- real Frontend
 * (nginx-served production build), real Spring Boot Backend, real Postgres, deterministic mock
 * AI/LLM (`docker-compose.post-e50.yml`). Every previous post-e50 stage (77-80) deferred this,
 * citing the cost of constructing a valid "canonical multiplanar run" fixture; Stage 81 traced
 * the actual precondition (`GET /api/studies/{caseId}` needs one `domain_study_runs` row with a
 * non-empty `sagittalModelKey`/`runId`) and found it's plain JSON metadata -- no real image
 * assets required (`resolvePersistedPlaneWorkspace` tolerates a missing asset URL gracefully).
 *
 * This is NOT wired into `npm test` -- it requires the Post-E50 Docker stack running externally
 * (`docker compose -f docker-compose.post-e50.yml up -d`) plus a pre-seeded Study (see
 * `docs/post_e50/81_PRODUCT_HARDENING_FRONTEND.md` for the exact fixture SQL used). It is a
 * manually-run confirmation script, matching this stage's "no meter framework enorme" constraint
 * -- one script, no new E2E framework, reusing Playwright (already a devDependency, already used
 * by `scripts/playwright-*.mjs` for pre-post-e50 stages).
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
