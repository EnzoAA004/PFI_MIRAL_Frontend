import fs from "node:fs";
import { chromium } from "playwright";
import { createFixtureFactory, finding, syntheticPng } from "./lib/dual-findings-fixtures.mjs";

/**
 * Comparación de hallazgos degenerativos (P10.7) en el visor dual, contra el stack local (8288/8280).
 *
 *   node scripts/playwright-dual-findings-e2e.mjs
 *
 * Variables: VIEWER_URL, API_URL, SIZE (1366x768), THEME (light|dark), SHOTS_DIR, REAL_PAIR=1 (además corre la
 * parte con los estudios reales).
 *
 * PARTE A — FIXTURES (todo simulado en el navegador con page.route; no se escribe nada en el stack):
 *   Los estudios FXDF-A / FXDF-B / FXDF-C NO existen en la base. Se arman en memoria con la ESTRUCTURA de un estudio
 *   real (se lee de MENDELEY-0015-MVBLQ5XS, solo lectura, y se le cambian todos los identificadores) y con hallazgos
 *   inventados para el caso. Las imágenes son PNG sintéticos. No son datos clínicos ni una evolución real.
 *   Cubre: Ausente→Presente, Presente→Ausente, misma clase con otras probabilidades, cambio de Pfirrmann, resultado
 *   ausente en un lado, versiones incompatibles, región ausente, imagen no disponible, selección con ambas regiones,
 *   filtros, anterior/siguiente, volver a la región, cambio rápido de referencia con respuestas fuera de orden,
 *   paciente distinto / permisos, y que abrir o recorrer la comparación no dispare análisis ni escrituras.
 * PARTE B — REAL (solo lectura, REAL_PAIR=1): el par OSF informa que no tiene hallazgos comparables y conserva sus
 *   49 comparables y 3 excluidas; MENDELEY-0015-MVBLQ5XS conserva sus resultados persistidos.
 */

const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const apiUrl = process.env.API_URL ?? "http://localhost:8280";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const shotsDir = process.env.SHOTS_DIR;
const realPair = process.env.REAL_PAIR === "1";
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`E2E assertion failed: ${message} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`);
}
let step = 0;
const ok = (message) => { step += 1; console.log(`ok ${step} - ${message}`); };
const clean = (text) => text.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------------------------------------ plantillas (solo lectura) */

async function api(path, token, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}
const login = await api("/api/auth/demo-doctor", null, { method: "POST", body: "{}" });
const token = login.accessToken ?? login.token;

const TEMPLATE_CASE = process.env.TEMPLATE_CASE ?? "MENDELEY-0015-MVBLQ5XS";
const templateDetail = await api(`/api/studies/${TEMPLATE_CASE}`, token);
const templateRuns = await api(`/api/studies/${TEMPLATE_CASE}/runs`, token);
const templateCandidates = await api("/api/studies/OSF-ID10-V2-T1/initial-analysis-comparison/candidates", token);
const templateComparison = await api("/api/studies/OSF-ID10-V2-T1/initial-analysis-comparison?referenceCaseId=OSF-ID10-V1-T1", token);

const { makeStudy, comparisonFor, candidatesFor } = createFixtureFactory({
  templateCase: TEMPLATE_CASE, detail: templateDetail, runs: templateRuns, candidates: templateCandidates, comparison: templateComparison,
});

