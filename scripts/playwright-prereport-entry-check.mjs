import { chromium } from "playwright";

/**
 * Solo lectura: en un estudio pendiente y en uno finalizado, la pestaña Revisión muestra «Preparar preinforme» y ningún
 * exportador antiguo, y el editor abre la corrida exacta. Bloquea cualquier escritura y no guarda ni aprueba nada.
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const API = process.env.PFI_API ?? "http://localhost:8280";
const login = await (await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const token = login.accessToken ?? login.token;
const get = async (path) => (await (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json());

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const writes = [];
const assistantCalls = [];
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => {
  const request = route.request();
  if (request.method() === "GET") return route.continue();
  if (process.env.ASK_ASSISTANT === "1" && /\/studies\/[^/]+\/chat$/.test(request.url())) { assistantCalls.push(request.url().replace(/^https?:\/\/[^/]+/, "")); return route.continue(); }
  writes.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
  return route.abort();
});
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures += 1; console.log(`${ok ? "ok" : "FALLA"} - ${name}${extra ? ` · ${extra}` : ""}`); };

await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
if (await demo.count()) await demo.click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();

for (const [caseId, label] of [["MENDELEY-0015-MVBLQ5XS", "pendiente"], ["OSF-ID10-V2-T1", "finalizado"]]) {
  const detail = await get(`/api/studies/${caseId}`);
  const runId = detail.runs[0].summary.runId;
  const statusBefore = JSON.stringify((await get(`/api/ai/runs/${runId}/review`).catch(() => null)) ?? null);
  await page.goto(`${WEB}/estudio/${caseId}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("tab", { name: /Revisi/ }).click();
  const status = (await page.locator(".rr-status").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  const body = await page.locator("aside.rr-panel").innerText();
  const button = page.getByTestId("prepare-prereport");
  check(`${label} (${caseId}): estado visible «${status}»`, true);
  check(`${label}: «Preparar preinforme» habilitado`, await button.isEnabled());
  check(`${label}: sin el bloque ni los botones del exportador anterior`, !/informe del estudio finalizado está listo/i.test(body) && (await page.getByRole("button", { name: /Descargar PDF|Guardar HTML/ }).count()) === 0);
  const style = await button.evaluate((el) => { const css = getComputedStyle(el); return { bg: css.backgroundColor, border: css.borderTopColor, radius: css.borderTopLeftRadius }; });
  check(`${label}: el botón usa el estilo de la interfaz (no el nativo gris)`, style.bg !== "rgb(239, 239, 239)" && style.radius !== "0px", JSON.stringify(style));
  const headerText = await page.locator("header").first().innerText();
  check(`${label}: el encabezado no ofrece «Reporte técnico»`, !/Reporte técnico/i.test(headerText));
  await page.getByTestId("tools-open").click();
  const toolIds = await page.locator("[data-tool-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-tool-id")));
  const toolsText = await page.locator("[data-tool-id]").first().locator("xpath=ancestor::*[self::div or self::section][last()]").innerText().catch(() => "");
  check(`${label}: herramientas del estudio sin «Informe y exportación» (ids: ${toolIds.join(", ")})`, !toolIds.includes("report") && !/Informe estructurado|Exportar desde Backend|Informe y exportación/i.test(await page.locator("body").innerText()));
  if (process.env.ASK_ASSISTANT === "1" && label === "pendiente") {
    await page.locator('[data-tool-id="assistant"]').click();
    await page.getByTestId("assistant-panel").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid="assistant-connection"]'); return el && !/Comprobando/.test(el.textContent ?? ""); }, null, { timeout: 30_000 });
    console.log("  asistente · conexión:", (await page.getByTestId("assistant-connection").innerText()).replace(/\s+/g, " "));
    const t0 = Date.now();
    await page.getByLabel("Escribir una pregunta").fill("¿Qué nivel tiene una predicción presente?");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const outcome = await Promise.race([
      page.getByTestId("assistant-message-assistant").first().waitFor({ timeout: 240_000 }).then(() => "answer"),
      page.getByTestId("assistant-error").waitFor({ timeout: 240_000 }).then(() => "error"),
    ]);
    const text = outcome === "answer" ? (await page.getByTestId("assistant-message-assistant").first().locator("p").first().innerText()).trim() : (await page.getByTestId("assistant-error").innerText()).trim();
    check("asistente: la consulta breve desde 8288 devuelve respuesta", outcome === "answer", `${Date.now() - t0} ms · ${text.slice(0, 160)}`);
  }
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: /Revisi/ }).click();
  await page.getByTestId("prepare-prereport").click();
  await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
  const runShown = await page.getByTestId("prereport-editor").getAttribute("aria-label");
  const bar = (await page.locator(".pre-bar").innerText()).replace(/\s+/g, " ");
  check(`${label}: abre el editor nuevo de la corrida ${runId}`, /Preparar preinforme/.test(runShown ?? "") && /Borrador pendiente de revisión profesional/.test(bar));
  const requested = await get(`/api/studies/${caseId}/prereport?runId=${runId}`);
  check(`${label}: el preinforme corresponde a la corrida exacta`, requested.generated?.run?.runId === runId || requested.run?.runId === runId || JSON.stringify(requested).includes(runId));
  await page.getByTestId("prereport-close").click();
  const statusAfter = JSON.stringify((await get(`/api/ai/runs/${runId}/review`).catch(() => null)) ?? null);
  check(`${label}: el estado de la revisión no cambió`, statusBefore === statusAfter);
}
if (assistantCalls.length) console.log("  llamadas del asistente:", assistantCalls.join("; "));
check("ninguna escritura salió del navegador", writes.length === 0, writes.join("; "));
await browser.close();
process.exit(failures ? 1 : 0);
