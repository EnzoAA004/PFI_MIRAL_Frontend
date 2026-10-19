import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const log = (...a) => console.log(...a);
const writes = [], issues = [];
page.on("console", (m) => { if (m.type() === "error") issues.push(m.text().slice(0, 200)); });
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => { const r = route.request(); if (r.method() === "GET") return route.continue(); writes.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); return route.abort(); });
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
const panelText = async () => (await page.locator("[aria-label='Herramientas del estudio']").innerText().catch(() => "—")).replace(/\n+/g, " | ").slice(0, 1500);
for (const caseId of ["OSF-ID10-V2-T1", "MENDELEY-0015-MVBLQ5XS"]) {
  await page.goto(`${WEB}/estudio/${caseId}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90000 }); await page.waitForTimeout(2500);
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.waitForTimeout(2500);
  log(`\n=== COMPARACIÓN desde ${caseId}:`, await panelText());
  await page.screenshot({ path: `${OUT}/cmp-${caseId}.png` });
  const sel = page.locator("[aria-label='Herramientas del estudio'] select");
  if (await sel.count()) {
    log("opciones de referencia:", await sel.first().locator("option").allInnerTexts());
  }
}
log("escrituras bloqueadas:", writes, "errores:", issues);
await browser.close();
