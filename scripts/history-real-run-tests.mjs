import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Historial del paciente y panel de estudio: datos de la corrida REAL.
 *  - el contrato del backend entrega `labelKey` (no `label`): las mediciones ya no se descartan;
 *  - el estado del análisis distingue sin análisis / en curso / fallido / resultados, sin usar productAnalysis;
 *  - un conteo ausente se dice «no informado» y nunca se vuelve 0;
 *  - las mediciones son las de UNA corrida (no se suman corridas);
 *  - revisor, fecha y cortes salen de la corrida, y un dato ausente se dice «No informado».
 */
const root = process.cwd();
function load(path, names, extra = {}) {
  const source = readFileSync(join(root, path), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, URLSearchParams, ...extra };
  vm.runInNewContext(`${js}\n${names.map((n) => `exports.${n} = ${n};`).join("\n")}`, sandbox);
  return sandbox.exports;
}
class ApiError extends Error {}
class ContractError extends Error {
  constructor(message, path, options = {}) {
    super(message);
    Object.assign(this, options);
  }
}
const history = load("src/subjectHistoryApi.ts", ["normalizeSubjectHistoryResponse"], {
  API_BASE_URL: "x",
  authHeaders: () => ({}),
  validateVisibleDataOrigin: () => undefined,
  applyCorrectionsToMeasurements: (m) => m,
  normalizePersistedCorrection: () => null,
  resolveMeasurementLabel: (item) => (typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.labelKey),
  generateTraceId: () => "t",
  refreshDoctorSession: async () => undefined,
  toSafeFrontendError: () => ({ message: "e" }),
  ApiError,
  ContractError,
});
const analysis = load("src/features/history/historyAnalysis.ts", ["analysisOf", "studiesWithResults", "formatDateTime", "shortRunId", "measurementCountLabel"]);
const facts = load("src/features/worklist/studyPanelFacts.ts", ["reviewerFact", "lastReviewFact", "sliceCountFact", "formatReviewDate"]);

let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}
const j = (v) => JSON.parse(JSON.stringify(v));

// payload con la forma real del backend (PatientHistoryService)
const backendMeasurement = (id, key, level) => ({ id, unit: "mm", level, plane: "sagittal", value: 12.5, source: "AI", status: "pending_review", aiValue: 12.5, labelKey: key, experimental: false });
function payload(studyOverrides = {}) {
  return {
    status: "ok",
    source: "postgres-domain",
    dataOrigin: "database",
    deidentified: true,
    subjectRef: "OSF-ID10",
    summary: { totalStudies: 1 },
    studies: [{
      caseId: "OSF-ID10-V2-T1",
      subjectRef: "OSF-ID10",
      studyDate: null,
      modality: null,
      planes: ["sagittal"],
      modelKey: "sagittal_spider",
      reviewStatus: "aceptado",
      reviewer: "Dra. Demo Reviewer",
      reviewedAt: "2026-10-18T01:50:50Z",
      priority: "media",
      latestRunId: "multi-1beddd775e6cfb778187",
      measurementsByPlane: { sagittal: [backendMeasurement("sagittal-disc-t10-t11-area", "disc area", "T10-T11"), backendMeasurement("sagittal-disc-t10-t11-height", "disc height", "T10-T11"), backendMeasurement("x-3", "disc width", "T10-T11")] },
      corrections: [],
      productAnalysis: null,
      latestRun: { runId: "multi-1beddd775e6cfb778187", status: "completed", createdAt: "2026-10-14T19:59:52Z", planes: ["sagittal"], measurementCount: 3, correctedMeasurementCount: 0 },
      ...studyOverrides,
    }],
  };
}

test("las mediciones con labelKey (contrato real) ya no se descartan", () => {
  const study = history.normalizeSubjectHistoryResponse(payload(), "OSF-ID10").studies[0];
  assert.equal(study.measurementsByPlane.sagittal.length, 3);
  assert.equal(study.measurementsByPlane.sagittal[0].label, "disc area");
});

test("latestRun se normaliza con su conteo y sin tocar productAnalysis (null)", () => {
  const study = history.normalizeSubjectHistoryResponse(payload(), "OSF-ID10").studies[0];
  assert.equal(study.productAnalysis, null);
  assert.deepEqual(j(study.latestRun), { runId: "multi-1beddd775e6cfb778187", status: "completed", createdAt: "2026-10-14T19:59:52Z", planes: ["sagittal"], measurementCount: 3, correctedMeasurementCount: 0 });
});

test("estudio con corrida real completada: «Resultados disponibles» y NO «sin análisis»", () => {
  const study = history.normalizeSubjectHistoryResponse(payload(), "OSF-ID10").studies[0];
  const a = analysis.analysisOf(study);
  assert.equal(a.state, "available");
  assert.equal(a.label, "Resultados disponibles");
  assert.equal(analysis.measurementCountLabel(a), "3 mediciones");
});