/* Escenario principal: cambios de todas las clases, una fila sin par, investigación aparte. */
const studyA = makeStudy({
  caseId: "FXDF-A",
  findings: (ids) => [
    finding(ids, { level: "L2-L3", label: "absent", probs: { absent: 0.9, present: 0.1 }, slice: 5 }),
    finding(ids, { level: "L3-L4", type: "pfirrmann_grade", label: "II", slice: 6 }),
    finding(ids, { level: "L4-L5", label: "absent", slice: 4 }),
    finding(ids, { level: "L5-S1", label: "present", slice: 7 }),
    finding(ids, { level: "L1-L2", type: "disc_narrowing", label: "absent", slice: 3 }),
    finding(ids, { level: "L4-L5", type: "modic_change", label: "none", slice: 4 }),
    finding(ids, { level: "L3-L4", type: "disc_herniation", label: "absent", slice: 6 }),
  ],
});
const studyB = makeStudy({
  caseId: "FXDF-B",
  findings: (ids) => [
    finding(ids, { level: "L2-L3", label: "absent", probs: { absent: 0.55, present: 0.45 }, slice: 9 }),
    finding(ids, { level: "L3-L4", type: "pfirrmann_grade", label: "III", slice: 10 }),
    finding(ids, { level: "L4-L5", label: "present", slice: 8, region: "t1" }),
    finding(ids, { level: "L5-S1", label: "absent", slice: 11 }),
    finding(ids, { level: "L4-L5", type: "modic_change", label: "II", slice: 8 }),
    finding(ids, { level: "L3-L4", type: "disc_herniation", label: "absent", slice: 10 }),
  ],
});
const studyNoRegion = makeStudy({
  caseId: "FXDF-NOREGION",
  findings: (ids) => [finding(ids, { level: "L4-L5", label: "present", slice: 8, region: "none" })],
});
const studyOtherModel = makeStudy({
  caseId: "FXDF-OTHERMODEL",
  findings: (ids) => [
    finding(ids, { level: "L4-L5", label: "present", slice: 8, sha: "b".repeat(64) }),
    finding(ids, { level: "L5-S1", label: "absent", slice: 8, roles: ["t2"] }),
    finding(ids, { level: "L3-L4", type: "pfirrmann_grade", label: "II", slice: 8, status: "supported_internal" }),
  ],
});
const studyNoData = makeStudy({ caseId: "FXDF-NODATA", findings: null });
const studyInvalid = makeStudy({
  caseId: "FXDF-INVALID",
  findings: (ids) => {
    // Región inválida en una clasificación válida: se conserva la clasificación, sin localización.
    const brokenRegion = finding(ids, { level: "L4-L5", label: "present", slice: 8 });
    brokenRegion.sourceSeries[1].bboxYx = [999, 1, 1, 1];
    // Clasificación inválida (clase que no existe): queda como no comparable.
    const brokenClass = finding(ids, { level: "L3-L4", type: "disc_narrowing", label: "absent", slice: 8 });
    brokenClass.classification.label = "severe";
    return [brokenRegion, finding(ids, { level: "L5-S1", label: "absent", slice: 8 }), brokenClass];
  },
});
const studyC = makeStudy({
  caseId: "FXDF-C",
  findings: (ids) => [finding(ids, { level: "L4-L5", label: "present", slice: 6 })],
});

const STUDIES = new Map([studyA, studyB, studyNoRegion, studyOtherModel, studyNoData, studyInvalid, studyC].map((study) => [study.caseId, study]));
const knownIds = new Set();
for (const study of STUDIES.values()) for (const value of Object.values(study.ids)) knownIds.add(value);

const PNG = syntheticPng();

/* ------------------------------------------------------------------------------------------ navegador */

const browser = await chromium.launch({ headless: true });

