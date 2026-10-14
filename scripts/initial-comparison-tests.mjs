import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Comparación entre estudios sobre el análisis inicial real: estado (respuesta tardía), presentación
 * (redondeo solo al mostrar, porcentaje no calculable, lenguaje neutro) y parseo estricto del contrato.
 * Se ejecuta el código real transpilado.
 */
function loadModule(path, exportNames) {
  const source = readFileSync(path, "utf8").replace(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+"[^"]+";\s*/g, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, DOMException };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const state = loadModule("src/features/reading/initialComparisonState.ts", ["initialComparisonReducer", "initialComparisonUiState", "emptyKindOf"]);
const display = loadModule("src/features/reading/initialComparisonDisplay.ts", [
  "formatValue", "formatDelta", "formatPercent", "displayUnit", "displayMetricName", "groupRowsByLevel", "groupExclusions",
  "trendText", "trendArrow", "formatStudyDate", "formatRunMoment", "shortRunId", "describeAnalysis", "DIFFERENCE_NOTE", "COMPARISON_SOURCE_LINE", "EMPTY_TEXT",
  "patientLinkText",
]);
const api = loadModule("src/initialAnalysisComparisonApi.ts", ["parseInitialComparisonResult", "parseInitialComparisonCandidates", "InitialComparisonContractError"]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const json = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

const side = (caseId, runId, usable = 5) => ({
  caseId, studyDate: "2026-04-01", runId, runCreatedAt: "2026-10-08T02:33:41Z", runStatus: "completed", reviewStatus: "pendiente",
  modelKey: "sagittal_spider", sagittalSequence: "t2", usableMeasurementCount: usable, patientLink: "patient_id",
});
const value = (id, effective, original = effective, corrected = null) => ({ measurementId: id, effectiveValue: effective, originalValue: original, correctedValue: corrected, corrected: corrected !== null, sliceIndex: 7 });
const row = (over = {}) => ({
  level: "L4-L5", structure: "disc", metric: "height", plane: "sagittal", unit: "mm", experimental: false,
  reference: value("r", 5.79), current: value("c", 7.3), deltaAbsolute: 1.51, deltaPercent: 26.079447322970638, percentStatus: "ok", trend: "increased", ...over,
});
const result = (referenceCaseId, rows = [row()]) => ({
  schemaVersion: "pfi.initial-analysis-comparison.v1", source: "initial_analysis", differenceDefinition: "diferencia = estudio abierto − referencia",
  current: side("cur", "run-cur"), reference: side(referenceCaseId, `run-${referenceCaseId}`),
  summary: { comparedCount: rows.length, excludedCount: 0, currentMeasurementCount: rows.length, referenceMeasurementCount: rows.length },
  comparisons: rows, excluded: [], limitations: ["a"],
});

/* ------------------------------------------------------------------ respuesta tardía */

const reduce = (s, a) => state.initialComparisonReducer(s, a);

check("una respuesta tardía de la referencia anterior no pisa a la actual", () => {
  let s = reduce(state.initialComparisonUiState, { type: "candidates_loaded", candidates: { current: side("cur", "r"), candidates: [], runSelectionRule: "x" } });
  s = reduce(s, { type: "comparison_requested", caseId: "A", requestId: 1 });
  s = reduce(s, { type: "comparison_requested", caseId: "B", requestId: 2 });
  const afterLateA = reduce(s, { type: "comparison_loaded", requestId: 1, result: result("A") });
  assert.equal(afterLateA.comparison, null, "la respuesta de A llegó tarde y se descarta");
  assert.equal(afterLateA.phase, "loading_comparison");
  const afterB = reduce(afterLateA, { type: "comparison_loaded", requestId: 2, result: result("B") });
  assert.equal(afterB.comparison.reference.caseId, "B");
  assert.equal(afterB.phase, "ready");
  // y una A tardía llegando DESPUÉS de B tampoco la reemplaza
  const afterLateAgain = reduce(afterB, { type: "comparison_loaded", requestId: 1, result: result("A") });
  assert.equal(afterLateAgain.comparison.reference.caseId, "B");
});

check("una respuesta cuyo estudio no es el elegido se descarta aunque el número coincida", () => {
  let s = reduce(state.initialComparisonUiState, { type: "comparison_requested", caseId: "A", requestId: 3 });
  s = reduce(s, { type: "comparison_loaded", requestId: 3, result: result("OTRA") });
  assert.equal(s.comparison, null);
});

check("un error tardío de una elección anterior no reemplaza a la actual", () => {
  let s = reduce(state.initialComparisonUiState, { type: "comparison_requested", caseId: "A", requestId: 1 });
  s = reduce(s, { type: "comparison_requested", caseId: "B", requestId: 2 });
  s = reduce(s, { type: "comparison_failed", requestId: 1, error: { code: "X", message: "tarde" } });
  assert.equal(s.comparisonError, null);
  assert.equal(s.phase, "loading_comparison");
  s = reduce(s, { type: "comparison_failed", requestId: 2, error: { code: "X", message: "actual" } });
  assert.equal(s.comparisonError.message, "actual");
  assert.equal(s.phase, "ready");
});

check("quitar la elección descarta lo que todavía viaja", () => {
  let s = reduce(state.initialComparisonUiState, { type: "comparison_requested", caseId: "A", requestId: 1 });
  s = reduce(s, { type: "selection_cleared" });
  s = reduce(s, { type: "comparison_loaded", requestId: 1, result: result("A") });
  assert.equal(s.comparison, null);
  assert.equal(s.selectedCaseId, null);
});

check("elegir una referencia limpia el resultado anterior (no se ve el viejo mientras carga el nuevo)", () => {
  let s = reduce(state.initialComparisonUiState, { type: "comparison_requested", caseId: "A", requestId: 1 });
  s = reduce(s, { type: "comparison_loaded", requestId: 1, result: result("A") });
  s = reduce(s, { type: "comparison_requested", caseId: "B", requestId: 2 });
  assert.equal(s.comparison, null);
});

/* ------------------------------------------------------------------------- estados vacíos */

const candidates = (usable, list) => ({ current: side("cur", "r", usable), candidates: list, runSelectionRule: "x" });
const candidate = (id, eligible) => ({ caseId: id, studyDate: null, runId: "r", runCreatedAt: null, usableMeasurementCount: eligible ? 3 : 0, eligible, reasonCode: null, reason: null, patientLink: "patient_id" });

check("tres situaciones vacías distintas: sin mediciones propias, sin otros estudios y sin candidatos utilizables", () => {
  assert.equal(state.emptyKindOf(null), null);
  assert.equal(state.emptyKindOf(candidates(0, [candidate("a", true)])), "current_without_measurements");
  assert.equal(state.emptyKindOf(candidates(4, [])), "no_other_studies");
  assert.equal(state.emptyKindOf(candidates(4, [candidate("a", false), candidate("b", false)])), "no_usable_candidates");
  assert.equal(state.emptyKindOf(candidates(4, [candidate("a", false), candidate("b", true)])), null);
  const titles = new Set(Object.values(json(display.EMPTY_TEXT)).map((entry) => entry.title));
  assert.equal(titles.size, 4, "cuatro mensajes, todos distintos (incluye 'sin coincidencias comparables')");
});

/* ------------------------------------------------------------------------- presentación */

check("se redondea solo al mostrar: el valor completo queda intacto", () => {
  assert.equal(display.formatValue(5.789999), "5.79");
  assert.equal(display.formatDelta(1.5100000000000007), "+1.51");
  assert.equal(display.formatDelta(-6.81), "−6.81");
  assert.equal(display.formatDelta(-0.004), "0.00", "lo que redondea a cero no lleva signo");
  assert.equal(display.formatDelta(0), "0.00");
  assert.equal(display.formatPercent({ deltaPercent: 26.079447322970638, percentStatus: "ok" }), "+26.1 %");
  assert.equal(display.formatPercent({ deltaPercent: -3.04, percentStatus: "ok" }), "−3.0 %");
});

check("con referencia cero el porcentaje es 'No calculable', nunca 0 % ni infinito", () => {
  assert.equal(display.formatPercent({ deltaPercent: null, percentStatus: "not_computable_reference_zero" }), "No calculable");
  assert.equal(display.formatPercent({ deltaPercent: 12, percentStatus: "not_computable_reference_zero" }), "No calculable");
});

check("el lenguaje describe el valor y no una evolución clínica", () => {
  assert.equal(display.trendText("increased"), "Aumentó");
  assert.equal(display.trendText("decreased"), "Disminuyó");
  assert.equal(display.trendText("unchanged"), "Sin cambio");
  const language = JSON.stringify([display.trendText("increased"), display.trendText("decreased"), display.DIFFERENCE_NOTE]);
  assert.ok(!/mejor[óo]|empeor[óo]|progresi|regresi/i.test(language.replace(/no indican mejoría ni empeoramiento clínico/, "")));
  assert.match(display.DIFFERENCE_NOTE, /estudio abierto − referencia/);
  assert.match(display.DIFFERENCE_NOTE, /no indican mejoría ni empeoramiento clínico/);
});

check("la fuente se declara como análisis inicial real y no el de demostración", () => {
  assert.match(display.COMPARISON_SOURCE_LINE, /análisis inicial real/);
  assert.match(display.COMPARISON_SOURCE_LINE, /No usa el análisis de demostración/);
});

check("unidades y nombres de métricas legibles", () => {
  assert.equal(display.displayUnit("mm2"), "mm²");
  assert.equal(display.displayUnit("deg"), "°");
  assert.equal(display.displayMetricName("disc", "height"), "Altura discal");
  assert.equal(display.displayMetricName("canal", "ap_diameter"), "Diámetro AP del canal");
  assert.equal(display.displayMetricName("rare", "thing"), "rare thing");
});

check("las filas se agrupan por nivel conservando el orden del Backend", () => {
  const groups = json(display.groupRowsByLevel([row({ level: "L1-L2" }), row({ level: "L1-L2", metric: "width" }), row({ level: "L4-L5" })]));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].level, "L1-L2");
  assert.equal(groups[0].rows.length, 2);
});

