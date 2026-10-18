import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Preinforme visual: selección, resumen, agrupación de imágenes, evidencia faltante, recorte sin deformar y contenido del
 * documento. Se ejecuta el código real transpilado, con fixtures de contrato (no son resultados de ningún estudio).
 */
function load(paths, exportNames) {
  const source = paths
    .map((path) => readFileSync(path, "utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/export \{[^}]*\};?/g, "").replace(/export /g, ""))
    .join("\n");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, Date, Math, Number, JSON, Object, Array, String, Map, Set, Infinity, Intl };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const m = load(["src/features/prereport/prereportModel.ts"], [
  "isIncluded", "levelIncluded", "effectiveText", "isEdited", "withInclude", "withText", "withLevelNote", "withObservations", "sameEdits",
  "selectedLevels", "includedResearch", "summaryMatrix", "evidenceBlocks", "missingEvidence", "documentSummary", "annexMeasurements",
  "formatNumber", "formatValue", "formatPercent", "DRAFT_BANNER", "levelKey",
]);
const html = load(["src/features/prereport/prereportModel.ts", "src/features/prereport/prereportHtml.ts"], ["buildPreReportHtml", "DRAFT_BANNER"]);
const img = load(["src/features/prereport/prereportImages.ts"], ["zoomCropFor"]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

/* ------------------------------------------------------------------ fixtures */
const region = (inputId, slice, w = 384) => ({ inputId, sliceIndex: slice, point: { x: 228.5, y: 93 }, bbox: { x0: 205, y0: 87, x1: 252, y1: 99 }, width: w, height: w });
const finding = (level, type, label, over = {}) => ({
  key: `f:${level}-${type}`, findingId: `${level}-${type}`, level, type, typeLabel: { disc_bulging: "Abombamiento discal", disc_narrowing: "Estrechamiento discal", pfirrmann_grade: "Grado de Pfirrmann", spondylolisthesis: "Espondilolistesis" }[type] ?? type,
  label, className: label === "present" ? "presente" : label === "absent" ? "ausente" : `grado ${label}`, confidence: 0.7044, classProbabilities: null,
  deploymentStatus: "supported_internal", section: "principal", positive: label === "present", evaluationDataset: "SPIDER_internal_test", externalValidation: false, modalities: ["T1", "T2"],
  text: `${type}: predicción del modelo «${label}» (70,4 %)`, defaultInclude: label === "present", sources: [
    { role: "sagittal_t2", roleLabel: "Sagital T2", available: true, regionIssue: null, region: region("inp-t2", 9), imagePath: "/api/ai/series/inp-t2/slices/9" },
    { role: "sagittal_t1", roleLabel: "Sagital T1", available: true, regionIssue: null, region: region("inp-t1", 7, 320), imagePath: "/api/ai/series/inp-t1/slices/7" },
  ], ...over,
});
const measurement = (id, level, labelKey, label, value, over = {}) => ({
  key: `m:${id}`, id, plane: "sagittal", labelKey, label, level, levelScope: "level", unit: labelKey.includes("area") ? "mm2" : "mm", original: value, corrected: null, effective: value, origin: "ia", experimental: false,
  sliceIndex: 7, invalidReason: null, text: `${label}: ${value} · IA`, defaultInclude: true,
  trace: { status: "located", reason: null, kind: "segment", points: [[140, 190], [134, 178]], origin: "ia", space: { name: "model_256x256", width: 256, height: 256 } },
  imagePath: "/api/ai/assets/plane-1/sagittal/input.png", ...over,
});
function model(over = {}) {
  const findings = [finding("L5-S1", "disc_bulging", "present"), finding("L4-L5", "disc_bulging", "absent"), finding("L5-S1", "pfirrmann_grade", "II", { section: "experimental", defaultInclude: true, positive: false }),
    finding("L5-S1", "spondylolisthesis", "present", { section: "investigacion", deploymentStatus: "not_product_supported", defaultInclude: false })];
  const measurements = [measurement("h5", "L5-S1", "disc height", "altura del disco", 13.43), measurement("a5", "L5-S1", "disc area", "área del disco", 312.23, { imagePath: null, trace: { status: "slice_only", reason: "La medición no tiene un trazo guardado.", kind: "none", points: [], origin: null, space: { name: null, width: null, height: null } } }),
    measurement("h4", "L4-L5", "disc height", "altura del disco", 9.31, { defaultInclude: false }), measurement("v", null, "canal area", "área del canal", 2975.1, { level: null, defaultInclude: false, imagePath: null })];
  return {
    schema: "pfi.prereport.v1",
    study: { caseId: "MEN-1", subjectRef: null, studyDate: null, modality: null, clinical: { ageAtStudy: null, ageProvenance: null, reason: null, symptoms: null, symptomDuration: null, relevantHistory: null } },
    run: { runId: "run-1", status: "completed", modelKey: "sagittal_spider", inferenceMode: "real_baseline", reviewStatus: "pending" },
    measurements, findings, findingsStatus: "available", annotations: [],
    levels: ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"].map((level) => ({ level, lumbar: true, evaluated: findings.some((f) => f.level === level) || measurements.some((x) => x.level === level),
      measurementKeys: measurements.filter((x) => x.level === level).map((x) => x.key), findingKeys: findings.filter((f) => f.level === level).map((f) => f.key), defaultCard: level === "L5-S1" })),
    series: [{ inputId: "inp-t2", plane: "sagittal", sequence: "T2", sequenceSource: "detectada", sliceCount: 15, analyzed: true, description: null, label: "Sagital T2" },
      { inputId: "inp-t1", plane: "sagittal", sequence: "T1", sequenceSource: "detectada", sliceCount: 15, analyzed: false, description: null, label: "Sagital T1" }],
    coverage: { measurementsTotal: 4, measurementsUsable: 4, measurementsWithTrace: 2, measurementsCorrected: 0, findingsTotal: 4, findingsPositiveMain: 1, findingsRejected: 0 },
    omitted: [{ kind: "research_findings", what: "1 resultado(s) de investigación", reason: "Quedan fuera del cuerpo salvo que el profesional los incluya." }],
    limitations: ["Requiere revisión profesional y no constituye un diagnóstico."],
    ...over,
  };
}
const readyImage = { status: "ready", image: { full: "data:image/jpeg;base64,AAAA", zoom: "data:image/jpeg;base64,BBBB", width: 256, height: 256, params: {} } };
const meta = { generatedAt: "2026-10-17T12:00:00Z", draftVersion: 2, fingerprint: "src-abc", stale: false };

