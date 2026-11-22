// EXT-02: tests de helpers puros de visualización/formato para el dashboard de Review Analytics. Sigue la misma
// convención de transpile-and-vm-load que scripts/ext04b3-visual-evidence-tests.mjs.
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

const api = load("src/reviewAnalyticsApi.ts", [
  "displayMetricGroupLabel", "formatPercent", "formatOptionalNumber", "REVIEW_ANALYTICS_DISCLAIMER",
], {
  multiplanarRequest: async () => ({}),
});

function group(overrides = {}) {
  return {
    level: "L4-L5", plane: "sagittal", structure: "disc", metric: "majorAxisMm", unit: "mm", releaseId: "release-1",
    automaticCount: 4, correctedCount: 2, correctionRate: 0.5, meanAbsoluteError: 0.3, medianAbsoluteError: 0.25, signedMeanError: -0.1,
    ...overrides,
  };
}

check("1. displayMetricGroupLabel junta nivel/plano/estructura/métrica", () => {
  assert.equal(api.displayMetricGroupLabel(group()), "L4-L5 · sagittal · disc · majorAxisMm");
});

check("2. displayMetricGroupLabel usa un texto neutral cuando falta el nivel", () => {
  assert.equal(api.displayMetricGroupLabel(group({ level: null })), "sin nivel · sagittal · disc · majorAxisMm");
});

check("3. formatPercent convierte una proporción 0..1 a porcentaje con un decimal", () => {
  assert.equal(api.formatPercent(0.5), "50.0%");
  assert.equal(api.formatPercent(0), "0.0%");
  assert.equal(api.formatPercent(1), "100.0%");
});

check("4. formatOptionalNumber muestra el guion cuando el valor es null (nunca fabrica un cero)", () => {
  assert.equal(api.formatOptionalNumber(null), "—");
});

check("5. formatOptionalNumber redondea a 2 decimales por defecto", () => {
  assert.equal(api.formatOptionalNumber(1.23456), "1.23");
});

check("6. formatOptionalNumber respeta una cantidad de decimales explícita", () => {
  assert.equal(api.formatOptionalNumber(1.23456, 4), "1.2346");
});

check("7. REVIEW_ANALYTICS_DISCLAIMER nunca afirma (solo puede negar) exactitud clínica o seguridad del modelo", () => {
  const affirmsClinicalAccuracy = /(?<!no es una medida de )(?<!ni de )exactitud cl[ií]nica|modelo seguro|garantiz/i;
  assert.doesNotMatch(api.REVIEW_ANALYTICS_DISCLAIMER, affirmsClinicalAccuracy);
  assert.match(api.REVIEW_ANALYTICS_DISCLAIMER, /no es una medida de exactitud cl[ií]nica/i);
});

check("8. REVIEW_ANALYTICS_DISCLAIMER usa vocabulario de telemetría interna, no semáforo clínico", () => {
  assert.match(api.REVIEW_ANALYTICS_DISCLAIMER, /telemetr[ií]a interna/i);
});

console.log(`\n${passed} tests OK — EXT-02 review analytics display helpers`);
