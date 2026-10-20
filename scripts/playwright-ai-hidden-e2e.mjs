import fs from "node:fs";
import { chromium } from "playwright";

/**
 * Primera lectura sin IA, contra el stack local (8288/8280). SOLO LECTURA: se abortan en el navegador las escrituras.
 *
 *   node scripts/playwright-ai-hidden-e2e.mjs
 *
 * Variables: VIEWER_URL, API_URL, SIZE (1366x768 | 1920x1080), THEME (light|dark), SHOTS_DIR, CASE (estudio individual),
 *   OTHER (otro estudio para comprobar que no hereda), REF (referencia del visor dual).
 *
 * Comprueba: ninguna capa de IA aparece ni un instante al abrir (MutationObserver desde antes de cargar), panel de
 * resultados compacto, interruptor «Mostrar IA»/«Ocultar IA» sin tocar corte/zoom/W-L, conservación al cambiar de
 * pestaña, reinicio al recargar y al abrir otro estudio, y en el dual: ambos lados apagados, controles independientes y
 * resultados comparados a pedido.
 */
const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const apiUrl = process.env.API_URL ?? "http://localhost:8280";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const shotsDir = process.env.SHOTS_DIR;
const CASE = process.env.CASE ?? "caso2";
const OTHER = process.env.OTHER ?? "caso1";
const REF = process.env.REF ?? "caso1";
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

let passed = 0;
const fail = (message) => { throw new Error(message); };
const ok = (condition, message) => { if (!condition) fail(message); passed += 1; console.log(`ok ${passed} - ${message}`); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
await context.addInitScript((t) => {
  try { if (!localStorage.getItem("pfi.theme")) localStorage.setItem("pfi.theme", t); } catch { /* sin almacenamiento */ }
  // Registra si, en algún momento, aparece una capa de IA en el DOM (aunque sea un cuadro).
  window.__aiSeen = [];
  const SELECTORS = ".mri-segmentation-canvas, .mri-overlay-img, .segmentation-legend-panel, .rr-instances-panel, .asset-landmark";
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const hit = node.matches(SELECTORS) ? node : node.querySelector(SELECTORS);
        if (hit) window.__aiSeen.push(hit.className || hit.tagName);
      }
    }
  }).observe(document, { childList: true, subtree: true });
}, theme);
const page = await context.newPage();
const writes = [];
const apiPattern = new RegExp(`${apiUrl.replace(/[.*+?^${}()|[\]\\/]/g, "\$&")}/api/(?!auth)`);
await page.route(apiPattern, (route) => {
  const method = route.request().method();
  if (method === "GET") return route.continue();
  writes.push(`${method} ${route.request().url()}`);
  return route.abort();
});

const shot = async (name) => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}-${theme}-${width}x${height}.png` }); };
const aiLayers = () => page.evaluate(() => ({
  segmentation: document.querySelectorAll(".mri-segmentation-canvas, .mri-overlay-img").length,
  legend: document.querySelectorAll(".segmentation-legend-panel").length,
  instances: document.querySelectorAll(".rr-instances-panel").length,
}));
const readouts = async () => ({
  zoom: await page.locator(".zoom-readout").first().innerText(),
  wl: await page.locator(".rr-corner-bl").first().innerText(),
  slice: await page.locator(".rr-slice-index").first().innerText(),
});

async function login() {
  await page.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Entrar con doctor demo/ }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  await page.waitForTimeout(1200);
}
async function openStudy(id) {
  await page.goto(`${viewerUrl}/estudio/${id}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 120000 });
  await page.locator(".mri-asset-img, .mri-pixel-canvas").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3500);
}

