import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR, CASE = process.env.CASE ?? "MENDELEY-0015-MVBLQ5XS";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const log = (...a) => console.log(...a);
const aborted = [], issues = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) issues.push(m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.status() >= 400) issues.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => { const r = route.request(); if (r.method() === "GET") return route.continue(); aborted.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); return route.abort(); });
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
await page.goto(`${WEB}/estudio/${CASE}`, { waitUntil: "networkidle" });
await page.locator("aside.rr-panel").waitFor({ timeout: 90000 });
await page.waitForTimeout(3000);
const t = async (sel) => (await page.locator(sel).first().innerText().catch(() => "—")).replace(/\n+/g, " | ").slice(0, 700);
log("PANEL inicial:", await t("aside.rr-panel"));
log("TOPBAR:", (await page.getByRole("button").allInnerTexts()).filter(Boolean).slice(0, 40).join(" / "));
const selects = await page.locator("select").evaluateAll((els) => els.map((e) => ({ label: e.getAttribute("aria-label") ?? e.id, opts: [...e.options].map((o) => o.text) })));
log("SELECTS:", JSON.stringify(selects).slice(0, 900));
await page.screenshot({ path: `${OUT}/v-inicial.png` });
// pestañas del panel
for (const tab of ["Hallazgos IA", "Revisión", "Contexto"]) {
  await page.getByRole("tab", { name: new RegExp(tab) }).or(page.getByRole("button", { name: new RegExp(`^${tab}`) })).first().click().catch(() => log("sin", tab));
  await page.waitForTimeout(1200);
  log(`--- ${tab}:`, await t("aside.rr-panel"));
  await page.screenshot({ path: `${OUT}/v-${tab.replace(/\W/g, "")}.png` });
}
// herramientas
await page.getByTestId("tools-open").click().catch(() => log("sin tools-open"));
await page.waitForTimeout(600);
log("HERRAMIENTAS:", await t("[aria-label='Herramientas del estudio']"));
await page.screenshot({ path: `${OUT}/v-herramientas.png` });
log("aborted", aborted, "issues", [...new Set(issues)]);
await browser.close();
