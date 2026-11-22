// EXT-04B3: tests del parser de contrato + helpers de visualización para el bloque visualEvidence de
// StudyReportDto (Backend EXT-04B2, extensions/ext-04-visual-evidence-backend @ 37bc4c1).
// Sigue la misma convención de transpile-and-vm-load que scripts/post-e50-structured-report-tests.mjs
// (sin jsdom/testing-library en este repo — el JSX del componente en sí no se renderiza acá; solo las
// funciones puras de parser/visualización que consume el componente se testean de forma unitaria, el mismo precedente que
// la lógica propia de MeasurementLayer.tsx testeada a través de measurements.ts, no del componente).
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
  const sandbox = {
    exports: {},
    console,
    BackendApiError: class BackendApiError extends Error {},
    API_BASE_URL: "http://localhost:8080",
    authHeaders: () => ({}),
    refreshDoctorSession: async () => {},
    ensureAuthSession: async () => {},
    generateTraceId: () => "trace-test",
    multiplanarRequest: async () => ({}),
    parseLongitudinalComparisonResult: (value) => value,
    ...extraSandbox,
  };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

// displayReportPlane se stubbea exactamente como lo define studyReportDisplay.ts, ya que
// visualEvidenceDisplay.ts lo importa de ese módulo hermano y el loader de arriba
// resuelve los imports mediante globals del sandbox, no una resolución real de módulos entre archivos.
function displayReportPlaneStub(plane) {
  if (plane === "sagittal") return "Sagital";
  if (plane === "axial") return "Axial";
  return "No informado";
}

const api = load("src/studyReportApi.ts", ["parseStudyReport", "parseVisualEvidence", "parseEvidenceGeometry", "parseEvidenceBaseImage", "StudyReportContractError"]);
const display = load("src/features/reading/visualEvidenceDisplay.ts", [
  "displayEvidenceSource",
  "evidenceVisualGroup",
  "displayEvidenceReviewStatus",
  "evidenceAriaLabel",
  "evidenceMaskAssetUrl",
  "evidenceBaseImageSliceUrl",
  "NO_VISUAL_EVIDENCE_MESSAGE",
  "NO_BASE_IMAGE_MESSAGE",
  "EXPERIMENTAL_BADGE_TEXT",
], { displayReportPlane: displayReportPlaneStub });

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// vm.runInNewContext le da a cada módulo cargado su propio realm (sus propios constructores
// de Array/Object), por lo que un valor devuelto a través de ese límite falla el
// deepEqual estricto de Node (identidad de prototipo distinta) incluso cuando es estructuralmente idéntico.
// Comparar vía JSON evita ese falso negativo — la misma técnica que el
// post-e50-structured-report-tests.mjs existente esquiva comparando solo campos
// primitivos de a uno.
function assertSameJson(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function baseReport(overrides = {}) {
  return {
    schemaVersion: "pfi.study-report.v1",
    generatedAt: "2026-09-03T12:00:00Z",
    reportStatus: "ready",
    caseId: "EXT04B-VISUAL-01",
    studyDate: "2026-09-01",
    modality: "MRI",
    analysis: {
      analysisRunId: "run-ext04b-1",
      analysisStatus: "completed",
      releaseId: "post-e50-ai-product-freeze-v1",
      createdAt: "2026-09-01T11:00:00Z",
      completedAt: "2026-09-01T11:00:02Z",
      humanReviewRequired: true,
    },
    review: { reviewStatus: "accepted", reviewComment: null, reviewedAt: null },
    discLevels: [],
    measurements: [],
    warnings: [],
    limitations: [],
    longitudinalComparison: null,
    longitudinalHistory: null,
    safety: {
      humanReviewRequired: true,
      notClinicalDiagnosis: true,
      autonomousDiagnosis: false,
      disclaimer: "Este informe corresponde a un prototipo de apoyo al análisis y no constituye un diagnóstico médico autónomo.",
    },
    traceability: {
      caseId: "EXT04B-VISUAL-01",
      analysisRunId: "run-ext04b-1",
      analysisSchemaVersion: "pfi.ai-product-result.v2",
      releaseId: "post-e50-ai-product-freeze-v1",
      generatedAt: "2026-09-03T12:00:00Z",
    },
    ...overrides,
  };
}

function bboxItem(overrides = {}) {
  return {
    evidenceId: "region-1",
    plane: "sagittal",
    level: "L4-L5",
    structure: "disc",
    geometryType: "BBOX",
    geometry: { x: 100, y: 120, width: 30, height: 20 },
    source: "ai_suggested",
    reviewStatus: "pending",
    label: "Región de interés",
    warning: "Sugerencia de IA sin revisión profesional.",
    experimental: false,
    baseImage: { inputId: "inp_2822bf9640ab40a289050a30ce2fe6fd", sliceIndex: 6 },
    ...overrides,
  };
}

// 1. visualEvidence ausente
check("1. visualEvidence ausente -> []", () => {
  assertSameJson(api.parseVisualEvidence(undefined), []);
});

// 2. visualEvidence null
check("2. visualEvidence null -> []", () => {
  assertSameJson(api.parseVisualEvidence(null), []);
});

// 3. BBOX
check("3. BBOX se parsea con sus 4 campos numéricos", () => {
  const geometry = api.parseEvidenceGeometry("BBOX", { x: 10, y: 20, width: 30, height: 40 });
  assertSameJson(geometry, { type: "BBOX", x: 10, y: 20, width: 30, height: 40 });
});

// 4. ELLIPSE
check("4. ELLIPSE se parsea con centro y radios", () => {
  const geometry = api.parseEvidenceGeometry("ELLIPSE", { centerX: 128, centerY: 128, radiusX: 12, radiusY: 8 });
  assertSameJson(geometry, { type: "ELLIPSE", centerX: 128, centerY: 128, radiusX: 12, radiusY: 8 });
});

// 5. POLYGON
check("5. POLYGON exige al menos 3 puntos", () => {
  const geometry = api.parseEvidenceGeometry("POLYGON", { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] });
  assert.equal(geometry.type, "POLYGON");
  assert.equal(geometry.points.length, 3);
  assert.equal(api.parseEvidenceGeometry("POLYGON", { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }), null);
});

