import fs from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

/**
 * Demostración interactiva de hallazgos A/B (`npm run demo:dual-findings`, http://localhost:8290/).
 *
 *   node scripts/playwright-demo-dual-findings-e2e.mjs
 *
 * Variables: DEMO_URL (http://localhost:8290), SIZE (1366x768), THEME (light|dark), SHOTS_DIR.
 * Si la demostración no está levantada, la prueba la levanta y la detiene al terminar.
 *
 * Verifica lo que se le promete a quien la abre: el rótulo siempre visible, los seis casos pedidos, los filtros, las
 * dos regiones, anterior/siguiente, distribuciones, navegación de cortes con regreso a la región y recarga. Además
 * comprueba que la página no habla con nada que no sea su propio servidor ni escribe nada (solo lecturas).
 * Todo lo que ve es simulado: no toca la base de 8288 ni la aplicación.
 */

const demoUrl = process.env.DEMO_URL ?? "http://localhost:8290";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const shotsDir = process.env.SHOTS_DIR;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const BANNER = "DEMOSTRACIÓN · DATOS SIMULADOS · NO REPRESENTA EVOLUCIÓN DE UN PACIENTE";
const assertTruthy = (value, message) => { if (!value) throw new Error(`E2E assertion failed: ${message}`); };
const assertEqual = (actual, expected, message) => {
  if (actual !== expected) throw new Error(`E2E assertion failed: ${message} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
};
let step = 0;
const ok = (message) => { step += 1; console.log(`ok ${step} - ${message}`); };
const clean = (text) => text.replace(/\s+/g, " ").trim();

async function reachable() {
  try { return (await fetch(`${demoUrl}/`)).ok; } catch { return false; }
}
let child = null;
if (!(await reachable())) {
  child = spawn(process.execPath, ["demo/dual-findings/server.mjs"], { stdio: "ignore" });
  for (let attempt = 0; attempt < 120 && !(await reachable()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  assertTruthy(await reachable(), "la demostración no levantó");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
const page = await context.newPage();
const pageErrors = [];
const requests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
context.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

const pane = (side) => page.getByTestId(`dual-pane-${side}`);
const row = (key) => page.locator(`[data-testid="dual-finding-row"][data-row-key="${key}"]`);
const sliceOf = async (side) => clean(await pane(side).locator(".rr-slice-index").first().innerText());
const markers = (side) => pane(side).locator(".mri-finding-marker-box").count();
const counts = async () => {
  const out = {};
  for (const id of ["changes", "all", "noncomparable"]) out[id] = Number((await page.getByTestId(`dual-findings-filter-${id}`).innerText()).match(/\((\d+)\)/)[1]);
  return out;
};
async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` });
}
async function bannerVisible() {
  const box = await page.getByTestId("demo-banner").boundingBox();
  const text = clean(await page.getByTestId("demo-banner").innerText());
  return Boolean(box) && box.y >= 0 && box.y + box.height <= height && text.includes(BANNER);
}

await page.goto(`${demoUrl}/`, { waitUntil: "load" });
await page.getByTestId("dual-comparison").waitFor({ timeout: 30000 });
{
  /* Primera lectura sin IA: los resultados comparados se abren con una acción explícita. */
  const gate = page.locator('[data-testid="dual-results-open"]:visible');
  if (await gate.count()) await gate.click();
}
await page.getByTestId("dual-findings-comparison").waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);

/* ---- Rótulo ---- */
assertTruthy(await bannerVisible(), "el rótulo de demostración está visible y completo");
assertEqual(await page.title(), "Demostración · Hallazgos A/B (simulado)", "el título de la pestaña también lo dice");
ok("rótulo «DEMOSTRACIÓN · DATOS SIMULADOS · NO REPRESENTA EVOLUCIÓN DE UN PACIENTE» visible al abrir");

