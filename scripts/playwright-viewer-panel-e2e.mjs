import fs from "node:fs";
import { chromium } from "playwright";

/**
 * Panel derecho del visor (etapa 1) contra el stack local real, con datos sintéticos.
 *
 *   node scripts/playwright-viewer-panel-e2e.mjs
 *
 * Variables: VIEWER_URL (8288), SIZE (1366x768), THEME (light|dark), READONLY_CASE (CMP-SYN-B),
 * RUN_ISOLATED=1 para crear y usar un caso de prueba propio (PANEL-E2E-<n>) con STUDY_ZIP,
 * SHOTS_DIR para guardar capturas.
 *
 * Parte A (solo lectura, estudio existente): estructura, selección de nivel sin mover el corte,
 * hallazgos expandidos, "Ver en el corte", motivos de bloqueo, acceso al análisis de demostración,
 * conservación de estado al cambiar de pestaña o de ancho y ausencia de POST de análisis.
 * Parte B (caso aislado): contexto con datos y guardado de borrador y de una corrección.
 */

const viewerUrl = process.env.VIEWER_URL ?? "http://localhost:8288";
const [width, height] = (process.env.SIZE ?? "1366x768").split("x").map(Number);
const theme = process.env.THEME ?? "light";
const readonlyCase = process.env.READONLY_CASE ?? "CMP-SYN-B";
const runIsolated = process.env.RUN_ISOLATED === "1";
const studyZip = process.env.STUDY_ZIP ?? "C:/Users/franc/Desktop/tesis/caso-2001-estudio.zip";
const shotsDir = process.env.SHOTS_DIR;
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript((value) => { try { localStorage.setItem("pfi.theme", value); } catch { /* sin almacenamiento */ } }, theme);
const page = await context.newPage();

const mutations = [];
const imageRequests = [];
page.on("request", (request) => {
  const url = request.url();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(`${request.method()} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  if (/\/slices\/|\/assets\//.test(url) && request.method() === "GET") imageRequests.push(url);
});
page.on("pageerror", (error) => { throw new Error(`error de página: ${error.message}`); });

async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${theme}-${width}-${name}.png` });
}

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