/* ------------------------------------------------------------------ pruebas */

check("la ficha por defecto es la del nivel con predicción positiva; las exclusiones no borran nada", () => {
  const g = model();
  assert.deepEqual(m.selectedLevels(g, {}).map((s) => s.level), ["L5-S1"]);
  assert.equal(m.levelIncluded(g, {}, "L4-L5"), false);
  const edits = m.withInclude({}, m.levelKey("L4-L5"), true);
  assert.deepEqual(m.selectedLevels(g, edits).map((s) => s.level), ["L4-L5", "L5-S1"].sort());
  // Excluir una medición del documento es una decisión de este borrador: el modelo generado sigue teniéndola.
  const without = m.withInclude({}, "m:h5", false);
  assert.equal(m.selectedLevels(g, without)[0].measurements.some((x) => x.id === "h5"), false);
  assert.equal(g.measurements.some((x) => x.id === "h5"), true);
});

check("los resultados de investigación quedan fuera del cuerpo y, si se incluyen, van en un apartado aparte", () => {
  const g = model();
  assert.equal(m.selectedLevels(g, {})[0].findings.some((f) => f.type === "spondylolisthesis"), false);
  assert.equal(m.includedResearch(g, {}).length, 0);
  const edits = m.withInclude({}, "f:L5-S1-spondylolisthesis", true);
  assert.equal(m.includedResearch(g, edits).length, 1);
  assert.equal(m.selectedLevels(g, edits)[0].findings.some((f) => f.type === "spondylolisthesis"), false, "nunca mezclado en la ficha");
  const doc = html.buildPreReportHtml(g, edits, {}, meta);
  assert.match(doc, /<h3>Resultados de investigación<\/h3>/);
  assert.match(doc, /No son una capacidad soportada para producto/);
});

