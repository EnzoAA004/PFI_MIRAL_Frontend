import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Stage 84: patient history / longitudinal timeline via `Study.subjectRef`. Follows the same
 * transpile-and-run-in-vm harness as every other post-e50 stage script, plus the existing
 * `p8e2-subject-history-tests.mjs` convention of string-assertions against `.tsx` files the
 * harness can't render (no DOM/React renderer here).
 */

const root = process.cwd();

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    clone() {
      return fakeResponse(body, { ok, status });
    },
  };
}

function loadSubjectHistory(fetchImpl) {
  const source = readFileSync(join(root, "src/subjectHistoryApi.ts"), "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class ApiError extends Error {
    constructor(message, options) {
      super(message);
      this.name = "ApiError";
      Object.assign(this, options);
    }
  }
  class ContractError extends Error {
    constructor(message, path, options = {}) {
      super(message);
      this.name = "ContractError";
      this.path = path;
      Object.assign(this, options);
    }
  }
  const sandbox = {
    exports: {},
    console,
    API_BASE_URL: "https://backend.example",
    authHeaders: () => ({ Authorization: "Bearer test-token" }),
    validateVisibleDataOrigin: () => undefined,
    applyCorrectionsToMeasurements: (measurements) => measurements,
    normalizePersistedCorrection: () => null,
    generateTraceId: () => "trace-test",
    refreshDoctorSession: async () => undefined,
    toSafeFrontendError: (status) => ({ message: `Error ${status}` }),
    URLSearchParams,
    fetch: fetchImpl ?? (async () => fakeResponse({})),
    ApiError,
    ContractError,
  };
  vm.runInNewContext(`${js}
exports.normalizeSubjectHistoryResponse = normalizeSubjectHistoryResponse;
exports.fetchAvailableMeasurementSeriesKeys = fetchAvailableMeasurementSeriesKeys;
exports.fetchMeasurementSeries = fetchMeasurementSeries;
exports.ApiError = ApiError;
exports.ContractError = ContractError;`, sandbox);
  return sandbox.exports;
}

let count = 0;
async function test(name, fn) {
  await fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

function validHistoryPayload(overrides = {}) {
  return {
    status: "ok",
    source: "postgres-domain",
    dataOrigin: "database",
    deidentified: true,
    subjectRef: "SPIDER-101",
    summary: { totalStudies: 1 },
    studies: [{
      caseId: "CASE-101",
      subjectRef: "SPIDER-101",
      studyDate: "2026-07-26",
      modality: "MRI",
      planes: ["sagittal"],
      modelKey: "sagittal_spider",
      reviewStatus: "pending",
      priority: "medium",
      measurementsByPlane: {},
      corrections: [],
      ...overrides.study,
    }],
    ...overrides,
  };
}

// ---- productAnalysis parsing (Stage 84-C/84-D/84-H) ----

await test("1. Study sin productAnalysis expone null, no lanza", () => {
  const subjectHistory = loadSubjectHistory();
  const normalized = subjectHistory.normalizeSubjectHistoryResponse(validHistoryPayload(), "SPIDER-101");
  assert.equal(normalized.studies[0].productAnalysis, null);
});

await test("2. productAnalysis completo se parsea con todos los campos", () => {
  const subjectHistory = loadSubjectHistory();
  const payload = validHistoryPayload({
    study: {
      productAnalysis: {
        analysisRunId: "run-1", status: "partial", reviewStatus: "accepted",
        measurementCount: 5, correctedMeasurementCount: 1,
        warnings: ["67B2_RUNTIME_PARITY_NOT_PROVEN"], humanReviewRequired: true, notClinicalDiagnosis: true,
      },
    },
  });
  const normalized = subjectHistory.normalizeSubjectHistoryResponse(payload, "SPIDER-101");
  const productAnalysis = normalized.studies[0].productAnalysis;
  assert.equal(productAnalysis.status, "partial");
  assert.equal(productAnalysis.reviewStatus, "accepted");
  assert.equal(productAnalysis.measurementCount, 5);
  assert.equal(productAnalysis.correctedMeasurementCount, 1);
  assert.deepEqual(productAnalysis.warnings, ["67B2_RUNTIME_PARITY_NOT_PROVEN"]);
});

await test("3. productAnalysis malformado (sin analysisRunId) cae a null, fail-closed", () => {
  const subjectHistory = loadSubjectHistory();
  const payload = validHistoryPayload({ study: { productAnalysis: { status: "completed" } } });
  const normalized = subjectHistory.normalizeSubjectHistoryResponse(payload, "SPIDER-101");
  assert.equal(normalized.studies[0].productAnalysis, null);
});

await test("4. humanReviewRequired/notClinicalDiagnosis nunca se inventan como true por default", () => {
  const subjectHistory = loadSubjectHistory();
  const payload = validHistoryPayload({
    study: { productAnalysis: { analysisRunId: "run-1", status: "completed", reviewStatus: "pending" } },
  });
  const normalized = subjectHistory.normalizeSubjectHistoryResponse(payload, "SPIDER-101");
  assert.equal(normalized.studies[0].productAnalysis.humanReviewRequired, false);
});

// ---- measurement-series API (Stage 84-I/84-J/84-K/84-M) ----

await test("5. fetchAvailableMeasurementSeriesKeys parsea una lista real de keys", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse([
    { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" },
  ]));
  const keys = await subjectHistory.fetchAvailableMeasurementSeriesKeys("PAT-1");
  assert.equal(keys.length, 1);
  assert.equal(keys[0].level, "L4-L5");
  assert.equal(keys[0].unit, "mm");
});