// 6. MASK_REFERENCE
check("6. MASK_REFERENCE se parsea y resuelve a la URL de assets existente", () => {
  const geometry = api.parseEvidenceGeometry("MASK_REFERENCE", { runId: "run-ext04b-1", plane: "sagittal", assetName: "mask-preview.png" });
  assertSameJson(geometry, { type: "MASK_REFERENCE", runId: "run-ext04b-1", plane: "sagittal", assetName: "mask-preview.png" });
  const url = display.evidenceMaskAssetUrl(geometry);
  assert.equal(url, "http://localhost:8080/api/ai/assets/run-ext04b-1/sagittal/mask-preview.png");
});

check("6b. MASK_REFERENCE rechaza path traversal (mismo guard que EvidenceGeometry.MaskReference)", () => {
  assert.equal(api.parseEvidenceGeometry("MASK_REFERENCE", { runId: "../etc", plane: "sagittal", assetName: "x.png" }), null);
  assert.equal(api.parseEvidenceGeometry("MASK_REFERENCE", { runId: "run-1", plane: "sagittal", assetName: "../x.png" }), null);
});

// 7. geometry desconocida fail-safe
check("7. geometryType desconocido no crashea: devuelve null y esa región se descarta", () => {
  assert.equal(api.parseEvidenceGeometry("SPLINE", { anything: 1 }), null);
  const items = api.parseVisualEvidence([bboxItem(), bboxItem({ evidenceId: "region-bad", geometryType: "SPLINE", geometry: {} })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].evidenceId, "region-1");
});

// 8. AI suggested
check("8. AI suggested: label y grupo visual", () => {
  assert.equal(display.displayEvidenceSource("ai_suggested"), "Región sugerida por IA");
  assert.equal(display.evidenceVisualGroup("ai_suggested"), "ai");
});

// 9. professional validated (DTO source real: "ai_validated")
check("9. professional validated (source=ai_validated): label y grupo visual", () => {
  assert.equal(display.displayEvidenceSource("ai_validated"), "Región revisada por profesional");
  assert.equal(display.evidenceVisualGroup("ai_validated"), "professional");
});

