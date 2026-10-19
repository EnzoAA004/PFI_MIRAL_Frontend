import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createIsolatedCorrectionCase } from "./lib/isolated-correction-case.mjs";

/**
 * Preinforme visual probado desde la interfaz de 8288, con el stack real.
 *
 * Aislamiento: esta prueba NO escribe en ningún estudio existente.
 *  - MENDELEY y OSF se abren en modo de SOLO LECTURA: el GET del preinforme se intercepta en el navegador para que el editor arranque
 *    sin borrador y cualquier escritura (PUT/POST/PATCH/DELETE) se aborta y se registra. Su borrador guardado, si existe, no se lee
 *    como base ni se modifica; al final se comprueba por API que conserva versión y fecha de actualización.
 *  - Guardado, recarga, ediciones, evidencia faltante, exportación y borrador desactualizado se prueban sobre un caso aislado
 *    propio (PREISO-n) que la prueba crea con «Nuevo estudio» y modifica por el flujo de Revisión.
 *
 * Variables: PFI_WEB, PFI_API, OUT_DIR, SKIP_ISOLATED=1 (omite el caso aislado).
 */
const WEB = process.env.PFI_WEB ?? "http://localhost:8288";
const API = process.env.PFI_API ?? "http://localhost:8280";
const OUT = process.env.OUT_DIR ?? "prereport-e2e-out";
const MENDELEY = "MENDELEY-0015-MVBLQ5XS";
const OSF = "OSF-ID10-V2-T1";
mkdirSync(OUT, { recursive: true });

