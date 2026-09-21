// EXT-05: pure display/delta helper tests for professional feedback curation. Follows the same
// transpile-and-vm-load convention as scripts/ext04b3-visual-evidence-tests.mjs (no jsdom/
// testing-library in this repo — the interactive `FeedbackCurationPanel.tsx` is a thin wrapper
// over these functions and is not rendered here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(path, exportNames, extraSandbox = {}) {
  const source = readFileSync(path, "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console, ...extraSandbox };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const api = load("src/professionalFeedbackCurationApi.ts", [
  "feedbackValueDelta", "displayFeedbackSource", "displayFeedbackStatus", "FEEDBACK_CANDIDATE_STATUSES",
], {
  multiplanarRequest: async () => ({}),
});

function measurementCandidate(overrides = {}) {
  return {
    id: "cand-1", caseId: "CASE-1", analysisRunId: "run-1", source: "measurement", correctionId: "correction-1",
    level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", geometryType: null,
    aiOriginalValue: 12.1, aiOriginalGeometry: null, professionalValue: 12.3, professionalGeometry: null,
    modelId: "sagittal_spider", modelSha256: "sha256:abc", pipelineVersion: "v2", note: null,
    status: "captured", correctedAt: "2026-09-06T12:00:00Z", capturedAt: "2026-09-06T12:00:01Z",
    curatedAt: null, exclusionReason: null,
    ...overrides,
  };
}

check("1. feedbackValueDelta calcula profesional - AI para un candidato de medición", () => {
  assert.ok(Math.abs(api.feedbackValueDelta(measurementCandidate()) - 0.2) < 1e-9);
});

check("2. feedbackValueDelta es null cuando falta el valor de IA", () => {
  assert.equal(api.feedbackValueDelta(measurementCandidate({ aiOriginalValue: null })), null);
});

check("3. feedbackValueDelta es null cuando falta el valor profesional", () => {
  assert.equal(api.feedbackValueDelta(measurementCandidate({ professionalValue: null })), null);
});

check("4. feedbackValueDelta es null para un candidato de geometría (no numérico)", () => {
  assert.equal(api.feedbackValueDelta(measurementCandidate({ aiOriginalValue: null, professionalValue: null, geometryType: "ELLIPSE" })), null);
});

check("5. displayFeedbackSource traduce los cuatro orígenes conocidos", () => {
  assert.equal(api.displayFeedbackSource("measurement"), "Medición corregida");
  assert.equal(api.displayFeedbackSource("evidence_region"), "Región de evidencia corregida");
  assert.equal(api.displayFeedbackSource("professional_new_finding"), "Hallazgo creado por profesional");
  assert.equal(api.displayFeedbackSource("rejected_ai_suggestion"), "Sugerencia de IA rechazada");
});

check("6. displayFeedbackSource cae al valor crudo ante un origen desconocido (no inventa)", () => {
  assert.equal(api.displayFeedbackSource("something_new"), "something_new");
});

check("7. displayFeedbackStatus traduce los cuatro estados permitidos", () => {
  assert.equal(api.displayFeedbackStatus("captured"), "Capturado");
  assert.equal(api.displayFeedbackStatus("eligible_for_curation"), "Elegible para curación");
  assert.equal(api.displayFeedbackStatus("excluded"), "Excluido");
  assert.equal(api.displayFeedbackStatus("curated"), "Curado");
});

check("8. FEEDBACK_CANDIDATE_STATUSES nunca incluye ready_for_training", () => {
  assert.equal(api.FEEDBACK_CANDIDATE_STATUSES.includes("ready_for_training"), false);
  assert.deepEqual([...api.FEEDBACK_CANDIDATE_STATUSES], ["captured", "eligible_for_curation", "excluded", "curated"]);
});

check("9. displayFeedbackStatus cae al valor crudo ante un estado desconocido", () => {
  assert.equal(api.displayFeedbackStatus("ready_for_training"), "ready_for_training");
});

check("10. ningún label usa lenguaje de entrenamiento automático ('reentrenar', 'training')", () => {
  const forbidden = /reentren|training|retrain/i;
  const texts = [
    api.displayFeedbackSource("measurement"), api.displayFeedbackSource("evidence_region"),
    api.displayFeedbackStatus("captured"), api.displayFeedbackStatus("curated"),
  ];
  for (const text of texts) assert.doesNotMatch(text, forbidden, `lenguaje inesperado: "${text}"`);
});

console.log(`\n${passed} tests OK — EXT-05 feedback curation display/delta helpers`);