check("texto generado y texto editado se manejan por separado; igualar lo generado no es una edición", () => {
  const generated = "Altura del disco: 13,4 mm · IA";
  const edits = m.withText({}, "m:h5", "Texto de la profesional", generated);
  assert.equal(m.effectiveText(edits, "m:h5", generated), "Texto de la profesional");
  assert.equal(m.isEdited(edits, "m:h5", generated), true);
  const restored = m.withText(edits, "m:h5", generated, generated);
  assert.equal(m.isEdited(restored, "m:h5", generated), false);
  assert.equal(m.effectiveText(restored, "m:h5", generated), generated);
  assert.equal(m.sameEdits({ text: {} }, {}), true);
  assert.equal(m.sameEdits(m.withObservations({}, "x"), {}), false);
});

check("el resumen compacto muestra negativos y no evaluados; sin P10.7 no inventa negativos", () => {
  const rows = m.summaryMatrix(model());
  const l5 = rows.find((r) => r.level === "L5-S1");
  assert.equal(l5.cells.disc_bulging.state, "present");
  assert.match(l5.cells.pfirrmann_grade.text, /grado II/);
  assert.equal(l5.cells.disc_narrowing.state, "not_evaluated");
  assert.equal(rows.find((r) => r.level === "L4-L5").cells.disc_bulging.state, "absent");
  const none = html.buildPreReportHtml(model({ findings: [], findingsStatus: "none", levels: model().levels.map((l) => ({ ...l, findingKeys: [] })) }), {}, {}, meta);
  assert.match(none, /no tiene resultados P10\.7 persistidos\. Eso no equivale a que ninguna categoría esté ausente/);
  assert.doesNotMatch(none, /class="matrix"/, "sin P10.7 no hay matriz que parezca un resultado negativo");
});

check("las imágenes se agrupan por nivel e imagen: un bloque de trazos y un bloque por corte de región", () => {
  const g = model();
  const selection = m.selectedLevels(g, {})[0];
  const blocks = m.evidenceBlocks(g, {}, selection);
  assert.equal(blocks.filter((b) => b.kind === "trace").length, 1);
  assert.equal(blocks.filter((b) => b.kind === "region").length, 2, "T2 corte 10 y T1 corte 8, cada una una vez");
  const trace = blocks.find((b) => b.kind === "trace");
  assert.equal(trace.traces.length, 1, "la medición sin trazo no entra");
  assert.equal(trace.sliceNumber, 8, "corte en base 1");
  const t2 = blocks.find((b) => b.imagePath.endsWith("/inp-t2/slices/9"));
  assert.equal(t2.sliceNumber, 10);
  assert.equal(t2.sliceTotal, 15);
  assert.match(t2.seriesLabel, /Sagital T2/);
  // Quitar una imagen no quita el resultado.
  const off = m.withInclude({}, t2.id, false);
  assert.equal(m.evidenceBlocks(g, off, selection).length, 2);
  assert.equal(m.evidenceBlocks(g, off, selection, { all: true }).length, 3);
  assert.equal(m.selectedLevels(g, off)[0].findings.length, 2);
});

check("trazos y región P10.7 NUNCA van en una misma imagen, aunque coincidan en el corte: una imagen por fuente", () => {
  const g = model();
  for (const f of g.findings.filter((x) => x.level === "L5-S1")) f.sources[0].imagePath = "/api/ai/assets/plane-1/sagittal/input.png";
  const blocks = m.evidenceBlocks(g, {}, m.selectedLevels(g, {})[0]);
  assert.equal(blocks.length, 3, "trazos (análisis inicial) + región T2 + región T1");
  assert.ok(blocks.every((b) => b.kind === "trace" ? b.regions.length === 0 : b.traces.length === 0), "ningún bloque mezcla fuentes");
  const sameSlice = blocks.filter((b) => b.imagePath === "/api/ai/assets/plane-1/sagittal/input.png");
  assert.equal(sameSlice.length, 2, "el mismo corte aparece una vez por fuente");
  const doc = html.buildPreReportHtml(g, {}, Object.fromEntries(blocks.map((b) => [b.id, readyImage])), meta);
  assert.match(doc, /Fuente: análisis inicial/);
  assert.match(doc, /Fuente: P10\.7/);
  assert.doesNotMatch(doc, /trazos de las mediciones y región evaluada/);
  assert.equal((doc.match(/<img /g) ?? []).length, 6);
});