const log = [];
const check = (name, ok, note) => {
  log.push({ name, ok: Boolean(ok), note });
  console.log(`${ok ? "ok" : "FALLA"} - ${name}${note ? ` · ${String(note).slice(0, 220)}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
const page = await context.newPage();
const dialogs = [];
page.on("dialog", async (dialog) => {
  dialogs.push(dialog.message());
  await dialog.accept();
});
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
/** Escrituras que salieron del navegador (para comprobar qué tocó cada sección). */
const writes = [];
page.on("request", (request) => {
  const url = request.url().replace(/^https?:\/\/[^/]+/, "");
  if (request.method() !== "GET" && /^\/api\//.test(url) && !/\/api\/auth\//.test(url)) writes.push(`${request.method()} ${url}`);
});

const login = await (await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const TOKEN = login.accessToken ?? login.token;
const api = async (path, init) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const runIdOf = async (caseId) => (await api(`/api/studies/${caseId}`)).body.runs[0].summary.runId;
const reviewOf = async (runId) => (await api(`/api/ai/runs/${runId}/review`)).body;
const draftOf = async (caseId, runId) => (await api(`/api/studies/${caseId}/prereport?runId=${runId}`)).body.draft;
const stamp = (draft) => (draft ? `${draft.version}@${draft.updatedAt}` : "sin borrador");

/* ---- modo de solo lectura para los estudios existentes ------------------------------------------------------------------ */
const readOnlyBlocked = [];
const readOnlyPrereport = async (route) => {
  const request = route.request();
  if (request.method() !== "GET") {
    readOnlyBlocked.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
    return route.abort();
  }
  const response = await route.fetch();
  const body = await response.json();
  await route.fulfill({ response, json: { ...body, draft: null, stale: false, changes: [], orphanedEdits: [] } });
};
const readOnlyOthers = (route) => {
  const request = route.request();
  if (request.method() === "GET") return route.continue();
  readOnlyBlocked.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")}`);
  return route.abort();
};
const PREREPORT = /localhost:8280\/api\/studies\/[^/]+\/prereport/;
const OTHER_API = /localhost:8280\/api\/(?!auth|studies\/[^/]+\/prereport)/;
async function readOnlyOn() {
  await page.route(PREREPORT, readOnlyPrereport);
  await page.route(OTHER_API, readOnlyOthers);
}
async function readOnlyOff() {
  await page.unroute(PREREPORT, readOnlyPrereport);
  await page.unroute(OTHER_API, readOnlyOthers);
}

async function loginUi() {
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  const demo = page.getByRole("button", { name: /Entrar con doctor demo/ });
  if (await demo.count()) await demo.click();
  await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
}
async function openStudy(caseId) {
  await page.goto(`${WEB}/estudio/${caseId}`, { waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
}
async function waitImages(timeout = 90_000) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="prereport-editor-column"]')?.textContent?.includes("preparando…"), null, { timeout });
  await page.waitForTimeout(600);
}
async function openEditor() {
  await page.getByRole("tab", { name: /Revisi/ }).click();
  await page.getByTestId("prepare-prereport").click();
  await page.getByTestId("prereport-editor").waitFor({ timeout: 30_000 });
  await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
  await waitImages();
}
const frame = () => page.frameLocator('[data-testid="prereport-frame"]');
const frameText = async () => (await frame().locator("body").innerText()).replace(/\s+/g, " ");
const allImagesLoaded = async () => frame().locator("img").evaluateAll((nodes) => nodes.length > 0 && nodes.every((n) => n.complete && n.naturalWidth > 0));

/** Pulsa «Guardar HTML»; si el editor advierte evidencia visual faltante, confirma «Exportar igual». */
async function clickExportHtml(page) {
  await page.getByTestId("prereport-export-html").click();
  const confirm = page.getByTestId("prereport-export-confirm-go");
  if (await confirm.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) await confirm.click();
}

/** Exporta una variante («brief» | «full») y devuelve el HTML guardado, el PDF y lo que tiene. */
async function exportVariant(tag, variant) {
  await page.getByTestId("prereport-variant").selectOption(variant);
  await page.waitForTimeout(500);
  const [download] = await Promise.all([page.waitForEvent("download"), clickExportHtml(page)]);
  const file = `${OUT}/${tag}.html`;
  await download.saveAs(file);
  const doc = await context.newPage();
  await doc.setViewportSize({ width: 1000, height: 900 });
  await doc.goto(`file:///${file.replace(/\\/g, "/")}`);
  await doc.waitForTimeout(700);
  const pdf = `${OUT}/${tag}.pdf`;
  await doc.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
  const images = await doc.locator("img").evaluateAll((nodes) => nodes.map((n) => [n.naturalWidth, n.naturalHeight, n.src.startsWith("data:")]));
  const text = (await doc.locator("body").innerText()).replace(/\s+/g, " ");
  await doc.close();
  const pages = (readFileSync(pdf, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { file, pdf, images, text, pages, html: readFileSync(file, "utf8") };
}
/** El cuerpo del documento (de «Resumen» a «Alcance y limitaciones»): lo que debe ser idéntico entre variantes. */
const bodyOf = (html) => html.slice(html.indexOf("<h2>Resumen"), html.indexOf("<h2>Alcance y limitaciones")).replace(/\((véase el Anexo A|disponibles? en la versión con anexos)\)/g, "(ref)");

try {
  await loginUi();
  const mendeleyRun = await runIdOf(MENDELEY);
  const osfRun = await runIdOf(OSF);
  const stampsBefore = { mendeley: stamp(await draftOf(MENDELEY, mendeleyRun)), osf: stamp(await draftOf(OSF, osfRun)) };
  const reviewBefore = await reviewOf(mendeleyRun);

  /* ================================================================== MENDELEY (solo lectura) */
  await readOnlyOn();
  await openStudy(MENDELEY);
  await page.getByRole("tab", { name: "Resultados" }).click();
  await page.getByRole("tab", { name: "Hallazgos IA" }).click();
  const findingsPanel = page.locator('section[aria-label="Hallazgos discales asistidos por IA"]');
  await findingsPanel.locator('details[data-level="L5-S1"] summary').click();
  const viewerGoTo = (await findingsPanel.getByRole("button", { name: /Ver en el corte/ }).first().innerText()).replace(/\s+/g, " ");
  const cornerBefore = (await page.locator(".rr-corner-bl").first().innerText()).replace(/\s+/g, " ");

  await page.getByRole("tab", { name: /Revisi/ }).click();
  check("1. «Preparar preinforme» disponible en Revisión con resultados utilizables, sin aprobar el estudio", await page.getByTestId("prepare-prereport").isEnabled());
  await openEditor();
  const text = await frameText();
  const barText = await page.locator(".pre-bar").innerText();
  check("1. el documento dice borrador pendiente de revisión profesional y que no aprueba el estudio", /Borrador pendiente de revisión profesional/.test(barText) && /no aprueba el estudio/.test(barText));
  await page.screenshot({ path: `${OUT}/01-editor-1366x768.png` });

  check("resumen: identifica la clasificación positiva y su nivel como pendiente de revisión", /predijo como presentes?, pendientes? de revisión profesional/.test(text) && /L5-S1 · Abombamiento discal: predicción del modelo «presente» \(70,4 %\)/.test(text));
  check("resumen: distingue ausentes y no evaluados, y no genera diagnóstico ni normalidad", /predichas como ausente/.test(text) && (!/no evaluado/i.test(text) || /no fueron evaluadas|no fue evaluada|no devolvió resultado/.test(text)) && !/diagnóstic[oa] de|normal\b|causa|recomend/i.test(text.replace(/no constituye un diagnóstico/g, "")));
  check("resumen: aclara que el detalle por nivel es la selección y no la cobertura completa", /selección incluida en este documento/.test(text) && /no representa la cobertura completa/.test(text));
  check("lenguaje: sin «P10.7», sin plurales entre paréntesis, con «Clasificación degenerativa por IA»", !/P10\.7|\(s\)|\(es\)/.test(text) && /Clasificación degenerativa por IA/.test(text));
  check("modalidad: sin dato registrado se dice honestamente", /Modalidad No registrada en el estudio/i.test(text));
  const viewerSlice = (viewerGoTo.match(/corte (\d+)/) ?? [])[1];
  check("L5-S1: el corte del documento coincide con el que marca el visor", viewerSlice && new RegExp(`Sagital T2 \\(detectada\\) · corte ${viewerSlice} de 15`).test(text), viewerGoTo);
  check("L5-S1: mediciones y clasificación en bloques separados, con la correspondencia pendiente de verificación", /Correspondencia pendiente de verificación/.test(text) && /La correspondencia anatómica entre estas mediciones y clasificaciones requiere verificación profesional\./.test(text) && /Mediciones del análisis inicial/.test(text) && /Región evaluada por el clasificador/.test(text));
  check("L5-S1: T1 y T2 del mismo nivel en un único bloque, con leyenda compartida", (await frame().locator(".series-row").count()) === 2 && (await frame().locator(".legend").count()) === 2);
  check("imágenes: «Imagen completa» y «Detalle ampliado», sin «sin deformar»", /Imagen completa/.test(text) && /Detalle ampliado/.test(text) && !/sin deformar/.test(text));
  check("las imágenes cargaron e incrustadas (data URL)", await allImagesLoaded());

  // ---- exportación breve y completa
  const briefM = await exportVariant("MENDELEY-preinforme", "brief");
  const dialogsAfterFirst = dialogs.length;
  const fullM = await exportVariant("MENDELEY-preinforme-con-anexos", "full");
  check("exportar: antes de exportar se informa la evidencia que falta", dialogsAfterFirst > 0 && /falta evidencia visual/.test(dialogs[0]) && /área del disco/.test(dialogs[0]), dialogs[0]?.slice(0, 160));
  check("«Preinforme» (predeterminado) no incluye anexos; «con anexos» sí", !/Anexo A/.test(briefM.text) && /Anexo A · Tabla completa de mediciones/.test(fullM.text) && /Anexo C · Trazabilidad técnica/.test(fullM.text) && /Disponibles en la versión con anexos/.test(briefM.text));
  check("ambas variantes conservan borrador, identificación, versión de fuentes, limitaciones y avisos", [briefM, fullM].every((d) => /Borrador pendiente de revisión profesional/.test(d.text) && /Estudio MENDELEY-0015-MVBLQ5XS/i.test(d.text) && (d === fullM ? /Versión de las fuentes src-/i.test(d.text) : !/Versión de las fuentes src-/i.test(d.text)) && /Alcance y limitaciones/.test(d.text) && /correspondencia anatómica entre estas mediciones y clasificaciones requiere verificación profesional/.test(d.text) && /Evidencia visual no disponible/i.test(d.text)));
  check("las dos variantes tienen las mismas cifras y evidencias (cuerpo idéntico, mismas imágenes)", bodyOf(briefM.html) === bodyOf(fullM.html) && briefM.images.length === fullM.images.length && briefM.images.length >= 6, `${briefM.images.length} imágenes`);
  check("el PDF breve es más corto que el completo", briefM.pages > 0 && briefM.pages < fullM.pages, `${briefM.pages} frente a ${fullM.pages} páginas`);
  check("«con anexos» deja el código P10.7 y las clases técnicas raw_ solo en el anexo", /P10\.7/.test(fullM.text) && /‡/.test(fullM.html) && !/raw_\d+/.test(briefM.text) && /sin correspondencia anatómica verificada/.test(fullM.text));
  check("PDF exportado con imágenes completas incrustadas", briefM.images.every(([w, h, data]) => w > 0 && h > 0 && data));

  await page.getByTestId("prereport-close").click();
  await page.getByRole("tab", { name: "Resultados" }).click();
  check("volver al visor conserva corte, zoom y W/L", (await page.locator(".rr-corner-bl").first().innerText()).replace(/\s+/g, " ") === cornerBefore);

  /* ================================================================== OSF (solo lectura) */
  await openStudy(OSF);
  await openEditor();
  const osfText = await frameText();
  check("OSF: se presentan mediciones y se explica que la corrida no dispone de resultados degenerativos", /Se presentan mediciones del análisis inicial/.test(osfText) && /La corrida no dispone de resultados de clasificación degenerativa por IA\. Eso no equivale a que ninguna categoría esté ausente\./.test(osfText));
  check("OSF: no inventa una matriz de negativos ni resultados «no evaluados»", !/Ausente · \d/.test(osfText) && !/No evaluado/.test(osfText) && !/predicha como ausente/.test(osfText));
  check("OSF: cada medición con trazo dice su serie, su corte (base 1) y su procedencia", /Sagital T\d \(\w+\) · corte \d+/.test(osfText) && /trazo de la IA/.test(osfText));
  check("OSF: las imágenes con trazos cargaron", await allImagesLoaded());
  const briefO = await exportVariant("OSF-preinforme", "brief");
  const fullO = await exportVariant("OSF-preinforme-con-anexos", "full");
  check("OSF: breve y completo con las mismas cifras y evidencias", bodyOf(briefO.html) === bodyOf(fullO.html) && briefO.images.length === fullO.images.length && briefO.pages < fullO.pages, `${briefO.pages} frente a ${fullO.pages} páginas`);
  await page.screenshot({ path: `${OUT}/04-editor-OSF.png` });
  await page.getByTestId("prereport-close").click();

  /* ================================================================== evidencia faltante (solo lectura, sobre MENDELEY) */
  await openStudy(MENDELEY);
  const invalidRegion = async (route) => {
    if (route.request().method() !== "GET") return readOnlyPrereport(route);
    const response = await route.fetch();
    const body = await response.json();
    const target = body.generated.findings.find((f) => f.level === "L5-S1" && f.type === "disc_bulging");
    target.sources[0].region = null;
    target.sources[0].imagePath = null;
    target.sources[0].regionIssue = "el recuadro de la región cae fuera de su espacio de coordenadas";
    await route.fulfill({ response, json: { ...body, draft: null, stale: false, changes: [], orphanedEdits: [] } });
  };
  await page.unroute(PREREPORT, readOnlyPrereport);
  await page.route(PREREPORT, invalidRegion);
  await page.route(/\/api\/ai\/series\/.*\/slices\//, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await openEditor();
  const failText = await frameText();
  check("evidencia faltante: imagen no disponible conserva el resultado textual y dice el motivo", /Imagen no disponible/.test(failText) && /Abombamiento discal/.test(failText));
  check("evidencia faltante: región inválida conserva la clasificación sin localización y se informa", /Sin región evaluada/.test(failText) && /región inválida/.test(failText) && /sin localización/.test(failText));
  await page.getByTestId("prereport-export-html").click();
  const banner = page.getByTestId("prereport-export-confirm");
  await banner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const bannerText = (await banner.innerText().catch(() => "")) ?? "";
  check("evidencia faltante: antes de exportar se informa qué falta, dentro del editor y sin diálogo nativo", /Falta evidencia visual/.test(bannerText) && /región inválida/.test(bannerText), bannerText.slice(0, 200));
  await page.getByTestId("prereport-export-confirm-cancel").click();
  await page.screenshot({ path: `${OUT}/05-evidencia-faltante.png` });
  await page.unroute(/\/api\/ai\/series\/.*\/slices\//);
  await page.unroute(PREREPORT, invalidRegion);
  await page.getByTestId("prereport-close").click();
  await readOnlyOff();

  check("estudios existentes: ninguna escritura salió del navegador y su borrador guardado quedó intacto", writes.length === 0 && readOnlyBlocked.length === 0 && stamp(await draftOf(MENDELEY, mendeleyRun)) === stampsBefore.mendeley && stamp(await draftOf(OSF, osfRun)) === stampsBefore.osf, `${stampsBefore.mendeley} | ${stampsBefore.osf}; intentos bloqueados: ${readOnlyBlocked.length}; escrituras: ${writes.join(" ; ")}`);
  const reviewAfter = await reviewOf(mendeleyRun);
  check("MENDELEY: la revisión sigue igual (no se aprobó ni se reanalizó)", reviewAfter.reviewStatus === reviewBefore.reviewStatus && reviewAfter.corrections.length === reviewBefore.corrections.length);

  /* ================================================================== permisos */
  const noToken = await fetch(`${API}/api/studies/${MENDELEY}/prereport?runId=${mendeleyRun}`);
  check("permisos: sin token no hay acceso (401)", noToken.status === 401);
  check("permisos: una corrida de otro estudio se rechaza (404)", (await api(`/api/studies/${MENDELEY}/prereport?runId=${osfRun}`)).status === 404);
  check("la corrida es obligatoria (400)", (await api(`/api/studies/${MENDELEY}/prereport`)).status === 400);

  /* ================================================================== caso aislado: guardado, recarga, ediciones, desactualizado */
  if (!process.env.SKIP_ISOLATED) {
    const caseId = `PREISO-${Date.now() % 100000}`;
    await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
    const iso = await createIsolatedCorrectionCase(page, { caseId, corrected: 7.3, log: (m) => console.log("  ·", m) });
    await openEditor();
    check("aislado: el borrador parte de lo generado y sin guardar", /sin guardar/.test(await page.locator(".pre-bar").innerText()));

    // edición: texto editado, exclusión, nota del nivel y observaciones
    const heightItem = page.locator('[data-testid^="pre-item-m:sagittal-disc-l4-l5-height"]').first();
    await heightItem.getByRole("button", { name: "Editar texto" }).click();
    await heightItem.locator("textarea").fill("Altura L4-L5 (texto editado por la profesional).");
    const areaItem = page.locator('[data-testid^="pre-item-m:sagittal-disc-l4-l5-area"]').first();
    if (await areaItem.count()) await areaItem.locator('input[type="checkbox"]').uncheck();
    await page.getByLabel("Observaciones sobre L4-L5").fill("Nota del nivel L4-L5 (aislado).");
    await page.getByTestId("prereport-observations").fill("Observación general del caso aislado.");
    await page.waitForTimeout(700);
    const editedText = await frameText();
    check("aislado: los textos editados y las observaciones rigen en el documento", /texto editado por la profesional/.test(editedText) && /Nota del nivel L4-L5/.test(editedText) && /Observación general del caso aislado/.test(editedText));

    const writesBeforeSave = writes.length;
    await page.getByTestId("prereport-save").click();
    await page.getByTestId("prereport-notice").filter({ hasText: /Borrador guardado \(versión 1\)/ }).waitFor({ timeout: 20_000 });
    check("aislado: guardar escribe solo el borrador del preinforme", writes.slice(writesBeforeSave).length === 1 && /PUT \/api\/studies\/.*\/prereport/.test(writes.at(-1)), writes.slice(writesBeforeSave).join(" | "));
    const stored = await draftOf(caseId, iso.runId);
    check("aislado: lo generado y lo editado se guardan por separado, con huella, versión y parámetros de imagen", stored.version === 1 && /^src-/.test(stored.sourceFingerprint) && stored.edits.observations.startsWith("Observación general") && Object.keys(stored.edits.renderParams ?? {}).length >= 1 && Object.keys(stored.edits.text).every((key) => /^(f|m|a):/.test(key)));
    const correctionsBeforeStale = (await reviewOf(iso.runId)).corrections.length;

    await page.reload({ waitUntil: "networkidle" });
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    await openEditor();
    check("aislado: tras recargar se recupera el borrador con sus ediciones", (await page.getByTestId("prereport-observations").inputValue()).startsWith("Observación general del caso aislado") && /texto editado por la profesional/.test(await frameText()));

    const briefI = await exportVariant("AISLADO-preinforme", "brief");
    const fullI = await exportVariant("AISLADO-preinforme-con-anexos", "full");
    check("aislado: exportación breve y completa con el mismo cuerpo y las ediciones", bodyOf(briefI.html) === bodyOf(fullI.html) && /texto editado por la profesional/.test(briefI.text) && /Anexo A/.test(fullI.text) && !/Anexo A/.test(briefI.text));
    check("aislado: excluir anexos de una exportación no cambia lo guardado", stamp(await draftOf(caseId, iso.runId)) === stamp(stored));
    await page.getByTestId("prereport-close").click();

    // cambia una corrección por el flujo existente → borrador desactualizado
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    await page.getByRole("tab", { name: "Resultados" }).click();
    await page.getByRole("tab", { name: "Mediciones" }).click();
    await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
    await page.locator(".rr-measure", { hasText: "Altura discal" }).first().locator(".rr-measure-input").fill("6.1");
    await page.getByRole("tab", { name: "Revisión" }).click();
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20_000 });
    await page.getByTestId("prepare-prereport").click();
    await page.getByTestId("prereport-editor").waitFor();
    await page.getByTestId("prereport-stale").waitFor({ timeout: 30_000 });
    const staleText = await frameText();
    check("aislado: al cambiar la corrección el borrador queda «basado en datos anteriores» y no se actualiza solo", /Basado en datos anteriores/.test(staleText) && /texto editado por la profesional/.test(staleText));
    await page.getByRole("button", { name: /Ver cambios/ }).click();
    const changes = await page.getByTestId("prereport-changes").innerText();
    check("aislado: se muestran los cambios (antes y ahora)", /6,1/.test(changes) && /7,3/.test(changes), changes.replace(/\s+/g, " "));
    check("aislado: las ediciones siguen intactas mientras está desactualizado", (await page.getByTestId("prereport-observations").inputValue()) === "Observación general del caso aislado.");
    await page.screenshot({ path: `${OUT}/06-borrador-desactualizado.png` });
    await page.getByTestId("prereport-update-sources").click();
    await page.getByTestId("prereport-notice").filter({ hasText: /Fuentes actualizadas/ }).waitFor({ timeout: 20_000 });
    const updated = await draftOf(caseId, iso.runId);
    check("aislado: la actualización es explícita, conserva las ediciones y pasa a los datos actuales", (await page.getByTestId("prereport-stale").count()) === 0 && /Observación general del caso aislado/.test(updated.edits.observations) && Object.values(updated.edits.text).some((v) => /texto editado por la profesional/.test(v)) && JSON.stringify(updated.generated).includes('"corrected":6.1'));
    check("aislado: el preinforme no tocó las correcciones del estudio", (await reviewOf(iso.runId)).corrections.length >= correctionsBeforeStale);
    await page.getByTestId("prereport-close").click();
  }

  check("sin errores de página", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  writeFileSync(`${OUT}/prereport-e2e-log.json`, JSON.stringify({ log, dialogs, writes }, null, 1));
  await browser.close();
}
const failed = log.filter((entry) => !entry.ok);
console.log(`\n${log.length - failed.length}/${log.length} comprobaciones correctas${failed.length ? `; con falla: ${failed.map((f) => f.name).join(" | ")}` : ""}`);
process.exitCode = failed.length ? 1 : 0;
