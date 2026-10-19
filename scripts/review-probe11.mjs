import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const log = (...a) => console.log(...a);
const writes = [], issues = [];
page.on("console", (m) => { if (m.type() === "error") issues.push(m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.status() >= 400) issues.push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
await page.route(/localhost:8280\/api\/(?!auth)/, (route) => { const r = route.request(); if (r.method() === "GET") return route.continue(); writes.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); return route.abort(); });
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
log("onboarding visible:", await page.getByText(/Recorrido|Bienvenid|tutorial/i).count());
// menú de perfil
await page.getByRole("button", { name: /Dra\. Demo Reviewer/ }).click();
log("menú perfil:", (await page.getByRole("menu").innerText()).replace(/\n+/g, " | "));
await page.getByRole("menuitem", { name: /Ver \/ editar perfil/ }).click(); await page.waitForTimeout(800);
log("→ perfil url:", page.url());
await page.getByRole("tab", { name: /Ayuda y alcance/ }).click(); await page.waitForTimeout(800);
log("AYUDA:", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 1800));
await page.screenshot({ path: `${OUT}/ayuda.png`, fullPage: true });
// viewer
await page.goto(`${WEB}/estudio/MENDELEY-0015-MVBLQ5XS`, { waitUntil: "networkidle" });
await page.locator("aside.rr-panel").waitFor({ timeout: 90000 }); await page.waitForTimeout(3000);
await page.getByRole("button", { name: "Editar datos" }).click(); await page.waitForTimeout(800);
log("EDITAR DATOS:", (await page.locator("[role=dialog]").first().innerText().catch(() => "sin diálogo")).replace(/\n+/g, " | ").slice(0, 1200));
await page.screenshot({ path: `${OUT}/editar-datos.png` });
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
log("diálogo tras Esc:", await page.locator("[role=dialog]").count());
for (const layout of ["Sagital + Axial", "T1 + T2"]) {
  await page.getByRole("combobox", { name: /Preset de layout/ }).selectOption({ label: layout });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/layout-${layout.replace(/\W/g, "")}.png` });
  log(`layout ${layout}:`, (await page.locator(".rr-corner-bl, .rr-corner-tr").allInnerTexts()).map((s) => s.replace(/\s+/g, " ")).slice(0, 8).join(" || "));
}
await page.getByRole("combobox", { name: /Serie o plano activo/ }).selectOption({ label: "Axial" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/axial.png` });
log("AXIAL panel:", (await page.locator("aside.rr-panel").innerText()).replace(/\n+/g, " | ").slice(0, 600));
log("escrituras:", writes, "issues:", [...new Set(issues)]);
await browser.close();