check("las exclusiones se agrupan por motivo, de la más frecuente a la menos", () => {
  const items = ["axial_unmapped", "axial_unmapped", "missing_in_other"].map((code) => ({ side: "current", level: null, plane: null, metricKey: null, measurementIds: [], reasonCode: code, reason: code }));
  const groups = json(display.groupExclusions(items));
  assert.equal(groups[0].reasonCode, "axial_unmapped");
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].title, "Plano axial sin estructura asignada");
});

check("fechas y corrida se muestran con fecha e identificador, sin desfase de zona horaria", () => {
  assert.equal(display.formatStudyDate("2026-04-01"), "01/04/2026");
  assert.equal(display.formatStudyDate(null), "Fecha no informada");
  assert.equal(display.formatRunMoment("2026-10-08T02:33:41.020538Z"), "08/10/2026 02:33");
  assert.equal(display.shortRunId("multi-4b8b98e6619f08c9831d"), "multi-…c9831d");
  assert.equal(display.shortRunId(null), "sin análisis");
  assert.match(display.describeAnalysis(side("a", "multi-4b8b98e6619f08c9831d")), /análisis multi-…c9831d del 08\/10\/2026 02:33/);
});

check("se explica en qué se basa el vínculo del paciente", () => {
  assert.match(display.patientLinkText("patient_id"), /identificador de paciente/);
  assert.match(display.patientLinkText("subject_ref_historical"), /asociación histórica/);
});