const sliceReadout = async () => (await page.locator(".rr-slice-index").first().innerText()).trim();
const analysisPosts = () => mutations.filter((item) => /product-analysis|multiplanar\/run|series-segmentation|disc-degenerative/.test(item));
const nonLoginMutations = () => mutations.filter((item) => !/\/api\/auth\//.test(item));

async function checkLayout(label) {
  const metrics = await page.evaluate(() => {
    const body = document.querySelector(".rr-panel-body");
    const aside = document.querySelector("aside.rr-panel");
    const scrollers = Array.from(aside.querySelectorAll("*")).filter((el) => {
      const style = getComputedStyle(el);
      return el !== body && (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    });
    return {
      horizontal: body.scrollWidth > body.clientWidth + 1,
      nestedScrollers: scrollers.map((el) => el.className),
      panelWidth: Math.round(aside.getBoundingClientRect().width),
    };
  });
  assertTruthy(!metrics.horizontal, `${label}: sin desborde horizontal`);
  assertTruthy(metrics.nestedScrollers.length === 0, `${label}: un único scroll, hay otros: ${metrics.nestedScrollers.join(",")}`);
  return metrics;
}

await login();
await shot("00-lista");
await openStudy(readonlyCase);
await shot("01-visor-completo");

/* ============================ A. estudio existente, solo lectura ============================ */

// A1. tres pestañas, dos vistas de Resultados
const tabNames = await page.locator('aside.rr-panel [role="tablist"][aria-label="Secciones del inspector"] [role="tab"]').allInnerTexts();
assertTruthy(JSON.stringify(tabNames) === JSON.stringify(["Resultados", "Revisión", "Contexto"]), `pestañas: ${tabNames}`);
const subNames = await page.locator('[aria-label="Vistas de resultados"] [role="tab"]').allInnerTexts();
assertTruthy(JSON.stringify(subNames) === JSON.stringify(["Mediciones", "Hallazgos IA"]), `vistas: ${subNames}`);
const initialMetrics = await checkLayout("inicio");
const expectedDefault = width >= 1800 ? 480 : 383;
assertTruthy(Math.abs(initialMetrics.panelWidth - expectedDefault) <= 2, `ancho inicial ${initialMetrics.panelWidth} ≠ ${expectedDefault}`);
ok(`tres pestañas, dos vistas, ancho inicial ${initialMetrics.panelWidth}px y un solo scroll sin desborde`);

// A2. conteos con texto y nivel seleccionado evidente; el corte no se mueve
const sliceBefore = await sliceReadout();
const levelButtons = await page.locator(".rr-level").evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
assertTruthy(levelButtons.some((text) => /L4-L5\s*5 mediciones/.test(text)), `conteo textual: ${levelButtons.join(" | ")}`);
assertTruthy(levelButtons.some((text) => /Medición general\s*1 medición$/.test(text)), "singular: 1 medición");
assertTruthy((await page.getByTestId("selected-level").getAttribute("data-selected")) === "false", "sin nivel seleccionado al inicio");
await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
await page.waitForTimeout(500);
const selected = page.getByTestId("selected-level");
assertTruthy((await selected.getAttribute("data-selected")) === "true", "nivel seleccionado evidente");
assertTruthy(/Nivel seleccionado:\s*L4-L5\s*·\s*5 mediciones/.test(await selected.innerText()), "texto del nivel seleccionado");
assertTruthy((await page.locator(".rr-level.is-active").count()) === 1 && (await page.locator(".rr-level.is-active").getAttribute("aria-pressed")) === "true", "el botón del nivel queda marcado");
assertTruthy((await sliceReadout()) === sliceBefore, `seleccionar un nivel no mueve el corte (${sliceBefore} → ${await sliceReadout()})`);
ok(`el nivel L4-L5 queda a la vista (${levelButtons.length} niveles con conteo textual) y el corte sigue en ${sliceBefore}`);

// A3. cada medición separa nombre, valor IA, unidad y corrección profesional
const rows = page.locator(".rr-measure");
const rowCount = await rows.count();
assertTruthy(rowCount >= 3, `filas de medición: ${rowCount}`);
for (let i = 0; i < rowCount; i += 1) {
  const row = rows.nth(i);
  assertTruthy((await row.locator(".rr-measure-label").innerText()).trim().length > 0, "nombre de la medición");
  assertTruthy(/Valor IA|Medición propia/.test(await row.locator(".rr-measure-cell-label").first().innerText()), "celda del valor IA");
  const aiText = (await row.locator(".rr-measure-ai").innerText()).trim();
  assertTruthy(/^\d[\d.,]*\s*\S+$|Sin valor/.test(aiText), `valor y unidad juntos: "${aiText}"`);
  assertTruthy((await row.locator(".rr-measure-input").count()) === 1 && /Corrección profesional/.test(await row.innerText()), "campo de corrección profesional");
}
await shot("02-mediciones-L4L5");
ok(`${rowCount} mediciones del nivel con nombre, valor IA con unidad y campo de corrección profesional`);

// A4. Hallazgos IA: Pfirrmann separado, alcance de las clasificaciones, "Ver en el corte"
await page.getByRole("tab", { name: "Hallazgos IA" }).click();
await page.waitForTimeout(400);
assertTruthy(await page.getByRole("list", { name: "Limitaciones de estos resultados" }).isVisible(), "las limitaciones están a la vista");
assertTruthy((await page.getByRole("button", { name: /Analizar estudio|Reanalizar/ }).count()) === 0, "Hallazgos IA no ofrece analizar");
assertTruthy(!/Sin hallazgos/.test(await page.locator("#rr-results-findings").innerText()), "ningún 'Sin hallazgos' a secas");
const summaries = await page.locator("summary.rr-disc-level-summary").evaluateAll((els) => els.map((el) => el.innerText.replace(/\s+/g, " ").trim()));
assertTruthy(summaries.every((text) => /clasificaci|Sin clasificaciones/.test(text) && /Pfirrmann/.test(text)), `resúmenes con alcance y Pfirrmann: ${summaries.join(" | ")}`);
await page.locator("summary.rr-disc-level-summary", { hasText: "L4-L5" }).first().click();
const expanded = page.locator("details.rr-disc-level[open]");
assertTruthy((await expanded.locator('[data-block="pfirrmann"]').count()) === 1, "bloque Pfirrmann aparte");
assertTruthy((await expanded.locator('[data-block="other"]').count()) === 1, "bloque de otras clasificaciones aparte");
assertTruthy((await expanded.locator('[data-block="pfirrmann"]').innerText()).includes("Pfirrmann") && !/Abombamiento/.test(await expanded.locator('[data-block="pfirrmann"]').innerText()), "Pfirrmann no se mezcla con las demás");
assertTruthy(/Que figuren como ausentes no descarta otras alteraciones/.test(await expanded.getByTestId("disc-scope-note").innerText()), "nota de alcance");
await shot("03-hallazgos-expandido");
const goToRegion = expanded.getByRole("button", { name: /Ver en el corte/ });
const sliceBeforeGo = await sliceReadout();
await goToRegion.click();
await page.waitForTimeout(700);
const sliceAfterGo = await sliceReadout();
assertTruthy(sliceAfterGo !== sliceBeforeGo || /Marcado/.test(await expanded.locator(".rr-disc-region button").innerText()), `"Ver en el corte" conserva su efecto (${sliceBeforeGo} → ${sliceAfterGo})`);
ok(`hallazgos expandidos: Pfirrmann separado, alcance explícito y "Ver en el corte" (${sliceBeforeGo} → ${sliceAfterGo})`);

// A5. Revisión: motivos de bloqueo visibles, etiquetas por efecto, aviso de nota
await page.getByRole("tab", { name: "Revisión" }).click();
await page.waitForTimeout(300);
const confirm = page.locator(".rr-review-footer .rr-primary");
assertTruthy(await confirm.isDisabled(), "Confirmar deshabilitado con estado Pendiente");
assertTruthy(/Elegí Observado, Finalizado o Descartado/.test(await page.getByTestId("confirm-reason").innerText()), "el motivo está en pantalla, junto al botón");
assertTruthy(await page.getByRole("button", { name: /Guardar borrador \(queda pendiente\)/ }).isEnabled(), "Guardar borrador disponible");
assertTruthy(/Qué cubre esta revisión/.test(await page.locator("#review-inspector-panel-review").innerText()) && /análisis de demostración/.test(await page.locator("#review-inspector-panel-review").innerText()), "explica qué cubre y qué no");
await page.getByLabel("Estado de revisión").selectOption("observado");
assertTruthy((await confirm.innerText()).trim() === "Marcar como observado" && await confirm.isEnabled(), "etiqueta describe el efecto");
assertTruthy(/al menos 5 caracteres/.test(await page.getByTestId("review-notes-hint").innerText()), "aviso de la nota requerida");
await page.getByLabel("Estado de revisión").selectOption("aceptado");
assertTruthy((await confirm.innerText()).trim() === "Finalizar y aprobar estudio", "etiqueta de finalizar");
await page.getByLabel("Estado de revisión").selectOption("pendiente");
const footerBox = await page.getByTestId("review-footer").boundingBox();
const lastField = await page.locator("#review-inspector-panel-review .rr-pane").boundingBox();
assertTruthy(footerBox && lastField && footerBox.y + footerBox.height <= height + 1, "el pie de la revisión está dentro de la ventana");
await shot("04-revision");
ok("Revisión: Confirmar deshabilitado con el motivo visible, etiquetas por efecto y aviso de nota, sin guardar nada");

// A6. Contexto: accesos y análisis de demostración, sin POST
await page.getByRole("tab", { name: "Contexto" }).click();
await page.getByTestId("study-context").waitFor({ timeout: 15000 });
const contextText = await page.getByTestId("study-context").innerText();
assertTruthy(/Edad al estudio/.test(contextText) && /Antecedentes/.test(contextText), "campos del contexto");
const hasContext = !(await page.getByTestId("study-context-empty").count());
if (!hasContext) assertTruthy((contextText.match(/No informado/g) ?? []).length === 5, "los cinco campos sin informar se rotulan");
await shot("05-contexto");
for (const id of ["section-history", "section-comparison", "section-report", "section-assistant", "section-3d", "section-concordance", "section-feedback", "section-audit", "section-technical", "section-demo-analysis"]) {
  assertTruthy((await page.getByTestId(id).count()) === 1, `acceso presente: ${id}`);
}
const demoSection = page.getByTestId("section-demo-analysis");
assertTruthy((await page.getByTestId("demo-analysis-notice").count()) === 0, "el análisis de demostración no carga hasta que se abre");
await demoSection.locator("summary").click();
await page.getByTestId("demo-analysis-notice").waitFor();
assertTruthy(/No corresponden al análisis real/.test(await page.getByTestId("demo-analysis-notice").innerText()), "explica que no es el análisis real");
assertTruthy((await demoSection.getByRole("button", { name: /Analizar estudio|Reanalizar|Reintentar/ }).count()) === 0, "sin disparador de corridas nuevas");
await page.waitForTimeout(800);
await page.locator(".rr-panel-body").evaluate((el) => { el.scrollTop = el.scrollHeight; });
await shot("06-demostracion");
await page.getByTestId("section-comparison").locator("summary").click();
assertTruthy(/no las mediciones que ves en el visor/.test(await page.getByTestId("comparison-source-note").innerText()), "la comparación declara su fuente");
await page.getByTestId("section-report").locator("summary").click();
await page.getByTestId("report-source-note").waitFor();
assertTruthy(/análisis de demostración registrado/.test(await page.getByTestId("report-source-note").innerText()), "el informe declara su fuente");
await page.getByTestId("section-assistant").locator("summary").click();
assertTruthy(/No recibe las mediciones del visor ni el contexto clínico/.test(await page.getByTestId("assistant-source-note").innerText()), "el asistente declara su fuente y que no recibe contexto");
await page.waitForTimeout(1200);
assertTruthy(analysisPosts().length === 0 && nonLoginMutations().length === 0, `ningún POST al navegar el panel: ${nonLoginMutations().join(", ")}`);
await checkLayout("contexto abierto");
ok("Contexto: accesos a historial, comparación, informe, asistente y herramientas; demostración separada y sin disparador; ningún POST");

// A7. cambiar de pestaña, de vista y de ancho no pierde estado ni recarga imágenes
await page.getByRole("tab", { name: "Revisión" }).click();
const noteText = `nota-de-prueba-${stamp}`;
await page.locator("#review-inspector-panel-review textarea").first().fill(noteText);
await page.getByRole("tab", { name: "Resultados" }).click();
await page.getByRole("tab", { name: "Mediciones" }).click();
const sliceKept = await sliceReadout();
const imagesBeforeResize = imageRequests.length;
const handle = page.getByRole("separator", { name: "Ancho del panel" });
await handle.focus();
const widthBefore = Number(await handle.getAttribute("aria-valuenow"));
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
const widthAfter = Number(await handle.getAttribute("aria-valuenow"));
assertTruthy(widthAfter === widthBefore + 48, `el teclado ensancha el panel (${widthBefore} → ${widthAfter})`);
const measuredWidth = Math.round((await page.locator("aside.rr-panel").boundingBox()).width);
assertTruthy(Math.abs(measuredWidth - widthAfter) <= 1, `el ancho aplicado coincide (${measuredWidth} vs ${widthAfter})`);
await page.keyboard.press("End");
const maxWidth = Number(await handle.getAttribute("aria-valuenow"));
assertTruthy(maxWidth === Number(await handle.getAttribute("aria-valuemax")), "Fin lleva al límite máximo");
assertTruthy(maxWidth <= width * 0.5 + 1, "el máximo deja la mitad de la ventana a la imagen");
await page.keyboard.press("Home");
assertTruthy(Number(await handle.getAttribute("aria-valuenow")) === Number(await handle.getAttribute("aria-valuemin")), "Inicio lleva al mínimo");
for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(500);
assertTruthy((await page.locator(".rr-level.is-active").getAttribute("aria-pressed")) === "true" && /L4-L5/.test(await page.getByTestId("selected-level").innerText()), "el nivel seleccionado se conserva");
assertTruthy((await sliceReadout()) === sliceKept, "el corte se conserva al cambiar de ancho");
assertTruthy(imageRequests.length === imagesBeforeResize, `cambiar el ancho no vuelve a pedir imágenes (${imageRequests.length - imagesBeforeResize} nuevas)`);
await page.getByRole("tab", { name: "Revisión" }).click();
assertTruthy((await page.locator("#review-inspector-panel-review textarea").first().inputValue()) === noteText, "la nota escrita se conserva");
assertTruthy(nonLoginMutations().length === 0, "ningún POST ni PUT por cambiar de pestaña o de ancho");
await checkLayout("ancho cambiado");
await page.keyboard.press("Escape");
ok("cambiar de pestaña, vista y ancho conserva nivel, corte y nota, no recarga imágenes y no envía nada");

/* =============================== B. caso aislado: guardado ================================ */

if (runIsolated) {
  assertTruthy(fs.existsSync(studyZip), `no existe el ZIP sintético ${studyZip}`);
  const caseId = `PANEL-E2E-${stamp}`;
  await page.getByRole("button", { name: "← Estudios" }).click();
  await page.getByRole("button", { name: "Nuevo estudio" }).click();
  await page.getByRole("heading", { name: "Nuevo estudio", level: 1 }).waitFor();
  await page.getByPlaceholder("CASE-XXXX").fill(caseId);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator('.ns-zip input[type="file"]').setInputFiles(studyZip);
  await page.getByText(/series detectadas/).waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "Contexto y revisión", level: 2 }).waitFor();
  await page.getByRole("button", { name: "Declarar edad manualmente" }).click();
  await page.getByPlaceholder("Años").fill("62");
  await page.getByLabel("Motivo del estudio").fill("Lumbalgia de prueba aislada");
  await page.getByLabel("Síntomas").fill("Dolor lumbar sintético");
  await page.getByLabel("Tiempo de evolución").fill("6 semanas");
  await page.getByLabel("Antecedentes relevantes").fill("Sin antecedentes (sintético)");
  await page.getByRole("button", { name: "Analizar estudio", exact: true }).click();
  await page.waitForURL(new RegExp(`/estudio/${caseId}`), { timeout: 900000 });
  await page.locator("aside.rr-panel").waitFor();
  await page.waitForTimeout(3000);
  const postsAfterCreation = mutations.length;

  // contexto con datos
  await page.getByRole("tab", { name: "Contexto" }).click();
  await page.getByTestId("study-context").waitFor({ timeout: 15000 });
  const filled = await page.getByTestId("study-context").innerText();
  assertTruthy(/62 años/.test(filled) && /Declarada al cargar el estudio/.test(filled), `edad con procedencia: ${filled}`);
  assertTruthy(/Lumbalgia de prueba aislada/.test(filled) && /Dolor lumbar sintético/.test(filled) && /6 semanas/.test(filled) && /Sin antecedentes \(sintético\)/.test(filled), "motivo, síntomas, evolución y antecedentes");
  assertTruthy((await page.getByTestId("study-context-empty").count()) === 0 && !/No informado/.test(filled.replace(/Paciente[\s\S]*?\n/, "")), "con contexto completo no se rotula nada como no informado");
  await shot("07-contexto-con-datos");
  assertTruthy(mutations.length === postsAfterCreation, "abrir el contexto no envía nada");
  ok("el contexto del estudio aislado muestra edad con su procedencia, motivo, síntomas, evolución y antecedentes");

  // guardado de borrador y de una corrección
  await page.getByRole("tab", { name: "Resultados" }).click();
  await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const heightRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
  await heightRow.waitFor();
  const original = (await heightRow.locator(".rr-measure-ai").innerText()).trim();
  const originalNumber = Number(original.replace(/[^\d.,]/g, "").replace(",", "."));
  const corrected = (originalNumber + 1.5).toFixed(1);
  await heightRow.locator(".rr-measure-input").fill(corrected);
  assertTruthy(/Corregido de/.test(await heightRow.innerText()) && (await heightRow.locator(".rr-measure-ai").innerText()).trim() === original, "al corregir, el valor original de la IA se conserva a la vista");
  await page.getByRole("tab", { name: "Revisión" }).click();
  await page.locator("#review-inspector-panel-review textarea").first().fill("Borrador de prueba aislada");
  const before = mutations.length;
  await page.getByRole("button", { name: /Guardar borrador \(queda pendiente\)/ }).click();
  await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20000 });
  const saved = mutations.slice(before);
  assertTruthy(saved.some((item) => /PUT .*\/api\/ai\/runs\/.+\/review/.test(item)), `guardó la revisión: ${saved.join(", ")}`);
  assertTruthy(saved.every((item) => !/product-analysis|multiplanar\/run/.test(item)), "el guardado no dispara análisis");
  ok(`borrador y corrección (${original} → ${corrected}) guardados en el caso aislado ${caseId}`);

  // se recupera del backend: volver a la lista y reabrir
  await page.getByRole("button", { name: "← Estudios" }).click();
  await openStudy(caseId);
  await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const reopenedRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
  assertTruthy((await reopenedRow.locator(".rr-measure-input").inputValue()) === corrected, "la corrección persiste al reabrir");
  assertTruthy((await reopenedRow.locator(".rr-measure-ai").innerText()).trim() === original, "el original de la IA sigue visible tras reabrir");
  await page.getByRole("tab", { name: "Revisión" }).click();
  assertTruthy((await page.locator("#review-inspector-panel-review textarea").first().inputValue()) === "Borrador de prueba aislada", "las notas persisten");
  ok("corrección y notas se recuperan del backend al reabrir el estudio");

  // validación existente: observar sin nota no guarda
  await page.getByLabel("Estado de revisión").selectOption("observado");
  await page.locator("#review-inspector-panel-review textarea").first().fill("");
  const beforeInvalid = mutations.length;
  await page.getByRole("button", { name: "Marcar como observado" }).click();
  await page.waitForTimeout(800);
  assertTruthy(mutations.length === beforeInvalid, "observar sin nota sigue sin guardar (la validación existente se conserva)");
  ok("la validación de nota para Observado se conserva: no se envió nada");
  console.log(`CASO AISLADO: ${caseId}`);
}

console.log(`Viewer panel e2e (${width}x${height}, ${theme}) passed: ${step}`);
await browser.close();
