import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Stage 79: longitudinal comparison between two Studies of the same patient. Same pattern as the
 * other post-e50 test scripts: transpile the pure .ts modules to CommonJS and run them in a vm
 * sandbox — no DOM/React renderer, so all the logic worth testing (parsing, presentation, state
 * transitions) lives in plain .ts files with no React import.
 */

function load(path, exportNames) {
  const source = readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const api = load("src/longitudinalComparisonApi.ts", ["parseLongitudinalComparisonResult"]);

const display = load("src/features/reading/longitudinalComparisonDisplay.ts", [
  "formatComparisonValue",
  "formatDeltaAbsolute",
  "formatDeltaPercent",
  "trendArrow",
  "displayComparisonStatus",
  "displayMetricLabel",
  "NO_BASELINE_STUDY_TEXT",
  "NO_COMPARABLE_MEASUREMENTS_TEXT",
  "NO_USABLE_ANALYSIS_TEXT",
  "LONGITUDINAL_DISCLAIMER",
]);

const state = load("src/features/reading/longitudinalComparisonState.ts", [
  "initialLongitudinalComparisonUiState",
  "candidatesRequested",
  "candidatesLoaded",
  "candidatesFailed",
  "excludeCurrentCase",
  "baselineCleared",
  "comparisonRequested",
  "comparisonLoaded",
  "comparisonFailed",
  "isSwitchingBaseline",
]);

const errorState = load("src/features/reading/productAnalysisV1State.ts", ["classifyProductAnalysisError"]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function backendApiError(status, message = "error") {
  return { name: "BackendApiError", status, message, path: "/api/studies/x", traceId: "trace-1" };
}

function effectiveValue(overrides = {}) {
  return { automaticValue: 12.3, correctedValue: null, effectiveValue: 12.3, source: "ai_original", ...overrides };
}

function measurementComparison(overrides = {}) {
  return {
    level: "L4-L5",
    plane: "sagittal",
    structure: "disc",
    metric: "areaMm2",
    unit: "mm2",
    baseline: effectiveValue(),
    current: effectiveValue({ effectiveValue: 13.1, automaticValue: 13.1 }),
    deltaAbsolute: 0.8,
    deltaPercent: 6.5,
    trend: "increased",
    comparisonStatus: "comparable",
    ...overrides,
  };
}

function comparisonResult(overrides = {}) {
  return {
    baselineCaseId: "case-baseline",
    currentCaseId: "case-current",
    baselineStudyId: "study-baseline",
    currentStudyId: "study-current",
    baselineAnalysisRunId: "run-baseline",
    currentAnalysisRunId: "run-current",
    baselineStudyDate: "2026-05-10",
    currentStudyDate: "2026-08-25",
    generatedAt: "2026-08-25T12:00:00Z",
    measurements: [measurementComparison()],
    ...overrides,
  };
}

// ---- 1-2: baseline selector ----
check("1. baseline selector: los candidatos se cargan y excluyen el estudio actual", () => {
  const loaded = state.candidatesLoaded(
    state.initialLongitudinalComparisonUiState(),
    state.excludeCurrentCase([{ caseId: "case-a", studyDate: "2026-01-01" }, { caseId: "case-current", studyDate: "2026-08-25" }], "case-current"),
  );
  assert.equal(loaded.candidates.length, 1);
  assert.equal(loaded.candidates[0].caseId, "case-a");
});

check("2. el estudio actual nunca aparece como su propio candidato", () => {
  const filtered = state.excludeCurrentCase([{ caseId: "case-current", studyDate: null }], "case-current");
  assert.equal(filtered.length, 0);
});

// ---- 3: empty history ----
check("3. historial vacío: candidates queda en []", () => {
  const loaded = state.candidatesLoaded(state.initialLongitudinalComparisonUiState(), []);
  assert.equal(loaded.candidates.length, 0);
  assert.equal(loaded.phase, "ready");
});

// ---- 4: comparison loading ----
check("4. loading: comparisonRequested pone phase=loading_comparison", () => {
  const requested = state.comparisonRequested(state.initialLongitudinalComparisonUiState(), "case-baseline");
  assert.equal(requested.phase, "loading_comparison");
  assert.equal(requested.selectedBaselineCaseId, "case-baseline");
});

// ---- 5: successful comparison ----
check("5. comparación exitosa deja result poblado", () => {
  const loaded = state.comparisonLoaded(state.initialLongitudinalComparisonUiState(), comparisonResult());
  assert.equal(loaded.phase, "ready");
  assert.equal(loaded.result.measurements.length, 1);
});

// ---- 6-7: delta formatting ----
check("6. delta absoluto se formatea con signo y unidad", () => {
  assert.equal(display.formatDeltaAbsolute(0.8, "mm"), "+0.80 mm");
  assert.equal(display.formatDeltaAbsolute(-4.2, "mm"), "-4.20 mm");
});

check("7. delta porcentual se formatea con signo", () => {
  assert.equal(display.formatDeltaPercent(6.5), "+6.50 %");
  assert.equal(display.formatDeltaPercent(-3.1), "-3.10 %");
});

// ---- 8: baseline zero -> percent null ----
check("8. deltaPercent null (baseline=0) se muestra como '—', nunca un error", () => {
  assert.equal(display.formatDeltaPercent(null), "—");
});

// ---- 9-11: corrected vs original visibility ----
check("9. el valor corregido del estudio actual se parsea y expone", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ current: effectiveValue({ correctedValue: 12.9, effectiveValue: 12.9, source: "professional_correction" }) })],
  }));
  assert.equal(result.measurements[0].current.correctedValue, 12.9);
  assert.equal(result.measurements[0].current.source, "professional_correction");
});

