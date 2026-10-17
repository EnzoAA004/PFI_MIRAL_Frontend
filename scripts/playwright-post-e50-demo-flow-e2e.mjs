import { chromium } from "playwright";
import { suspendedForRetiredTools } from "./lib/retired-tools.mjs";
suspendedForRetiredTools("playwright-post-e50-demo-flow-e2e.mjs", ["demo", "report"]);

const frontendUrl = process.env.POST_E50_FRONTEND_URL ?? "http://localhost:8188";
const backendUrl = process.env.POST_E50_BACKEND_URL ?? "http://localhost:8180";
const token = process.env.POST_E50_E2E_TOKEN;

if (!token) {
  console.error("POST_E50_E2E_TOKEN is required.");
  process.exit(1);
}

/** Las corridas de demostración ya no se inician desde el visor: el e2e las crea por la API. */
async function startDemoAnalysis(caseId) {
  const response = await fetch(`${backendUrl}/api/studies/${encodeURIComponent(caseId)}/product-analysis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`E2E setup failed: product-analysis ${response.status}`);
}

async function openDemoAnalysis(page) {
  await openTool(page, "demo");
  await page.getByTestId("demo-analysis-notice").waitFor({ timeout: 10000 });
}

function assertTruthy(value, message) {
  if (!value) throw new Error(`Demo E2E assertion failed: ${message}`);
}

async function seedSession(page) {
  await page.addInitScript(({ token: accessToken }) => {
    const session = {
      accessToken,
      refreshToken: accessToken,
      tokenType: "Bearer",
      user: {
        id: "demo-doctor",
        fullName: "Dra. Demo Reviewer",
        email: "doctor.demo@pfi.local",
        licenseNumber: "MN-DEMO-2026",
        specialty: "Radiologia",
        institution: "PFI Academic Lab",
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

async function api(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  const failedResponses = [];
  const legacyPatientRequests = [];
  const reportRequests = [];

  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/patients") || /\/api\/studies\/[^/]+\/patient\b/.test(url)) {
      legacyPatientRequests.push(`${request.method()} ${url}`);
    }
    if (/\/api\/studies\/DEMO-LUMBAR-2026-03\/report/.test(url)) {
      reportRequests.push(`${request.method()} ${url}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await seedSession(page);

  await page.goto(`${frontendUrl}/pacientes`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Paciente", { timeout: 10000 });
  const patientListText = await page.textContent("body");
  assertTruthy(patientListText.includes("DEMO-LUMBAR-2026-03"), "la lista de pacientes no muestra el último Study demo");
  assertTruthy(patientListText.includes("DEMO-LUMBAR-ALT-01"), "la lista no muestra el paciente alternativo demo");
  console.log("ok 1 - /pacientes muestra fixtures demo de-identificados");

  await page.goto(`${frontendUrl}/estudio/DEMO-LUMBAR-2026-03`, { waitUntil: "networkidle" });
  await page.getByText("DEMO-LUMBAR-2026-03", { exact: false }).first().waitFor({ timeout: 10000 });
  console.log("ok 2 - Study actual demo abre");

  await openDemoAnalysis(page);
  const findingsText = await page.textContent("body");
  assertTruthy(findingsText.includes("Análisis parcial") || findingsText.includes("partial"), "no se ve estado partial");
  assertTruthy(findingsText.includes("L4-L5"), "no se ve nivel L4-L5");
  console.log("ok 3 - hallazgos AI partial visibles");

  await openTool(page, "history");
  await page.getByRole("button", { name: "Ver historial del paciente" }).click();
  await page.waitForSelector("text=Línea de tiempo de estudios", { timeout: 10000 });
  const historyText = await page.textContent("body");
  assertTruthy(historyText.includes("DEMO-LUMBAR-2026-01"), "falta Study histórico 01");
  assertTruthy(historyText.includes("DEMO-LUMBAR-2026-02"), "falta Study histórico 02");
  assertTruthy(historyText.includes("DEMO-LUMBAR-2026-03"), "falta Study actual 03");
  console.log("ok 4 - historial muestra 3 Studies");

  const evolutionSelect = page.locator('select[aria-label="Nivel y métrica"]');
  await evolutionSelect.waitFor({ timeout: 10000 });
  const majorOption = evolutionSelect.locator("option", { hasText: "Eje mayor" }).first();
  if (await majorOption.count()) {
    await evolutionSelect.selectOption(await majorOption.getAttribute("value"));
  }
  await page.waitForTimeout(1200);
  const evolutionText = await page.textContent("body");
  assertTruthy(evolutionText.includes("11.9"), "evolución no muestra 11.9");
  assertTruthy(evolutionText.includes("12.3"), "evolución no muestra 12.3");
  assertTruthy(evolutionText.includes("12.9"), "evolución no muestra valor efectivo 12.9");
  assertTruthy(evolutionText.includes("Valor revisado"), "evolución no marca corrección profesional");
  console.log("ok 5 - evolución determinística 11.9 -> 12.3 -> 12.9 visible");

  await page.goto(`${frontendUrl}/estudio/DEMO-LUMBAR-2026-03`, { waitUntil: "networkidle" });
  await openTool(page, "report");
  await page.getByTestId("backend-study-report").waitFor({ timeout: 10000 });
  const reportText = await page.getByTestId("backend-study-report").textContent();
  assertTruthy(reportText.includes("pfi.study-report.v1"), "reporte estructurado no visible en UI");
  assertTruthy(reportText.includes("12.9"), "reporte no muestra valor efectivo corregido");
  console.log("ok 6 - reporte estructurado visible en UI");

  const report = await api("/api/studies/DEMO-LUMBAR-2026-03/report?baselineCaseId=DEMO-LUMBAR-2026-02");
  assertTruthy(report.schemaVersion === "pfi.study-report.v1", "schema report inesperado");
  const jsonReport = await api("/api/studies/DEMO-LUMBAR-2026-03/report.json");
  assertTruthy(jsonReport.schemaVersion === "pfi.study-report.v1", "JSON export inesperado");
  const pdf = await api("/api/studies/DEMO-LUMBAR-2026-03/report.pdf");
  assertTruthy(new TextDecoder().decode(pdf.slice(0, 5)) === "%PDF-", "PDF signature inválida");
  console.log("ok 7 - report JSON/PDF válidos");

  const comparison = await api("/api/studies/DEMO-LUMBAR-2026-03/longitudinal-comparison?baselineCaseId=DEMO-LUMBAR-2026-02");
  const majorComparison = comparison.measurements.find((measurement) => measurement.metric === "majorAxisMm");
  assertTruthy(Math.abs(majorComparison.deltaAbsolute - 0.6) < 0.01, "delta longitudinal inesperado");
  console.log("ok 8 - comparación Study B vs C determinística");

  const chat = await api("/api/studies/DEMO-LUMBAR-2026-03/chat", {
    method: "POST",
    body: JSON.stringify({ question: "¿Qué cambió respecto del estudio anterior?" }),
  });
  assertTruthy(JSON.stringify(chat).includes("12.3 mm a 12.9 mm"), "respuesta del assistant inesperada");
  const conversations = await api("/api/studies/DEMO-LUMBAR-2026-03/chat-conversations");
  assertTruthy(conversations.conversations.length > 0, "chat no persistió conversación");
  console.log("ok 9 - assistant determinístico y conversación persistida");

  await page.reload({ waitUntil: "networkidle" });
  await openTool(page, "report");
  await page.getByTestId("backend-study-report").waitFor({ timeout: 10000 });
  assertTruthy((await page.textContent("body")).includes("12.9"), "reload no preservó corrección/reporte");
  console.log("ok 10 - reload persistence");

  assertTruthy(legacyPatientRequests.length === 0, `requests legacy observados: ${legacyPatientRequests.join(", ")}`);
  assertTruthy(reportRequests.length > 0, "la UI no consultó endpoints /report");
  const toleratedConsoleNoise = consoleErrors.filter((entry) => entry.includes("favicon"));
  const seriousErrors = consoleErrors.filter((entry) => !toleratedConsoleNoise.includes(entry));
  if (failedResponses.length) console.log(`info - failedResponses=${failedResponses.join(" | ")}`);
  assertTruthy(failedResponses.length === 0, `HTTP failures observed: ${failedResponses.join(" | ")}`);
  assertTruthy(seriousErrors.length === 0, `console errors: ${seriousErrors.join(" | ")}`);
  console.log("ok 11 - 0 console errors críticos y 0 legacy patient endpoints");

  await browser.close();
  console.log("Stage 89 demo browser E2E: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/** Abre una herramienta del estudio desde su índice ("Herramientas del estudio" en la cabecera del panel). */
async function openTool(page, id) {
  const index = page.getByTestId("tools-index");
  if (!(await index.isVisible())) {
    const open = page.getByTestId("tools-open");
    if ((await open.getAttribute("aria-pressed")) !== "true") await open.click();
    else await page.locator(".rr-tool-view:visible .rr-tool-back").click();
  }
  await page.locator(`[data-tool-id="${id}"]`).click();
  await page.locator(`.rr-tool-view[data-tool="${id}"]`).waitFor();
}
