import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

/**
 * Comparación entre estudios sobre el análisis inicial REAL, contra el stack local (8288/8280).
 *
 *   node scripts/playwright-initial-comparison-e2e.mjs
 *
 * Variables: VIEWER_URL, SIZE (1366x768), THEME (light|dark), CURRENT_CASE (CMP-SYN-B), REFERENCE_CASE
 * (CMP-SYN-A), SINGLE_CASE (SYN-A-058332: paciente con un solo estudio), SHOTS_DIR, DB_CHECK=0 para omitir el
 * contraste contra la base, RUN_ISOLATED=1 para crear un caso aislado (CMPISO-<n>) del mismo paciente y
 * guardar una corrección profesional (no se toca ningún estudio existente).
 *
 * Parte A (solo lectura): candidatos del mismo paciente, valores y cálculos contrastados con lo persistido,
 * respuesta tardía descartada, estado del visor conservado, sin POST. Los estados vacíos que el stack real no
 * produce se simulan SOLO en el navegador (page.route), sin escribir nada.
 * Parte B (caso aislado): corrección persistida en el estudio abierto y en la referencia.
 *
 * CMP-SYN-A y CMP-SYN-B salen del MISMO archivo: sus diferencias reales son cero. Eso prueba el funcionamiento
 * técnico de la comparación, no evolución clínica; las diferencias distintas de cero salen del caso aislado,
 * donde la única diferencia es una corrección profesional guardada.
 */

const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const currentCase = process.env.CURRENT_CASE ?? "CMP-SYN-B";
const referenceCase = process.env.REFERENCE_CASE ?? "CMP-SYN-A";
const singleCase = process.env.SINGLE_CASE ?? "SYN-A-058332";
const shotsDir = process.env.SHOTS_DIR;
const dbCheck = process.env.DB_CHECK !== "0";
const runIsolated = process.env.RUN_ISOLATED === "1";
const studyZip = process.env.STUDY_ZIP ?? "C:/Users/franc/Desktop/tesis/caso-2001-estudio.zip";
const stamp = Date.now().toString().slice(-7);

if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

function assertTruthy(value, message) {
  if (!value) throw new Error(`E2E assertion failed: ${message}`);
}
let step = 0;
function ok(message) {
  step += 1;
  console.log(`ok ${step} - ${message}`);
}

function sql(query) {
  return execFileSync("docker", ["exec", "lumbarai-clean-postgres", "psql", "-U", "pfi", "pfi_backend", "-tAc", query], { encoding: "utf8" }).trim();
}

/** Valor persistido de una medición del análisis inicial más reciente de un estudio (JSONB). */
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
    `select c.after_value->>'value' from domain_review_corrections c join domain_study_runs r on r.id=c.study_run_id join domain_studies s on s.id=r.study_id ` +
    `where s.case_id='${caseId}' and c.measurement_id='${measurementId}' order by c.created_at desc limit 1`,
  );
  return text === "" ? null : Number(text);
}