check("10. el valor corregido del baseline también se parsea y expone", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ baseline: effectiveValue({ correctedValue: 11.8, effectiveValue: 11.8, source: "professional_correction" }) })],
  }));
  assert.equal(result.measurements[0].baseline.correctedValue, 11.8);
});

check("11. el valor automático original sigue visible aunque exista una corrección", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ current: effectiveValue({ automaticValue: 13.1, correctedValue: 12.9, effectiveValue: 12.9, source: "professional_correction" }) })],
  }));
  assert.equal(result.measurements[0].current.automaticValue, 13.1, "el valor automatico nunca debe perderse al mostrar el corregido");
});

// ---- 12: level null safe ----
check("12. level null no rompe el formateo ni se muestra como 'null'", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ level: null, comparisonStatus: "level_unresolved", current: null, deltaAbsolute: null, deltaPercent: null, trend: null })],
  }));
  assert.equal(result.measurements[0].level, null);
  assert.notEqual(result.measurements[0].level, "null");
});

// ---- 13: not comparable state ----
check("13. not comparable: displayComparisonStatus da un texto entendible por cada motivo", () => {
  assert.match(display.displayComparisonStatus("level_unresolved"), /no asignado/i);
  assert.match(display.displayComparisonStatus("unit_mismatch"), /incompatibles/i);
});

// ---- 14-15: missing baseline / current ----
check("14. missing_baseline se representa sin baseline value", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ comparisonStatus: "missing_baseline", baseline: null, deltaAbsolute: null, deltaPercent: null, trend: null })],
  }));
  assert.equal(result.measurements[0].baseline, null);
  assert.equal(result.measurements[0].comparisonStatus, "missing_baseline");
});

check("15. missing_current se representa sin current value", () => {
  const result = api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ comparisonStatus: "missing_current", current: null, deltaAbsolute: null, deltaPercent: null, trend: null })],
  }));
  assert.equal(result.measurements[0].current, null);
});

// ---- 16: no usable analysis ----
check("16. sin análisis utilizable: el error 422 se clasifica como functional", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(422)).kind, "functional");
});

// ---- 17-18: unit / mm² formatting ----
check("17. la unidad se muestra junto al valor", () => {
  assert.equal(display.formatComparisonValue(12.3, "mm"), "12.30 mm");
});