/* ------------------------------------------------------------------------------ parseo */

check("el contrato válido se parsea y conserva el original junto al corregido", () => {
  const parsed = json(api.parseInitialComparisonResult(result("ref", [row({ current: value("c", 7.3, 5.79, 7.3) })])));
  assert.equal(parsed.comparisons[0].current.corrected, true);
  assert.equal(parsed.comparisons[0].current.originalValue, 5.79);
  assert.equal(parsed.comparisons[0].current.effectiveValue, 7.3);
});

check("un valor ausente no se completa con cero: el contrato roto se rechaza", () => {
  const broken = result("ref");
  delete broken.comparisons[0].reference.effectiveValue;
  assert.throws(() => api.parseInitialComparisonResult(broken), /effectiveValue/);
  const noDelta = result("ref");
  noDelta.comparisons[0].deltaAbsolute = null;
  assert.throws(() => api.parseInitialComparisonResult(noDelta), /deltaAbsolute/);
});

check("porcentaje y estado deben ser coherentes", () => {
  const inconsistent = result("ref", [row({ deltaPercent: null, percentStatus: "ok" })]);
  assert.throws(() => api.parseInitialComparisonResult(inconsistent), /deltaPercent/);
  const zero = result("ref", [row({ reference: value("r", 0), deltaPercent: 12, percentStatus: "not_computable_reference_zero" })]);
  assert.throws(() => api.parseInitialComparisonResult(zero), /deltaPercent/);
  const valid = json(api.parseInitialComparisonResult(result("ref", [row({ reference: value("r", 0), deltaPercent: null, percentStatus: "not_computable_reference_zero" })])));
  assert.equal(valid.comparisons[0].deltaPercent, null);
});

check("solo se acepta la fuente del análisis inicial", () => {
  const wrong = result("ref");
  wrong.source = "product_analysis";
  assert.throws(() => api.parseInitialComparisonResult(wrong), /source/);
});

check("los candidatos se parsean y exigen su vínculo con el paciente", () => {
  const ok = json(api.parseInitialComparisonCandidates({
    schemaVersion: "pfi.initial-analysis-comparison.v1", current: side("cur", "r"), runSelectionRule: "regla",
    candidates: [candidate("a", true)],
  }));
  assert.equal(ok.candidates[0].patientLink, "patient_id");
  assert.throws(() => api.parseInitialComparisonCandidates({ schemaVersion: "x", current: side("cur", "r"), runSelectionRule: "r", candidates: [{ ...candidate("a", true), patientLink: "otro" }] }), /patientLink/);
});

check("el cliente no dispara análisis: solo GET de lectura", () => {
  const source = readFileSync("src/initialAnalysisComparisonApi.ts", "utf8");
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /product-analysis|multiplanar\/run|longitudinal-comparison/);
  assert.match(source, /initial-analysis-comparison/);
});

console.log(`Initial comparison tests passed: ${passed}`);
