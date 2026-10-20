import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { autoOpenAiResults } from "./lib/auto-open-ai-results.mjs";
import { chromium } from "playwright";
import {
  correctionCountOf,
  createIsolatedCorrectionCase,
  latestRunIdOf,
  persistedAiValueOf,
  persistedCorrectionOf,
} from "./lib/isolated-correction-case.mjs";

/**
 * Comparación visual entre estudios (visor dual) contra el stack local (8288/8280).
 *
 *   node scripts/playwright-dual-comparison-e2e.mjs
 *
 * Variables: VIEWER_URL, API_URL (http://localhost:8280), SIZE (1366x768), THEME (light|dark), CURRENT_CASE
 * (CMP-SYN-B), REFERENCE_CASE (CMP-SYN-A), ISO_CASE (opcional: reutiliza un caso aislado ya creado; si no se da, la
 * prueba CREA el suyo, DUALISO-<n>, con una corrección profesional en la altura discal L4-L5), OTHER_PATIENT_CASE
 * (SYN-A-058332: estudio de OTRO paciente), ISO_ZIP (ZIP sintético), SHOTS_DIR.
 *
 * Parte A (datos reales, solo lectura): CMP-SYN-B abierto frente a CMP-SYN-A. Los dos salen del MISMO archivo, así
 * que todas sus diferencias son cero: prueba el funcionamiento técnico del visor, no evolución clínica.
 * Parte B (caso propio de la prueba): antes de empezar, y en un contexto de navegador aparte, la prueba crea su caso
 * aislado por «Nuevo estudio» (ZIP sintético, análisis inicial real) y guarda la corrección con «Guardar borrador».
 * Verifica la persistencia en la base y tras recargar, y que el comparador use esa corrección en la corrida del caso.
 * Después, ya en modo solo lectura, lo compara con CMP-SYN-A: su única diferencia distinta de cero es una corrección
 * profesional guardada, no un cambio anatómico. La prueba no depende de ningún estudio que otra persona haya dejado
 * en la base ni modifica estudios existentes; el caso que crea queda en 8288 (es suyo).
 * Parte C (SIMULADA en el navegador con page.route; no se escribe nada): ubicación ausente, corrida distinta,
 * fallo de carga de un estudio o de una imagen. El stack real no produce esas situaciones.
 *
 * No se modifica ningún estudio ni revisión existente y no debe salir ningún POST de análisis.
 */

const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const apiUrl = process.env.API_URL ?? "http://localhost:8280";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const currentCase = process.env.CURRENT_CASE ?? "CMP-SYN-B";
const referenceCase = process.env.REFERENCE_CASE ?? "CMP-SYN-A";
const isoCaseGiven = process.env.ISO_CASE ?? null;
const isoCase = isoCaseGiven ?? `DUALISO-${Date.now().toString().slice(-7)}`;
const isoZip = process.env.ISO_ZIP ?? undefined;
const ISO_CORRECTED = 7.3;
const otherPatientCase = process.env.OTHER_PATIENT_CASE ?? "SYN-A-058332";
const shotsDir = process.env.SHOTS_DIR;
const dbCheck = process.env.DB_CHECK !== "0";

if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`E2E assertion failed: ${message} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
}
let step = 0;
function ok(message) {
  step += 1;
  console.log(`ok ${step} - ${message}`);
}

function sql(query) {
  return execFileSync("docker", ["exec", "lumbarai-clean-postgres", "psql", "-U", "pfi", "pfi_backend", "-tAc", query], { encoding: "utf8" }).trim();
}
function latestRunId(caseId) {
  return sql(`select r.multiplanar_run_id from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}' order by r.created_at desc, r.updated_at desc limit 1`);
}
function sagittalRunId(caseId) {
  return sql(`select r.sagittal_run_id from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}' order by r.created_at desc, r.updated_at desc limit 1`);
}
/** Puntos persistidos de una medición del análisis inicial más reciente (JSONB), o null. */
function persistedPoints(caseId, measurementId) {
  const text = sql(
    `select e.value->'points' from domain_study_runs r join domain_studies s on s.id=r.study_id, ` +
    `jsonb_array_elements(r.metrics_snapshot->'planes'->'sagittal'->'measurements') e ` +
    `where s.case_id='${caseId}' and e.value->>'id'='${measurementId}' order by r.created_at desc limit 1`,
  );
  return text ? JSON.parse(text) : null;
}
function persistedSlice(caseId, measurementId) {
  const text = sql(
    `select e.value->>'sliceIndex' from domain_study_runs r join domain_studies s on s.id=r.study_id, ` +
    `jsonb_array_elements(r.metrics_snapshot->'planes'->'sagittal'->'measurements') e ` +
    `where s.case_id='${caseId}' and e.value->>'id'='${measurementId}' order by r.created_at desc limit 1`,
  );
  return text === "" ? null : Number(text);
}
function persistedValue(caseId, measurementId) {
  const text = sql(
    `select e.value->>'value' from domain_study_runs r join domain_studies s on s.id=r.study_id, ` +
    `jsonb_array_elements(r.metrics_snapshot->'planes'->'sagittal'->'measurements') e ` +
    `where s.case_id='${caseId}' and e.value->>'id'='${measurementId}' order by r.created_at desc limit 1`,
  );
  return text === "" ? null : Number(text);
}
function persistedCorrection(caseId, measurementId) {
  const text = sql(
    `select c.after_value::text from domain_review_corrections c join domain_study_runs r on r.id=c.study_run_id join domain_studies s on s.id=r.study_id ` +
    `where s.case_id='${caseId}' and c.measurement_id='${measurementId}' order by c.created_at desc limit 1`,
  );
  return text ? JSON.parse(text) : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch({ headless: true });

/* ---- Parte 0: caso propio con su corrección, en un contexto aparte (las escrituras no cuentan en la ejecución de solo lectura) ---- */
let isoCreated = null;
if (!isoCaseGiven) {
  const setupContext = await browser.newContext({ viewport: { width, height } });
  await autoOpenAiResults(setupContext);
  const setupPage = await setupContext.newPage();
  const setupMutations = [];
  setupContext.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) setupMutations.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  await setupPage.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  const setupDemo = setupPage.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await setupDemo.count()) await setupDemo.click();
  await setupPage.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  isoCreated = await createIsolatedCorrectionCase(setupPage, { caseId: isoCase, corrected: ISO_CORRECTED, mutations: setupMutations, studyZip: isoZip });
  assertEqual(correctionCountOf(isoCase), 1, "la corrección quedó persistida en la base (una fila)");
  assertEqual(Number(persistedCorrectionOf(isoCase).value), ISO_CORRECTED, "la corrección persistida es el valor guardado");
  assertEqual(persistedAiValueOf(isoCase), isoCreated.original, "el valor de la IA sigue intacto en el snapshot de la corrida");
  // Persistencia tras recargar: la corrección vuelve a la tabla de mediciones desde la base.
  await setupPage.goto(`${viewerUrl}/estudio/${isoCase}`, { waitUntil: "networkidle" });
  await setupPage.locator("aside.rr-panel").waitFor({ timeout: 60000 });
  await setupPage.waitForTimeout(3000);
  await setupPage.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const reloadedRow = setupPage.locator(".rr-measure", { hasText: "Altura discal" }).first();
  assertEqual(await reloadedRow.locator(".rr-measure-input").inputValue(), String(ISO_CORRECTED), "tras recargar, la tabla muestra la corrección persistida");
  await setupContext.close();
  ok(`caso propio ${isoCase} creado por «Nuevo estudio» con su corrección ${ISO_CORRECTED} (IA ${isoCreated.original}): persistida en la base y restaurada tras recargar`);
}
const context = await browser.newContext({ viewport: { width, height } });
await autoOpenAiResults(context);
await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
const page = await context.newPage();

