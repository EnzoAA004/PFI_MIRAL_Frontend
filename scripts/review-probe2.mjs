import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const log = (...a) => console.log(...a);
const aborted = [], issues = [];
page.on("console", (m) => { if (m.type() === "error") issues.push(m.text().slice(0, 200)); });
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => { const r = route.request(); if (r.method() === "GET") return route.continue(); aborted.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); return route.abort(); });
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
const txt = async (sel = "main") => (await page.locator(sel).first().innerText()).replace(/\n+/g, " | ").slice(0, 900);
for (const subject of ["OSF-ID10", "MENDELEY-0015"]) {
  await page.goto(`${WEB}/pacientes/${subject}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  log(`\n=== ${subject} · resumen:`, await txt());
  await page.screenshot({ path: `${OUT}/pac-${subject}-resumen.png`, fullPage: true });
  for (const tab of ["Repositorio de estudios", "Actividad y auditoría"]) {
    await page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab })).first().click().catch(() => log("sin pestaña", tab));
    await page.waitForTimeout(1200);
    log(`--- ${tab}:`, await txt());
    await page.screenshot({ path: `${OUT}/pac-${subject}-${tab.split(" ")[0]}.png`, fullPage: true });
  }
  log("botones:", await page.getByRole("button").allInnerTexts().then((a) => a.filter(Boolean).join(" / ")));
}
log("abortados", aborted, "errores", issues);
await browser.close();