/* ---- Casos pedidos ---- */
assertEqual(await page.getByTestId("dual-tab-findings").getAttribute("aria-selected"), "true", "abre en «Hallazgos IA»");
assertEqual(JSON.stringify(await counts()), JSON.stringify({ changes: 4, all: 6, noncomparable: 1 }), "conteos de las clasificaciones principales");
await page.getByTestId("dual-findings-filter-all").click();
const status = async (key) => clean(await row(key).getByTestId("dual-finding-status").innerText());
assertEqual(await status("L4-L5|disc_bulging"), "Ausente → Presente", "Ausente → Presente");
assertEqual(await status("L5-S1|disc_bulging"), "Presente → Ausente", "Presente → Ausente");
assertEqual(await status("L3-L4|pfirrmann_grade"), "Cambio de grado o categoría", "cambio de Pfirrmann");
assertTruthy(/Experimental/.test(await row("L3-L4|pfirrmann_grade").innerText()), "Pfirrmann identificado como experimental");
assertEqual(await status("L2-L3|disc_bulging"), "Sin cambio de clasificación", "misma clase con distinta probabilidad: sin cambio");
assertEqual(await status("L1-L2|disc_narrowing"), "No comparable", "resultado no evaluado en B");
assertTruthy(/Sin dato/.test(await row("L1-L2|disc_narrowing").innerText()) && /no equivale a «Ausente»/.test(await row("L1-L2|disc_narrowing").innerText()), "no evaluado nunca es «Ausente»");
assertEqual(await status("L5-S1|upper_endplate_change"), "Ausente → Presente", "clasificación válida con región no disponible en B");
ok("los seis casos están: Ausente→Presente, Presente→Ausente, Pfirrmann experimental, misma clase sin cambio, no evaluado y región no disponible");

/* ---- Filtros ---- */
await page.getByTestId("dual-findings-filter-changes").click();
assertEqual(await page.getByTestId("dual-finding-row").count() >= 4, true, "cambios: al menos las cuatro principales");
assertEqual(await row("L2-L3|disc_bulging").count(), 0, "«misma clase» no aparece entre los cambios");
await page.getByTestId("dual-findings-filter-noncomparable").click();
assertEqual(await page.locator('[data-testid="dual-finding-row"]:not([data-status="not_comparable"])').count(), 0, "no comparables: solo no comparables");
await page.getByTestId("dual-findings-filter-all").click();
assertEqual(await page.locator('[data-testid="dual-finding-row"]').count() >= 6, true, "todos");
ok("filtros Cambios / Todos / No comparables con sus conteos");

/* ---- Selección con ambas regiones ---- */
await page.getByTestId("dual-findings-filter-changes").click();
await row("L4-L5|disc_bulging").click();
await page.waitForTimeout(1500);
assertEqual(await markers("reference"), 1, "región de la referencia");
assertEqual(await markers("current"), 1, "región del actual");
assertTruthy(/5\/15/.test(await sliceOf("reference")) && /9\/15/.test(await sliceOf("current")), "cada visor abre su propio corte");
assertTruthy(/Sagital T2/.test(await page.getByTestId("dual-finding-region-reference").innerText()) && /Sagital T1/.test(await page.getByTestId("dual-finding-region-current").innerText()), "cada lado en su propia serie");
assertTruthy(await bannerVisible(), "el rótulo sigue visible con una fila seleccionada");
await shot("demo-01-diferencia-seleccionada-ambas-regiones");
ok("al elegir L4-L5 Ausente→Presente se resalta la región evaluada en ambos lados, cada una en su serie y corte");

/* ---- Navegar cortes y volver ---- */
await pane("current").getByRole("button", { name: /Corte siguiente/ }).click();
await page.waitForTimeout(700);
assertEqual(await markers("current"), 0, "la marca sale al cambiar de corte");
await page.getByTestId("dual-region-return-current").click();
await page.waitForTimeout(700);
assertEqual(await markers("current"), 1, "volver a la región");
assertTruthy(/9\/15/.test(await sliceOf("current")), "vuelve al corte exacto");
ok("se puede navegar cortes y volver a la región seleccionada");