check("una ficha con mediciones y predicciones declara la correspondencia pendiente de verificación", () => {
  const g = model();
  const doc = html.buildPreReportHtml(g, {}, {}, meta);
  assert.match(doc, /Correspondencia pendiente de verificación/);
  assert.match(doc, /No se presentan como evidencia de un mismo disco/);
  assert.match(doc, /Mediciones del análisis inicial/);
  assert.match(doc, /Predicciones del modelo \(P10\.7\)/);
});

check("la evidencia faltante se informa: región inválida, sin región y medición sin trazo", () => {
  const bad = model();
  bad.findings[0].sources[0] = { ...bad.findings[0].sources[0], region: null, imagePath: null, regionIssue: "el recuadro de la región cae fuera de su espacio de coordenadas" };
  const missing = m.missingEvidence(bad, {});
  assert.ok(missing.some((x) => /Abombamiento discal \(Sagital T2\)/.test(x.what) && /región inválida/.test(x.reason)), JSON.stringify(missing));
  assert.ok(missing.some((x) => /área del disco/.test(x.what) && /trazo/.test(x.reason)));
  const doc = html.buildPreReportHtml(bad, {}, { "img:trace:L5-S1:/api/ai/assets/plane-1/sagittal/input.png": readyImage }, meta);
  assert.match(doc, /Sin región evaluada/);
  assert.match(doc, /se conserva la clasificación sin localización/);
  assert.match(doc, /Evidencia no disponible · /, "el anexo la lista");
});

check("una imagen que falla conserva el resultado textual y dice el motivo; nunca se sustituye por otro corte", () => {
  const g = model();
  const selection = m.selectedLevels(g, {})[0];
  const blocks = m.evidenceBlocks(g, {}, selection);
  const states = Object.fromEntries(blocks.map((b) => [b.id, { status: "failed", error: "backend respondio 404" }]));
  const doc = html.buildPreReportHtml(g, {}, states, meta);
  assert.match(doc, /Imagen no disponible/);
  assert.match(doc, /backend respondio 404/);
  assert.match(doc, /Abombamiento discal: predicción del modelo|disc_bulging: predicción del modelo/);
  assert.doesNotMatch(doc, /<img /);
});

check("el documento dice borrador, separa fechas, no inventa datos y no muestra códigos internos en el encabezado", () => {
  const doc = html.buildPreReportHtml(model(), {}, {}, meta);
  const head = doc.slice(doc.indexOf("<header>"), doc.indexOf("</header>"));
  assert.match(doc, /Preinforme · Borrador pendiente de revisión profesional/);
  assert.match(head, /Fecha del estudio<\/dt><dd>No informada/);
  assert.match(head, /Fecha de generación/);
  assert.match(head, /Edad al estudio<\/dt><dd>No informada/);
  assert.match(head, /Contexto clínico<\/dt><dd class="muted">No informado/);
  assert.doesNotMatch(head, /real_baseline|run-1|sagittal_spider/);
  assert.match(doc, /real_baseline/, "el modo de inferencia está solo en la trazabilidad del anexo");
  assert.match(doc, /@page/);
  assert.match(doc, /counter\(page\)/);
  assert.match(doc, /thead \{ display: table-header-group; \}/);
  assert.doesNotMatch(doc, /about:blank/);
});

check("sin veredictos de rango, sin «atípicos», sin frases de normalidad ni diagnóstico, y «sin corrección» no se llama «sin cambios»", () => {
  const doc = html.buildPreReportHtml(model(), m.withInclude({}, m.levelKey("L4-L5"), true), {}, meta);
  for (const forbidden of [/atípic/i, /dentro del rango/i, /fuera de rango/i, /por debajo del rango/i, /sin cambios/i, /normal/i, /compatible con/i, /diagnóstico de/i]) {
    assert.doesNotMatch(doc.replace("no constituye un diagnóstico", "").replace(/no constituye diagnóstico/g, ""), forbidden, String(forbidden));
  }
  assert.match(doc, /No registrada/, "la ausencia de corrección se dice como «No registrada»");
  assert.match(doc, /no indica que alguien haya revisado el valor/);
});

