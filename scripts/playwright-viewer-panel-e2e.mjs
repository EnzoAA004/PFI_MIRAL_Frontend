import fs from "node:fs";
import { chromium } from "playwright";

/**
 * Panel derecho del visor (etapas 1 y 2) contra el stack local real, con datos sintéticos.
 *
 *   node scripts/playwright-viewer-panel-e2e.mjs
 *
 * Variables: VIEWER_URL (8288), SIZE (1366x768), THEME (light|dark), READONLY_CASE (CMP-SYN-B),
 * RUN_ISOLATED=1 para crear y usar un caso de prueba propio (PANEL-E2E-<n>) con STUDY_ZIP,
 * SHOTS_DIR para guardar capturas.
 *
 * Parte A (solo lectura, estudio existente): estructura, selección y cambio de nivel, hallazgos
 * compactos con "Alcance y limitaciones" cerrado, motivos de bloqueo, anotación sin guardar al navegar,
 * índice de "Herramientas del estudio" (sin consultar nada al abrirlo), conservación de estado al
 * cambiar de pestaña, herramienta o ancho y ausencia de POST de análisis.
 * Parte C (otra página, respuesta del estudio alterada en el navegador y sin persistir nada): un disco
 * con una clasificación faltante y otro sin clasificaciones, para comprobar que los datos faltantes no se
 * cuentan como negativos.
 * Parte B (caso aislado): contexto con datos y guardado de borrador, corrección y anotación.
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
const getRequests = [];
context.on("request", (request) => {
  const url = request.url();
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(`${request.method()} ${path}`);
  if (request.method() === "GET") getRequests.push(path);
  if (/\/slices\/|\/assets\//.test(url) && request.method() === "GET") imageRequests.push(url);
});
page.on("pageerror", (error) => { throw new Error(`error de página: ${error.message}`); });

async function shot(name, target = page) {
  if (shotsDir) await target.screenshot({ path: `${shotsDir}/${theme}-${width}x${height}-${name}.png` });
}

async function login(target = page) {
  await target.goto(`${viewerUrl}/`, { waitUntil: "networkidle" });
  const demo = target.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await target.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}

async function openStudy(caseId, target = page) {
  await target.getByText(caseId, { exact: true }).first().click();
  await target.getByRole("button", { name: "Abrir estudio" }).click();
  await target.locator("aside.rr-panel").waitFor();
  await target.getByRole("tab", { name: "Resultados" }).waitFor();
  await target.waitForTimeout(2500);
}

const sliceReadout = async (target = page) => (await target.locator(".rr-slice-index").first().innerText()).trim();
const analysisPosts = () => mutations.filter((item) => /product-analysis|multiplanar\/run|series-segmentation|disc-degenerative/.test(item));
const nonLoginMutations = () => mutations.filter((item) => !/\/api\/auth\//.test(item));

async function checkLayout(label, target = page) {
  const metrics = await target.evaluate(() => {
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

// A1. tres pestañas sin comprimir, acceso a herramientas en la cabecera
const tabNames = await page.locator('aside.rr-panel [role="tablist"][aria-label="Secciones del inspector"] [role="tab"]').allInnerTexts();
assertTruthy(JSON.stringify(tabNames) === JSON.stringify(["Resultados", "Revisión", "Contexto"]), `pestañas: ${tabNames}`);
const initialMetrics = await checkLayout("inicio");
const tabBoxes = await page.locator('aside.rr-panel [role="tablist"][aria-label="Secciones del inspector"] [role="tab"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
assertTruthy(tabBoxes.every((w) => w >= initialMetrics.panelWidth / 3 - 3), `las tres pestañas conservan su ancho: ${tabBoxes}`);
const toolsButton = page.getByTestId("tools-open");
assertTruthy(await toolsButton.isVisible() && /Herramientas del estudio/.test(await toolsButton.innerText()), "acceso visible a las herramientas");
const expectedDefault = width >= 1800 ? 480 : 383;
assertTruthy(Math.abs(initialMetrics.panelWidth - expectedDefault) <= 2, `ancho inicial ${initialMetrics.panelWidth} ≠ ${expectedDefault}`);
ok(`tres pestañas (${tabBoxes.join("/")} px), acceso a herramientas en la cabecera, ancho inicial ${initialMetrics.panelWidth}px y un solo scroll`);

// A2. Mediciones: selector sin selección, encabezado compacto con el nivel y los valores debajo
const sliceBefore = await sliceReadout();
assertTruthy((await page.locator("#rr-results-measurements").getByText("Seleccioná un nivel para ver sus mediciones.").count()) === 1, "una sola indicación de selección");
assertTruthy((await page.getByTestId("level-header").count()) === 0, "sin nivel no hay encabezado");
const levelButtons = await page.locator(".rr-level").evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
assertTruthy(levelButtons.some((text) => /L4-L5\s*5 mediciones/.test(text)) && levelButtons.some((text) => /Medición general\s*1 medición$/.test(text)), `conteos comprensibles: ${levelButtons.join(" | ")}`);
await shot("02-mediciones-sin-nivel");
await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
await page.waitForTimeout(400);
const header = page.getByTestId("level-header");
assertTruthy(/L4-L5\s*·\s*5 mediciones/.test(await header.innerText()), "encabezado: nivel y cantidad");
assertTruthy((await page.locator(".rr-level").count()) === 0, "la grilla se reemplaza por el encabezado");
assertTruthy((await page.locator("#rr-results-measurements").getByText("Seleccioná un nivel para ver sus mediciones.").count()) === 0, "ya no se repite la indicación");
const firstRowBox = await page.locator(".rr-measure").first().boundingBox();
const headerBox = await header.boundingBox();
assertTruthy(firstRowBox && headerBox && firstRowBox.y - (headerBox.y + headerBox.height) < 60 && firstRowBox.y + firstRowBox.height < height - 60, `los valores se ven de inmediato (primer valor en y=${Math.round(firstRowBox?.y ?? -1)})`);
assertTruthy((await sliceReadout()) === sliceBefore, "elegir un nivel no mueve el corte");
await shot("03-mediciones-nivel-seleccionado");
ok(`selector → encabezado compacto “L4-L5 · 5 mediciones”; el primer valor queda en y=${Math.round(firstRowBox.y)} y el corte sigue en ${sliceBefore}`);

// A3. valor IA, unidad y corrección diferenciados; cambiar de nivel sin perder la corrección ni mover el corte
const rows = page.locator(".rr-measure");
const rowCount = await rows.count();
assertTruthy(rowCount >= 3, `filas: ${rowCount}`);
for (let i = 0; i < rowCount; i += 1) {
  const row = rows.nth(i);
  assertTruthy((await row.locator(".rr-measure-label").innerText()).trim().length > 0, "nombre");
  assertTruthy(/Valor IA|Medición propia/.test(await row.locator(".rr-measure-cell-label").first().innerText()), "celda del valor IA");
  assertTruthy(/^\d[\d.,]*\s*\S+$|Sin valor/.test((await row.locator(".rr-measure-ai").innerText()).trim()), "valor y unidad juntos");
  assertTruthy((await row.locator(".rr-measure-input").count()) === 1 && /Corrección profesional/.test(await row.innerText()), "campo de corrección profesional");
}
const heightRowA = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
const originalA = (await heightRowA.locator(".rr-measure-ai").innerText()).trim();
await heightRowA.locator(".rr-measure-input").fill("9.9");
await page.getByTestId("change-level").click();
assertTruthy(await page.locator(".rr-level").first().isVisible() && (await page.locator("section[data-group='measurements']").isHidden()), "“Cambiar nivel” vuelve a mostrar el selector");
assertTruthy((await sliceReadout()) === sliceBefore, "cambiar de nivel no mueve el corte");
await page.locator(".rr-level", { hasText: "L3-L4" }).first().click();
assertTruthy(/L3-L4\s*·\s*5 mediciones/.test(await page.getByTestId("level-header").innerText()), "se muestra el nuevo nivel");
await page.getByTestId("change-level").click();
await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
const heightRowB = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
assertTruthy((await heightRowB.locator(".rr-measure-input").inputValue()) === "9.9" && (await heightRowB.locator(".rr-measure-ai").innerText()).trim() === originalA, "la corrección escrita y el valor IA se conservan al cambiar de nivel");
await page.getByTestId("clear-level").click();
assertTruthy((await page.getByTestId("level-header").count()) === 0 && await page.locator(".rr-level").first().isVisible(), "“Quitar selección” vuelve al selector");
assertTruthy((await sliceReadout()) === sliceBefore, "quitar la selección no mueve el corte");
await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
assertTruthy((await page.locator(".rr-measure", { hasText: "Altura discal" }).first().locator(".rr-measure-input").inputValue()) === "9.9", "la corrección sigue tras quitar y volver a elegir");
await page.locator(".rr-measure", { hasText: "Altura discal" }).first().locator(".rr-measure-input").fill("");
ok("cambiar y quitar el nivel conserva la corrección (valor IA visible) y no mueve el corte");

// A4. Hallazgos IA: aviso breve, "Alcance y limitaciones" cerrado, tabla compacta
await page.getByRole("tab", { name: "Hallazgos IA" }).click();
await page.waitForTimeout(400);
const findingsPane = page.locator("#rr-results-findings");
assertTruthy(/Resultados generados por IA\. Requieren revisión profesional\./.test(await findingsPane.innerText()), "aviso breve");
assertTruthy(!/pendiente de revisión/i.test(await findingsPane.innerText()), "no afirma un estado de revisión que no existe");
const scope = page.getByTestId("scope-limitations");
assertTruthy((await scope.getAttribute("open")) === null, "“Alcance y limitaciones” empieza cerrado");
assertTruthy(await page.getByTestId("study-limitation").isVisible(), "la limitación propia de este estudio sigue a la vista");
assertTruthy((await page.getByRole("button", { name: /Analizar estudio|Reanalizar/ }).count()) === 0, "Hallazgos IA no ofrece analizar");
const head = (await findingsPane.locator(".rr-disc-overview-head").innerText()).replace(/\s+/g, " ").trim();
assertTruthy(/Disco\s+Clasificaciones positivas\s+Pfirrmann/i.test(head), `columnas: ${head}`);
const summaries = await findingsPane.locator("summary.rr-disc-level-summary").evaluateAll((els) => els.map((el) => Array.from(el.children).map((c) => c.textContent.replace(/\s+/g, " ").trim())));
assertTruthy(summaries.length === 5 && summaries.every(([disc, count, grade]) => /^L\d-/.test(disc) && /^\d de 4$/.test(count) && /^(I|II|III|IV|V)$/.test(grade)), `filas compactas: ${JSON.stringify(summaries)}`);
assertTruthy(summaries.some(([, count]) => count === "0 de 4") && summaries.some(([, count]) => count === "4 de 4"), "conteos del contrato real");
assertTruthy((await findingsPane.getByTestId("disc-count-note").count()) === 1 && /No expresa gravedad ni normalidad/.test(await findingsPane.getByTestId("disc-count-note").innerText()), "una sola aclaración del conteo");
const researchBlock = findingsPane.getByTestId("research-results");
if (await researchBlock.count()) assertTruthy((await researchBlock.getAttribute("open")) === null, "resultados de investigación plegados");
const tableBox = await findingsPane.locator(".rr-disc-overview").boundingBox();
assertTruthy(tableBox && tableBox.y < height * 0.62, `la tabla aparece sin desplazarse (y=${Math.round(tableBox?.y ?? -1)})`);
await shot("04-hallazgos-al-abrir");
await scope.locator("summary").click();
assertTruthy(/validación interna/i.test(await scope.innerText()), "al abrirlo explica alcance y validación");
await scope.locator("summary").click();
ok(`hallazgos: aviso de una línea, ayudas cerradas, tabla Disco | Clasificaciones positivas | Pfirrmann (${summaries.map((s) => s[1]).join(", ")}) a y=${Math.round(tableBox.y)}`);

// A5. detalle de un disco: nombres y resultados, "Ver en el corte" conservado
await findingsPane.locator("summary.rr-disc-level-summary", { hasText: "L4-L5" }).first().click();
const expanded = findingsPane.locator("details.rr-disc-level[open]");
const classNames = await expanded.locator('[data-block="classifications"] .rr-disc-finding > span:first-child').allInnerTexts();
assertTruthy(JSON.stringify(classNames) === JSON.stringify(["Abombamiento discal", "Estrechamiento discal", "Cambio del platillo superior", "Cambio del platillo inferior"]), `clasificaciones: ${classNames}`);
assertTruthy(/Presente/.test(await expanded.locator('[data-block="classifications"]').innerText()), "con sus resultados");
assertTruthy(/Grado/.test(await expanded.locator('[data-block="pfirrmann"]').innerText()) && !/Abombamiento/.test(await expanded.locator('[data-block="pfirrmann"]').innerText()), "Pfirrmann en su bloque");
const goToRegion = expanded.getByRole("button", { name: /Ver en el corte/ });
const sliceBeforeGo = await sliceReadout();
await goToRegion.click();
await page.waitForTimeout(700);
const sliceAfterGo = await sliceReadout();
assertTruthy(sliceAfterGo !== sliceBeforeGo || /Marcado/.test(await expanded.locator(".rr-disc-region button").innerText()), "“Ver en el corte” conserva su efecto");
await shot("05-hallazgo-expandido");
ok(`disco expandido con nombres y resultados y “Ver en el corte” (${sliceBeforeGo} → ${sliceAfterGo})`);

// A6. Revisión: notas y estado primero, ayuda cerrada, anotaciones compactas, pie compacto con motivos
await page.getByRole("tab", { name: "Revisión" }).click();
await page.waitForTimeout(300);
const reviewPane = page.locator("#review-inspector-panel-review");
assertTruthy(/Revisás el análisis inicial del estudio/.test(await page.getByTestId("review-oneliner").innerText()), "una línea que identifica el análisis revisado");
const notesBox = await reviewPane.locator("textarea").first().boundingBox();
const annotBox = await page.getByTestId("annotation-toggle").boundingBox();
const scopeBox = await page.getByTestId("review-scope").boundingBox();
assertTruthy(notesBox && annotBox && scopeBox && notesBox.y < annotBox.y && annotBox.y < scopeBox.y, "notas y estado antes que las anotaciones y las explicaciones largas");
assertTruthy((await page.getByTestId("review-scope").getAttribute("open")) === null, "“Qué incluye esta revisión” cerrado");
const confirm = page.locator(".rr-review-footer .rr-primary");
assertTruthy(await confirm.isDisabled() && /Elegí Observado, Finalizado o Descartado/.test(await page.getByTestId("confirm-reason").innerText()), "motivo específico visible junto al botón");
const footerBox = await page.getByTestId("review-footer").boundingBox();
assertTruthy(footerBox.height <= 130, `pie compacto (${Math.round(footerBox.height)} px)`);
assertTruthy(footerBox.y >= scopeBox.y + scopeBox.height - 1, "el pie no se superpone al contenido");
await page.getByLabel("Estado de revisión").selectOption("observado");
assertTruthy((await confirm.innerText()).trim() === "Marcar como observado" && /al menos 5 caracteres/.test(await page.getByTestId("review-notes-hint").innerText()), "etiqueta por efecto y aviso de nota");
await shot("06-revision");
await page.getByLabel("Estado de revisión").selectOption("pendiente");
ok("Revisión: una línea, notas y estado primero, ayuda cerrada, pie compacto con motivos visibles");

// A7. anotación sin guardar: el editor se oculta sin descartar el texto y el aviso explica el guardado
assertTruthy((await page.getByTestId("annotations-pending").count()) === 0, "sin cambios no hay aviso");
await page.getByTestId("annotation-toggle").click();
const editor = reviewPane.getByLabel("Texto de la anotación");
await editor.waitFor();
assertTruthy(await reviewPane.getByRole("button", { name: "Estudio" }).isVisible() && await reviewPane.getByRole("button", { name: /Corte \d+/ }).isVisible(), "destinos Estudio / Nivel / Corte");
await editor.fill(`texto-sin-agregar-${stamp}`);
await page.getByTestId("annotation-toggle").click();
assertTruthy(await editor.isHidden() && /texto sin agregar/.test(await page.getByTestId("annotation-toggle").innerText()), "ocultar el editor no descarta el texto y lo indica");
assertTruthy(/texto escrito sin agregar/.test(await page.getByTestId("annotations-pending").innerText()), "aviso de texto pendiente");
await page.getByRole("tab", { name: "Contexto" }).click();
await page.getByTestId("tools-open").click();
await page.getByRole("tab", { name: "Revisión" }).click();
assertTruthy(/texto sin agregar/.test(await page.getByTestId("annotation-toggle").innerText()), "navegar entre pestañas y herramientas conserva el texto");
await page.getByTestId("annotation-toggle").click();
assertTruthy((await editor.inputValue()) === `texto-sin-agregar-${stamp}`, "el texto escrito sigue en el editor");
await reviewPane.getByRole("button", { name: "Agregar", exact: true }).click();
assertTruthy(await editor.isHidden() && (await reviewPane.locator(".rr-annots li").count()) === 1, "al agregar, el editor se cierra y la anotación queda en la lista compacta");
assertTruthy(/anotaciones sin guardar/.test(await page.getByTestId("annotations-pending").innerText()) && /Guardar borrador/.test(await page.getByTestId("annotations-pending").innerText()), "aviso breve de dónde se guardan");
await shot("07-anotaciones-sin-guardar");
await reviewPane.getByRole("button", { name: "Eliminar anotación" }).click();
ok("anotación: el editor se oculta sin perder el texto, se conserva al navegar y el aviso explica cómo se guarda");

// A8. Contexto exclusivo de paciente y datos clínicos
await page.getByRole("tab", { name: "Contexto" }).click();
await page.getByTestId("study-context").waitFor({ timeout: 15000 });
const contextText = await page.locator("#review-inspector-panel-context").innerText();
assertTruthy(/Edad al estudio/.test(contextText) && /Antecedentes/.test(contextText) && /Paciente/.test(contextText), "campos del contexto");
assertTruthy(!/Historial del paciente|Comparación entre estudios|Informe y exportación|Asistente|Reconstrucción 3D|Concordancia|Feedback|Auditoría|Detalles técnicos|demostración/i.test(contextText), "Contexto no reúne herramientas");
const hasContext = !(await page.getByTestId("study-context-empty").count());
if (!hasContext) assertTruthy((contextText.match(/No informado/g) ?? []).length === 5, "los cinco campos sin informar se rotulan");
assertTruthy((await page.getByTestId("context-help").getAttribute("open")) === null, "la ayuda sobre los datos empieza cerrada");
await shot("08-contexto");
ok("Contexto solo con paciente y datos clínicos; faltantes rotulados 'No informado'; ayuda cerrada");

// A9. Herramientas del estudio: índice agrupado, una herramienta por vez, regreso al índice
const getsBeforeIndex = getRequests.length;
await toolsButton.click();
await page.getByTestId("tools-index").waitFor();
await page.waitForTimeout(800);
const consulted = getRequests.slice(getsBeforeIndex).filter((path) => /report|longitudinal|chat|feedback|concordance|product-analyses|\/subjects|audit/.test(path));
assertTruthy(consulted.length === 0, `abrir el índice no consulta herramientas: ${consulted.join(", ")}`);
const groupTitles = await page.locator(".rr-tools-group > h3").allInnerTexts();
assertTruthy(JSON.stringify(groupTitles) === JSON.stringify(["Seguimiento del paciente"]), `solo el grupo de seguimiento, sin encabezados vacíos: ${groupTitles}`);
const itemTitles = await page.locator(".rr-tool-item-title").allInnerTexts();
assertTruthy(JSON.stringify(itemTitles) === JSON.stringify(["Historial del paciente", "Comparación entre estudios"]), `solo historial y comparación: ${itemTitles}`);
for (const retired of ["report", "assistant", "concordance", "feedback", "audit", "three-d", "technical", "demo"]) {
  assertTruthy((await page.locator(`[data-tool-id="${retired}"]`).count()) === 0, `la herramienta retirada ${retired} no tiene acceso`);
}
assertTruthy(!/Informe|Asistente|Evidencia y trazabilidad|Inspección técnica|Análisis de demostración|Concordancia|Feedback|Auditoría|Reconstrucción 3D|Detalles técnicos/.test(await page.getByTestId("tools-index").innerText()), "el índice no menciona las herramientas retiradas");
assertTruthy((await page.locator(".rr-tool-view").count()) === 0, "ninguna herramienta está montada al abrir el índice");
assertTruthy((await page.locator('[data-tool-id="comparison"] .rr-tool-item-provenance').count()) === 0, "la comparación ya no advierte que usa el análisis de demostración");
assertTruthy((await page.getByRole("tab", { selected: true }).count()) === 0, "con las herramientas abiertas ninguna pestaña figura activa");
await checkLayout("índice de herramientas");
await shot("09-herramientas-indice");
await page.locator('[data-tool-id="history"]').click();
const historyView = page.locator('.rr-tool-view[data-tool="history"]');
assertTruthy(await historyView.isVisible() && await historyView.getByRole("button", { name: "Ver historial del paciente" }).isVisible(), "la herramienta se muestra en el mismo panel");
assertTruthy(await page.getByTestId("tools-index").isHidden() && (await page.locator(".rr-tool-view:visible").count()) === 1, "una herramienta por vez");
assertTruthy(await historyView.getByRole("heading", { name: "Historial del paciente" }).isVisible(), "con su título");
await historyView.getByRole("button", { name: /Herramientas del estudio/ }).click();
assertTruthy(await page.getByTestId("tools-index").isVisible(), "regreso al índice");
assertTruthy(await page.evaluate(() => document.activeElement?.getAttribute("data-tool-id") === "history"), "el foco vuelve al elemento que se abrió");
await page.locator('[data-tool-id="comparison"]').click();
assertTruthy(/análisis inicial real/.test(await page.getByTestId("comparison-source-note").innerText()) && /No usa el análisis de demostración/.test(await page.getByTestId("comparison-source-note").innerText()), "la comparación declara que usa el análisis inicial real");
await page.locator('.rr-tool-view[data-tool="comparison"]').getByRole("button", { name: /Herramientas del estudio/ }).click();
await page.waitForTimeout(600);
assertTruthy(analysisPosts().length === 0 && nonLoginMutations().length === 0, `ningún POST al navegar herramientas: ${nonLoginMutations().join(", ")}`);
await page.getByRole("tab", { name: "Resultados" }).click();
assertTruthy(await page.getByTestId("tools-index").isHidden() && await page.getByRole("tab", { name: "Resultados", selected: true }).isVisible(), "elegir una pestaña cierra las herramientas");
ok("índice de herramientas: solo historial y comparación, sin accesos a las retiradas ni encabezados vacíos, una por vez, regreso al índice con foco, sin consultas al abrirlo y sin POST");

// A10. cambiar pestaña, vista, herramienta y ancho no pierde estado ni recarga imágenes
await page.getByRole("tab", { name: "Revisión" }).click();
const noteText = `nota-de-prueba-${stamp}`;
await reviewPane.locator("textarea").first().fill(noteText);
await page.getByLabel("Estado de revisión").selectOption("observado");
await page.getByRole("tab", { name: "Resultados" }).click();
if ((await page.getByTestId("level-header").count()) === 0) await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
const sliceKept = await sliceReadout();
const imagesBeforeResize = imageRequests.length;
await toolsButton.click();
await page.locator('[data-tool-id="history"]').click();
const handle = page.getByRole("separator", { name: "Ancho del panel" });
await handle.focus();
const widthBefore = Number(await handle.getAttribute("aria-valuenow"));
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
const widthAfter = Number(await handle.getAttribute("aria-valuenow"));
assertTruthy(widthAfter === widthBefore + 48, `el teclado ensancha el panel (${widthBefore} → ${widthAfter})`);
assertTruthy(Math.abs(Math.round((await page.locator("aside.rr-panel").boundingBox()).width) - widthAfter) <= 1, "el ancho aplicado coincide");
await page.keyboard.press("End");
const maxWidth = Number(await handle.getAttribute("aria-valuenow"));
assertTruthy(maxWidth === Number(await handle.getAttribute("aria-valuemax")) && maxWidth <= width * 0.5 + 1, "Fin lleva al máximo, que deja la mitad a la imagen");
await page.keyboard.press("Home");
assertTruthy(Number(await handle.getAttribute("aria-valuenow")) === Number(await handle.getAttribute("aria-valuemin")), "Inicio lleva al mínimo");
for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(400);
await checkLayout("ancho cambiado con herramienta abierta");
await page.getByRole("tab", { name: "Resultados" }).click();
assertTruthy(/L4-L5\s*·/.test(await page.getByTestId("level-header").innerText()), "el nivel seleccionado se conserva");
assertTruthy((await sliceReadout()) === sliceKept, "el corte se conserva");
assertTruthy(imageRequests.length === imagesBeforeResize, `no se vuelven a pedir imágenes (${imageRequests.length - imagesBeforeResize} nuevas)`);
await page.getByRole("tab", { name: "Revisión" }).click();
assertTruthy((await reviewPane.locator("textarea").first().inputValue()) === noteText && (await page.getByLabel("Estado de revisión").inputValue()) === "observado", "notas y estado locales se conservan");
assertTruthy(nonLoginMutations().length === 0, "ningún POST ni PUT en toda la navegación");
await page.getByLabel("Estado de revisión").selectOption("pendiente");
ok("pestañas, herramientas y ancho: se conservan nivel, corte, nota y estado; no se recargan imágenes; no se envía nada");

/* ============ C. datos faltantes: respuesta del estudio alterada solo en el navegador ============ */