try {
  await login();

  // 1) Abrir un estudio: nada de IA, ni siquiera por un instante.
  await openStudy(CASE);
  const seen = await page.evaluate(() => window.__aiSeen);
  ok(seen.length === 0, `al abrir ${CASE} no apareció ninguna capa de IA en el DOM (ni momentánea): ${JSON.stringify(seen)}`);
  const layers = await aiLayers();
  ok(layers.segmentation === 0 && layers.legend === 0 && layers.instances === 0, "sin máscara, sin leyenda y sin lista de estructuras sobre la imagen");
  ok(await page.getByTestId("ai-results-gate").isVisible(), "el panel de resultados muestra el estado compacto con «Mostrar resultados de la IA»");
  ok(!(await page.getByText("Seleccioná un nivel para ver sus mediciones.").isVisible()), "los resultados (niveles y mediciones) no se ven automáticamente");
  ok((await page.getByTestId("ai-toggle").first().innerText()).trim() === "Mostrar IA", "el interruptor dice «Mostrar IA» y está apagado");
  ok((await page.getByTestId("ai-toggle").first().getAttribute("aria-pressed")) === "false", "el interruptor expone aria-pressed=false");
  await shot("01-sin-ia");

  // 2) Mostrar IA no cambia corte, zoom ni W/L.
  await page.getByRole("button", { name: "Acercar" }).first().click();
  const before = await readouts();
  await page.getByTestId("ai-toggle").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const withAi = await aiLayers();
  ok(withAi.segmentation > 0, "«Mostrar IA» (con teclado) dibuja la segmentación");
  ok((await page.getByTestId("ai-toggle").first().innerText()).trim() === "Ocultar IA", "el botón pasa a «Ocultar IA»");
  const after = await readouts();
  ok(JSON.stringify(before) === JSON.stringify(after), `corte, zoom y W/L se conservan al mostrar la IA (${JSON.stringify(after)})`);
  await shot("02-con-ia");

  // 3) Cambiar de pestaña conserva la elección.
  await page.getByRole("tab", { name: "Revisión" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("tab", { name: "Resultados" }).click();
  ok((await page.getByTestId("ai-toggle").first().innerText()).trim() === "Ocultar IA", "al cambiar de pestaña dentro del estudio se conserva «Ocultar IA»");
  ok((await aiLayers()).segmentation > 0, "y la segmentación sigue visible");

  // 4) Abrir resultados es explícito y no mueve la imagen.
  await page.getByTestId("ai-results-open").click();
  await page.waitForTimeout(600);
  ok(await page.getByText("Seleccioná un nivel para ver sus mediciones.").isVisible(), "«Mostrar resultados de la IA» abre niveles y mediciones");
  ok(JSON.stringify(await readouts()) === JSON.stringify(before), "abrir resultados tampoco cambia corte, zoom ni W/L");

  // 5) Ocultar retira las superposiciones y no borra resultados.
  await page.getByTestId("ai-toggle").first().click();
  await page.waitForTimeout(600);
  ok((await aiLayers()).segmentation === 0, "«Ocultar IA» retira la segmentación");
  ok(await page.getByText("Seleccioná un nivel para ver sus mediciones.").isVisible(), "los resultados del panel siguen ahí (ocultar no los borra)");

  // 6) Recargar y abrir otro estudio vuelven a empezar sin IA (aunque estaba prendida).
  await page.getByTestId("ai-toggle").first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__aiSeen = []; });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 120000 });
  await page.waitForTimeout(3500);
  ok((await page.evaluate(() => window.__aiSeen)).length === 0, "al recargar con la IA prendida no reaparece ni un instante");
  ok((await page.getByTestId("ai-toggle").first().innerText()).trim() === "Mostrar IA" && await page.getByTestId("ai-results-gate").isVisible(), "recargar vuelve a empezar sin IA y con los resultados cerrados");
  await page.getByTestId("ai-toggle").first().click();
  await openStudy(OTHER);
  ok((await aiLayers()).segmentation === 0 && (await page.getByTestId("ai-toggle").first().innerText()).trim() === "Mostrar IA", "otro estudio no hereda la IA prendida del anterior");

  // 7) Visor dual: ambos lados apagados, controles independientes, resultados a pedido.
  await openStudy(CASE);
  await page.evaluate(() => { window.__aiSeen = []; });
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("#rr-cmp-reference option").length > 1, null, { timeout: 60000 });
  const options = await page.locator("#rr-cmp-reference option").evaluateAll((list) => list.map((item) => ({ value: item.value, text: item.textContent })));
  await page.locator("#rr-cmp-reference").selectOption(options.find((item) => item.text.includes(REF)).value);
  await page.waitForTimeout(3000);
  await page.getByTestId("open-dual-comparison").click();
  await page.getByTestId("dual-comparison").waitFor({ timeout: 60000 });
  await page.getByTestId("dual-pane-reference").locator(".mri-asset-img, .mri-pixel-canvas").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(4000);
  const dualSeen = await page.evaluate(() => window.__aiSeen);
  ok(dualSeen.length === 0, `el dual abre sin ninguna capa de IA, ni momentánea: ${JSON.stringify(dualSeen)}`);
  const side = (name) => page.getByTestId(`dual-pane-${name}`);
  const sideLayers = (name) => side(name).locator(".mri-segmentation-canvas, .mri-overlay-img").count();
  ok((await sideLayers("reference")) === 0 && (await sideLayers("current")) === 0, "ambos lados empiezan sin superposiciones");
  ok(await page.locator('[data-testid="dual-results-gate"]:visible').isVisible(), "los resultados comparados no se muestran hasta pedirlos");
  ok(!(await page.getByText("Cambios de clasificación").first().isVisible()), "la comparación de hallazgos no aparece al entrar");
  await shot("03-dual-sin-ia");

  await side("reference").getByTestId("ai-toggle").click();
  await page.waitForTimeout(1200);
  ok((await sideLayers("reference")) > 0 && (await sideLayers("current")) === 0, "cada lado tiene su control: prender el de referencia no prende el actual");
  await side("current").getByTestId("ai-toggle").click();
  await page.waitForTimeout(1200);
  await side("reference").getByTestId("ai-toggle").click();
  await page.waitForTimeout(800);
  ok((await sideLayers("reference")) === 0 && (await sideLayers("current")) > 0, "y apagar el de referencia no apaga el actual");
  await side("current").getByTestId("ai-toggle").click();

  await page.getByTestId("dual-tab-findings").click();
  await page.locator('[data-testid="dual-results-open"]:visible').click();
  await page.waitForTimeout(1500);
  ok(await page.getByText(/Cambios de clasificación \(\d+\)/).first().isVisible(), "«Mostrar resultados comparados» abre la comparación de hallazgos");
  await shot("04-dual-hallazgos");

  // 8) Elegir un hallazgo muestra solo su evidencia, con estado visible y posibilidad de ocultarla.
  const row = page.locator(".rr-dual-side button").filter({ hasText: /Pfirrmann|Estrechamiento/ }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1500);
    ok((await sideLayers("reference")) === 0 && (await sideLayers("current")) === 0, "seleccionar un hallazgo no prende la segmentación de los lados");
    const note = page.getByTestId("evidence-visible-note");
    if (await note.count()) {
      ok(await note.first().isVisible(), "la evidencia elegida queda con su estado visible");
      await note.first().getByRole("button", { name: "Ocultar evidencia" }).click();
      ok((await page.getByTestId("evidence-hidden-note").count()) > 0, "y se puede ocultar");
    }
  }

  ok(writes.length === 0, `sin escrituras durante la prueba (${writes.length})`);
  console.log(`\nPrimera lectura sin IA (${width}x${height}, ${theme}): ${passed} comprobaciones pasaron`);
} catch (error) {
  console.error(`FALLO: ${error.message}`);
  await page.screenshot({ path: `${shotsDir ?? "."}/fallo-ai-hidden-${width}x${height}-${theme}.png` }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
}