// 10. professional corrected
check("10. professional corrected: label y grupo visual", () => {
  assert.equal(display.displayEvidenceSource("professional_corrected"), "Región corregida por profesional");
  assert.equal(display.evidenceVisualGroup("professional_corrected"), "professional");
});

// 11. professional drawn
check("11. professional drawn: label y grupo visual", () => {
  assert.equal(display.displayEvidenceSource("professional_drawn"), "Región creada por profesional");
  assert.equal(display.evidenceVisualGroup("professional_drawn"), "professional");
});

// 12. experimental badge
check("12. badge experimental y el flag sobrevive el parseo", () => {
  assert.equal(display.EXPERIMENTAL_BADGE_TEXT, "Experimental");
  const [item] = api.parseVisualEvidence([bboxItem({ experimental: true })]);
  assert.equal(item.experimental, true);
});

// 13. no clinical wording
check("13. ningún label/mensaje usa lenguaje clínico prohibido", () => {
  const forbidden = /patológic|diagnóstic|lesión confirmada|confirmad[oa]|tratamiento recomendado|grave|empeor|mejor/i;
  const texts = [
    display.displayEvidenceSource("ai_suggested"),
    display.displayEvidenceSource("ai_validated"),
    display.displayEvidenceSource("professional_corrected"),
    display.displayEvidenceSource("professional_drawn"),
    display.NO_VISUAL_EVIDENCE_MESSAGE,
    display.EXPERIMENTAL_BADGE_TEXT,
    display.displayEvidenceReviewStatus("accepted"),
    display.displayEvidenceReviewStatus("rejected"),
  ];
  for (const text of texts) assert.doesNotMatch(text, forbidden, `lenguaje clínico inesperado: "${text}"`);
});

// 14. provenance / 15. reviewer ID no visible
check("14/15. el item parseado no expone modelId/reviewedBy/authoredBy aunque el JSON los traiga", () => {
  const raw = bboxItem({ modelId: "sagittal_spider", reviewedBy: "dr-secreta", authoredBy: "dr-secreta", modelSha256: "abc123" });
  const [item] = api.parseVisualEvidence([raw]);
  const keys = Object.keys(item);
  assertSameJson(keys.sort(), ["evidenceId", "experimental", "geometry", "label", "level", "plane", "reviewStatus", "source", "structure", "warning", "baseImage"].sort());
  assert.equal("modelId" in item, false);
  assert.equal("reviewedBy" in item, false);
  assert.equal("authoredBy" in item, false);
});

// 16. responsive coordinate scaling: la base 0..256 no se reinterpreta como píxeles CSS
check("16. la geometría permanece en la base canónica 0..256, sin conversión a píxeles CSS", () => {
  const geometry = api.parseEvidenceGeometry("BBOX", { x: 0, y: 0, width: 256, height: 256 });
  assertSameJson(geometry, { type: "BBOX", x: 0, y: 0, width: 256, height: 256 });
  // Un valor fuera de 0..256 (más allá de la tolerancia de punto flotante) se descarta:
  // nunca se clampea silenciosamente a un valor inventado.
  assert.equal(api.parseEvidenceGeometry("BBOX", { x: 300, y: 0, width: 10, height: 10 }), null);
});

// 17. report integration
check("17. parseStudyReport integra visualEvidence dentro del reporte", () => {
  const parsed = api.parseStudyReport(baseReport({ visualEvidence: [bboxItem()] }));
  assert.equal(parsed.visualEvidence.length, 1);
  assert.equal(parsed.visualEvidence[0].evidenceId, "region-1");
});

// 18. multiple evidence regions
check("18. múltiples regiones de evidencia se preservan todas", () => {
  const items = api.parseVisualEvidence([
    bboxItem({ evidenceId: "r1" }),
    bboxItem({ evidenceId: "r2", geometryType: "ELLIPSE", geometry: { centerX: 50, centerY: 50, radiusX: 5, radiusY: 5 } }),
    bboxItem({ evidenceId: "r3", geometryType: "POLYGON", geometry: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] } }),
  ]);
  assert.equal(items.length, 3);
  assertSameJson(items.map((item) => item.evidenceId), ["r1", "r2", "r3"]);
});

