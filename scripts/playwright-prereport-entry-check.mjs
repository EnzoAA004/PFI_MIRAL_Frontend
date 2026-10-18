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
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => {
  const request = route.request();
  if (request.method() === "GET") return route.continue();
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
  await button.click();
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
check("ninguna escritura salió del navegador", writes.length === 0, writes.join("; "));
await browser.close();
process.exit(failures ? 1 : 0);
