import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const log = (...a) => console.log(...a);
// teclado y foco
{
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await page.route(/localhost:8280\/api\/(?!auth)/, (route) => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  const active = () => page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}${e.getAttribute("aria-label") ? `[${e.getAttribute("aria-label")}]` : ""}:${(e.textContent || e.getAttribute("placeholder") || "").trim().slice(0, 30)}` : "none"; });
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.waitForTimeout(800);
  const seq = [await active()];
  for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); seq.push(await active()); }
  log("foco en Nuevo estudio:", seq.join(" → "));
  // foco visible
  const outline = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow.slice(0, 40)}`; });
  log("estilo de foco:", outline);
  await page.keyboard.press("Escape");
  // lista: abrir con Enter
  await page.waitForTimeout(500);
  await page.goto(`${WEB}/worklist`, { waitUntil: "networkidle" });
  const row = page.locator("tbody tr").first();
  await row.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  log("Enter sobre fila →", page.url());
  // sesión vencida: borrar tokens y recargar / llamar
  await page.evaluate(() => { for (const s of [localStorage, sessionStorage]) for (const k of Object.keys(s)) if (/token|auth|session/i.test(k)) { console.log("limpio", k); s.removeItem(k); } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  log("tras borrar tokens y recargar:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 200), "| url", page.url());
  await page.screenshot({ path: `${OUT}/k-sesion.png` });
}
// visor en 1920, claro y oscuro
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.route(/localhost:8280\/api\/(?!auth)/, (route) => route.request().method() === "GET" ? route.continue() : route.abort());
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  await page.goto(`${WEB}/estudio/MENDELEY-0015-MVBLQ5XS`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90000 }); await page.waitForTimeout(3000);
  await page.locator(".rr-level", { hasText: "L5-S1" }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/v1920-${scheme}.png` });
  await ctx.close();
}
await browser.close();