check("procedencia IA / corrección profesional y trazo original: una corrección numérica no cambia el trazo", () => {
  const g = model();
  g.measurements[0] = { ...g.measurements[0], corrected: 12, effective: 12, origin: "profesional", text: "Altura del disco: 12,0 mm · corrección profesional (IA: 13,4 mm)" };
  const doc = html.buildPreReportHtml(g, {}, {}, meta);
  assert.match(doc, /Corrección profesional \(IA: 13,4 mm\)/);
  const block = m.evidenceBlocks(g, {}, m.selectedLevels(g, {})[0]).find((b) => b.kind === "trace");
  assert.equal(block.traces[0].origin, "ia", "el trazo sigue siendo el de la IA");
  assert.match(block.traces[0].label, /12,0 mm/);
});

check("la ficha reúne nivel, texto e imagen en un bloque que no se corta al paginar", () => {
  const g = model();
  const states = Object.fromEntries(m.evidenceBlocks(g, {}, m.selectedLevels(g, {})[0]).map((b) => [b.id, readyImage]));
  const doc = html.buildPreReportHtml(g, {}, states, meta);
  assert.match(doc, /\.ficha-block \{ break-inside: avoid;/);
  assert.match(doc, /continuación/, "el segundo bloque de imágenes repite el nivel");
  assert.equal((doc.match(/<img /g) ?? []).length, 6, "tres imágenes × (completa + ampliación)");
  assert.match(doc, /Región evaluada por el modelo \(no delimita una lesión\)/);
  assert.match(doc, /Ampliación de la misma zona, sin deformar/);
});

check("el borrador desactualizado se rotula y el documento nunca se actualiza solo", () => {
  const doc = html.buildPreReportHtml(model(), {}, {}, { ...meta, stale: true });
  assert.match(doc, /Basado en datos anteriores/);
  assert.match(doc, /El contenido no se actualizó/);
});

check("las observaciones del profesional son solo texto del profesional", () => {
  const empty = html.buildPreReportHtml(model(), {}, {}, meta);
  assert.match(empty, /Sin observaciones registradas\. Este documento no contiene una conclusión diagnóstica generada automáticamente/);
  const edits = m.withLevelNote(m.withObservations({}, "Correlacionar con la clínica.\n<script>alert(1)</script>"), "L5-S1", "Nota del nivel");
  const doc = html.buildPreReportHtml(model(), edits, {}, meta);
  assert.match(doc, /Correlacionar con la clínica\.<br>&lt;script&gt;/);
  assert.doesNotMatch(doc, /<script>alert/);
  assert.match(doc, /Nota del nivel/);
});

check("el recorte de la ampliación conserva la proporción de la imagen y queda dentro de ella", () => {
  for (const [w, h] of [[256, 256], [384, 384], [512, 320], [320, 512]]) {
    const crop = img.zoomCropFor({ minX: 100, minY: 120, maxX: 140, maxY: 150 }, w, h);
    assert.ok(Math.abs(crop.w / crop.h - w / h) < 0.01, `proporción ${w}x${h}`);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= w + 0.01 && crop.y + crop.h <= h + 0.01, `límites ${w}x${h}`);
    assert.ok(crop.x <= 100 && crop.x + crop.w >= 140, "contiene la evidencia");
  }
  const edge = img.zoomCropFor({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 256, 256);
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 0);
  const wide = img.zoomCropFor({ minX: 0, minY: 0, maxX: 256, maxY: 256 }, 256, 256);
  assert.equal(wide.w, 256);
});

check("formato consistente: es-AR, un decimal, unidades legibles", () => {
  assert.equal(m.formatNumber(13.43), "13,4");
  assert.equal(m.formatValue(312.23, "mm2"), "312,2 mm²");
  assert.equal(m.formatValue(4.2, "deg"), "4,2°");
  assert.equal(m.formatValue(null, "mm"), "—");
  assert.equal(m.formatPercent(0.7044), "70,4 %");
});

console.log(`Preinforme visual: ${passed} pruebas pasaron`);