// 19. rejected/non-effective no mostrado si Backend no lo envía
check("19. el parser nunca inventa regiones adicionales: solo refleja lo que Backend envía", () => {
  const items = api.parseVisualEvidence([bboxItem()]);
  assert.equal(items.length, 1);
  assert.equal(api.parseVisualEvidence([]).length, 0);
});

// 20. backward compatibility con pfi.study-report.v1 previo (sin la clave visualEvidence)
check("20. un reporte pfi.study-report.v1 previo (sin la clave visualEvidence) sigue parseando", () => {
  const legacy = baseReport();
  delete legacy.visualEvidence;
  const parsed = api.parseStudyReport(legacy);
  assert.equal(parsed.schemaVersion, "pfi.study-report.v1");
  assertSameJson(parsed.visualEvidence, []);
});

check("21. aria-label es descriptivo y no depende del color", () => {
  const [item] = api.parseVisualEvidence([bboxItem({ experimental: true })]);
  const label = display.evidenceAriaLabel(item);
  assert.match(label, /Región sugerida por IA/);
  assert.match(label, /L4-L5/);
  assert.match(label, /Sagital/);
  assert.match(label, /experimental/);
});

// EXT-04B3.5: baseImage image-context checks -------------------------------

check("22. baseImage válido se parsea con inputId y sliceIndex", () => {
  const baseImage = api.parseEvidenceBaseImage({ inputId: "inp_2822bf9640ab40a289050a30ce2fe6fd", sliceIndex: 6 });
  assertSameJson(baseImage, { inputId: "inp_2822bf9640ab40a289050a30ce2fe6fd", sliceIndex: 6 });
});

check("23. baseImage ausente o null -> null (no crashea, no fabrica una referencia)", () => {
  assert.equal(api.parseEvidenceBaseImage(undefined), null);
  assert.equal(api.parseEvidenceBaseImage(null), null);
});

check("24. baseImage malformado (sliceIndex no entero, inputId vacío) -> null, fail-safe", () => {
  assert.equal(api.parseEvidenceBaseImage({ inputId: "", sliceIndex: 6 }), null);
  assert.equal(api.parseEvidenceBaseImage({ inputId: "inp_abc", sliceIndex: 1.5 }), null);
  assert.equal(api.parseEvidenceBaseImage({ inputId: "inp_abc", sliceIndex: -1 }), null);
  assert.equal(api.parseEvidenceBaseImage({ inputId: "inp_abc" }), null);
});

check("25. un item sin la clave baseImage (reporte pre-EXT-04B3.5) parsea con baseImage: null", () => {
  const raw = bboxItem();
  delete raw.baseImage;
  const [item] = api.parseVisualEvidence([raw]);
  assert.equal(item.baseImage, null);
});

check("26. evidenceBaseImageSliceUrl reutiliza el endpoint real GET /api/ai/series/{inputId}/slices/{index}", () => {
  const url = display.evidenceBaseImageSliceUrl({ inputId: "inp_2822bf9640ab40a289050a30ce2fe6fd", sliceIndex: 6 });
  assert.equal(url, "http://localhost:8080/api/ai/series/inp_2822bf9640ab40a289050a30ce2fe6fd/slices/6");
});

check("27. NO_BASE_IMAGE_MESSAGE es el fallback textual pedido, sin lenguaje clínico", () => {
  assert.equal(display.NO_BASE_IMAGE_MESSAGE, "Imagen base no disponible.");
});

check("28. un reporte completo con baseImage integra el item sin perder el campo", () => {
  const parsed = api.parseStudyReport(baseReport({ visualEvidence: [bboxItem()] }));
  assert.equal(parsed.visualEvidence[0].baseImage.inputId, "inp_2822bf9640ab40a289050a30ce2fe6fd");
  assert.equal(parsed.visualEvidence[0].baseImage.sliceIndex, 6);
});

console.log(`\n${passed} tests OK — EXT-04B3/EXT-04B3.5 visual evidence contract/display`);
