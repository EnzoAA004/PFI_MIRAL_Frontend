import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Etapa 78: workflow de revisión/corrección profesional sobre el panel de product-analysis de la etapa 77.
 * El mismo patrón que scripts/post-e50-product-analysis-v1-tests.mjs: transpilar los módulos .ts puros
 * a CommonJS y correrlos en un sandbox vm — sin DOM/renderer de React involucrado, así que toda la
 * lógica que vale la pena testear (parseo, presentación, el reducer) vive en archivos .ts planos sin React
 * import.
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
  "parseProductAnalysisResult",
  "buildReviewRequestBody",
  "buildCorrectionRequestBody",
]);

const display = load("src/features/reading/productAnalysisDisplay.ts", [
  "displayReviewStatus",
  "displayReviewedBy",
  "displayAxialPairingStatus",
  "displayDegenerativeFindingsStatus",
  "formatMeasurementFieldValue",
  "REVIEW_ACTION_LABELS",
]);

const state = load("src/features/reading/productAnalysisV1State.ts", [
  "initialProductAnalysisUiState",
  "productAnalysisReducer",
  "classifyProductAnalysisError",
  "canMutate",
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
    majorAxisMm: 5.0,
    minorAxisMm: 3.0,
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
    axialPairingValidated: false,
    axialPairingExperimental: true,
    axialPairingReviewRequired: true,
    degenerativeFindingsStatus: "blocked_preprocessing_parity",
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

// ---- 1: pending visible ----
check("1. pending es visible", () => {
  assert.match(display.displayReviewStatus(review({ status: "pending" })), /pendiente/i);
});

// ---- 2-4: accept/observe/reject actions ----
check("2. accept action deja review.status=accepted tras la mutación", () => {
  const next = state.productAnalysisReducer(state.initialProductAnalysisUiState(), {
    type: "mutation_succeeded",
    result: result({ review: review({ status: "accepted" }) }),
  });
  assert.equal(next.selected.review.status, "accepted");
  assert.match(display.displayReviewStatus(next.selected.review), /aceptado/i);
});

check("3. observe action deja review.status=observed", () => {
  const next = state.productAnalysisReducer(state.initialProductAnalysisUiState(), {
    type: "mutation_succeeded",
    result: result({ review: review({ status: "observed", comment: "revisar de nuevo" }) }),
  });
  assert.equal(next.selected.review.status, "observed");
  assert.equal(next.selected.review.comment, "revisar de nuevo");
});

check("4. reject action deja review.status=rejected", () => {
  const next = state.productAnalysisReducer(state.initialProductAnalysisUiState(), {
    type: "mutation_succeeded",
    result: result({ review: review({ status: "rejected", comment: "no es confiable" }) }),
  });
  assert.equal(next.selected.review.status, "rejected");
});

// ---- 5: loading mutation state ----
check("5. loading: mutation_requested pone mutating=true", () => {
  const next = state.productAnalysisReducer(state.initialProductAnalysisUiState(), { type: "mutation_requested" });
  assert.equal(next.mutating, true);
});

// ---- 6: double submit blocked ----
check("6. double submit: canMutate=false mientras mutating=true", () => {
  const mutating = state.productAnalysisReducer(state.initialProductAnalysisUiState(), { type: "mutation_requested" });
  assert.equal(state.canMutate(mutating), false);
  const idle = state.productAnalysisReducer(mutating, { type: "mutation_succeeded", result: result() });
  assert.equal(state.canMutate(idle), true);
});

// ---- 7: comment input ----
check("7. comment se envía cuando existe, se omite cuando no", () => {
  const withComment = api.buildReviewRequestBody({ status: "observed", comment: "algo a decir" });
  assert.equal(JSON.stringify(withComment), JSON.stringify({ status: "observed", comment: "algo a decir" }));
  const withoutComment = api.buildReviewRequestBody({ status: "accepted" });
  assert.equal(Object.hasOwn(withoutComment, "comment"), false);
});

// ---- 8: review reload (persisted across a simulated remount) ----
check("8. review reload: mutation_succeeded reemplaza la entrada correcta en el historial", () => {
  const seeded = {
    ...state.initialProductAnalysisUiState(),
    history: [result({ analysisRunId: "run-a" }), result({ analysisRunId: "run-b" })],
  };
  const next = state.productAnalysisReducer(seeded, {
    type: "mutation_succeeded",
    result: result({ analysisRunId: "run-a", review: review({ status: "accepted" }) }),
  });
  assert.equal(next.history.find((item) => item.analysisRunId === "run-a").review.status, "accepted");
  assert.equal(next.history.find((item) => item.analysisRunId === "run-b").review.status, "pending");
});

// ---- 9-10: corrected measurement displayed alongside original ----
check("9. corrected measurement se parsea y se puede mostrar", () => {
  const parsed = api.parseProductAnalysisResult(result({
    discLevels: [discLevel({ measurements: [measurement({ corrections: [correction({ correctedValue: 99.9 })] })] })],
  }));
  const parsedMeasurement = parsed.discLevels[0].measurements[0];
  assert.equal(parsedMeasurement.corrections[0].correctedValue, 99.9);
  assert.equal(display.formatMeasurementFieldValue("areaMm2", parsedMeasurement.corrections[0].correctedValue), "99.90 mm²");
});

check("10. el valor automático original sigue visible tras una corrección", () => {
  const parsed = api.parseProductAnalysisResult(result({
    discLevels: [discLevel({ measurements: [measurement({ areaMm2: 120.5, corrections: [correction({ correctedValue: 99.9 })] })] })],
  }));
  const parsedMeasurement = parsed.discLevels[0].measurements[0];
  assert.equal(parsedMeasurement.areaMm2, 120.5, "el dato crudo de la IA no debe alterarse por la corrección");
});

// ---- 11: unit immutable ----
check("11. el body de corrección nunca incluye unit -- el Backend la deriva de field", () => {
  const body = api.buildCorrectionRequestBody({ field: "areaMm2", correctedValue: 99.9 });
  assert.equal(Object.hasOwn(body, "unit"), false);
  assert.equal(body.field, "areaMm2");
});

// ---- 12-14: backend error classification ----
check("12. backend 422 se clasifica como functional", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(422)).kind, "functional");
});