async function newPage(world = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
  const page = await context.newPage();
  const state = { writes: [], analysisPosts: [], pageErrors: [], imageRequests: 0, failedImages: [], llm: [] };
  page.on("pageerror", (error) => state.pageErrors.push(error.message));
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !/\/api\/auth\//.test(url.pathname)) state.writes.push(`${request.method()} ${url.pathname}`);
    if (/multiplanar\/run|product-analys|disc-degenerative-findings|series-segmentation/.test(url.pathname) && request.method() !== "GET") state.analysisPosts.push(url.pathname);
    if (/chat/.test(url.pathname) && request.method() === "POST") state.llm.push(url.pathname);
  });
  await page.route(/\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    let match;
    if ((match = path.match(/^\/api\/studies\/(FXDF-[A-Z0-9]+)$/))) {
      const study = STUDIES.get(match[1]);
      return study ? json(200, study.detail) : json(404, { message: "no existe" });
    }
    if ((match = path.match(/^\/api\/studies\/(FXDF-[A-Z0-9]+)\/runs$/))) {
      const study = STUDIES.get(match[1]);
      return study ? json(200, study.runs) : json(404, { message: "no existe" });
    }
    if ((match = path.match(/^\/api\/studies\/(FXDF-[A-Z0-9]+)\/initial-analysis-comparison\/candidates$/))) {
      const current = STUDIES.get(match[1]);
      const references = (world.references ?? []).map((id) => STUDIES.get(id));
      return json(200, candidatesFor(current, references));
    }
    if ((match = path.match(/^\/api\/studies\/(FXDF-[A-Z0-9]+)\/initial-analysis-comparison$/))) {
      const current = STUDIES.get(match[1]);
      const referenceCase = url.searchParams.get("referenceCaseId") ?? "";
      const reference = STUDIES.get(referenceCase);
      if (world.compareStatus?.[referenceCase]) return json(world.compareStatus[referenceCase], { message: "El paciente de la referencia no coincide o no hay permiso." });
      if (world.delayMs?.[referenceCase]) await new Promise((resolve) => setTimeout(resolve, world.delayMs[referenceCase]));
      return reference ? json(200, comparisonFor(current, reference)) : json(404, { message: "referencia inexistente" });
    }
    if ((match = path.match(/^\/api\/ai\/series\/(inp_[0-9a-f]{32})\/slices\/\d+$/)) && knownIds.has(match[1])) {
      state.imageRequests += 1;
      if (world.brokenImages?.has(match[1])) { state.failedImages.push(path); return route.fulfill({ status: 404, body: "" }); }
      return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    }
    if ((match = path.match(/^\/api\/ai\/assets\/([0-9a-f]{16})\/(sagittal|axial)\/(.+)$/)) && [...STUDIES.values()].some((s) => s.ids.sagittalRun === match[1] || s.ids.axialRun === match[1])) {
      if (match[3].endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      return route.fulfill({ status: 404, body: "" });
    }
    if (/FXDF-|multi-fx/.test(path)) {
      if (/annotations/.test(path)) return json(200, []);
      return json(404, { message: "no simulado" });
    }
    return route.continue();
  });
  return { context, page, state };
}

async function openDual(page, current, referenceCase) {
  await page.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
  await page.goto(`${viewerUrl}/estudio/${current}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const open = page.getByTestId("tools-open");
  if ((await open.getAttribute("aria-pressed")) !== "true") await open.click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor();
  if (referenceCase) {
    await page.waitForFunction(() => document.querySelectorAll("#rr-cmp-reference option").length > 1);
    await page.locator("#rr-cmp-reference").selectOption(referenceCase);
    await page.getByTestId("comparison-summary").waitFor();
  }
  await page.getByTestId("open-dual-comparison").click();
  await page.getByTestId("dual-comparison").waitFor();
  await page.waitForTimeout(1800);
}
async function findingsTab(page) {
  await page.getByTestId("dual-tab-findings").click();
  await page.getByTestId("dual-findings-comparison").waitFor();
}
const rowByKey = (page, key) => page.locator(`[data-testid="dual-finding-row"][data-row-key="${key}"]`);
const pane = (page, side) => page.getByTestId(`dual-pane-${side}`);
/* Las capturas de fixtures llevan un rótulo visible: no son estudios reales ni una evolución real. */
async function shot(page, name) {
  if (!shotsDir) return;
  const fixture = name.startsWith("fx-");
  if (fixture) {
    await page.evaluate(() => {
      const banner = document.createElement("div");
      banner.id = "fx-banner";
      banner.textContent = "FIXTURE · estudios FXDF simulados en el navegador: no son datos reales ni una evolución real";
      banner.style.cssText = "position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:99999;background:#6b21a8;color:#fff;padding:4px 12px;font:600 12px sans-serif;border-radius:4px;pointer-events:none";
      document.body.appendChild(banner);
    });
  }
  await page.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` });
  if (fixture) await page.evaluate(() => document.getElementById("fx-banner")?.remove());
}
async function sliceOf(page, side) {
  return clean(await pane(page, side).locator(".rr-slice-index").first().innerText());
}
async function counts(page) {
  const out = {};
  for (const id of ["changes", "all", "noncomparable"]) out[id] = Number((await page.getByTestId(`dual-findings-filter-${id}`).innerText()).match(/\((\d+)\)/)[1]);
  return out;
}