check("18. formateo mm² correcto", () => {
  assert.equal(display.formatComparisonValue(120.5, "mm2"), "120.50 mm2");
});

// ---- 19: no clinical color semantics ----
check("19. trendArrow nunca implica un color clínico -- sólo flechas, nunca 'mejora'/'empeora'", () => {
  assert.equal(display.trendArrow("increased"), "↑");
  assert.equal(display.trendArrow("decreased"), "↓");
  assert.equal(display.trendArrow("unchanged"), "");
  const forbidden = /mejor|empeor|verde|rojo|green|red/i;
  assert.equal(forbidden.test(display.trendArrow("increased")), false);
});

// ---- 20-22: error handling ----
check("20. network error se clasifica como network", () => {
  assert.equal(errorState.classifyProductAnalysisError(new TypeError("Failed to fetch")).kind, "network");
});

check("21. 404 se clasifica como not_found", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(404)).kind, "not_found");
});

check("22. paciente distinto (422/400) se clasifica como functional, nunca oculto como 500", () => {
  assert.equal(errorState.classifyProductAnalysisError(backendApiError(400)).kind, "functional");
});

// ---- 23: switching baseline reloads ----
check("23. cambiar de baseline siempre recarga -- nunca reutiliza el resultado anterior", () => {
  const afterFirst = state.comparisonLoaded(state.comparisonRequested(state.initialLongitudinalComparisonUiState(), "case-a"), comparisonResult({ baselineCaseId: "case-a" }));
  assert.equal(state.isSwitchingBaseline(afterFirst, "case-b"), true);
  const afterSwitch = state.comparisonRequested(afterFirst, "case-b");
  assert.equal(afterSwitch.selectedBaselineCaseId, "case-b");
  assert.equal(afterSwitch.phase, "loading_comparison");
});

// ---- 24: analysis history (stage 77) still works / concepts stay separate ----
check("24. el historial de análisis de un Study (stage 77) es un concepto distinto de la comparación entre Studies (stage 79)", () => {
  // Distintos módulos, distintos estados -- nunca se mezclan (79-X).
  const analysisHistorySource = readFileSync("src/features/reading/productAnalysisV1State.ts", "utf8");
  const longitudinalSource = readFileSync("src/features/reading/longitudinalComparisonState.ts", "utf8");
  assert.equal(analysisHistorySource.includes("baselineCaseId"), false, "el historial de un Study no debe conocer conceptos de baseline entre Studies");
  assert.equal(longitudinalSource.includes("analysisRunId"), false, "el estado de comparación no debe manejar el historial de corridas de un Study");
});

// ---- 25: no diagnosis language ----
check("25. ningún texto de presentación afirma una evolución clínica o un diagnóstico", () => {
  const forbidden = /mejor[oó]|empeor[oó]|diagn[oó]stic|patholog|worsen|improv/i;
  const texts = [
    display.displayComparisonStatus("comparable"),
    display.displayComparisonStatus("level_unresolved"),
    display.NO_BASELINE_STUDY_TEXT,
    display.NO_COMPARABLE_MEASUREMENTS_TEXT,
    display.NO_USABLE_ANALYSIS_TEXT,
    display.LONGITUDINAL_DISCLAIMER,
  ];
  for (const text of texts) assert.equal(forbidden.test(text), false, `texto indebido: "${text}"`);
});

// ---- extra: fail-closed parsing ----
check("extra. una respuesta sin baselineCaseId es rechazada, no completada con un default", () => {
  const invalid = comparisonResult();
  delete invalid.baselineCaseId;
  assert.throws(() => api.parseLongitudinalComparisonResult(invalid));
});

check("extra. un comparisonStatus desconocido es rechazado (fail closed)", () => {
  assert.throws(() => api.parseLongitudinalComparisonResult(comparisonResult({
    measurements: [measurementComparison({ comparisonStatus: "unknown_status" })],
  })));
});

console.log(`Post-E50 longitudinal comparison (stage 79): ${passed} tests OK`);