function latestRunId(caseId) {
  return sql(`select r.multiplanar_run_id from domain_study_runs r join domain_studies s on s.id=r.study_id where s.case_id='${caseId}' order by r.created_at desc, r.updated_at desc limit 1`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
const page = await context.newPage();

const mutations = [];
const imageRequests = [];
const comparisonRequests = [];
context.on("request", (request) => {
  const url = request.url();
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(`${request.method()} ${path}`);
  if (/\/slices\/|\/assets\//.test(url) && request.method() === "GET") imageRequests.push(url);
  if (/initial-analysis-comparison/.test(url) && request.method() === "GET") comparisonRequests.push(url);
});
page.on("pageerror", (error) => { throw new Error(`error de página: ${error.message}`); });

async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` });
}

const nonLoginMutations = () => mutations.filter((item) => !/\/api\/auth\//.test(item));
const sliceReadout = async () => (await page.locator(".rr-slice-index").first().innerText()).trim();

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

async function openComparison() {
  const open = page.getByTestId("tools-open");
  if ((await open.getAttribute("aria-pressed")) !== "true") await open.click();
  else if (await page.locator(".rr-tool-view:visible").count()) await page.locator(".rr-tool-view:visible .rr-tool-back").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("initial-comparison").waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-testid=initial-comparison]")?.textContent?.includes("Buscando otros estudios"));
}

async function backToStudies() {
  await page.getByRole("button", { name: "← Estudios" }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

/** Lee la tabla de la pantalla como filas {level, metric, ref, cur, delta, percent}. */
async function tableRows() {
  return page.locator(".rr-cmp-table").evaluateAll((tables) => tables.flatMap((table) => {
    const level = table.getAttribute("data-level");
    return Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent.replace(/\s+/g, " ").trim());
      return { level, metric: tr.querySelector("th").textContent.replace(/\s+/g, " ").trim(), ref: cells[0], cur: cells[1], delta: cells[2], percent: cells[3] };
    });
  }));
}

await login();
await openStudy(currentCase);
const viewerRunId = dbCheck ? latestRunId(currentCase) : null;

/* ====================== A. estudios existentes, solo lectura ====================== */

// A1. candidatos del mismo paciente, estudio abierto con ID, fecha y análisis
await openComparison();
const source = await page.getByTestId("comparison-source-note").innerText();
assertTruthy(/análisis inicial real/.test(source) && /No usa el análisis de demostración/.test(source), "declara la fuente real");
const currentText = await page.getByTestId("current-side").innerText();
assertTruthy(currentText.includes(currentCase) && /\d{2}\/\d{2}\/\d{4}/.test(currentText) && /análisis .* del \d{2}\/\d{2}\/\d{4}/.test(currentText), `estudio abierto con ID, fecha y análisis: ${currentText}`);
const options = await page.locator("#rr-cmp-reference option").allInnerTexts();
assertTruthy(options.some((text) => text.startsWith(`${referenceCase} ·`)), `ofrece ${referenceCase}: ${options}`);
assertTruthy(options.every((text) => !/SYN-A-058332|SYN-A-015977|caso-x|EXIT-REAL|UI-Demo|PANEL-E2E|Caso-/.test(text)), `solo estudios del mismo paciente: ${options}`);
assertTruthy(options.every((text, index) => index === 0 || /\d+ mediciones$/.test(text)), "cada candidato muestra cuántas mediciones utilizables tiene");
const firstRequest = comparisonRequests.find((url) => /candidates/.test(url));
assertTruthy(firstRequest && new URL(firstRequest).searchParams.get("currentRunId") === (viewerRunId ?? new URL(firstRequest).searchParams.get("currentRunId")), "pide la corrida que muestra el visor");
if (dbCheck) assertTruthy(new URL(firstRequest).searchParams.get("currentRunId") === viewerRunId, `currentRunId = corrida más reciente en la base (${viewerRunId})`);
await shot("01-candidatos");
ok(`candidatos del mismo paciente (${options.length - 1}), con mediciones utilizables, y estudio abierto identificado${dbCheck ? `; el visor envía su corrida ${viewerRunId}` : ""}`);

// A2. elegir referencia: valores, unidades y cálculos
const requestsBefore = comparisonRequests.length;
await page.locator("#rr-cmp-reference").selectOption(referenceCase);
await page.getByTestId("comparison-summary").waitFor();
assertTruthy(comparisonRequests.length === requestsBefore + 1 && new URL(comparisonRequests.at(-1)).searchParams.get("referenceCaseId") === referenceCase, "un solo pedido de comparación");
const refLabel = await page.getByTestId("reference-label").innerText();
const refAnalysis = await page.getByTestId("reference-analysis").innerText();
assertTruthy(refLabel.includes(referenceCase) && /\d{2}\/\d{2}\/\d{4}/.test(refLabel), "referencia con ID y fecha");
assertTruthy(/análisis .* del \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(refAnalysis), `referencia con identificador y fecha del análisis: ${refAnalysis}`);
const summary = await page.getByTestId("comparison-summary").innerText();
const compared = Number((/(\d+) mediciones comparadas/.exec(summary) ?? [])[1]);
const excludedCount = Number((/(\d+) excluidas/.exec(summary) ?? [])[1]);
assertTruthy(compared > 0 && excludedCount >= 0, `conteos visibles: ${summary}`);
const rows = await tableRows();
assertTruthy(rows.length === compared, `la tabla tiene ${rows.length} filas y el resumen dice ${compared}`);
assertTruthy(new Set(rows.map((r) => r.level)).size === (await page.locator(".rr-cmp-table").count()), "tablas agrupadas por nivel");
assertTruthy(rows.every((r) => /\((mm|mm²|°)\)/.test(r.metric)), "cada métrica muestra su unidad");
assertTruthy(await page.getByTestId("difference-note").isVisible() && /estudio abierto − referencia/.test(await page.getByTestId("difference-note").innerText()), "definición de la diferencia visible");
await shot("02-resultado");

// A3. contraste de una muestra de filas con lo persistido y verificación del cálculo
if (dbCheck) {
  const sample = [
    ["L4-L5", "Altura discal", "sagittal-disc-l4-l5-height"],
    ["L4-L5", "Ancho discal", "sagittal-disc-l4-l5-width"],
    ["L4-L5", "Área discal", "sagittal-disc-l4-l5-area"],
    ["L4-L5", "Diámetro AP del canal", "sagittal-canal-ap-l4-l5"],
    ["T11-T12", "Altura discal", "sagittal-disc-t11-t12-height"],
  ];
  for (const [level, metricName, measurementId] of sample) {
    const reference = persistedValue(referenceCase, measurementId);
    const current = persistedValue(currentCase, measurementId);
    assertTruthy(reference !== null && current !== null, `valores persistidos de ${measurementId}`);
    const row = rows.find((r) => r.level === level && r.metric.startsWith(metricName));
    assertTruthy(row, `fila ${level} ${metricName}`);
    const correctedReference = persistedCorrection(referenceCase, measurementId);
    const correctedCurrent = persistedCorrection(currentCase, measurementId);
    const expectedReference = correctedReference ?? reference;
    const expectedCurrent = correctedCurrent ?? current;
    assertTruthy(row.ref.startsWith(expectedReference.toFixed(2)) && row.cur.startsWith(expectedCurrent.toFixed(2)), `${level} ${metricName}: pantalla ${row.ref} / ${row.cur}, persistido ${expectedReference} / ${expectedCurrent}`);
    const delta = Math.round((expectedCurrent - expectedReference) * 1e8) / 1e8;
    const expectedDelta = delta === 0 ? "0.00" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;
    assertTruthy(row.delta.startsWith(expectedDelta), `${level} ${metricName}: diferencia en pantalla "${row.delta}", esperada ${expectedDelta}`);
  }
  ok(`${sample.length} filas contrastadas con los valores persistidos y su diferencia (abierto − referencia) recalculada`);
}
const unchanged = rows.filter((r) => /Sin cambio/.test(r.delta)).length;
ok(`${compared} mediciones comparadas, ${excludedCount} excluidas; ${unchanged} sin cambio (ambos estudios salen del mismo archivo: prueba técnica, no evolución clínica)`);

// A4. exclusiones con su motivo
const excludedDetails = page.getByTestId("excluded-details");
assertTruthy(/Mediciones excluidas \(\d+\)/.test(await excludedDetails.locator("summary").innerText()), "detalle de excluidas con su cantidad");
await excludedDetails.locator("summary").click();
const excludedText = await excludedDetails.innerText();
assertTruthy(/Plano axial sin estructura asignada/.test(excludedText) && /raw_\*/.test(excludedText), "motivo de las clases axiales");
assertTruthy(/depende de cuánta columna abarque el encuadre/.test(excludedText), "motivo del área completa del canal");
await excludedDetails.locator("summary").click();
await page.getByTestId("comparison-limitations").locator("summary").click();
assertTruthy(/corrida más reciente/.test(await page.getByTestId("comparison-limitations").innerText()), "regla de selección de corrida documentada en la pantalla");
await page.getByTestId("comparison-limitations").locator("summary").click();
ok("exclusiones agrupadas por motivo y regla de selección de corrida visibles");

// A5. cambiar la referencia no deja ver una respuesta tardía de la selección anterior
const otherReference = options.map((text) => text.split(" · ")[0]).find((id) => id && id !== referenceCase && id !== "Elegir un estudio del paciente…");
if (otherReference) {
  await page.route(`**/initial-analysis-comparison?*referenceCaseId=${otherReference}*`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => {});
  });
  await page.locator("#rr-cmp-reference").selectOption(otherReference);
  await page.waitForTimeout(300);
  await page.locator("#rr-cmp-reference").selectOption(referenceCase);
  await page.getByTestId("comparison-summary").waitFor();
  await page.waitForTimeout(3600);
  assertTruthy((await page.getByTestId("reference-label").innerText()).includes(referenceCase), "tras llegar la respuesta tardía se sigue viendo la referencia elegida al final");
  assertTruthy(!(await page.getByTestId("initial-comparison").innerText()).includes(otherReference + " ·") || (await page.locator("#rr-cmp-reference").inputValue()) === referenceCase, "la respuesta tardía no reemplazó la selección");
  await page.unroute(`**/initial-analysis-comparison?*referenceCaseId=${otherReference}*`);
  ok(`respuesta tardía de ${otherReference} descartada: se mantiene ${referenceCase}`);
}

// A6. entrar y salir de la herramienta conserva el estado del visor y no vuelve a pedir imágenes
await page.locator(".rr-tool-view:visible .rr-tool-back").click();
await page.getByRole("tab", { name: "Resultados" }).click();
if ((await page.getByTestId("level-header").count()) === 0) await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
await page.getByRole("tab", { name: "Revisión" }).click();
const note = `nota-comparacion-${stamp}`;
await page.locator("#review-inspector-panel-review textarea").first().fill(note);
await page.getByRole("tab", { name: "Resultados" }).click();
const sliceKept = await sliceReadout();
const imagesBefore = imageRequests.length;
await openComparison();
assertTruthy((await page.locator("#rr-cmp-reference").inputValue()) === referenceCase, "la referencia elegida se conserva al volver a la herramienta");
await page.getByRole("tab", { name: "Resultados" }).click();
assertTruthy(/L4-L5\s*·/.test(await page.getByTestId("level-header").innerText()), "nivel seleccionado conservado");
assertTruthy((await sliceReadout()) === sliceKept, "corte conservado");
await page.getByRole("tab", { name: "Revisión" }).click();
assertTruthy((await page.locator("#review-inspector-panel-review textarea").first().inputValue()) === note, "nota conservada");
assertTruthy(imageRequests.length === imagesBefore, "no se vuelven a pedir imágenes");
ok("entrar y salir de Comparación conserva nivel, corte, nota y referencia, sin volver a pedir imágenes");

// A7. estados vacíos
await backToStudies();
await openStudy(singleCase);
await openComparison();
const none = await page.getByTestId("comparison-empty").innerText();
assertTruthy(/Este paciente no tiene otros estudios/.test(none), `paciente con un solo estudio: ${none}`);
assertTruthy(await page.locator("#rr-cmp-reference").isDisabled(), "sin otros estudios no se puede elegir referencia");
await shot("03-sin-otros-estudios");

// Estados que el stack real no produce hoy: se simulan solo en el navegador (nada se escribe).
await backToStudies();
await openStudy(currentCase);
const simulated = async (mutate, expectedTitle, label, extra) => {
  await page.route("**/initial-analysis-comparison/candidates*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    mutate(body);
    await route.fulfill({ response, json: body });
  });
  await page.getByTestId("tools-open").click();
  await page.locator('[data-tool-id="comparison"]').click();
  await page.getByTestId("comparison-empty").waitFor();
  assertTruthy(expectedTitle.test(await page.getByTestId("comparison-empty").innerText()), `${label}: ${await page.getByTestId("comparison-empty").innerText()}`);
  if (extra) await extra();
  await shot(label.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  await page.unroute("**/initial-analysis-comparison/candidates*");
  await backToStudies();
  await openStudy(currentCase);
};
await simulated((body) => { body.candidates.forEach((c) => { c.eligible = false; c.usableMeasurementCount = 0; c.reasonCode = "no_usable_measurements"; c.reason = "Su análisis inicial más reciente no tiene mediciones utilizables para comparar."; }); }, /no tienen mediciones utilizables/, "04-sin-candidatos-utilizables-simulado", async () => {
  assertTruthy(/no se ofrecen/.test(await page.getByTestId("ineligible-candidates").innerText()), "lista los estudios no ofrecidos con su motivo");
});
await simulated((body) => { body.current.usableMeasurementCount = 0; }, /Este estudio no tiene mediciones utilizables/, "05-estudio-abierto-sin-mediciones-simulado");

await page.route("**/initial-analysis-comparison?*", async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  body.comparisons = [];
  body.summary.comparedCount = 0;
  await route.fulfill({ response, json: body });
});
await page.getByTestId("tools-open").click();
await page.locator('[data-tool-id="comparison"]').click();
await page.getByTestId("initial-comparison").waitFor();
await page.waitForFunction(() => document.querySelectorAll("#rr-cmp-reference option").length > 1);
await page.locator("#rr-cmp-reference").selectOption(referenceCase);
await page.getByTestId("comparison-empty").waitFor();
assertTruthy(/No hay coincidencias comparables/.test(await page.getByTestId("comparison-empty").innerText()), "sin coincidencias comparables");
assertTruthy((await page.getByTestId("excluded-details").getAttribute("open")) !== null, "con cero coincidencias el detalle de lo excluido se muestra abierto");
await shot("06-sin-coincidencias-simulado");
await page.unroute("**/initial-analysis-comparison?*");
ok("estados vacíos: sin otros estudios (real), y sin candidatos utilizables, estudio abierto sin mediciones y sin coincidencias comparables (simulados en el navegador)");

assertTruthy(nonLoginMutations().length === 0, `ningún POST/PUT al comparar: ${nonLoginMutations().join(", ")}`);
assertTruthy(!mutations.some((item) => /product-analysis|multiplanar\/run|series-segmentation|disc-degenerative/.test(item)), "ningún análisis ejecutado");
ok("la comparación no envía ningún POST ni dispara análisis");

/* =========================== B. caso aislado con corrección persistida =========================== */

if (runIsolated) {
  assertTruthy(fs.existsSync(studyZip), `no existe el ZIP sintético ${studyZip}`);
  const isoCase = `CMPISO-${stamp}`;
  await backToStudies();
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
  await page.getByLabel("Buscar paciente por código o nombre").fill("VIS-006857");
  await page.getByRole("list", { name: "Resultados de pacientes" }).getByRole("button").first().click();
  await page.locator('[aria-label="Paciente seleccionado"]').waitFor();
  await page.getByPlaceholder("CASE-XXXX").fill(isoCase);
  await page.getByLabel(/Fecha del estudio/).fill("2026-10-14");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator('.ns-zip input[type="file"]').setInputFiles(studyZip);
  await page.getByText(/series detectadas/).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).waitFor();
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(new RegExp(`/estudio/${isoCase}`), { timeout: 900000 });
  await page.locator("aside.rr-panel").waitFor();
  await page.waitForTimeout(3000);

  // corrección profesional guardada en el caso aislado (única diferencia respecto de CMP-SYN-A)
  await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const heightRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
  await heightRow.waitFor();
  const originalText = (await heightRow.locator(".rr-measure-ai").innerText()).trim();
  const original = Number(originalText.replace(/[^\d.,]/g, "").replace(",", "."));
  await heightRow.locator(".rr-measure-input").fill("7.3");
  await page.getByRole("tab", { name: "Revisión" }).click();
  const before = mutations.length;
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20000 });
  assertTruthy(mutations.slice(before).every((item) => !/product-analysis|multiplanar\/run/.test(item)), "guardar no dispara análisis");
  if (dbCheck) assertTruthy(persistedCorrection(isoCase, "sagittal-disc-l4-l5-height") === 7.3, "la corrección quedó persistida");

  // estudio abierto = caso aislado, referencia = CMP-SYN-A
  await openComparison();
  await page.locator("#rr-cmp-reference").selectOption(referenceCase);
  await page.getByTestId("comparison-summary").waitFor();
  const isoRows = await tableRows();
  const heightIso = isoRows.find((r) => r.level === "L4-L5" && r.metric.startsWith("Altura discal"));
  const referenceHeight = dbCheck ? persistedValue(referenceCase, "sagittal-disc-l4-l5-height") : original;
  const expectedDelta = Math.round((7.3 - referenceHeight) * 1e8) / 1e8;
  const expectedPercent = (expectedDelta / referenceHeight) * 100;
  assertTruthy(heightIso.ref.startsWith(referenceHeight.toFixed(2)), `referencia ${heightIso.ref}`);
  assertTruthy(heightIso.cur.startsWith("7.30") && /corregido · IA /.test(heightIso.cur) && heightIso.cur.includes(`IA ${original.toFixed(2)}`), `valor corregido con el original a la vista: ${heightIso.cur}`);
  assertTruthy(heightIso.delta.startsWith(`+${expectedDelta.toFixed(2)}`) && /Aumentó/.test(heightIso.delta), `diferencia +${expectedDelta.toFixed(2)}: ${heightIso.delta}`);
  assertTruthy(heightIso.percent === `+${expectedPercent.toFixed(1)} %`, `porcentaje ${heightIso.percent} vs +${expectedPercent.toFixed(1)} %`);
  assertTruthy(isoRows.filter((r) => /Sin cambio/.test(r.delta)).length === isoRows.length - 1, "las demás filas no cambian: es la única diferencia");
  assertTruthy((await page.getByTestId("corrected-value").count()) === 1, "solo el valor corregido se marca");
  await shot("07-comparacion-con-correccion");
  ok(`corrección persistida: altura L4-L5 ${referenceHeight} → 7.30 (IA ${original}) = +${expectedDelta.toFixed(2)} mm (+${expectedPercent.toFixed(1)} %), el resto sin cambio`);

  // y a la inversa: abierto = CMP-SYN-A, referencia = caso aislado (referencia corregida)
  await backToStudies();
  await openStudy(referenceCase);
  await openComparison();
  await page.locator("#rr-cmp-reference").selectOption(isoCase);
  await page.getByTestId("comparison-summary").waitFor();
  const inverse = (await tableRows()).find((r) => r.level === "L4-L5" && r.metric.startsWith("Altura discal"));
  const inversePercent = (-expectedDelta / 7.3) * 100;
  assertTruthy(inverse.ref.startsWith("7.30") && /corregido/.test(inverse.ref), `referencia corregida: ${inverse.ref}`);
  assertTruthy(inverse.delta.startsWith(`−${expectedDelta.toFixed(2)}`) && /Disminuyó/.test(inverse.delta), `diferencia −${expectedDelta.toFixed(2)}: ${inverse.delta}`);
  assertTruthy(inverse.percent === `−${Math.abs(inversePercent).toFixed(1)} %`, `porcentaje inverso ${inverse.percent}`);
  ok(`al invertir los estudios la diferencia cambia de signo y el porcentaje usa la nueva referencia (${inverse.percent})`);
  console.log(`CASO AISLADO: ${isoCase}`);
}

console.log(`Initial comparison e2e (${width}x${height}, ${theme}) passed: ${step}`);
await browser.close();