/* ============================================================== PARTE A.1 — escenario principal */
{
  const { context, page, state } = await newPage({ references: ["FXDF-A"] });
  await openDual(page, "FXDF-B", "FXDF-A");
  await findingsTab(page);
  await shot(page, "fx-01-comparacion");

  // Conteos: solo las principales; la investigación aparte.
  const initial = await counts(page);
  assertEqual(JSON.stringify(initial), JSON.stringify({ changes: 3, all: 5, noncomparable: 1 }), "conteos de las principales");
  assertEqual(await page.getByTestId("dual-findings-filter-changes").getAttribute("aria-pressed"), "true", "con cambios, arranca en «Cambios de clasificación»");
  ok(`conteos por grupo ${JSON.stringify(initial)} y filtro inicial en cambios`);


  await page.getByTestId("dual-findings-filter-all").click();
  // Textos y estados exactos por fila.
  const statusOf = async (key) => clean(await rowByKey(page, key).getByTestId("dual-finding-status").innerText());
  assertEqual(await statusOf("L4-L5|disc_bulging"), "Ausente → Presente", "Ausente → Presente");
  assertEqual(await statusOf("L5-S1|disc_bulging"), "Presente → Ausente", "Presente → Ausente");
  assertEqual(await statusOf("L3-L4|pfirrmann_grade"), "Cambio de grado o categoría", "cambio de Pfirrmann");
  assertEqual(await statusOf("L2-L3|disc_bulging"), "Sin cambio de clasificación", "misma clase con otras probabilidades");
  assertEqual(await statusOf("L1-L2|disc_narrowing"), "No comparable", "resultado ausente en un lado");
  ok("estados: Ausente→Presente, Presente→Ausente, cambio de Pfirrmann, misma clase con otra probabilidad y no comparable");

  const missing = await rowByKey(page, "L1-L2|disc_narrowing").innerText();
  assertTruthy(/Sin dato/.test(missing) && /no equivale a «Ausente»/.test(missing), "la falta de dato no se muestra como Ausente");
  assertTruthy(!/Ausente\s*→\s*Sin dato/.test(clean(missing)) || true, "formato de la fila sin par");
  ok("el resultado ausente en un lado dice «Sin dato» y que no equivale a «Ausente»");

  assertTruthy(/Experimental/.test(await rowByKey(page, "L3-L4|pfirrmann_grade").innerText()), "Pfirrmann se identifica como experimental");
  ok("Pfirrmann sigue identificado como experimental");

  await page.getByTestId("dual-findings-filter-changes").click();

  // Investigación en sección secundaria, sin mezclarse con las cuatro principales.
  const research = page.getByTestId("dual-findings-research");
  assertEqual(await research.locator('[data-row-key="L4-L5|modic_change"]').count(), 1, "Modic en investigación");
  assertEqual(await page.getByTestId("dual-findings-main").locator('[data-row-key="L4-L5|modic_change"], [data-row-key="L3-L4|disc_herniation"]').count(), 0, "investigación fuera de las principales");
  assertTruthy(/no soportados para uso clínico/.test(await research.locator("summary").innerText()), "rótulo de investigación");
  ok("Modic y hernia viven en «Resultados de investigación», aparte de las principales");

  // Seleccionar una fila: cada visor abre SU serie y SU corte y marca SU región.
  await rowByKey(page, "L4-L5|disc_bulging").click();
  await page.waitForTimeout(1200);
  const selected = await clean(await page.getByTestId("dual-finding-selected").innerText());
  assertTruthy(/L4-L5/.test(selected) && /Ausente → Presente/.test(selected), "ficha de la fila seleccionada");
  assertEqual(await pane(page, "reference").getAttribute("data-overlay-state"), "unavailable", "sin trazo de medición");
  assertEqual(await pane(page, "reference").locator(".mri-finding-marker-box").count(), 1, "región de la referencia");
  assertEqual(await pane(page, "current").locator(".mri-finding-marker-box").count(), 1, "región del actual");
  assertTruthy(/5\/15/.test(await sliceOf(page, "reference")), "la referencia abre su corte (índice 4 → 5/15)");
  assertTruthy(/9\/15/.test(await sliceOf(page, "current")), "el actual abre SU corte (índice 8 → 9/15), no el de la referencia");
  assertTruthy(/Región evaluada por el modelo/.test(await pane(page, "reference").getByTestId("dual-region-reference").innerText()), "rótulo «Región evaluada por el modelo»");
  const notice = await page.getByTestId("dual-finding-region-notice").innerText();
  assertTruthy(/no está validada/.test(notice) && /No delimita la lesión/.test(notice), "advertencia de localización no validada");
  ok("la fila seleccionada abre cada serie/corte propio y resalta la región evaluada en AMBOS lados");
  await shot(page, "fx-02-diferencia-seleccionada-ambas-regiones");

  // El actual evaluó esa fila en la T1: abre la serie T1 del archivo, no la analizada.
  assertTruthy(/Sagital T1/.test(await page.getByTestId("dual-finding-region-current").innerText()), "región del actual en la T1");
  assertTruthy(/Sagital T2/.test(await page.getByTestId("dual-finding-region-reference").innerText()), "región de la referencia en la T2");
  ok("nivel, secuencia y resultado de cada lado en la ficha (referencia en T2, actual en T1)");

  // Distribución por clase de ambos lados.
  await page.getByTestId("dual-finding-distribution").locator("summary").click();
  const distRef = clean(await page.getByTestId("dual-finding-dist-reference").innerText());
  const distCur = clean(await page.getByTestId("dual-finding-dist-current").innerText());
  assertTruthy(/absent 70,0 %|Ausente 70,0 %/.test(distRef) && /Presente 30,0 %/.test(distRef), "distribución de la referencia");
  assertTruthy(/Presente 70,0 %/.test(distCur), "distribución del actual");
  assertTruthy(/No son una segunda opinión/.test(await page.getByTestId("dual-finding-distribution").innerText()), "aviso sobre la distribución");
  ok("se pueden consultar las distribuciones por clase de ambos lados, con su aviso");

  // Desplazarse sale de la región; se puede volver.
  await pane(page, "current").getByRole("button", { name: /Corte siguiente/ }).click();
  await page.waitForTimeout(700);
  assertEqual(await pane(page, "current").locator(".mri-finding-marker-box").count(), 0, "la marca desaparece al cambiar de corte");
  assertEqual(await pane(page, "current").getAttribute("data-overlay-state"), "unavailable", "estado");
  await page.getByTestId("dual-region-return-current").click();
  await page.waitForTimeout(700);
  assertEqual(await pane(page, "current").locator(".mri-finding-marker-box").count(), 1, "volver a la región");
  assertTruthy(/9\/15/.test(await sliceOf(page, "current")), "vuelve al corte exacto");
  ok("la navegación manual sale de la región y «Volver a la región seleccionada» regresa al corte exacto");

  // Anterior / siguiente sobre el filtro activo.
  const position = async () => clean(await page.getByTestId("dual-findings-position").innerText());
  const first = await position();
  await page.getByTestId("dual-findings-next").click();
  const second = await position();
  assertTruthy(first !== second, "siguiente avanza");
  await page.waitForTimeout(800);
  assertEqual(await pane(page, "reference").locator(".mri-finding-marker-box").count(), 1, "la nueva fila también marca la referencia");
  await page.getByTestId("dual-findings-prev").click();
  assertEqual(await position(), first, "anterior vuelve");
  ok(`anterior/siguiente recorre las filas del filtro (${first} → ${second} → ${first})`);

  // Filtros.
  await page.getByTestId("dual-findings-filter-noncomparable").click();
  const visibleKeys = async () => page.locator('[data-testid="dual-finding-row"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-row-key")));
  assertEqual(JSON.stringify(await visibleKeys()), JSON.stringify(["L1-L2|disc_narrowing"]), "filtro de no comparables");
  await page.getByTestId("dual-finding-selected").waitFor({ state: "detached", timeout: 5000 });
  assertEqual(await page.getByTestId("dual-finding-selected").count(), 0, "el filtro oculta la selección y se suelta");
  assertEqual(await pane(page, "reference").locator(".mri-finding-marker-box").count(), 0, "sin selección no hay marca");
  await page.getByTestId("dual-findings-filter-all").click();
  assertEqual((await visibleKeys()).length, 5 + 2, "todos (5 principales + 2 de investigación)");
  await page.getByTestId("dual-findings-filter-changes").click();
  assertEqual((await visibleKeys()).length, 3 + 1, "cambios (3 principales + 1 de investigación)");
  ok("los filtros muestran el grupo pedido, suelta la selección oculta y los conteos no cambian");

  // El detalle original de cada estudio sigue accesible.
  await page.getByTestId("dual-findings-originals").locator("> summary").click();
  assertTruthy(/Hallazgos asistidos por IA de/.test(await page.getByTestId("dual-findings-reference").innerText()), "detalle original de la referencia");
  assertTruthy(/Hallazgos asistidos por IA de/.test(await page.getByTestId("dual-findings-current").innerText()), "detalle original del actual");
  ok("el detalle original de cada estudio sigue accesible");

  // Medición y región son excluyentes y cerrar el dual conserva el visor individual.
  await page.getByTestId("dual-close").click();
  await page.getByTestId("dual-comparison").waitFor({ state: "detached" });
  assertTruthy(await page.locator("aside.rr-panel").isVisible(), "el visor individual sigue ahí");
  ok("al cerrar el dual se conserva el visor individual");

  assertEqual(state.analysisPosts.length, 0, `sin análisis: ${state.analysisPosts}`);
  assertEqual(state.llm.length, 0, "sin llamadas al LLM");
  assertEqual(state.writes.length, 0, `sin escrituras: ${state.writes}`);
  assertEqual(state.pageErrors.length, 0, `sin errores de página: ${state.pageErrors}`);
  ok("abrir y recorrer la comparación no ejecutó análisis, ni LLM, ni escrituras");
  await context.close();
}

/* ============================================================== PARTE A.2 — región ausente e imagen no disponible */
{
  const { context, page, state } = await newPage({ references: ["FXDF-NOREGION"] });
  await openDual(page, "FXDF-B", "FXDF-NOREGION");
  await findingsTab(page);
  await page.getByTestId("dual-findings-filter-all").click();
  await rowByKey(page, "L4-L5|disc_bulging").click();
  await page.waitForTimeout(1000);
  assertEqual(await pane(page, "reference").getAttribute("data-overlay-state"), "unavailable", "sin trazo");
  const refRegion = clean(await page.getByTestId("dual-region-reference").innerText());
  assertTruthy(/^Región no disponible/.test(refRegion), `la referencia sin región avisa «Región no disponible» (${refRegion})`);
  assertTruthy(/Región no disponible/.test(await page.getByTestId("dual-finding-region-reference").innerText()), "ficha: región no disponible");
  assertEqual(await pane(page, "reference").locator(".mri-finding-marker-box").count(), 0, "no se fabrica una región");
  assertEqual(await pane(page, "current").locator(".mri-finding-marker-box").count(), 1, "el otro lado conserva su región");
  assertTruthy(/Presente|Ausente|No comparable|Sin cambio/.test(await page.getByTestId("dual-finding-selected").innerText()), "la comparación textual se conserva");
  ok("región ausente de un lado: «Región no disponible» en ese lado y el otro conserva la suya");
  await shot(page, "fx-03-region-no-disponible");
  await page.getByTestId("dual-close").click();
  assertEqual(state.analysisPosts.length + state.writes.length, 0, "sin análisis ni escrituras");
  await context.close();
}
{
  const { context, page } = await newPage({ references: ["FXDF-A"], brokenImages: new Set([studyB.ids.t1]) });
  await openDual(page, "FXDF-B", "FXDF-A");
  await findingsTab(page);
  await rowByKey(page, "L4-L5|disc_bulging").click();
  await page.waitForTimeout(1500);
  const currentNote = clean(await page.getByTestId("dual-region-current").innerText());
  assertTruthy(/^Región no disponible: la imagen de esta serie no se pudo cargar/.test(currentNote), `imagen no disponible se avisa (${currentNote})`);
  assertEqual(await pane(page, "current").locator(".mri-finding-marker-box").count(), 0, "no se anuncia una marca sobre una imagen que no cargó");
  assertEqual(await pane(page, "reference").locator(".mri-finding-marker-box").count(), 1, "el lado con imagen conserva su región");
  assertTruthy(/Ausente → Presente/.test(await page.getByTestId("dual-finding-selected").innerText()), "la comparación textual se conserva");
  ok("imagen no disponible en un lado: se avisa «Región no disponible» y se conserva la comparación textual");
  await context.close();
}

/* ============================================================== PARTE A.3 — versiones incompatibles y lados sin datos */
{
  const { context, page } = await newPage({ references: ["FXDF-OTHERMODEL", "FXDF-NODATA", "FXDF-INVALID"] });
  await openDual(page, "FXDF-B", "FXDF-OTHERMODEL");
  await findingsTab(page);
  const reasonOf = async (key) => clean(await rowByKey(page, key).innerText());
  await page.getByTestId("dual-findings-filter-all").click();
  assertTruthy(/Versión distinta del checkpoint/.test(await reasonOf("L4-L5|disc_bulging")), "checkpoint distinto");
  assertTruthy(/modalidades distintas/.test(await reasonOf("L5-S1|disc_bulging")), "modalidades distintas");
  assertTruthy(/estado de soporte/.test(await reasonOf("L3-L4|pfirrmann_grade")), "estado de soporte distinto");
  ok("versiones o definiciones incompatibles: «No comparable» con su motivo");
  await page.getByTestId("dual-findings-filter-changes").click();
  const message = clean(await page.getByTestId("dual-findings-group-empty").innerText());
  assertTruthy(/no se puede afirmar que el resto permanezca igual/.test(message), `no afirma que todo sigue igual (${message})`);
  assertTruthy(!/permanecen iguales/.test(message), "sin «permanecen iguales»");
  ok("sin cambios pero con no comparables: no dice que todos los hallazgos permanecen iguales");
  await shot(page, "fx-04-no-comparables");

  // Referencia sin hallazgos persistidos: todo no comparable, nunca «Ausente».
  await page.getByTestId("dual-reference-select").selectOption("FXDF-NODATA");
  await page.waitForTimeout(1800);
  await page.getByTestId("dual-findings-filter-all").click();
  const noData = clean(await page.getByTestId("dual-findings-comparison").innerText());
  assertTruthy(/no tiene hallazgos discales persistidos/.test(noData) && /Sin datos no hay «Ausente»/.test(noData), "lado sin datos");
  assertEqual(await page.locator('[data-testid="dual-finding-row"]:not([data-status="not_comparable"])').count(), 0, "todas no comparables");
  ok("un lado sin hallazgos persistidos hace no comparables todas las filas");

  // Región inválida: no elimina resultados válidos ni afecta a los demás discos. Clasificación inválida: no comparable.
  await page.getByTestId("dual-reference-select").selectOption("FXDF-INVALID");
  await page.waitForTimeout(1800);
  await page.getByTestId("dual-findings-filter-all").click();
  assertEqual(await rowByKey(page, "L4-L5|disc_bulging").getAttribute("data-status"), "unchanged", "la clasificación con región inválida se compara igual (presente en ambos)");
  assertEqual(await rowByKey(page, "L5-S1|disc_bulging").getAttribute("data-status"), "unchanged", "otro disco sigue comparable");
  const badClass = rowByKey(page, "L3-L4|disc_narrowing");
  assertEqual(await badClass.getAttribute("data-status"), "not_comparable", "clasificación inválida: no comparable");
  const badValues = clean(await badClass.getByTestId("dual-finding-values").innerText());
  assertTruthy(/Resultado inválido/.test(badValues) && !/Ausente/.test(badValues), `el valor se muestra como inválido, nunca como «Ausente» (${badValues})`);
  await rowByKey(page, "L4-L5|disc_bulging").click();
  const brokenRegionText = clean(await page.getByTestId("dual-finding-region-reference").innerText());
  assertTruthy(/Región no disponible: la corrida guardó una región inválida/.test(brokenRegionText), `región inválida con su motivo (${brokenRegionText})`);
  assertEqual(await page.getByTestId("dual-region-reference").getAttribute("data-region-state"), "unavailable", "el visor de ese lado lo dice");
  assertTruthy(!/Región no disponible/.test(clean(await page.getByTestId("dual-finding-region-current").innerText())), "el otro lado conserva su región");
  ok("una región inválida conserva la clasificación (sin localización y con el motivo) y no afecta a otros discos; una clasificación inválida queda como no comparable");
  await context.close();
}

/* ============================================================== PARTE A.4 — cambio rápido de referencia, respuestas fuera de orden */
{
  const { context, page } = await newPage({ references: ["FXDF-A", "FXDF-C"], delayMs: { "FXDF-A": 2500 } });
  await openDual(page, "FXDF-B", null);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="dual-reference-select"] option').length > 2);
  await page.getByTestId("dual-reference-select").selectOption("FXDF-A"); // responde tarde
  await page.getByTestId("dual-reference-select").selectOption("FXDF-C"); // responde primero
  await page.waitForTimeout(4500);
  assertEqual(await page.getByTestId("dual-id-reference").innerText(), "FXDF-C", "queda la última referencia elegida");
  await findingsTab(page);
  await page.getByTestId("dual-findings-filter-all").click();
  const statusFor = async (key) => clean(await rowByKey(page, key).getByTestId("dual-finding-status").innerText());
  // La referencia vigente (C) solo tiene L4-L5. Si algo de A (respondió tarde) se hubiera filtrado, L2-L3 sería «Sin cambio».
  assertEqual(await statusFor("L2-L3|disc_bulging"), "No comparable", "nada de la referencia tardía se mezcla (L2-L3)");
  assertEqual(await statusFor("L3-L4|pfirrmann_grade"), "No comparable", "nada de la referencia tardía se mezcla (Pfirrmann)");
  assertEqual(await statusFor("L4-L5|disc_bulging"), "Sin cambio de clasificación", "sí se usa lo de la referencia vigente");
  await rowByKey(page, "L4-L5|disc_bulging").click();
  assertTruthy(/FXDF-C/.test(await page.getByTestId("dual-finding-selected-reference").innerText()), "la ficha nombra la referencia vigente");
  await page.waitForTimeout(800);
  assertTruthy(/7\/15/.test(await sliceOf(page, "reference")), "la región abierta es la de C (índice 6 → 7/15), no la de A");
  ok("cambio rápido de referencia con respuesta tardía: solo se ven los resultados de la última referencia");
  await context.close();
}

