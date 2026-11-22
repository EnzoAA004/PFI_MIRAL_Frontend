// EXT-07B: "Comparación con estudio previo" — tests de helpers puros de visualización/emparejamiento, siguiendo la
// misma convención de transpile-and-vm-load que scripts/post-e50-structured-report-tests.mjs (este
// repo no tiene jsdom/testing-library/vitest — el JSX del componente no se renderiza acá, solo los
// helpers que consume).
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

function displayReportPlaneStub(plane) {
  if (plane === "sagittal") return "Sagital";
  if (plane === "axial") return "Axial";
  return "No informado";
}
function displayReportMetricStub(metric) {
  if (metric === "majorAxisMm") return "Eje mayor";
  return metric;
}
function formatReportValueStub(value, unit) {
  return value === null ? "No disponible" : `${value.toFixed(2)} ${unit}`;
}
function formatReportDeltaStub(value, unit) {
  if (value === null) return "No disponible";
  const sign = value > 0 ? "+" : value < 0 ? "" : "±";
  return `${sign}${value.toFixed(2)} ${unit}`;
}
function formatReportPercentStub(value) {
  if (value === null) return "No disponible";
  const sign = value > 0 ? "+" : value < 0 ? "" : "±";
  return `${sign}${value.toFixed(1)} %`;
}
function reportCorrectedMarkerStub(source) {
  return source === "professional_correction" ? "corregido" : "";
}

const display = load("src/features/reading/beforeAfterDisplay.ts", [
  "beforeAfterRows",
  "matchingEvidence",
  "beforeAfterRowLabel",
  "beforeAfterValueLine",
  "beforeAfterDeltaLine",
  "hasBeforeAfter",
  "BEFORE_AFTER_TITLE",
  "NO_BEFORE_AFTER_MESSAGE",
], {
  displayReportPlane: displayReportPlaneStub,
  displayReportMetric: displayReportMetricStub,
  formatReportValue: formatReportValueStub,
  formatReportDelta: formatReportDeltaStub,
  formatReportPercent: formatReportPercentStub,
  reportCorrectedMarker: reportCorrectedMarkerStub,
});

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function row(overrides = {}) {
  return {
    previousCaseId: "CASE-B",
    previousStudyDate: "2026-02-10",
    currentStudyDate: "2026-03-10",
    level: "L4-L5",
    plane: "sagittal",
    structure: "disc",
    metric: "majorAxisMm",
    unit: "mm",
    previousEffectiveValue: 12.3,
    currentEffectiveValue: 12.9,
    absoluteDelta: 0.6,
    percentageDelta: 4.878,
    previousValueSource: "professional_correction",
    currentValueSource: "ai_original",
    previousAutomaticValue: 12.1,
    currentAutomaticValue: 12.9,
    previousCorrectedValue: 12.3,
    currentCorrectedValue: null,
    ...overrides,
  };
}

function evidenceItem(overrides = {}) {
  return {
    evidenceId: "region-1",
    plane: "sagittal",
    level: "L4-L5",
    structure: "disc",
    geometry: { type: "BBOX", x: 10, y: 10, width: 20, height: 20 },
    source: "ai_suggested",
    reviewStatus: "pending",
    label: "Región de interés",
    warning: null,
    experimental: false,
    baseImage: null,
    ...overrides,
  };
}

check("1. beforeAfterRows respeta el límite (por defecto 4)", () => {
  const history = { available: true, comparisons: [row(), row(), row(), row(), row()], previousStudies: [], currentStudy: {}, message: "" };
  assert.equal(display.beforeAfterRows(history).length, 4);
  assert.equal(display.beforeAfterRows(history, 2).length, 2);
});

check("2. beforeAfterRows con historia null -> []", () => {
  assert.equal(display.beforeAfterRows(null).length, 0);
});

check("3. hasBeforeAfter es false sin comparaciones", () => {
  assert.equal(display.hasBeforeAfter(null), false);
  assert.equal(display.hasBeforeAfter({ longitudinalHistory: { comparisons: [] } }), false);
});

check("4. matchingEvidence encuentra por level+plane+structure", () => {
  const found = display.matchingEvidence(row(), [evidenceItem({ evidenceId: "no-match", level: "L3-L4" }), evidenceItem({ evidenceId: "match" })]);
  assert.equal(found.evidenceId, "match");
});

check("5. matchingEvidence devuelve null si no hay coincidencia (no crashea, no inventa)", () => {
  const found = display.matchingEvidence(row(), [evidenceItem({ level: "L3-L4" })]);
  assert.equal(found, null);
  assert.equal(display.matchingEvidence(row(), []), null);
});

check("6. beforeAfterRowLabel es legible y neutral", () => {
  const label = display.beforeAfterRowLabel(row());
  assert.equal(label, "L4-L5 · Sagital · disc · Eje mayor");
});

check("7. beforeAfterValueLine muestra el marcador de corrección profesional cuando corresponde", () => {
  assert.equal(display.beforeAfterValueLine(12.3, "mm", "professional_correction"), "12.30 mm (corregido)");
  assert.equal(display.beforeAfterValueLine(12.9, "mm", "ai_original"), "12.90 mm");
});

check("8. beforeAfterDeltaLine usa Delta/Delta% (vocabulario neutral, con signo matemático)", () => {
  assert.equal(display.beforeAfterDeltaLine(row()), "+0.60 mm · +4.9 %");
});

check("9. ningún texto usa lenguaje clínico prohibido (mejoró/empeoró/progresión)", () => {
  const forbidden = /mejor[oó]|empeor[oó]|progres|deterior/i;
  const texts = [display.BEFORE_AFTER_TITLE, display.NO_BEFORE_AFTER_MESSAGE, display.beforeAfterRowLabel(row()), display.beforeAfterDeltaLine(row())];
  for (const text of texts) assert.doesNotMatch(text, forbidden, `lenguaje clínico inesperado: "${text}"`);
});

check("10. BEFORE_AFTER_TITLE es exactamente el pedido", () => {
  assert.equal(display.BEFORE_AFTER_TITLE, "Comparación con estudio previo");
});

console.log(`\n${passed} tests OK — EXT-07B before/after display helpers`);
