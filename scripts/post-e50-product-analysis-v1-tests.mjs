import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Stage 77: `POST/GET /api/studies/{caseId}/product-analys(is|es)` (pfi.ai-product-result.v1).
 *
 * Sigue el mismo patrón que scripts/disc-degenerative-findings-tests.mjs: transpila el .ts a
 * CommonJS y lo corre en un sandbox de `vm`, sin DOM ni React real — por eso toda la lógica que
 * hace falta cubrir vive en módulos puros (parseo, presentación, reducer) y no en el .tsx del
 * panel, que sólo arma JSX sobre esos módulos.
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

const api = load("src/productAnalysisV1Api.ts", [
  "ProductAnalysisV1ContractError",
  "parseProductAnalysisResult",
  "parseProductAnalysisHistory",
  "buildStartRequestBody",
]);

const display = load("src/features/reading/productAnalysisDisplay.ts", [
  "displayProductAnalysisWarning",
  "displayDiscLevel",
  "displayLocalizationStatus",
  "displayAxialPairingStatus",
  "displayDegenerativeFindingsStatus",
  "displayReviewStatus",
  "formatLengthMm",
  "formatAreaMm2",
  "DISC_LEVEL_UNASSIGNED_TEXT",
  "MORPHOMETRY_DISCLAIMER",
  "PRODUCT_ANALYSIS_EMPTY_HISTORY_TEXT",
  "PRODUCT_ANALYSIS_PROCESSING_TEXT",
]);

const state = load("src/features/reading/productAnalysisV1State.ts", [
  "initialProductAnalysisUiState",
  "productAnalysisReducer",
  "classifyProductAnalysisError",
  "canSubmit",
  "canRetry",
]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function backendApiError(status, message = "error") {
  return { name: "BackendApiError", status, message, path: "/api/studies/x", traceId: "trace-1" };
}

function review(overrides = {}) {
  return { required: true, status: "pending", comment: null, reviewedBy: null, reviewedAt: null, ...overrides };
}

function correction(overrides = {}) {
  return {
    field: "areaMm2",
    originalValue: 120.5,
    correctedValue: 110.0,
    unit: "mm2",
    comment: null,
    reviewedBy: "doctor-1",
    createdAt: "2026-08-25T10:00:00Z",
    ...overrides,
  };
}

function measurement(overrides = {}) {
  return {
    measurementId: "measurement-1",
    plane: "sagittal",
    level: "L4-L5",
    structure: "disc",
    areaMm2: 120.5,
    majorAxisMm: 12.345678,
    minorAxisMm: 8.4,
    reviewRequired: true,
    corrections: [],
    ...overrides,
  };
}

function discLevel(overrides = {}) {
  return {
    discLevelId: "level-1",
    level: "L4-L5",
    localizationStatus: "localized",
    localizationValidated: true,
    abstentionPreserved: false,
    axialPairingStatus: "paired",
    axialPairingValidated: true,
    axialPairingExperimental: false,
    axialPairingReviewRequired: false,
    degenerativeFindingsStatus: null,
    automaticInferenceEnabled: false,
    measurements: [measurement()],
    review: review(),
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    analysisRunId: "run-1",
    studyId: "study-1",
    caseId: "case-1",
    status: "completed",
    warnings: [],
    discLevels: [discLevel()],
    review: review(),
    humanReviewRequired: true,
    notClinicalDiagnosis: true,
    autonomousDiagnosis: false,
    createdAt: "2026-08-25T10:00:00Z",
    completedAt: "2026-08-25T10:01:00Z",
    ...overrides,
  };
}

// ---- 1-3: completed / partial / failed ----
check("1. completed se parsea con su status intacto", () => {
  const parsed = api.parseProductAnalysisResult(result({ status: "completed" }));
  assert.equal(parsed.status, "completed");
});

check("2. partial se parsea con warnings visibles", () => {
  const parsed = api.parseProductAnalysisResult(result({ status: "partial", warnings: ["67B2_RUNTIME_PARITY_NOT_PROVEN"] }));
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.warnings.length, 1);
});

check("3. failed se parsea como dato válido, no como excepción", () => {
  const parsed = api.parseProductAnalysisResult(result({ status: "failed" }));
  assert.equal(parsed.status, "failed");
});

// ---- 4-5: loading / button disabled ----
check("4. loading: submit_requested pone phase=submitting", () => {
  const next = state.productAnalysisReducer(state.initialProductAnalysisUiState(), { type: "submit_requested" });
  assert.equal(next.phase, "submitting");
});