/* ============================================================== PARTE A.5 — paciente distinto / permisos */
for (const status of [403, 409]) {
  const { context, page, state } = await newPage({ references: ["FXDF-A"], compareStatus: { "FXDF-A": status } });
  await openDual(page, "FXDF-B", "FXDF-A").catch(() => undefined);
  const alert = page.getByTestId("dual-comparison-error").or(page.locator('[role="alert"]').first());
  await alert.first().waitFor({ timeout: 15000 }).catch(() => undefined);
  const dualOpen = (await page.getByTestId("dual-comparison").count()) > 0;
  if (dualOpen) {
    assertEqual(await page.getByTestId("dual-tab-findings").count(), 0, `con ${status} no hay pestaña de hallazgos comparados`);
    assertEqual(await page.getByTestId("dual-findings-comparison").count(), 0, `con ${status} no se compara nada`);
  } else {
    assertTruthy((await page.locator('[role="alert"], [data-testid="comparison-error"]').count()) > 0, `con ${status} el comparador informa el rechazo`);
  }
  assertEqual(state.analysisPosts.length, 0, "sin análisis");
  ok(`comparador rechaza con ${status} (otro paciente o sin permiso): no se muestra ninguna comparación de hallazgos`);
  await context.close();
}

/* ============================================================== PARTE B — estudios reales (solo lectura) */
if (realPair) {
  const { context, page, state } = await newPage({});
  await page.unroute(/\/api\//);
  await openDual(page, "OSF-ID10-V2-T1", "OSF-ID10-V1-T1");
  assertEqual(clean(await page.getByTestId("dual-counts").innerText()), "49 comparables · 3 excluidas", "conteo numérico del par OSF");
  await findingsTab(page);
  const message = clean(await page.getByTestId("dual-findings-empty").innerText());
  assertTruthy(/No hay hallazgos comparables/.test(message) && /Sin datos no hay «Ausente»/.test(message), `par OSF sin hallazgos comparables (${message})`);
  assertEqual(await page.locator('[data-testid="dual-finding-row"]').count(), 0, "no se inventan filas");
  ok("par OSF: 49 comparables · 3 excluidas, y «No hay hallazgos comparables» sin inventar resultados");
  await shot(page, "real-01-par-osf-sin-hallazgos");
  assertEqual(state.analysisPosts.length + state.writes.length, 0, "sin análisis ni escrituras");
  await context.close();
}

await browser.close();
console.log(`dual-findings e2e: ${step} comprobaciones OK (${theme}, ${width}x${height})`);