test("estudio sin corrida: «Sin análisis»", () => {
  const study = history.normalizeSubjectHistoryResponse(payload({ latestRun: null, latestRunId: null, measurementsByPlane: {} }), "OSF-ID10").studies[0];
  assert.equal(analysis.analysisOf(study).state, "none");
  assert.equal(analysis.analysisOf(study).label, "Sin análisis");
  assert.equal(analysis.measurementCountLabel(analysis.analysisOf(study)), null);
});

test("en curso, fallido y estado desconocido se distinguen", () => {
  const stateOf = (status) => analysis.analysisOf(history.normalizeSubjectHistoryResponse(payload({ latestRun: { runId: "r1", status, planes: [], measurementCount: 0, correctedMeasurementCount: 0 } }), "OSF-ID10").studies[0]);
  assert.equal(stateOf("running").state, "running");
  assert.equal(stateOf("created").label, "Análisis en curso");
  assert.equal(stateOf("failed").state, "failed");
  assert.equal(stateOf("failed").label, "Análisis fallido");
  assert.equal(stateOf("raro").state, "unknown");
  // sin resultados disponibles no se muestra ningún conteo de mediciones
  assert.equal(stateOf("failed").measurementCount, null);
});

test("un conteo ausente se dice «no informadas», nunca 0", () => {
  const study = history.normalizeSubjectHistoryResponse(payload({ latestRun: { runId: "r1", status: "completed", planes: [] } }), "OSF-ID10").studies[0];
  const a = analysis.analysisOf(study);
  assert.equal(a.measurementCount, null);
  assert.equal(analysis.measurementCountLabel(a), "Mediciones: no informadas");
});

test("respuesta anterior del backend (sin latestRun) con corrida: resultados disponibles y conteo de lo recibido", () => {
  const study = history.normalizeSubjectHistoryResponse(payload({ latestRun: undefined }), "OSF-ID10").studies[0];
  const a = analysis.analysisOf(study);
  assert.equal(a.state, "available");
  assert.equal(a.measurementCount, 3);
});

test("las mediciones son las de UNA corrida y el encabezado cuenta estudios, no suma corridas", () => {
  const two = payload();
  two.studies.push({ ...two.studies[0], caseId: "OSF-ID10-V1-T1", latestRun: { runId: "multi-otra", status: "completed", planes: ["sagittal"], measurementCount: 50, correctedMeasurementCount: 2 } });
  two.summary = { totalStudies: 2 };
  const studies = history.normalizeSubjectHistoryResponse(two, "OSF-ID10").studies;
  assert.equal(analysis.studiesWithResults(studies), 2);
  assert.equal(analysis.analysisOf(studies[1]).measurementCount, 50);
  assert.equal(analysis.analysisOf(studies[0]).measurementCount, 3);
});

test("fechas con el formato de la interfaz y corrida abreviada", () => {
  const formatted = analysis.formatDateTime("2026-10-18T01:50:50.003970Z");
  assert.match(formatted, /^\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}/);
  assert.doesNotMatch(formatted, /T\d\d:\d\d:\d\d|Z$/);
  assert.equal(analysis.formatDateTime(null), null);
  assert.equal(analysis.formatDateTime("no es fecha"), null);
  assert.equal(analysis.shortRunId("multi-1beddd775e6cfb778187"), "multi-…778187");
  assert.equal(analysis.shortRunId(null), "No informada");
});

// ---- panel «Estudio seleccionado»
test("revisor y fecha salen de la corrida; la revisión finalizada sin dato dice «No informado»", () => {
  const run = { reviewer: "Dra. Demo Reviewer", reviewedAt: "2026-10-18T01:50:50Z" };
  assert.equal(facts.reviewerFact(run, undefined, true), "Dra. Demo Reviewer");
  assert.notEqual(facts.lastReviewFact(run, undefined, true), "Sin revisiones");
  assert.equal(facts.reviewerFact({ reviewer: null }, undefined, true), "No informado");
  assert.equal(facts.lastReviewFact({ reviewedAt: null }, undefined, true), "No informado");
  // un estudio pendiente sin revisar sí no tiene revisor
  assert.equal(facts.reviewerFact({ reviewer: null }, undefined, false), "Sin revisor asignado");
  assert.equal(facts.lastReviewFact({ reviewedAt: null }, undefined, false), "Sin revisiones");
});

test("cortes: el catálogo en 0 usa el conteo de la corrida y, si falta, dice «no informados» (no 0)", () => {
  const run = { metricsSnapshot: { planes: { sagittal: { input: { sliceCount: 21 } } } } };
  assert.equal(facts.sliceCountFact({ plane: "sagittal", sliceCount: 15 }, run), "15 cortes");
  assert.equal(facts.sliceCountFact({ plane: "sagittal", sliceCount: 0 }, run), "21 cortes");
  assert.equal(facts.sliceCountFact({ plane: "axial", sliceCount: 0 }, run), "Cortes no informados");
  assert.equal(facts.sliceCountFact({ plane: "sagittal", sliceCount: 0 }, undefined), "Cortes no informados");
  assert.equal(facts.sliceCountFact({ plane: "sagittal", sliceCount: 1 }, undefined), "1 corte");
});

console.log(`Historial con datos reales: ${n} pruebas pasaron`);