/* ---- Anterior / siguiente ---- */
const position = async () => clean(await page.getByTestId("dual-findings-position").innerText());
const first = await position();
await page.getByTestId("dual-findings-next").click();
await page.waitForTimeout(800);
assertTruthy((await position()) !== first, "siguiente avanza");
await page.getByTestId("dual-findings-prev").click();
assertEqual(await position(), first, "anterior vuelve");
ok(`anterior/siguiente (${first})`);

/* ---- Distribuciones ---- */
await page.getByTestId("dual-finding-distribution").locator("summary").click();
assertTruthy(/Ausente 70,0 %/.test(clean(await page.getByTestId("dual-finding-dist-reference").innerText())), "distribución de A");
assertTruthy(/Presente 70,0 %/.test(clean(await page.getByTestId("dual-finding-dist-current").innerText())), "distribución de B");
ok("distribución de probabilidades por clase de ambos lados");

/* ---- Región no disponible ---- */
await page.getByTestId("dual-findings-filter-all").click();
await row("L5-S1|upper_endplate_change").click();
await page.waitForTimeout(1500);
assertEqual(await markers("reference"), 1, "A conserva su región");
assertEqual(await page.getByTestId("dual-region-current").getAttribute("data-region-state"), "unavailable", "B: región no disponible");
assertTruthy(/Región no disponible/.test(await page.getByTestId("dual-finding-region-current").innerText()), "B lo dice");
await shot("demo-02-region-no-disponible-en-B");
ok("clasificación válida con región no disponible: B lo dice y A conserva la suya");

/* ---- Pfirrmann y misma clase ---- */
await row("L2-L3|disc_bulging").click();
await page.waitForTimeout(1200);
assertTruthy(/Sin cambio de clasificación/.test(await page.getByTestId("dual-finding-selected").innerText()), "la ficha de «misma clase» no la cuenta como cambio");
await shot("demo-03-misma-clase-otra-probabilidad");
ok("misma clase con distinta probabilidad: se puede consultar y no se cuenta como cambio");

/* ---- Cerrar, reabrir y recargar ---- */
assertTruthy(await bannerVisible(), "rótulo visible");
await page.getByTestId("dual-close").click();
await page.getByTestId("demo-reopen").waitFor();
assertTruthy(await bannerVisible(), "el rótulo sigue visible con la comparación cerrada");
await page.getByTestId("demo-reopen").click();
await page.getByTestId("dual-findings-comparison").waitFor();
await page.reload({ waitUntil: "load" });
await page.getByTestId("dual-findings-comparison").waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
assertTruthy(await bannerVisible(), "tras recargar el rótulo sigue ahí");
assertEqual(JSON.stringify(await counts()), JSON.stringify({ changes: 4, all: 6, noncomparable: 1 }), "tras recargar los conteos son los mismos");
await row("L4-L5|disc_bulging").click();
await page.waitForTimeout(1200);
assertEqual(await markers("current"), 1, "tras recargar se puede seguir usando");
ok("cerrar, reabrir y recargar la página: la demostración sigue funcionando");

/* ---- Aislamiento ---- */
const origin = new URL(demoUrl).origin;
assertTruthy(requests.every((request) => request.url.startsWith(origin) || request.url.startsWith("blob:") || request.url.startsWith("data:")), `todo el tráfico va a la propia demostración (${requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:")).map((r) => r.url).slice(0, 3)})`);
assertTruthy(requests.every((request) => request.method === "GET"), "solo lecturas: ninguna escritura");
assertTruthy(!requests.some((request) => /:(8288|8280|8200|8088)\b/.test(request.url)), "no toca 8288, 8280, 8200 ni 8088");
assertEqual(pageErrors.length, 0, `sin errores de página (${pageErrors.join(" | ")})`);
ok("la página solo habló con su propio servidor, solo con lecturas, sin errores");

await browser.close();
if (child) child.kill();
console.log(`demo dual-findings e2e: ${step} comprobaciones OK (${theme}, ${width}x${height})`);