check("5. button disabled: canSubmit=false durante submitting", () => {
  const submitting = state.productAnalysisReducer(state.initialProductAnalysisUiState(), { type: "submit_requested" });
  assert.equal(state.canSubmit(submitting), false);
});

// ---- 6: level null no rompe ----
check("6. level null no rompe: muestra texto descriptivo, nunca null/undefined", () => {
  const text = display.displayDiscLevel(null);
  assert.equal(text, display.DISC_LEVEL_UNASSIGNED_TEXT);
  assert.notEqual(text, "null");
  assert.notEqual(text, "undefined");
});

// ---- 7-9: 67B2 ----
check("7. localized muestra nivel disponible", () => {
  const text = display.displayLocalizationStatus("localized");
  assert.match(text, /localizado/i);
});

check("8. abstained muestra abstención, nunca error", () => {
  const text = display.displayLocalizationStatus("abstained");
  assert.match(text, /abstuvo/i);
});

check("9. unavailable muestra no disponible", () => {
  const text = display.displayLocalizationStatus("unavailable");
  assert.match(text, /no disponible/i);
});

// ---- 10-11: 67C ----
check("10. validated=false nunca muestra 'Validado'", () => {
  const text = display.displayAxialPairingStatus("paired", { validated: false, experimental: false, reviewRequired: false });
  assert.equal(/validado/i.test(text), false);
});

check("11. experimental=true es visible en el texto", () => {
  const text = display.displayAxialPairingStatus("experimental", { validated: false, experimental: true, reviewRequired: true });
  assert.match(text, /experimental/i);
});

// ---- 12: P10.7 ----
check("12. P10.7 blocked_preprocessing_parity nunca se muestra como negativo", () => {
  const text = display.displayDegenerativeFindingsStatus("blocked_preprocessing_parity");
  assert.equal(/normal/i.test(text), false);
  assert.equal(/no se detect/i.test(text), false);
  assert.match(text, /no disponible/i);
});

// ---- 13 & 30: warnings mapper ----
check("13. warnings mapper traduce un código conocido", () => {
  assert.equal(display.displayProductAnalysisWarning("67B2_RUNTIME_PARITY_NOT_PROVEN"), "Localización automática de nivel no disponible en esta versión.");
  assert.equal(display.displayProductAnalysisWarning("67C_RUNTIME_PARITY_NOT_PROVEN"), "Emparejamiento automático sagital-axial no disponible en esta versión.");
});

check("30. warning desconocido tiene fallback seguro (nunca undefined/throw)", () => {
  const text = display.displayProductAnalysisWarning("UNKNOWN_CODE_XYZ");
  assert.equal(text, "UNKNOWN_CODE_XYZ");
});

// ---- 14-15: measurement formatting ----
check("14. measurement en mm se redondea para mostrar, sin tocar el dato crudo", () => {
  assert.equal(display.formatLengthMm(12.345678), "12.35 mm");
  assert.equal(display.formatLengthMm(null), "—");
});

check("15. measurement en mm²", () => {
  assert.equal(display.formatAreaMm2(120.5), "120.50 mm²");
  assert.equal(display.formatAreaMm2(null), "—");
});

// ---- 16-17: GET history ----
check("16. GET history vacío se parsea sin error", () => {
  const parsed = api.parseProductAnalysisHistory({ caseId: "case-1", analyses: [] });
  assert.equal(parsed.analyses.length, 0);
});

check("17. GET history con runs preserva cada entrada", () => {
  const parsed = api.parseProductAnalysisHistory({ caseId: "case-1", analyses: [result({ analysisRunId: "run-1" }), result({ analysisRunId: "run-2" })] });
  assert.equal(parsed.analyses.length, 2);
  assert.equal(parsed.analyses[0].analysisRunId, "run-1");
  assert.equal(parsed.analyses[1].analysisRunId, "run-2");
});

// ---- 18: GET detail ----
check("18. GET detail se parsea igual que la respuesta de POST", () => {
  const parsed = api.parseProductAnalysisResult(result({ analysisRunId: "run-detail" }));
  assert.equal(parsed.analysisRunId, "run-detail");
});