const missingPage = await context.newPage();
missingPage.on("pageerror", (error) => { throw new Error(`error de página (datos faltantes): ${error.message}`); });
await missingPage.route(`**/api/studies/${readonlyCase}`, async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "discDegenerativeFindings" && Array.isArray(item?.findings)) {
        item.findings = item.findings.filter((finding) => {
          const level = finding.anatomy?.level;
          if (level === "L3-L4") return false; // disco sin ninguna clasificación
          if (level === "L2-L3" && finding.findingType === "disc_narrowing") return false; // una clasificación faltante
          if (level === "L1-L2" && finding.findingType === "pfirrmann_grade") return false; // sin grado de Pfirrmann
          return true;
        });
      } else walk(item);
    }
  };
  walk(body);
  await route.fulfill({ response, json: body });
});
await login(missingPage);
await openStudy(readonlyCase, missingPage);
await missingPage.getByRole("tab", { name: "Hallazgos IA" }).click();
await missingPage.waitForTimeout(500);
const incompleteRows = await missingPage.locator("#rr-results-findings summary.rr-disc-level-summary").evaluateAll((els) => els.map((el) => Array.from(el.children).map((c) => c.textContent.replace(/\s+/g, " ").trim())));
const byDisc = Object.fromEntries(incompleteRows.map(([disc, count, grade]) => [disc, { count, grade }]));
assertTruthy(/^0 de 4$/.test(byDisc["L1-L2"].count) && byDisc["L1-L2"].grade === "Sin dato", `L1-L2 completo, sin Pfirrmann: ${JSON.stringify(byDisc["L1-L2"])}`);
assertTruthy(/^0 de 3 evaluadas/.test(byDisc["L2-L3"].count) && /Sin dato: estrechamiento discal/.test(byDisc["L2-L3"].count) && !/de 4/.test(byDisc["L2-L3"].count), `L2-L3 con una clasificación faltante no es 0 de 4: ${JSON.stringify(byDisc["L2-L3"])}`);
assertTruthy(/^Sin datos/.test(byDisc["L3-L4"].count) && byDisc["L3-L4"].grade === "Sin dato", `L3-L4 sin clasificaciones: ${JSON.stringify(byDisc["L3-L4"])}`);
assertTruthy(/^4 de 4$/.test(byDisc["L4-L5"].count), "los discos completos siguen mostrando n de 4");
await missingPage.locator("#rr-results-findings summary.rr-disc-level-summary", { hasText: "L2-L3" }).first().click();
const missingRow = missingPage.locator('details.rr-disc-level[open] .rr-disc-finding[data-result="missing"]');
assertTruthy((await missingRow.count()) === 1 && /Estrechamiento discal/.test(await missingRow.innerText()) && /Sin dato/.test(await missingRow.innerText()), "la clasificación faltante se rotula 'Sin dato', no 'Ausente'");
assertTruthy((await missingPage.locator("details.rr-disc-level[open] .rr-disc-finding[data-result='absent']").count()) === 3, "las demás siguen con su resultado real");
await shot("12-hallazgos-datos-faltantes", missingPage);
await missingPage.close();
ok("datos faltantes (simulados en el navegador, sin persistir): '0 de 3 evaluadas · Sin dato…', 'Sin datos' y 'Sin dato' en Pfirrmann; nunca '0 de 4'");

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

  // contexto con datos: edad con etiqueta breve y ayuda desplegable
  await page.getByRole("tab", { name: "Contexto" }).click();
  await page.getByTestId("study-context").waitFor({ timeout: 15000 });
  const filled = await page.getByTestId("study-context").innerText();
  assertTruthy(/62 años · Declarada/.test(filled) && !/Declarada al cargar/.test(filled), `edad con etiqueta breve: ${filled}`);
  assertTruthy(/Lumbalgia de prueba aislada/.test(filled) && /Dolor lumbar sintético/.test(filled) && /6 semanas/.test(filled) && /Sin antecedentes \(sintético\)/.test(filled), "motivo, síntomas, evolución y antecedentes");
  assertTruthy(!/No informado/.test(filled), "con contexto completo no se rotula nada como no informado");
  await page.getByTestId("context-help").locator("summary").click();
  assertTruthy(/declaró quien cargó el estudio/.test(await page.getByTestId("context-help").innerText()) && /no se recalcula/.test(await page.getByTestId("context-help").innerText()), "la explicación completa está en la ayuda");
  await shot("13-contexto-con-datos");
  assertTruthy(mutations.length === postsAfterCreation, "abrir el contexto no envía nada");
  ok("contexto del caso aislado: '62 años · Declarada', datos clínicos y ayuda desplegable");

  // guardado de borrador, corrección y anotación
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
  const isolatedPane = page.locator("#review-inspector-panel-review");
  await isolatedPane.locator("textarea").first().fill("Borrador de prueba aislada");
  await page.getByTestId("annotation-toggle").click();
  await isolatedPane.getByLabel("Texto de la anotación").fill("Anotación del caso aislado");
  await isolatedPane.getByRole("button", { name: "Agregar", exact: true }).click();
  assertTruthy(/anotaciones sin guardar/.test(await page.getByTestId("annotations-pending").innerText()), "aviso de anotación sin guardar");
  const before = mutations.length;
  await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20000 });
  const saved = mutations.slice(before);
  assertTruthy(saved.some((item) => /PUT .*\/api\/ai\/runs\/.+\/review/.test(item)) && saved.some((item) => /PUT .*\/api\/ai\/runs\/.+\/annotations/.test(item)), `guardó la revisión y las anotaciones: ${saved.join(", ")}`);
  assertTruthy(saved.every((item) => !/product-analysis|multiplanar\/run/.test(item)), "el guardado no dispara análisis");
  assertTruthy((await page.getByTestId("annotations-pending").count()) === 0, "tras guardar desaparece el aviso de cambios pendientes");
  ok(`borrador, corrección (${original} → ${corrected}) y anotación guardados en el caso aislado ${caseId}`);

  await page.getByRole("button", { name: "← Estudios" }).click();
  await openStudy(caseId);
  await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
  const reopenedRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
  assertTruthy((await reopenedRow.locator(".rr-measure-input").inputValue()) === corrected && (await reopenedRow.locator(".rr-measure-ai").innerText()).trim() === original, "corrección y valor IA persisten al reabrir");
  await page.getByRole("tab", { name: "Revisión" }).click();
  assertTruthy((await page.locator("#review-inspector-panel-review textarea").first().inputValue()) === "Borrador de prueba aislada", "las notas persisten");
  assertTruthy((await page.locator("#review-inspector-panel-review .rr-annots li").count()) === 1 && (await page.getByTestId("annotations-pending").count()) === 0, "la anotación persiste y no figura como pendiente");
  ok("corrección, notas y anotación se recuperan del backend al reabrir");

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