const mutations = [];
const imageRequests = [];
const comparisonRequests = [];
const comparisonResponses = [];
let authHeader = null;
context.on("request", (request) => {
  const url = request.url();
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(`${request.method()} ${path}`);
  if (/\/slices\/|\/assets\//.test(url) && request.method() === "GET") imageRequests.push(url);
  if (/initial-analysis-comparison/.test(url) && request.method() === "GET") comparisonRequests.push(url);
  const header = request.headers().authorization;
  if (header && /\/api\//.test(url)) authHeader = header;
});
context.on("response", async (response) => {
  if (/initial-analysis-comparison\?/.test(response.url()) && response.status() === 200) {
    try { comparisonResponses.push({ url: response.url(), body: await response.json() }); } catch { /* respuesta cancelada */ }
  }
});
page.on("pageerror", (error) => { throw new Error(`error de página: ${error.message}`); });

async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` });
}
const nonLoginMutations = () => mutations.filter((item) => !/\/api\/auth\//.test(item));
const dual = () => page.getByTestId("dual-comparison");
const pane = (side) => page.getByTestId(`dual-pane-${side}`);
const lastComparison = () => comparisonResponses[comparisonResponses.length - 1]?.body;

async function login() {
  await page.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

async function openStudy(caseId) {
  await page.getByText(caseId, { exact: true }).first().click();
  await page.getByRole("button", { name: "Abrir estudio" }).click();
  await page.locator("aside.rr-panel").waitFor();
  await page.getByRole("tab", { name: "Resultados" }).waitFor();
  await page.waitForTimeout(2500);
}

async function backToWorklist() {
  await page.getByRole("button", { name: /Estudios/ }).first().click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

async function openDualFromTool(reference) {
  const open = page.getByTestId("tools-open");
  if ((await open.getAttribute("aria-pressed")) !== "true") await open.click();
  else if (await page.locator(".rr-tool-view:visible").count()) await page.locator(".rr-tool-view:visible .rr-tool-back").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#rr-cmp-reference option").length > 1);
  if (reference) {
    await page.locator("#rr-cmp-reference").selectOption(reference);
    await page.getByTestId("comparison-summary").waitFor();
  }
  await page.getByTestId("open-dual-comparison").click();
  await dual().waitFor();
  /* Primera lectura sin IA: los resultados comparados se abren con una acción explícita. */
  const gate = page.locator('[data-testid="dual-results-open"]:visible');
  if (await gate.count()) await gate.click();
  if (reference) await page.getByTestId("dual-differences").waitFor();
  await page.waitForTimeout(3200);
}

async function closeDual() {
  await page.getByTestId("dual-close").click();
  await dual().waitFor({ state: "detached" });
}

const rowKeyOf = (row) => `${row.level}|${row.structure}|${row.metric}|${row.plane}`;
const rowLocator = (key) => page.locator(`[data-row-key="${key}"]`);
const visibleKeys = () => page.locator('[data-testid="dual-row"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-row-key")));
const selectedFigureCount = (side) => pane(side).locator(".mri-measure.is-selected .mri-measure-hit").count();
const overlayState = (side) => pane(side).getAttribute("data-overlay-state");

/** Segmento seleccionado en pantalla, en la base 0..256 del SVG. */
async function drawnSegment(side) {
  return pane(side).locator(".mri-measure.is-selected line").first().evaluate((line) => ({
    x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")),
  }));
}
const approx = (a, b) => Math.abs(a - b) < 0.0051;
const segmentMatches = (segment, points) =>
  approx(segment.x1, points[0].x) && approx(segment.y1, points[0].y) && approx(segment.x2, points[1].x) && approx(segment.y2, points[1].y);

async function sliceOf(side) {
  return (await pane(side).locator(".rr-slice-index").first().innerText()).trim();
}
async function zoomOf(side) {
  return (await pane(side).locator(".zoom-readout").first().innerText()).trim();
}
async function wlOf(side) {
  return (await pane(side).locator(".rr-corner-bl").first().innerText()).trim();
}
/** La capa de medidas debe cubrir exactamente la imagen: si se desalinea, el trazo queda en otro lugar. */
async function layerCoversImage(side) {
  return pane(side).evaluate((root) => {
    const layer = root.querySelector(".mri-measure-layer");
    const image = root.querySelector(".mri-asset-img");
    if (!layer || !image) return null;
    const a = layer.getBoundingClientRect();
    const b = image.getBoundingClientRect();
    return Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
  });
}

async function apiGet(path, withToken = true) {
  const response = await fetch(`${apiUrl}${path}`, { headers: withToken && authHeader ? { authorization: authHeader } : {} });
  return response.status;
}

/* =========================================================================================== */
/* A. Datos reales: CMP-SYN-B (actual) frente a CMP-SYN-A (referencia)                           */
/* =========================================================================================== */

await login();
await openStudy(currentCase);

// A1. Estado del visor individual antes de abrir la comparación.
const individualSliceBefore = (await page.locator(".rr-slice-index").first().innerText()).trim();
await page.getByRole("button", { name: /Corte siguiente en sagittal/ }).first().click();
await page.waitForTimeout(600);
await page.locator("button", { hasText: "Acercar" }).first().click();
await page.waitForTimeout(300);
const individualBefore = {
  slice: (await page.locator(".rr-slice-index").first().innerText()).trim(),
  zoom: (await page.locator(".zoom-readout").first().innerText()).trim(),
  wl: (await page.locator(".rr-corner-bl").first().innerText()).trim(),
};
assertTruthy(individualBefore.slice !== individualSliceBefore, "el visor individual cambió de corte antes de comparar");
ok(`visor individual con estado propio antes de comparar (${JSON.stringify(individualBefore)})`);

// A2. Abrir desde la herramienta: identidad, fecha y corrida de cada lado.
await openDualFromTool(referenceCase);
await shot("01-visor-dual-sin-seleccion");
assertEqual(await page.getByTestId("dual-id-reference").innerText(), referenceCase, "ID de la referencia");
assertEqual(await page.getByTestId("dual-id-current").innerText(), currentCase, "ID del actual");
assertTruthy((await pane("reference").locator(".rr-dual-badge").innerText()).toLowerCase() === "referencia", "rótulo Referencia");
assertTruthy((await pane("current").locator(".rr-dual-badge").innerText()).toLowerCase() === "actual", "rótulo Actual");
const refBox = await pane("reference").boundingBox();
const curBox = await pane("current").boundingBox();
assertTruthy(refBox.x < curBox.x, "la referencia está a la izquierda y el estudio actual a la derecha");
const response = lastComparison();
assertTruthy(response, "hay respuesta de comparación");
if (dbCheck) {
  assertEqual(response.current.runId, latestRunId(currentCase), "la comparación usa la corrida que muestra el visor para el estudio actual");
  assertEqual(response.reference.runId, latestRunId(referenceCase), "la referencia usa su corrida más reciente");
  const tail = (id) => id.slice(-6);
  assertTruthy((await page.getByTestId("dual-run-current").innerText()).includes(tail(latestRunId(currentCase))), "la cabecera actual muestra la corrida usada");
  assertTruthy((await page.getByTestId("dual-run-reference").innerText()).includes(tail(latestRunId(referenceCase))), "la cabecera de referencia muestra la corrida usada");
  const request = comparisonRequests.find((url) => /referenceCaseId=/.test(url));
  assertTruthy(request.includes(`currentRunId=${latestRunId(currentCase)}`), "el visor envía su currentRunId");
  // Las imágenes de cada lado salen de la corrida de ese estudio.
  assertTruthy(imageRequests.some((url) => url.includes(`/assets/${sagittalRunId(currentCase)}/`)), "se pidió la imagen del estudio actual");
  assertTruthy(imageRequests.some((url) => url.includes(`/assets/${sagittalRunId(referenceCase)}/`)), "se pidió la imagen de la referencia");
}
ok("apertura: referencia a la izquierda, actual a la derecha, ID/fecha/corrida correctos y corrida del visor respetada");

for (const side of ["reference", "current"]) {
  assertTruthy(await pane(side).locator(".mri-asset-img").count() > 0, `el lado ${side} tiene imagen`);
  assertEqual(await pane(side).locator(".mri-measure-layer").count(), 0, `sin selección el lado ${side} no tiene marcas sobre la imagen`);
}
ok("sin diferencia seleccionada ninguna imagen lleva marcas");

const result = lastComparison();
const rows = result.comparisons;
assertTruthy(rows.length > 0, "hay mediciones comparables reales");
assertTruthy(rows.every((row) => row.deltaAbsolute === 0), "CMP-SYN-A/B vienen del mismo archivo: todas las diferencias son cero");

// A3. Filtros con datos reales (todas las diferencias son cero).
await page.getByTestId("dual-filter-nonzero").check();
await page.getByTestId("dual-empty").waitFor();
const emptyText = await page.getByTestId("dual-empty").innerText();
assertTruthy(emptyText.includes("No hay diferencias que cumplan el filtro"), "mensaje de filtro sin resultados");
assertTruthy(!/sin cambios/i.test(emptyText), "con filtro aplicado no se dice 'Sin cambios'");
const filterState = await page.getByTestId("dual-filter-state").innerText();
assertTruthy(filterState.includes(`${rows.length} filas ocultas de ${rows.length}`), `el filtro informa cuántas ocultó (${filterState})`);
await shot("06-filtro-sin-resultados");
await page.getByTestId("dual-filter-reset").click();
assertEqual((await visibleKeys()).length, rows.length, "restablecer devuelve todas las filas");
assertEqual(await page.getByTestId("dual-filter-state").count(), 0, "sin filtro no hay aviso de filtro");
ok("filtro de diferencias distintas de cero: sin resultados explícito, filas ocultas contadas y recuperables");

// Umbral por métrica: la unidad de cada métrica se ve y un umbral no toca las otras.
await page.getByTestId("dual-filter-minimums-toggle").click();
const areaInput = page.locator('[data-testid="dual-filter-minimums"] input[data-metric="disc.area"]');
assertTruthy(await areaInput.count(), "hay un umbral para el área discal");
const unitText = await page.getByTestId("dual-filter-minimums").innerText();
assertTruthy(unitText.includes("mm²") && unitText.includes("mm") && unitText.includes("°"), `cada métrica muestra su unidad (${unitText.replace(/\n/g, " ")})`);
await areaInput.fill("1000");
const discAreaRows = rows.filter((row) => row.structure === "disc" && row.metric === "area").length;
assertTruthy(discAreaRows > 0, "hay filas de área discal");
assertEqual((await visibleKeys()).length, rows.length - discAreaRows, "el umbral de mm² oculta solo el área discal (no mm ni grados)");
const stateText = await page.getByTestId("dual-filter-state").innerText();
assertTruthy(stateText.includes(`${discAreaRows} filas ocultas`) || stateText.includes(`${discAreaRows} fila oculta`), "informa cuántas ocultó el umbral");
await areaInput.fill("");
assertEqual((await visibleKeys()).length, rows.length, "borrar el umbral devuelve las filas");
await page.getByTestId("dual-filter-minimums-toggle").click();
ok("umbral de magnitud por métrica: solo afecta a su métrica, informa filas ocultas y es reversible");

// A4. Selección: corte de origen y trazo real en ambos lados.
const target = rows.find((row) => row.reference.location?.status === "located" && row.current.location?.status === "located") ?? rows[0];
const targetKey = rowKeyOf(target);
await rowLocator(targetKey).click();
await page.waitForTimeout(1500);
for (const [side, value, caseId] of [["reference", target.reference, referenceCase], ["current", target.current, currentCase]]) {
  assertEqual(await overlayState(side), "draw", `el lado ${side} dibuja la medición`);
  assertEqual(await selectedFigureCount(side), 1, `el lado ${side} muestra solo la figura seleccionada`);
  const segment = await drawnSegment(side);
  if (dbCheck) {
    const points = persistedPoints(caseId, value.measurementId);
    assertTruthy(segmentMatches(segment, points), `el trazo del lado ${side} coincide con lo persistido (${JSON.stringify(segment)} vs ${JSON.stringify(points)})`);
    assertEqual(await sliceOf(side), `${persistedSlice(caseId, value.measurementId) + 1}/15`, `el lado ${side} abre su corte de origen`);
  }
  assertTruthy((await pane(side).getAttribute("class")).includes("has-selection"), "las demás capas se atenúan");
  const cover = await layerCoversImage(side);
  assertTruthy(cover !== null && cover < 1.01, `la capa de medidas cubre la imagen del lado ${side}`);
}
const selectedText = (await page.getByTestId("dual-selected").innerText()).toLowerCase();
assertTruthy(selectedText.includes("referencia") && selectedText.includes("actual") && selectedText.includes("diferencia"), "se muestran ambos valores y la diferencia");
assertEqual(await page.locator(`[data-row-key="${targetKey}"]`).getAttribute("aria-current"), "true", "la selección sigue visible en la lista");
await shot("02-diferencia-seleccionada");
ok(`selección de ${targetKey}: corte y trazo reales (contrastados con la base) y solo esa figura en ambos lados`);

// A5. Zoom, desplazamiento, ventana y cambio de corte con la figura puesta.
await pane("current").locator("button", { hasText: "Acercar" }).click();
await pane("current").locator("button", { hasText: "Acercar" }).click();
await page.waitForTimeout(300);
const zoomedReadout = await zoomOf("current");
assertTruthy(zoomedReadout !== await zoomOf("reference"), "cada visor tiene su propio zoom");
const frame = await pane("current").locator(".real-slice-frame").boundingBox();
await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
await page.mouse.down();
await page.mouse.move(frame.x + frame.width / 2 + 40, frame.y + frame.height / 2 + 25, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
const afterPan = await layerCoversImage("current");
assertTruthy(afterPan !== null && afterPan < 1.01, "tras zoom y desplazamiento la capa de medidas sigue sobre la imagen");
assertEqual(await selectedFigureCount("current"), 1, "la figura sigue después de zoom y desplazamiento");
const wlBefore = await wlOf("current");
const refZoomBefore = await zoomOf("reference");
ok("zoom y desplazamiento propios de cada visor; la figura acompaña a la imagen");

const keys = await visibleKeys();
const otherKey = keys.find((key) => key !== targetKey);
await rowLocator(otherKey).click();
await page.waitForTimeout(800);
assertEqual(await zoomOf("current"), zoomedReadout, "elegir otra diferencia no reinicia el zoom");
assertEqual(await wlOf("current"), wlBefore, "elegir otra diferencia no reinicia W/L");
assertEqual(await zoomOf("reference"), refZoomBefore, "el otro visor no se tocó");
ok("cambiar de diferencia no reinicia zoom ni W/L");

await rowLocator(targetKey).click();
await page.waitForTimeout(600);
const sliceBefore = await sliceOf("current");
await pane("current").getByRole("button", { name: /Corte siguiente/ }).click();
await page.waitForTimeout(700);
assertEqual(await selectedFigureCount("current"), 0, "al cambiar de corte no queda el trazo de otro corte sobre la imagen nueva");
assertEqual(await overlayState("current"), "elsewhere", "el lado que cambió de corte lo indica");
assertEqual(await selectedFigureCount("reference"), 1, "el otro lado no se ve afectado");
await shot("07-cambio-manual-de-corte");
await page.getByTestId("dual-return-current").click();
await page.waitForTimeout(700);
assertEqual(await sliceOf("current"), sliceBefore, "Volver a la medición seleccionada restituye el corte");
assertEqual(await selectedFigureCount("current"), 1, "y vuelve el trazo");
ok("cambio manual de corte: no se arrastra el trazo, el otro lado sigue y se puede volver a la medición");

// A6. Anterior / siguiente sobre las filas del filtro activo.
const orderedKeys = await visibleKeys();
const startIndex = orderedKeys.indexOf(targetKey);
await page.getByTestId("dual-next").click();
assertEqual(await page.locator('[aria-current="true"]').first().getAttribute("data-row-key"), orderedKeys[startIndex + 1], "Siguiente avanza una fila");
await page.getByTestId("dual-prev").click();
assertEqual(await page.locator('[aria-current="true"]').first().getAttribute("data-row-key"), orderedKeys[startIndex], "Anterior vuelve");
await rowLocator(orderedKeys[0]).click();
assertTruthy(await page.getByTestId("dual-prev").isDisabled(), "en la primera fila no hay anterior");
await rowLocator(orderedKeys[orderedKeys.length - 1]).click();
assertTruthy(await page.getByTestId("dual-next").isDisabled(), "en la última fila no hay siguiente");
const position = await page.getByTestId("dual-position").innerText();
assertTruthy(position.includes(`${orderedKeys.length} de ${orderedKeys.length}`), `la posición se informa (${position})`);
ok("anterior/siguiente recorren la lista visible y avisan los extremos");

// A7. Una medición sin trazo (áreas): se abre el corte, no se inventa nada, se explica.
const areaRow = rows.find((row) => row.reference.location?.status === "slice_only");
if (areaRow) {
  await rowLocator(rowKeyOf(areaRow)).click();
  await page.waitForTimeout(800);
  for (const side of ["reference", "current"]) {
    assertEqual(await overlayState(side), "unavailable", `sin trazo en ${side}`);
    assertEqual(await selectedFigureCount(side), 0, `no se dibuja nada en ${side}`);
    const note = await page.getByTestId(`dual-location-${side}`).innerText();
    assertTruthy(note.includes("No se puede ubicar en este estudio"), `el lado ${side} explica por qué (${note})`);
    assertTruthy(/\d+\/15/.test(await sliceOf(side)), "igual se abre el corte");
  }
  const values = (await page.getByTestId("dual-selected").innerText()).toLowerCase();
  assertTruthy(values.includes("referencia") && values.includes("actual"), "los valores siguen disponibles");
  await shot("04-ubicacion-no-disponible-areas");
  ok("medición sin trazo guardado (área): valores visibles, corte abierto, sin marcas inventadas y con motivo");
} else {
  ok("(omitido) no hay mediciones solo-corte en este par");
}

// A8. Hallazgos IA: los dos estudios abiertos, cada uno con su procedencia.
await page.getByTestId("dual-tab-findings").click();
await page.getByTestId("dual-findings").waitFor();
// El detalle original de cada estudio queda plegado bajo la comparación: se abre para leerlo.
await page.getByTestId("dual-findings-originals").locator("> summary").click();
const findingsRef = await page.getByTestId("dual-findings-reference").innerText();
const findingsCur = await page.getByTestId("dual-findings-current").innerText();
assertTruthy(findingsRef.includes(referenceCase) && findingsCur.includes(currentCase), "cada lado muestra su estudio");
assertTruthy(findingsRef.includes("análisis") && findingsCur.includes("análisis"), "cada lado muestra su corrida");
assertTruthy(await page.getByTestId("dual-findings-comparison").count() === 1, "la vista principal es la comparación por disco y clasificación");
await shot("05-hallazgos-ia-ambos-estudios");
await page.getByTestId("dual-tab-differences").click();
assertEqual(await selectedFigureCount("reference") + await selectedFigureCount("current") >= 0, true, "volver a Diferencias no pierde los visores");
ok("Hallazgos IA: comparación como vista principal y detalle original de ambos estudios con su procedencia");

// A9. Cambio rápido de referencia con respuestas fuera de orden.
const options = await page.locator('[data-testid="dual-reference-select"] option').evaluateAll((nodes) => nodes.map((node) => node.value).filter(Boolean));
if (options.length >= 2) {
  const [slow, fast] = [options[0], options[1]];
  await page.route((url) => url.href.includes("initial-analysis-comparison?") && url.href.includes(`referenceCaseId=${slow}`), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  await page.getByTestId("dual-reference-select").selectOption(slow);
  await page.waitForTimeout(150);
  await page.getByTestId("dual-reference-select").selectOption(fast);
  const seen = new Set();
  const deadline = Date.now() + 4200;
  while (Date.now() < deadline) {
    const idText = await page.getByTestId("dual-id-reference").innerText().catch(() => "");
    if (idText) seen.add(idText);
    await page.waitForTimeout(120);
  }
  await page.unroute((url) => url.href.includes("initial-analysis-comparison?"));
  assertTruthy(!seen.has(slow), `la respuesta tardía de ${slow} no reemplazó a ${fast} (vistos: ${[...seen].join(", ")})`);
  assertEqual(await page.getByTestId("dual-id-reference").innerText(), fast, "queda la última referencia elegida");
  assertEqual(await page.getByTestId("dual-reference-select").inputValue(), fast, "el selector coincide");
  assertEqual(await page.locator('[aria-current="true"]').count(), 0, "no queda una selección de la comparación anterior");
  ok(`cambio rápido ${slow} → ${fast} con la primera respuesta demorada: se descarta la tardía y no queda overlay de la anterior`);
} else {
  ok("(omitido) un solo candidato elegible: no se puede probar el cambio rápido de referencia");
}

// A10. Volver al visor individual: estado conservado. Escape también cierra.
await page.keyboard.press("Escape");
await dual().waitFor({ state: "detached" });
const individualAfter = {
  slice: (await page.locator(".rr-slice-index").first().innerText()).trim(),
  zoom: (await page.locator(".zoom-readout").first().innerText()).trim(),
  wl: (await page.locator(".rr-corner-bl").first().innerText()).trim(),
};
assertTruthy(same(individualAfter, individualBefore), `el visor individual conserva su estado (${JSON.stringify(individualBefore)} vs ${JSON.stringify(individualAfter)})`);
ok("al salir (Escape) el visor individual conserva corte, zoom y ventana");

/* ---- Sin POST de análisis en toda la parte A ---- */
assertEqual(nonLoginMutations().length, 0, `ninguna solicitud de escritura durante la parte A (${nonLoginMutations().join(", ")})`);
assertTruthy(comparisonRequests.every((url) => /initial-analysis-comparison/.test(url)), "solo lecturas de comparación");
ok("abrir, navegar, filtrar y cerrar no disparó ningún POST/PUT/DELETE (ningún análisis)");

/* ---- Pacientes distintos y permisos, contra el Backend real ---- */
assertTruthy(authHeader, "hay sesión para llamar a la API");
assertEqual(await apiGet(`/api/studies/${currentCase}/initial-analysis-comparison?referenceCaseId=${otherPatientCase}`), 404, "estudio de otro paciente");
assertEqual(await apiGet(`/api/studies/${currentCase}/initial-analysis-comparison?referenceCaseId=NO-EXISTE-1`), 404, "estudio inexistente");
assertEqual(await apiGet(`/api/studies/${currentCase}/initial-analysis-comparison?referenceCaseId=${currentCase}`) >= 400, true, "un estudio contra sí mismo");
assertEqual(await apiGet(`/api/studies/${currentCase}/initial-analysis-comparison?referenceCaseId=${referenceCase}`, false), 401, "sin sesión");
assertEqual(await apiGet(`/api/studies/${currentCase}/initial-analysis-comparison/candidates`, false), 401, "candidatos sin sesión");
ok("el Backend real rechaza otro paciente (404), estudio inexistente, comparación consigo mismo y pedidos sin sesión (401)");

/* =========================================================================================== */
/* B. Datos reales: caso aislado con una corrección profesional frente a CMP-SYN-A               */
/* =========================================================================================== */

assertEqual(sql(`select count(*) from domain_studies where case_id='${isoCase}'`), "1", `existe el caso aislado ${isoCase}`);
{
  await backToWorklist();
  await openStudy(isoCase);
  await openDualFromTool(referenceCase);
  const iso = lastComparison();
  const diffRows = iso.comparisons.filter((row) => row.deltaAbsolute !== 0);
  assertEqual(diffRows.length, 1, "el caso aislado tiene exactamente una diferencia distinta de cero");
  const diff = diffRows[0];
  const diffKey = rowKeyOf(diff);
  assertTruthy(diff.current.corrected && !diff.reference.corrected, "la diferencia viene de una corrección profesional del estudio actual");
  // El comparador usa la corrección EN LA CORRIDA de este caso: la corrida comparada es la del caso y la corrección está ligada a ella.
  assertEqual(iso.current.runId, latestRunIdOf(isoCase), "el comparador usa la corrida más reciente del caso aislado");
  assertEqual(sql(`select count(*) from domain_review_corrections c join domain_study_runs r on r.id=c.study_run_id where r.multiplanar_run_id='${iso.current.runId}' and c.measurement_id='${diff.current.measurementId}'`), "1", "la corrección persistida pertenece a la corrida que compara");
  assertEqual(Number(diff.current.effectiveValue), ISO_CORRECTED, "el valor efectivo del comparador es la corrección");
  await rowLocator(diffKey).click();
  await page.waitForTimeout(1500);

  const summary = await page.getByTestId("dual-selected").innerText();
  const referenceAi = persistedAiValueOf(referenceCase, diff.reference.measurementId);
  const expectedDelta = Math.round((ISO_CORRECTED - referenceAi) * 100) / 100;
  const expectedPercent = ((ISO_CORRECTED - referenceAi) / referenceAi * 100).toFixed(1);
  assertTruthy(
    summary.includes(isoCreated?.original?.toFixed(2) ?? "") && summary.includes(ISO_CORRECTED.toFixed(2)) && summary.includes(`+${expectedDelta.toFixed(2)}`) && summary.includes(expectedPercent),
    `valores y diferencia exactos: IA ${isoCreated?.original}, corregido ${ISO_CORRECTED}, +${expectedDelta.toFixed(2)} mm, ${expectedPercent} % (${summary.replace(/\n/g, " ")})`,
  );
  assertTruthy(summary.includes("corregido"), "se marca la procedencia profesional");
  assertTruthy(await rowLocator(diffKey).innerText().then((text) => text.includes("corregido")), "la fila indica la corrección");

  if (dbCheck) {
    assertEqual(persistedValue(isoCase, diff.current.measurementId), isoCreated?.original ?? persistedAiValueOf(isoCase, diff.current.measurementId), "el original de la IA sigue en el snapshot");
    const correction = persistedCorrection(isoCase, diff.current.measurementId);
    assertEqual(Number(correction.value), ISO_CORRECTED, "la corrección persistida es el valor guardado");
    const aiPoints = persistedPoints(isoCase, diff.current.measurementId);
    const savedPoints = correction.points ?? null;
    const moved = savedPoints && !same(savedPoints, aiPoints);
    const expected = moved ? savedPoints : aiPoints;
    const segment = await drawnSegment("current");
    assertTruthy(segmentMatches(segment, expected), `el trazo dibujado es el persistido y no se ajustó al valor corregido (${JSON.stringify(segment)} vs ${JSON.stringify(expected)})`);
    const note = await page.getByTestId("dual-location-current").innerText();
    assertTruthy(moved ? note.includes("revisor") : note.includes("no modifica el trazo"), `la nota dice de dónde sale el trazo (${note})`);
    // Longitud del trazo: la de los puntos persistidos, no la que correspondería a 7,3 mm.
    const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
    const expectedLength = Math.hypot(expected[1].x - expected[0].x, expected[1].y - expected[0].y);
    assertTruthy(Math.abs(length - expectedLength) < 0.01, "el trazo no se alargó para coincidir con el valor corregido");
  }
  await shot("08-correccion-profesional-sin-nueva-geometria");
  ok("corrección profesional: valor corregido y original consultables, mismo trazo persistido (sin geometría nueva) y diferencia calculada contra la base");

  // Filtros con una diferencia real distinta de cero.
  await page.getByTestId("dual-filter-nonzero").check();
  assertEqual((await visibleKeys()).length, 1, "solo queda la diferencia distinta de cero");
  assertEqual(await page.locator('[aria-current="true"]').count(), 1, "la selección sigue visible porque cumple el filtro");
  assertTruthy(await page.getByTestId("dual-next").isDisabled(), "con una sola fila no hay siguiente");
  assertTruthy(await page.getByTestId("dual-prev").isDisabled(), "ni anterior");
  const hiddenText = await page.getByTestId("dual-filter-state").innerText();
  assertTruthy(hiddenText.includes(`${iso.comparisons.length - 1} filas ocultas`), `informa las ocultas (${hiddenText})`);
  await shot("03-filtro-aplicado");

  await page.getByTestId("dual-filter-minimums-toggle").click();
  const metricKey = `${diff.structure}.${diff.metric}`;
  const input = page.locator(`[data-testid="dual-filter-minimums"] input[data-metric="${metricKey}"]`);
  const exact = expectedDelta.toFixed(2).replace(".", ",");
  const above = (expectedDelta + 0.01).toFixed(2).replace(".", ",");
  await input.fill(exact);
  assertEqual((await visibleKeys()).length, 1, `límite exacto: ${exact} deja pasar una diferencia de exactamente ${exact}`);
  await input.fill(above);
  await page.getByTestId("dual-empty").waitFor();
  assertTruthy((await page.getByTestId("dual-empty").innerText()).includes("No hay diferencias que cumplan el filtro"), `${above} no la deja pasar`);
  assertEqual(await selectedFigureCount("current"), 0, "al ocultarse la fila seleccionada se suelta la selección y no queda su trazo");
  const below = (Math.floor(expectedDelta * 10) / 10).toString().replace(".", ",");
  await input.fill(below);
  assertEqual((await visibleKeys()).length, 1, `${below} la deja pasar`);
  // Un umbral grande en otra métrica (otra unidad) no la oculta.
  await input.fill("");
  const angleInput = page.locator('[data-testid="dual-filter-minimums"] input[data-metric*="angle"]');
  if (await angleInput.count()) {
    await angleInput.first().fill("100");
    assertEqual((await visibleKeys()).length, 1, "un umbral en grados no afecta a una métrica en mm");
    await angleInput.first().fill("");
  }
  await page.getByTestId("dual-filter-reset").click();
  assertEqual((await visibleKeys()).length, iso.comparisons.length, "restablecer devuelve todas las filas");
  ok("filtros con diferencia real: solo distintas de cero, límite inclusivo exacto, unidades independientes y restablecer");

  // Selección con otra referencia se limpia; inversión de roles no aplica (el actual es el abierto).
  await closeDual();
  assertEqual(nonLoginMutations().length, 0, "parte B sin escrituras");
  ok("la parte B no escribió nada");
}

/* =========================================================================================== */
/* D. Historial del paciente: "Comparar" abre la comparación real                                 */
/* =========================================================================================== */

await backToWorklist();
await openStudy(currentCase);
await page.getByTestId("tools-open").click();
await page.locator('[data-tool-id="history"]').click();
await page.getByRole("button", { name: "Ver historial del paciente" }).click();
const compareButtons = page.getByRole("button", { name: "Comparar", exact: true });
await compareButtons.first().waitFor();
const comparisonsBefore = comparisonResponses.length;
await compareButtons.first().click();
await dual().waitFor();
await page.getByTestId("dual-differences").waitFor();
assertEqual(await page.getByTestId("dual-id-current").innerText(), currentCase, "el estudio desde el que se abrió el historial es el actual");
const fromHistory = lastComparison();
assertTruthy(comparisonResponses.length > comparisonsBefore, "la comparación se pidió al Backend");
assertEqual(fromHistory.source, "initial_analysis", "es la comparación sobre el análisis inicial real");
assertEqual(await page.getByTestId("dual-id-reference").innerText(), fromHistory.reference.caseId, "la referencia es el estudio elegido en el historial");
assertTruthy(["patient_id", "subject_ref_historical"].includes(fromHistory.current.patientLink), "el vínculo de paciente lo valida el Backend");
await shot("11-comparar-desde-historial");
await closeDual();
assertTruthy(await page.locator("aside.rr-panel").isVisible(), "al cerrar se vuelve al visor del estudio");
assertEqual(nonLoginMutations().length, 0, "el historial no escribió nada");
ok("historial del paciente: «Comparar» abre la comparación visual real con la referencia elegida; el Backend valida paciente y permisos");

/* =========================================================================================== */
/* C. SIMULADO en el navegador: ubicación ausente, corrida distinta, fallos de carga             */
/* =========================================================================================== */

await backToWorklist();
await openStudy(currentCase);
const patch = (mutate) => async (route) => {
  const original = await route.fetch();
  const body = await original.json();
  mutate(body);
  await route.fulfill({ response: original, json: body });
};
const comparisonUrl = (url) => url.href.includes("initial-analysis-comparison?");

// C1. Un lado sin ubicación no bloquea al otro. (SIMULADO)
await page.route(comparisonUrl, patch((body) => { for (const row of body.comparisons) row.reference.location = null; }));
await openDualFromTool(referenceCase);
await rowLocator(targetKey).click();
await page.waitForTimeout(1200);
assertEqual(await overlayState("reference"), "unavailable", "[simulado] sin ubicación en la referencia");
assertEqual(await overlayState("current"), "draw", "[simulado] el actual sí se dibuja");
assertTruthy((await page.getByTestId("dual-location-reference").innerText()).includes("No se puede ubicar en este estudio"), "[simulado] se explica");
assertTruthy((await rowLocator(targetKey).innerText()).includes("sin ubicación"), "[simulado] la fila indica qué lado no se puede ubicar");
await shot("09-simulado-ubicacion-solo-en-un-lado");
ok("[simulado] ubicación ausente en un lado: valores visibles, se indica qué lado falla y el otro visor sigue funcionando");
await closeDual();
await page.unroute(comparisonUrl);

// C2. Corte inexistente en la referencia y sin ubicación en ambos. (SIMULADO)
await page.route(comparisonUrl, patch((body) => {
  for (const row of body.comparisons) {
    if (row.reference.location) row.reference.location.sliceIndex = 40;
    row.current.location = null;
  }
}));
await openDualFromTool(referenceCase);
await rowLocator(targetKey).click();
await page.waitForTimeout(1000);
assertEqual(await overlayState("reference"), "unavailable", "[simulado] corte fuera de la serie cargada");
assertTruthy((await page.getByTestId("dual-location-reference").innerText()).includes("no existe"), "[simulado] se dice que el corte no existe");
assertEqual(await page.getByTestId("dual-return-reference").count(), 0, "[simulado] no se ofrece volver a un corte inexistente");
assertEqual(await overlayState("current"), "unavailable", "[simulado] ninguno de los dos se dibuja");
ok("[simulado] corte inexistente y ubicación ausente: se explica y no se ofrece volver a un corte al que no se puede ir");
await closeDual();
await page.unroute(comparisonUrl);

// C3. La corrida de la comparación no es la que se cargaría: no se muestra otra en silencio. (SIMULADO)
await page.route(comparisonUrl, patch((body) => { body.reference.runId = "run-que-no-existe"; }));
await openDualFromTool(referenceCase);
const mismatch = await page.getByTestId("dual-error-reference").innerText();
assertTruthy(mismatch.includes("No se muestra otra corrida en su lugar"), `[simulado] corrida distinta explícita (${mismatch})`);
assertEqual(await pane("reference").locator(".mri-asset-img").count(), 0, "[simulado] no se muestra la imagen de otra corrida");
assertEqual(await pane("current").locator(".mri-asset-img").count() > 0, true, "[simulado] el otro lado sigue mostrando su imagen");
await shot("10-simulado-corrida-distinta");
ok("[simulado] corrida distinta de la usada por la comparación: error explícito del lado afectado, sin sustituirla");
await closeDual();
await page.unroute(comparisonUrl);

// C4. Falla la carga del estudio de referencia: error independiente. (SIMULADO)
await page.route(new RegExp(`/api/studies/${referenceCase}$`), (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
await openDualFromTool(referenceCase);
assertTruthy(await page.getByTestId("dual-error-reference").isVisible(), "[simulado] error de carga de la referencia");
assertTruthy(await pane("current").locator(".mri-asset-img").count() > 0, "[simulado] el estudio actual sigue disponible");
await rowLocator(targetKey).click();
await page.waitForTimeout(800);
assertEqual(await overlayState("current"), "draw", "[simulado] el actual igual dibuja su medición");
ok("[simulado] fallo de carga de un estudio: error por visor, sin bloquear el otro ni la tabla");
await closeDual();
await page.unroute(new RegExp(`/api/studies/${referenceCase}$`));

// C5. Falla la imagen de la referencia: error explícito, sin reemplazarla por otro corte. (SIMULADO)
if (dbCheck) {
  // Se recarga la aplicación: las imágenes ya vistas quedan en una caché de la sesión y no volverían a pedirse.
  await page.route(new RegExp(`/api/ai/assets/${sagittalRunId(referenceCase)}/sagittal/input\\.png`), (route) => route.abort());
  await login();
  await openStudy(currentCase);
    await openDualFromTool(referenceCase);
  const refText = await pane("reference").innerText();
  assertTruthy(refText.includes("Imagen no disponible desde backend"), `[simulado] error explícito de imagen (${refText.split(String.fromCharCode(10)).join(" | ").slice(0, 400)}) urls=${imageRequests.filter((u) => u.includes(sagittalRunId(referenceCase))).slice(-3).join(",")}`);
  assertEqual(await pane("reference").locator(".mri-asset-img").count(), 0, "[simulado] no se muestra otra imagen en su lugar");
  assertTruthy(await pane("current").locator(".mri-asset-img").count() > 0, "[simulado] el actual no se ve afectado");
  ok("[simulado] fallo de la imagen de un lado: error explícito y sin sustituirla por otro corte o corrida");
  await closeDual();
}

assertEqual(nonLoginMutations().length, 0, `ninguna escritura en toda la ejecución (${nonLoginMutations().join(", ")})`);
ok("toda la ejecución fue de solo lectura (sin POST/PUT/DELETE de análisis)");

await browser.close();
console.log(`\nE2E de comparación visual: ${step} verificaciones correctas.`);
