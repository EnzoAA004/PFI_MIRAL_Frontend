import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createIsolatedCorrectionCase } from "./lib/isolated-correction-case.mjs";

/**
 * Preinforme visual probado desde la interfaz de 8288, con el stack real. No aprueba ni reanaliza ningún estudio existente y no
 * modifica sus resultados, correcciones, anotaciones ni su estado de revisión: solo crea borradores del preinforme. La prueba de
 * borrador desactualizado usa un caso aislado propio (se crea con «Nuevo estudio»).
 *
 * Variables: PFI_WEB, PFI_API, OUT_DIR, SKIP_STALE=1 (no crea el caso aislado).
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
const writes = [];
page.on("request", (request) => {
  const url = request.url().replace(/^https?:\/\/[^/]+/, "");
  if (request.method() !== "GET" && /^\/api\//.test(url) && !/\/api\/auth\//.test(url)) writes.push(`${request.method()} ${url}`);
});

async function token() {
  const res = await fetch(`${API}/api/auth/demo-doctor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await res.json();
  return body.accessToken ?? body.token;
}
const TOKEN = await token();
const api = async (path, init) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function runIdOf(caseId) {
  const detail = await api(`/api/studies/${caseId}`);
  return detail.body.runs[0].summary.runId;
}
const reviewOf = async (runId) => (await api(`/api/ai/runs/${runId}/review`)).body;
/** Deja en blanco las ediciones de un borrador que esta prueba creó antes (la prueba es repetible). Solo toca el borrador del preinforme. */
async function resetDraftEdits(caseId, runId) {
  const current = (await api(`/api/studies/${caseId}/prereport?runId=${runId}`)).body.draft;
  if (current) await api(`/api/studies/${caseId}/prereport?runId=${runId}`, { method: "PUT", body: JSON.stringify({ expectedVersion: current.version, edits: {} }) });
}

async function login() {
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
async function openEditor() {
  await page.getByRole("tab", { name: /Revisi/ }).click();
  await page.getByTestId("prepare-prereport").click();
  await page.getByTestId("prereport-editor").waitFor({ timeout: 30_000 });
  await page.getByTestId("prereport-summary").waitFor({ timeout: 30_000 });
  await waitImages();
}
/** Espera a que ninguna imagen del editor esté «preparando…». */
async function waitImages(timeout = 90_000) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="prereport-editor-column"]')?.textContent?.includes("preparando…"), null, { timeout });
  await page.waitForTimeout(600);
}
const frame = () => page.frameLocator('[data-testid="prereport-frame"]');
const frameText = async () => (await frame().locator("body").innerText()).replace(/\s+/g, " ");
async function allImagesLoaded() {
  return frame().locator("img").evaluateAll((nodes) => nodes.length > 0 && nodes.every((n) => n.complete && n.naturalWidth > 0));
}

async function exportDocument(tag) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("prereport-export-html").click()]);
  const file = `${OUT}/preinforme-borrador-${tag}.html`;
  await download.saveAs(file);
  const doc = await context.newPage();
  await doc.setViewportSize({ width: 1000, height: 900 });
  await doc.goto(`file:///${file.replace(/\\/g, "/").replace(/^\//, "")}`.replace("file:///C:", "file:///C:"));
  await doc.waitForTimeout(700);
  await doc.screenshot({ path: `${OUT}/preinforme-borrador-${tag}-pantalla.png`, fullPage: true });
  const pdf = `${OUT}/preinforme-borrador-${tag}.pdf`;
  await doc.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true });
  const images = await doc.locator("img").evaluateAll((nodes) => nodes.map((n) => [n.naturalWidth, n.naturalHeight, n.src.startsWith("data:")]));
  await doc.close();
  return { file, pdf, images };
}