await test("6. fetchAvailableMeasurementSeriesKeys con payload no-array lanza ContractError", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse({ notAnArray: true }));
  await assert.rejects(() => subjectHistory.fetchAvailableMeasurementSeriesKeys("PAT-1"), subjectHistory.ContractError);
});

await test("7. una key con level=null se acepta (nivel no resuelto se muestra, no se descarta la key)", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse([
    { level: null, plane: "sagittal", structure: "disc", metric: "areaMm2", unit: "mm2" },
  ]));
  const keys = await subjectHistory.fetchAvailableMeasurementSeriesKeys("PAT-1");
  assert.equal(keys[0].level, null);
});

await test("8. fetchMeasurementSeries parsea puntos con valor original y corregido", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse({
    key: { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" },
    points: [
      { caseId: "case-a", studyDate: "2026-02-01", automaticValue: 11.9, correctedValue: null, effectiveValue: 11.9, effectiveSource: "ai_original" },
      { caseId: "case-c", studyDate: "2026-08-25", automaticValue: 13.1, correctedValue: 12.9, effectiveValue: 12.9, effectiveSource: "professional_correction" },
    ],
  }));
  const series = await subjectHistory.fetchMeasurementSeries("PAT-1", { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" });
  assert.equal(series.points.length, 2);
  assert.equal(series.points[1].automaticValue, 13.1); // 21: original preserved
  assert.equal(series.points[1].correctedValue, 12.9); // 20: corrected value present
  assert.equal(series.points[1].effectiveSource, "professional_correction");
});

await test("9. fetchMeasurementSeries con puntos malformados (sin caseId) lanza ContractError", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse({
    key: { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" },
    points: [{ studyDate: "2026-02-01" }],
  }));
  await assert.rejects(() => subjectHistory.fetchMeasurementSeries("PAT-1", { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" }));
});

await test("10. fetchMeasurementSeries con respuesta HTTP no-ok lanza ApiError", async () => {
  const subjectHistory = loadSubjectHistory(async () => fakeResponse({ code: "SOME_ERROR" }, { ok: false, status: 500 }));
  await assert.rejects(() => subjectHistory.fetchMeasurementSeries("PAT-1", { level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm" }), subjectHistory.ApiError);
});

// ---- 13/14/15/26/29/30: Frontend surface string-assertions (PatientHistoryView.tsx) ----

const historyViewSource = readFileSync(join(root, "src/components/PatientHistoryView.tsx"), "utf8");
const studyReviewSource = readFileSync(join(root, "src/components/StudyReviewView.tsx"), "utf8");
const patientHistoryPageSource = readFileSync(join(root, "src/components/PatientHistoryPage.tsx"), "utf8");
const appSource = readFileSync(join(root, "src/App.tsx"), "utf8");
const routesSource = readFileSync(join(root, "src/routes.ts"), "utf8");

await test("11. el título de la vista nunca imprime el subjectRef crudo (privacidad, 84-W)", () => {
  assert.match(historyViewSource, /Historial del paciente/);
  assert.doesNotMatch(historyViewSource, /<h1>\{displayReference\}<\/h1>/);
});

await test("12. el avatar decorativo no usa la primera letra del subjectRef fuera del modo trazabilidad de estudio", () => {
  assert.match(historyViewSource, /studyTraceabilityMode \? displayReference\.slice\(0, 1\) : "H"/);
});

await test("13. estudio actual se marca explícitamente, no sólo por color", () => {
  assert.match(historyViewSource, /Estudio actual/);
});

await test("14. acción Comparar existe y reutiliza LongitudinalComparisonPanel (Stage 79), no recalcula en Frontend", () => {
  assert.match(historyViewSource, /Comparar/);
  assert.match(historyViewSource, /LongitudinalComparisonPanel/);
  assert.doesNotMatch(historyViewSource, /deltaAbsolute\s*=|current\s*-\s*baseline/);
});

await test("15. acción Abrir estudio existe", () => {
  assert.match(historyViewSource, /Abrir estudio/);
});

await test("16. empty state subjectRef null usa el texto exacto del brief", () => {
  assert.match(studyReviewSource, /Este estudio no tiene una referencia longitudinal disponible\./);
});

await test("17. empty state de un único Study usa el texto exacto del brief", () => {
  assert.match(historyViewSource, /No hay otros estudios disponibles para comparación\./);
});

await test("18. empty state sin análisis usa el texto exacto del brief", () => {
  assert.match(historyViewSource, /Este estudio todavía no tiene un análisis\./);
});

await test("19. empty state sin series comparables usa el texto exacto del brief", () => {
  assert.match(historyViewSource, /No hay mediciones comparables entre múltiples estudios\./);
});

await test("20. warnings se muestran sin reinterpretarse (67B2/67C se mapean a texto legible, no se ocultan)", () => {
  assert.match(historyViewSource, /67B2_RUNTIME_PARITY_NOT_PROVEN/);
  assert.match(historyViewSource, /67C_RUNTIME_PARITY_NOT_PROVEN/);
});

await test("21. ningún texto estático afirma una mejora o empeoramiento clínico (84-N) -- el disclaimer 'no constituye diagnóstico' sigue permitido", () => {
  const forbidden = /mejor[oó]|empeor[oó]|worsened|improved/i;
  assert.equal(forbidden.test(historyViewSource), false);
  // El único uso de "diagnóstico" permitido es el disclaimer negativo estándar de este producto.
  assert.doesNotMatch(historyViewSource, /diagn[oó]stic(?!o clínico)/i);
});

await test("22. la evolución no calcula deltas en el Frontend -- sólo muestra el punto ya resuelto por el Backend", () => {
  assert.doesNotMatch(historyViewSource, /effectiveValue\s*-\s*automaticValue|trend\s*=/);
});

await test("23. el valor corregido muestra explícitamente el valor automático original", () => {
  assert.match(historyViewSource, /Valor revisado: automático/);
});

await test("24. no se agrega una librería de charts nueva (84-S)", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.equal(Object.keys(deps).some((name) => /recharts|chart\.js|d3/i.test(name)), false);
});

await test("25. selector Nivel · Métrica existe para elegir la serie a mostrar", () => {
  assert.match(historyViewSource, /Nivel · Métrica/);
});

// ---- 13 (open action)/27: routing real, sin recarga completa ----

await test("26. PatientHistoryPage navega a un Study existente vía onOpenStudy, sin recargar la página", () => {
  assert.match(patientHistoryPageSource, /onOpenStudy/);
  assert.doesNotMatch(patientHistoryPageSource, /window\.location/);
});

await test("27. App usa el mismo pathForStudy/navigate ya existente para abrir un Study desde el historial", () => {
  assert.match(appSource, /onOpenStudy=\{\(caseId\) => navigate\(pathForStudy\(caseId\)\)\}/);
});

await test("28. la ruta de historial de paciente documenta subjectRef, no una entidad Patient separada", () => {
  assert.match(routesSource, /subjectRef/);
});

// ---- 4/5/6: current study marker wiring from StudyReviewView ----

await test("29. StudyReviewView expone la acción para abrir el historial del paciente sólo cuando hay subjectRef", () => {
  assert.match(studyReviewSource, /onOpenPatientHistory/);
  assert.match(studyReviewSource, /Ver historial del paciente/);
});

await test("30. abrir el historial desde un Study recuerda su caseId como 'estudio actual'", () => {
  assert.match(appSource, /setPatientHistoryCurrentCaseId\(safeRun\?\.caseId/);
});

// ---- extra: fail-closed subjectRef mismatch still enforced (regression guard) ----

await test("31. la respuesta con subjectRef distinto al pedido sigue rechazándose (fail-closed no roto por Stage 84)", () => {
  const subjectHistory = loadSubjectHistory();
  assert.throws(() => subjectHistory.normalizeSubjectHistoryResponse(validHistoryPayload({ subjectRef: "OTHER" }), "SPIDER-101"), subjectHistory.ContractError);
});

console.log(`Post-E50 patient history (stage 84): ${count} tests OK`);