check("13. backend 404 se clasifica como not_found", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(404)).kind, "not_found");
});

check("14. backend 500 se clasifica como upstream", () => {
  assert.equal(state.classifyProductAnalysisError(backendApiError(500)).kind, "upstream");
});

// ---- 15: successful status clears prior mutation error ----
check("15. una mutación exitosa limpia el error de mutación anterior", () => {
  const failed = state.productAnalysisReducer(state.initialProductAnalysisUiState(), {
    type: "mutation_failed",
    error: state.classifyProductAnalysisError(backendApiError(500)),
  });
  assert.ok(failed.mutationError);
  const succeeded = state.productAnalysisReducer(failed, { type: "mutation_succeeded", result: result() });
  assert.equal(succeeded.mutationError, undefined);
});

// ---- 16-17: 67C sigue siendo experimental / no validado sin importar la revisión ----
check("16. 67C sigue mostrando experimental tras cualquier revisión", () => {
  const text = display.displayAxialPairingStatus("paired", { validated: false, experimental: true, reviewRequired: true });
  assert.match(text, /experimental/i);
});

check("17. 67C aceptado nunca se etiqueta como 'validado'", () => {
  const text = display.displayAxialPairingStatus("paired", { validated: false, experimental: true, reviewRequired: true });
  assert.equal(/\bvalidado\b/i.test(text), false);
});

// ---- 18: P10.7 bloqueado nunca ofrece una acción de revisión propia ----
check("18. P10.7 blocked es puramente descriptivo, sin llamado a revisar un hallazgo", () => {
  const text = display.displayDegenerativeFindingsStatus("blocked_preprocessing_parity");
  assert.equal(/aceptar|rechazar|revisar hallazgo/i.test(text), false);
});

// ---- 19: switching runs switches review ----
check("19. cambiar de análisis no mezcla la revisión de otro run", () => {
  const seeded = {
    ...state.initialProductAnalysisUiState(),
    history: [
      result({ analysisRunId: "run-a", review: review({ status: "accepted" }) }),
      result({ analysisRunId: "run-b", review: review({ status: "pending" }) }),
    ],
  };
  const selectedA = state.productAnalysisReducer(seeded, { type: "select_from_history", analysisId: "run-a" });
  assert.equal(selectedA.selected.review.status, "accepted");
  const selectedB = state.productAnalysisReducer(selectedA, { type: "select_from_history", analysisId: "run-b" });
  assert.equal(selectedB.selected.review.status, "pending");
});

// ---- 20: el comentario XSS nunca se renderiza como HTML ----
check("20. el panel nunca usa dangerouslySetInnerHTML para mostrar un comentario", () => {
  const panelSource = readFileSync("src/features/reading/ProductAnalysisV1Panel.tsx", "utf8");
  assert.equal(panelSource.includes("dangerouslySetInnerHTML"), false);
});

console.log(`Post-E50 professional review (stage 78): ${passed} tests OK`);