try {
  await login();

  /* ================================================================== MENDELEY */
  const mendeleyRun = await runIdOf(MENDELEY);
  await resetDraftEdits(MENDELEY, mendeleyRun);
  const reviewBefore = await reviewOf(mendeleyRun);
  const draftVersionBefore = (await api(`/api/studies/${MENDELEY}/prereport?runId=${mendeleyRun}`)).body.draft?.version ?? null;
  await openStudy(MENDELEY);

  // El visor: qué corte muestra el visor para el abombamiento de L5-S1 (para comparar con el documento).
  await page.getByRole("tab", { name: "Resultados" }).click();
  await page.getByRole("tab", { name: "Hallazgos IA" }).click();
  const findingsPanel = page.locator('section[aria-label="Hallazgos discales asistidos por IA"]');
  await findingsPanel.locator('details[data-level="L5-S1"] summary').click();
  const viewerGoTo = (await findingsPanel.getByRole("button", { name: /Ver en el corte/ }).first().innerText()).replace(/\s+/g, " ");
  const viewerRows = (await findingsPanel.locator('details[data-level="L5-S1"]').innerText()).replace(/\s+/g, " ");
  const cornerBefore = (await page.locator(".rr-corner-bl").first().innerText()).replace(/\s+/g, " ");
  const counterBefore = (await page.locator(".rr-slice-counter, [data-testid=slice-counter]").first().innerText().catch(() => "")).trim();

  await page.getByRole("tab", { name: /Revisi/ }).click();
  const enabled = await page.getByTestId("prepare-prereport").isEnabled();
  check("1. «Preparar preinforme» disponible en Revisión con resultados utilizables, sin aprobar el estudio", enabled);
  const writesBeforeOpen = writes.length;
  await openEditor();
  check("1. abrir el editor no escribe nada en el Backend", writes.length === writesBeforeOpen, writes.slice(writesBeforeOpen).join(" | "));
  const draftsAfterOpen = (await api(`/api/studies/${MENDELEY}/prereport?runId=${mendeleyRun}`)).body;
  check("1. abrir no crea ni modifica el borrador", (draftsAfterOpen.draft?.version ?? null) === draftVersionBefore, `versión ${draftVersionBefore} → ${draftsAfterOpen.draft?.version ?? null}`);
  const afterOpenReview = await reviewOf(mendeleyRun);
  check("1. abrir no cambia la revisión", afterOpenReview.reviewStatus === reviewBefore.reviewStatus && afterOpenReview.corrections.length === reviewBefore.corrections.length, afterOpenReview.reviewStatus);

  const barText = await page.locator(".pre-bar").innerText();
  check("1. el documento dice borrador pendiente de revisión profesional y que no aprueba el estudio", /Borrador pendiente de revisión profesional/.test(barText) && /no aprueba el estudio/.test(barText), barText.replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/01-editor-1366x768.png` });

  // ---- ficha de L5-S1 comparada con el visor
  const text = await frameText();
  check("L5-S1. el abombamiento predicho figura como predicción del modelo con su probabilidad (70,4 %)", /Abombamiento discal: predicción del modelo «presente» \(70,4 %\)/.test(text));
  const viewerSlice = (viewerGoTo.match(/corte (\d+)/) ?? [])[1];
  check("L5-S1. el corte del documento coincide con el que marca el visor", viewerSlice && new RegExp(`Sagital T2 \\(detectada\\) · corte ${viewerSlice} de 15`).test(text), `visor: ${viewerGoTo}; ${viewerRows.slice(0, 120)}`);
  check("L5-S1. hay región evaluada rotulada como tal (no como lesión)", /Región evaluada por el modelo/.test(text) && /no delimita una lesión/.test(text));
  check("L5-S1. series T2 y T1 identificadas, corte en base 1", /Sagital T1 \(detectada\) · corte \d+ de 15/.test(text) && /Sagital T2 \(detectada\) · corte \d+ de 15/.test(text));
  check("L5-S1. mediciones y predicciones P10.7 van en bloques e imágenes separados, con la correspondencia declarada pendiente de verificación", /Correspondencia pendiente de verificación/.test(text) && /Fuente: análisis inicial/.test(text) && /Fuente: P10\.7/.test(text) && !/trazos de las mediciones y región/.test(text));
  check("L5-S1. las imágenes cargaron (incrustadas, no dependen de una URL)", await allImagesLoaded());
  const imageSources = await frame().locator("img").evaluateAll((nodes) => nodes.map((n) => n.src.slice(0, 11)));
  check("L5-S1. todas las imágenes son data URL", imageSources.length > 0 && imageSources.every((s) => s.startsWith("data:image")), imageSources.join(","));
  check("sin atípicos, sin rangos, sin normalidad", !/atípic|dentro del rango|fuera de rango|normal\b/i.test(text.replace(/no constituye un diagnóstico/g, "")));
  check("sin códigos internos ni modo real_baseline en el encabezado", !/real_baseline/.test(await frame().locator("header").innerText()));
  check("fecha del estudio ausente se dice, no se inventa", /Fecha del estudio No informada/i.test(text) && /Edad al estudio No informada/i.test(text));
  check("sin about:blank en el documento", !text.includes("about:blank"));

  // ---- edición: incluir/excluir, texto editado, observaciones, guardado y recarga
  const pfirrmannItem = page.locator('[data-testid^="pre-item-f:"]', { hasText: "Pfirrmann" }).first();
  await pfirrmannItem.locator('input[type="checkbox"]').uncheck();
  const bulgingItem = page.locator('[data-testid^="pre-item-f:"]', { hasText: "Abombamiento discal" }).first();
  await bulgingItem.getByRole("button", { name: "Editar texto" }).click();
  await bulgingItem.locator("textarea").fill("Abombamiento discal L5-S1: predicción del modelo «presente» (70,4 %). Correlacionar con la clínica.");
  await page.getByLabel("Incluir la ficha de L4-L5").check();
  await page.getByLabel("Observaciones sobre L5-S1").fill("Nota del nivel L5-S1 (prueba).");
  await page.getByTestId("prereport-observations").fill("Observación general de prueba: sin conclusión diagnóstica.");
  await page.getByTestId("pre-research").locator("summary").click();
  await page.getByTestId("pre-research").locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(800);
  let text2 = await frameText();
  check("edición: el texto editado rige en el documento y la exclusión de Pfirrmann se refleja", /Correlacionar con la clínica/.test(text2) && !/Grado de Pfirrmann: predicción del modelo «grado II»[^.]*experimental\s*texto/.test(text2));
  check("edición: la ficha de L4-L5 se agrega y los resultados de investigación van en un apartado propio", /L4-L5/.test(text2) && /Resultados de investigación/.test(text2) && /No son una capacidad soportada para producto/.test(text2));
  check("edición: observaciones del profesional visibles", /Observación general de prueba/.test(text2) && /Nota del nivel L5-S1/.test(text2));
  const writesBeforeSave = writes.length;
  await page.getByTestId("prereport-save").click();
  await page.getByTestId("prereport-notice").filter({ hasText: /Borrador guardado \(versión \d+\)/ }).waitFor({ timeout: 20_000 });
  const saveWrites = writes.slice(writesBeforeSave);
  check("guardar escribe solo el borrador del preinforme", saveWrites.length === 1 && /PUT \/api\/studies\/.*\/prereport/.test(saveWrites[0]), saveWrites.join(" | "));
  const reviewAfterSave = await reviewOf(mendeleyRun);
  check("guardar no cambia la revisión ni crea correcciones", reviewAfterSave.reviewStatus === reviewBefore.reviewStatus && reviewAfterSave.corrections.length === reviewBefore.corrections.length);
  const stored = (await api(`/api/studies/${MENDELEY}/prereport?runId=${mendeleyRun}`)).body.draft;
  check("el borrador guardado conserva lo generado y lo editado por separado, con huella y versión", stored && stored.version >= 1 && /^src-/.test(stored.sourceFingerprint) && stored.generated.schema === "pfi.prereport.v1" && stored.edits.observations.startsWith("Observación general") && Object.keys(stored.edits.text).length === 1, JSON.stringify(Object.keys(stored.edits)));
  check("se registran los parámetros de visualización de cada imagen", Object.keys(stored.edits.renderParams ?? {}).length >= 3 && Object.values(stored.edits.renderParams).every((p) => p.zoomCrop && p.imageSize && p.fullCrop));
  check("las ediciones están contra claves de origen (medición/hallazgo), no contra posiciones", Object.keys(stored.edits.text).every((key) => /^(f|m|a):/.test(key)));

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await openEditor();
  check("tras recargar, el borrador se recupera con sus ediciones", (await page.getByTestId("prereport-observations").inputValue()).startsWith("Observación general de prueba") && /Correlacionar con la clínica/.test(await frameText()));
  check("tras recargar figura la versión guardada", new RegExp(`versión ${stored.version}`).test(await page.locator(".pre-bar").innerText()));

  // ---- 1920×1080
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/02-editor-1920x1080.png` });
  const overflow1920 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check("1920×1080: el editor no desborda", !overflow1920);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(500);
  check("1366×768: el editor no desborda horizontalmente", !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));
  await page.getByTestId("prereport-preview").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/03-vista-previa-1366x768.png` });
  await page.getByTestId("prereport-preview").click();

  // ---- exportar (PDF real a partir del HTML exportado) y verificar
  const dialogsBefore = dialogs.length;
  const exported = await exportDocument("MENDELEY");
  check("exportar: antes de exportar se informa la evidencia que falta (área sin trazo)", dialogs.length > dialogsBefore && /falta evidencia visual/.test(dialogs.at(-1)) && /área del disco/.test(dialogs.at(-1)), dialogs.at(-1)?.slice(0, 200));
  check("exportar: las imágenes del archivo salen completas e incrustadas", exported.images.length > 0 && exported.images.every(([w, h, data]) => w > 0 && h > 0 && data), JSON.stringify(exported.images.slice(0, 3)));

  // ---- volver al visor conservando su estado
  await page.getByTestId("prereport-close").click();
  await page.getByTestId("prereport-editor").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Resultados" }).click();
  const cornerAfter = (await page.locator(".rr-corner-bl").first().innerText()).replace(/\s+/g, " ");
  check("volver al visor conserva corte, zoom y W/L", cornerAfter === cornerBefore, `${cornerBefore} → ${cornerAfter}`);
  const finalReview = await reviewOf(mendeleyRun);
  check("MENDELEY: la revisión sigue pendiente y sin correcciones (no se aprobó ni se reanalizó)", finalReview.reviewStatus === reviewBefore.reviewStatus && finalReview.corrections.length === reviewBefore.corrections.length && !writes.some((w) => /multiplanar\/run|product-analysis|review/.test(w) && !/prereport/.test(w)), writes.join(" | "));

  /* ================================================================== OSF: mediciones y trazos, sin P10.7 */
  const osfRun = await runIdOf(OSF);
  await resetDraftEdits(OSF, osfRun);
  const osfReviewBefore = await reviewOf(osfRun);
  await openStudy(OSF);
  await openEditor();
  const osfText = await frameText();
  check("OSF: dice explícitamente que la corrida no tiene resultados P10.7", /no tiene resultados P10\.7 persistidos/.test(osfText) && /no equivale a que ninguna categoría esté ausente/.test(osfText));
  check("OSF: no inventa una matriz de negativos", !/Ausente · \d/.test(osfText) && !/No evaluado/.test(osfText));
  const osfSummary = await page.getByTestId("prereport-summary").innerText();
  check("OSF: hay fichas lumbares con mediciones e imágenes con trazos", /[1-9]\d* ficha/.test(osfSummary) && /[1-9]\d* imagen/.test(osfSummary), osfSummary);
  check("OSF: las imágenes con trazos cargaron", await allImagesLoaded());
  check("OSF: cada medición con trazo dice su serie, su corte (base 1) y su procedencia (IA)", /Sagital T\d \(\w+\) · corte \d+/.test(osfText) && /trazo de la IA/.test(osfText));
  await page.screenshot({ path: `${OUT}/04-editor-OSF.png` });
  await page.getByTestId("prereport-observations").fill("Borrador de prueba del flujo (OSF): sin conclusión diagnóstica.");
  await page.getByTestId("prereport-save").click();
  await page.getByTestId("prereport-notice").filter({ hasText: /Borrador guardado/ }).waitFor({ timeout: 20_000 });
  const osfExport = await exportDocument("OSF");
  check("OSF: PDF exportado con imágenes incrustadas", osfExport.images.length > 0 && osfExport.images.every(([w, h, data]) => w > 0 && h > 0 && data));
  await page.getByTestId("prereport-close").click();
  const osfReviewAfter = await reviewOf(osfRun);
  check("OSF: la revisión no cambió", osfReviewAfter.reviewStatus === osfReviewBefore.reviewStatus && osfReviewAfter.corrections.length === osfReviewBefore.corrections.length);

  /* ================================================================== imagen no disponible / región inválida */
  await openStudy(MENDELEY);
  await page.route(/\/api\/ai\/series\/.*\/slices\//, (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(/\/prereport\?runId=/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const draft = body.draft;
    const generated = draft ? draft.generated : body.generated;
    // Región inválida en el primer resultado del nivel L5-S1 (la corrida «declaró» una región fuera de su espacio).
    const target = generated.findings.find((f) => f.level === "L5-S1" && f.type === "disc_bulging");
    target.sources[0].region = null;
    target.sources[0].imagePath = null;
    target.sources[0].regionIssue = "el recuadro de la región cae fuera de su espacio de coordenadas";
    await route.fulfill({ response, json: body });
  });
  await openEditor();
  const failText = await frameText();
  check("imagen no disponible: se conserva el resultado textual y se dice el motivo", /Imagen no disponible/.test(failText) && /Abombamiento discal/.test(failText), failText.slice(failText.indexOf("Imagen no disponible"), failText.indexOf("Imagen no disponible") + 160));
  check("región inválida: se conserva la clasificación sin localización y se informa", /Sin región evaluada/.test(failText) && /región inválida/.test(failText) && /sin localización/.test(failText));
  check("no se sustituye por un corte genérico (no hay imagen de relleno para lo que falló)", (await frame().locator("img").count()) === 0 || /Imagen no disponible/.test(failText));
  const confirmCount = dialogs.length;
  await page.getByTestId("prereport-export-html").click();
  await page.waitForTimeout(2500);
  check("antes de exportar se informa qué evidencia falta", dialogs.length > confirmCount && /falta evidencia visual/.test(dialogs.at(-1)) && /región inválida/.test(dialogs.at(-1)), dialogs.at(-1)?.slice(0, 260));
  await page.screenshot({ path: `${OUT}/05-evidencia-faltante.png` });
  await page.unroute(/\/api\/ai\/series\/.*\/slices\//);
  await page.unroute(/\/prereport\?runId=/);
  await page.getByTestId("prereport-close").click();

  /* ================================================================== permisos */
  const noToken = await fetch(`${API}/api/studies/${MENDELEY}/prereport?runId=${mendeleyRun}`);
  check("permisos: sin token no hay acceso (401)", noToken.status === 401, noToken.status);
  const badRun = await api(`/api/studies/${MENDELEY}/prereport?runId=${osfRun}`);
  check("permisos: una corrida de otro estudio se rechaza (404) y no se elige otra", badRun.status === 404, badRun.status);
  const noRun = await api(`/api/studies/${MENDELEY}/prereport`);
  check("la corrida es obligatoria (400)", noRun.status === 400, noRun.status);

  /* ================================================================== borrador desactualizado (caso aislado) */
  if (!process.env.SKIP_STALE) {
    const caseId = `PREISO-${Date.now() % 100000}`;
    await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Nuevo estudio" }).waitFor();
    const iso = await createIsolatedCorrectionCase(page, { caseId, corrected: 7.3, log: (m) => console.log("  ·", m) });
    await openEditor();
    await page.getByTestId("prereport-observations").fill("Observación sobre el caso aislado.");
    const isoItem = page.locator('[data-testid^="pre-item-m:sagittal-disc-l4-l5-height"]').first();
    if (await isoItem.count()) {
      await isoItem.getByRole("button", { name: "Editar texto" }).click();
      await isoItem.locator("textarea").fill("Altura L4-L5 (texto editado por la profesional).");
    }
    await page.getByTestId("prereport-save").click();
    await page.getByTestId("prereport-notice").filter({ hasText: /Borrador guardado/ }).waitFor({ timeout: 20_000 });
    const isoDraft = (await api(`/api/studies/${caseId}/prereport?runId=${iso.runId}`)).body;
    check("aislado: el borrador refleja la corrección profesional vigente", JSON.stringify(isoDraft.draft.generated.measurements.find((m) => m.id === "sagittal-disc-l4-l5-height")).includes('"corrected":7.3'));
    await page.getByTestId("prereport-close").click();

    // Cambia una corrección (por el flujo existente de Revisión) → el borrador queda basado en datos anteriores.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("aside.rr-panel").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(2500);
    await page.getByRole("tab", { name: "Resultados" }).click();
    await page.getByRole("tab", { name: "Mediciones" }).click();
    await page.locator(".rr-level", { hasText: "L4-L5" }).first().click();
    const heightRow = page.locator(".rr-measure", { hasText: "Altura discal" }).first();
    await heightRow.locator(".rr-measure-input").fill("6.1");
    await page.getByRole("tab", { name: "Revisión" }).click();
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByText(/Borrador guardado correctamente/).first().waitFor({ timeout: 20_000 });
    await page.getByTestId("prepare-prereport").click();
    await page.getByTestId("prereport-editor").waitFor();
    await page.getByTestId("prereport-stale").waitFor({ timeout: 30_000 });
    check("aislado: al cambiar la corrección el borrador se marca «basado en datos anteriores»", true);
    check("aislado: el contenido NO se actualizó solo (sigue la corrección anterior)", /7,3/.test(await frameText()) && !/6,1 mm/.test(await frameText().then((t) => t.split("Anexo A")[0])));
    await page.getByRole("button", { name: /Ver cambios/ }).click();
    const changesText = await page.getByTestId("prereport-changes").innerText();
    check("aislado: se muestran los cambios (antes/ahora)", /6,1/.test(changesText) && /7,3/.test(changesText), changesText.replace(/\s+/g, " "));
    check("aislado: las ediciones siguen intactas mientras está desactualizado", (await page.getByTestId("prereport-observations").inputValue()) === "Observación sobre el caso aislado.");
    await page.screenshot({ path: `${OUT}/06-borrador-desactualizado.png` });
    await page.getByTestId("prereport-update-sources").click();
    await page.getByTestId("prereport-notice").filter({ hasText: /Fuentes actualizadas/ }).waitFor({ timeout: 20_000 });
    check("aislado: la actualización es explícita y conserva las ediciones", (await page.getByTestId("prereport-observations").inputValue()) === "Observación sobre el caso aislado." && (await page.getByTestId("prereport-stale").count()) === 0);
    const after = (await frameText()).split("Anexo A")[0];
    check("aislado: tras actualizar rige el valor corregido actual", /6,1/.test(after));
    const edited = (await api(`/api/studies/${caseId}/prereport?runId=${iso.runId}`)).body.draft;
    check("aislado: la edición de texto sobrevive a la actualización de fuentes", Object.values(edited.edits.text ?? {}).some((v) => /texto editado por la profesional/.test(v)));
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
