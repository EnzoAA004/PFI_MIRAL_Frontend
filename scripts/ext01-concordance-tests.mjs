// EXT-01: pure display helper tests for evidence concordance. Follows the same
// transpile-and-vm-load convention as scripts/ext04b3-visual-evidence-tests.mjs.
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

const api = load("src/concordanceApi.ts", [
  "displayConcordanceState", "displayConcordanceReason", "displayConcordanceSentence", "CONCORDANCE_STATES",
], {
  multiplanarRequest: async () => ({}),
});

check("1. displayConcordanceState traduce los 5 estados conocidos", () => {
  assert.equal(api.displayConcordanceState("CONCORDANT"), "Concordante");
  assert.equal(api.displayConcordanceState("PARTIALLY_CONCORDANT"), "Parcialmente concordante");
  assert.equal(api.displayConcordanceState("DISCREPANT"), "Discrepante");
  assert.equal(api.displayConcordanceState("INSUFFICIENT_EVIDENCE"), "Evidencia insuficiente");
  assert.equal(api.displayConcordanceState("NOT_COMPARABLE"), "No comparable");
});

check("2. CONCORDANCE_STATES tiene exactamente los 5 estados del spec", () => {
  assert.deepEqual([...api.CONCORDANCE_STATES], ["CONCORDANT", "PARTIALLY_CONCORDANT", "DISCREPANT", "INSUFFICIENT_EVIDENCE", "NOT_COMPARABLE"]);
});

check("3. displayConcordanceReason traduce un reasonCode conocido", () => {
  assert.equal(api.displayConcordanceReason("SAME_FINDING"), "Mismo hallazgo en todas las fuentes");
});

check("4. displayConcordanceReason cae al código crudo ante uno desconocido (no inventa)", () => {
  assert.equal(api.displayConcordanceReason("SOME_FUTURE_REASON"), "SOME_FUTURE_REASON");
});

check("5. displayConcordanceSentence nunca dice 'confirmado por dos IAs'", () => {
  const sentence = api.displayConcordanceSentence({ state: "CONCORDANT", reasonCode: "SAME_FINDING", comparedEvidenceIds: ["e1", "e2"], ruleVersion: "v1" });
  assert.doesNotMatch(sentence, /confirmado por dos/i);
  assert.match(sentence, /según la regla v1/);
});

check("6. displayConcordanceSentence siempre nombra explícitamente la versión de la regla", () => {
  const sentence = api.displayConcordanceSentence({ state: "DISCREPANT", reasonCode: "SEVERITY_SPREAD_TWO_OR_MORE_STEPS", comparedEvidenceIds: ["e1", "e2"], ruleVersion: "v1" });
  assert.match(sentence, /regla v1/);
});

check("7. displayConcordanceSentence nunca usa lenguaje diagnóstico", () => {
  const forbidden = /diagn[oó]stico confirmado|patolog[ií]a confirmada/i;
  for (const state of api.CONCORDANCE_STATES) {
    const sentence = api.displayConcordanceSentence({ state, reasonCode: "SAME_FINDING", comparedEvidenceIds: [], ruleVersion: "v1" });
    assert.doesNotMatch(sentence, forbidden);
  }
});

console.log(`\n${passed} tests OK — EXT-01 concordance display helpers`);