// ---- 19: reload recupera persisted analysis ----
check("19. reload: detail_loaded desde estado inicial deja el análisis listo", () => {
  const loaded = state.productAnalysisReducer(state.initialProductAnalysisUiState(), { type: "detail_loaded", result: result() });
  assert.equal(loaded.phase, "ready");
  assert.equal(loaded.selected.analysisRunId, "run-1");
});

// ---- 20-23: error handling ----
check("20. 404 se clasifica como not_found", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(404)).kind, "not_found");
});

check("21. 422 se clasifica como functional", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(422)).kind, "functional");
});

check("22. 500 se clasifica como upstream", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(500)).kind, "upstream");
});

check("23. un error sin forma de BackendApiError (red) se clasifica como network", () => {
  assert.equal(state.classifyProductAnalysisError(new TypeError("Failed to fetch")).kind, "network");
});

// ---- 24: retry manual ----
check("24. retry manual: canRetry sólo es true tras una falla, y el reducer no reintenta solo", () => {
  const failed = state.productAnalysisReducer(state.initialProductAnalysisUiState(), {
    type: "submit_failed",
    error: state.classifyProductAnalysisError(backendApiError(502)),
  });
  assert.equal(failed.phase, "error");
  assert.equal(state.canRetry(failed), true);
  // sin una nueva acción explícita, el estado no cambia por su cuenta.
  assert.equal(failed.phase, "error");
});

// ---- 25-26: request body ----
check("25. el body público nunca incluye sagittalInputId/axialInputId", () => {
  const body = api.buildStartRequestBody({ metadata: { source: "worklist" } });
  assert.equal(Object.hasOwn(body, "sagittalInputId"), false);
  assert.equal(Object.hasOwn(body, "axialInputId"), false);
});

check("26. metadata se envía cuando existe, y se omite cuando no", () => {
  // JSON.stringify en vez de assert.deepEqual: el objeto sale del sandbox de vm (otro realm),
  // y deepStrictEqual compara también el prototipo, que difiere entre realms aunque la forma
  // sea idéntica.
  assert.equal(JSON.stringify(api.buildStartRequestBody({ metadata: { foo: "bar" } })), JSON.stringify({ metadata: { foo: "bar" } }));
  assert.equal(JSON.stringify(api.buildStartRequestBody(undefined)), JSON.stringify({}));
});

// ---- 27: double submit ----
check("27. double submit: canSubmit vuelve a true recién tras ready/error, nunca durante submitting", () => {
  let current = state.initialProductAnalysisUiState();
  current = state.productAnalysisReducer(current, { type: "submit_requested" });
  assert.equal(state.canSubmit(current), false);
  const second = state.productAnalysisReducer(current, { type: "submit_requested" });
  assert.equal(second.phase, "submitting");
});

// ---- 28: review pending ----
check("28. review pending es visible", () => {
  assert.match(display.displayReviewStatus(review({ status: "pending" })), /pendiente/i);
  assert.match(display.displayReviewStatus(review({ required: false })), /no requiere/i);
});

// ---- 29: sin diagnóstico indebido ----
check("29. ningún texto de presentación afirma un diagnóstico automático/confirmado", () => {
  const forbidden = /diagn[oó]stico (autom[aá]tico|confirmado)|tratamiento|recomendaci[oó]n terap[eé]utica/i;
  const texts = [
    display.displayLocalizationStatus("localized"),
    display.displayLocalizationStatus("abstained"),
    display.displayLocalizationStatus("unavailable"),
    display.displayAxialPairingStatus("paired", { validated: true, experimental: false, reviewRequired: false }),
    display.displayDegenerativeFindingsStatus("blocked_preprocessing_parity"),
    display.displayReviewStatus(review()),
    display.MORPHOMETRY_DISCLAIMER,
    display.PRODUCT_ANALYSIS_PROCESSING_TEXT,
  ];
  for (const text of texts) assert.equal(forbidden.test(text), false, `texto indebido: "${text}"`);
});

// ---- extra: fail-closed parsing (no inventar contrato) ----
check("extra. un resultado sin humanReviewRequired es rechazado, no completado con un default", () => {
  const invalid = result();
  delete invalid.humanReviewRequired;
  assert.throws(() => api.parseProductAnalysisResult(invalid), api.ProductAnalysisV1ContractError);
});

check("extra. un status desconocido es rechazado (fail closed)", () => {
  assert.throws(() => api.parseProductAnalysisResult(result({ status: "unknown_status" })), api.ProductAnalysisV1ContractError);
});

console.log(`Post-E50 product analysis v1: ${passed} tests OK`);
