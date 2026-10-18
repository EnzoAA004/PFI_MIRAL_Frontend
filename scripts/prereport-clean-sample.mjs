import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

/**
 * Muestra LIMPIA del preinforme: vista previa sin guardar, armada solo con los valores iniciales del constructor (selección por
 * defecto, sin textos editados, sin observaciones). No lee, no sobrescribe ni borra el borrador guardado:
 *  - la respuesta del GET del preinforme se intercepta en el navegador para que el editor arranque sin borrador;
 *  - cualquier escritura (PUT/POST) al preinforme o a la revisión se bloquea en el navegador y se registra.
 * Al terminar se comprueba por API que el borrador guardado conserva versión y fecha de actualización.
 *
 * Uso: OUT_DIR=... node scripts/prereport-clean-sample.mjs
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const API = process.env.PFI_API ?? "http://localhost:8280";
const OUT = process.env.OUT_DIR ?? "prereport-clean-sample";
const CASES = [["MENDELEY-0015-MVBLQ5XS", "MENDELEY"], ["OSF-ID10-V2-T1", "OSF"]];
mkdirSync(OUT, { recursive: true });

const login = await (await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const TOKEN = login.accessToken ?? login.token;
const api = async (path) => (await (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json());

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
const page = await context.newPage();
page.on("dialog", async (dialog) => {
  console.log("  diálogo:", dialog.message().split("\n")[0]);
  await dialog.accept();
});
const blocked = [];
await page.route(/localhost:8280\/api\/studies\/[^/]+\/prereport/, async (route) => {
  const request = route.request();
  if (request.method() !== "GET") {
    blocked.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
    return route.abort();
  }
  const response = await route.fetch();
  const body = await response.json();
  // El editor arranca desde lo que genera el constructor hoy, sin el borrador guardado.
  await route.fulfill({ response, json: { ...body, draft: null, stale: false, changes: [], orphanedEdits: [] } });
});
await page.route(/localhost:8280\/api\/(?!auth|studies\/[^/]+\/prereport)/, (route) => {
  const request = route.request();
  if (request.method() === "GET") return route.continue();
  blocked.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
  return route.abort();
});

await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
if (await demo.count()) await demo.click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();

const report = [];
for (const [caseId, tag] of CASES) {
  const detail = await api(`/api/studies/${caseId}`);
  const runId = detail.runs[0].summary.runId;
  const before = (await api(`/api/studies/${caseId}/prereport?runId=${runId}`)).draft;
  await page.goto(`${WEB}/estudio/${caseId}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.getByRole("tab", { name: /Revisi/ }).click();
  await page.getByTestId("prepare-prereport").click();
  await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="prereport-editor-column"]')?.textContent?.includes("preparando…"), null, { timeout: 90_000 });
  await page.waitForTimeout(800);
  const state = {
    barra: (await page.locator(".pre-bar-title").innerText()).replace(/\s+/g, " "),
    observaciones: await page.getByTestId("prereport-observations").inputValue(),
    resumen: await page.getByTestId("prereport-summary").innerText(),
  };
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("prereport-export-html").click()]);
  const file = `${OUT}/PREINFORME-vista-previa-SIN-GUARDAR_${tag}.html`;
  await download.saveAs(file);
  const doc = await context.newPage();
  await doc.setViewportSize({ width: 1000, height: 900 });
  await doc.goto(`file:///${file.replace(/\\/g, "/")}`);
  await doc.waitForTimeout(700);
  const text = (await doc.locator("body").innerText()).replace(/\s+/g, " ");
  await doc.pdf({ path: `${OUT}/PREINFORME-vista-previa-SIN-GUARDAR_${tag}.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
  await doc.screenshot({ path: `${OUT}/PREINFORME-vista-previa-SIN-GUARDAR_${tag}-pantalla.png`, fullPage: true });
  await doc.close();
  await page.getByTestId("prereport-close").click();
  const after = (await api(`/api/studies/${caseId}/prereport?runId=${runId}`)).draft;
  report.push({
    caso: caseId,
    editor: state,
    contiene: {
      textoEditado: /texto editado/i.test(text),
      notaDePrueba: /\(prueba\)/i.test(text) || /Nota del nivel/.test(text),
      observaciones: !/Sin observaciones registradas/.test(text),
      versionDelBorrador: (text.match(/Versión del borrador\s+(\S+(?: \S+)?)/) ?? [])[1] ?? null,
      fichas: [...new Set([...text.matchAll(/\b(L[1-5]-[L|S][1-5]|T1[0-2]-[LT]?\d+)\s·\sMediciones del análisis inicial/g)].map((m) => m[1]))],
      resultadosDeInvestigacion: /<h3>Resultados de investigación/.test(await (await import("node:fs/promises")).readFile(file, "utf8")),
    },
    borradorGuardado: { antes: before ? { version: before.version, actualizado: before.updatedAt } : null, despues: after ? { version: after.version, actualizado: after.updatedAt } : null, intacto: JSON.stringify(before && { v: before.version, u: before.updatedAt }) === JSON.stringify(after && { v: after.version, u: after.updatedAt }) },
  });
}
console.log(JSON.stringify({ escrituras_bloqueadas: blocked, informe: report }, null, 1));
writeFileSync(`${OUT}/muestra-limpia-verificacion.json`, JSON.stringify({ escrituras_bloqueadas: blocked, informe: report }, null, 1));
await browser.close();
