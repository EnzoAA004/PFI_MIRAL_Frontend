import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const WEB = "http://localhost:8288", OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
for (const [w, h] of [[1366, 768], [1920, 1080]]) for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  const page = await ctx.newPage();
  const issues = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) issues.push(`console.${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => issues.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) issues.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  await page.route(/localhost:8280\/api\/(?!auth)/, (route) => route.request().method() === "GET" ? route.continue() : route.abort());
  const tag = `${w}-${scheme}`;
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/login-${tag}.png` });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  for (const [name, url] of [["worklist", "/worklist"], ["pacientes", "/pacientes"], ["ajustes", "/ajustes"], ["analytics", "/analytics"], ["estudio-mendeley", "/estudio/MENDELEY-0015-MVBLQ5XS"], ["ruta-desconocida", "/xyz/abc"], ["estudio-inexistente", "/estudio/NO-EXISTE-999"], ["paciente-inexistente", "/pacientes/NO-EXISTE"]]) {
    await page.goto(`${WEB}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(name.startsWith("estudio-mendeley") ? 3500 : 1200);
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    const scroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > innerWidth, body: document.body.innerText.length }));
    results.push({ tag, name, url, hScroll: scroll.x, textLen: scroll.body, issues: issues.splice(0) });
  }
  await ctx.close();
}
writeFileSync(`${OUT}/crawl.json`, JSON.stringify(results, null, 1));
for (const r of results) console.log(r.tag, r.name, r.hScroll ? "H-SCROLL" : "", r.issues.length ? JSON.stringify([...new Set(r.issues)]).slice(0, 300) : "");
await browser.close();
