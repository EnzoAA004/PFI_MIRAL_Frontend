// EXT-04B5: tests de matemática pura de edición de geometría + contrato de respuesta de escritura para el
// flujo de anotación/corrección profesional. Sigue la misma convención de transpile-and-vm-load que
// scripts/ext04b3-visual-evidence-tests.mjs (sin jsdom/testing-library en este repo — los
// componentes interactivos `EvidenceRegionEditor.tsx`/`NewEvidenceRegionCreator.tsx` son wrappers
// delgados sobre estas funciones y no se renderizan acá; solo se testea de forma unitaria la lógica que consumen,
// el mismo precedente que `MeasurementLayer.tsx` testeado a través de `measurements.ts`).
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

function assertSameJson(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

const editing = load("src/features/reading/evidenceRegionEditing.ts", [
  "CANONICAL_MIN", "CANONICAL_MAX",
  "clampCanonical", "isGraphicallyEditable", "pointFromClient",
  "moveBbox", "resizeBboxHandle", "moveEllipseCenter", "resizeEllipseRadius",
  "bboxHandlePositions", "geometryToRequestMap", "defaultBbox", "defaultEllipse",
]);

const api = load("src/studyReportApi.ts", ["parseEvidenceGeometry"], {
  BackendApiError: class BackendApiError extends Error {},
  API_BASE_URL: "http://localhost:8080",
  authHeaders: () => ({}),
  refreshDoctorSession: async () => {},
  ensureAuthSession: async () => {},
  generateTraceId: () => "trace-test",
  multiplanarRequest: async () => ({}),
  parseLongitudinalComparisonResult: (value) => value,
});

const annotationApi = load("src/professionalAnnotationApi.ts", [
  "parseEvidenceRegionResponse", "parseEvidenceRegionCorrectionResponse", "ProfessionalAnnotationContractError",
], {
  parseEvidenceGeometry: api.parseEvidenceGeometry,
  multiplanarRequest: async () => ({}),
});

// --- clampCanonical ---------------------------------------------------------

check("1. clampCanonical clampea por debajo de 0", () => {
  assert.equal(editing.clampCanonical(-50), 0);
});

check("2. clampCanonical clampea por encima de 256", () => {
  assert.equal(editing.clampCanonical(400), 256);
});

check("3. clampCanonical no toca un valor ya dentro del rango", () => {
  assert.equal(editing.clampCanonical(128), 128);
});

// --- isGraphicallyEditable ---------------------------------------------------

check("4. BBOX es editable gráficamente", () => {
  assert.equal(editing.isGraphicallyEditable("BBOX"), true);
});

check("5. ELLIPSE es editable gráficamente", () => {
  assert.equal(editing.isGraphicallyEditable("ELLIPSE"), true);
});

check("6. POLYGON NO es editable gráficamente en esta iteración", () => {
  assert.equal(editing.isGraphicallyEditable("POLYGON"), false);
});

check("7. MASK_REFERENCE nunca es editable gráficamente (es un ráster, no un vector)", () => {
  assert.equal(editing.isGraphicallyEditable("MASK_REFERENCE"), false);
});

// --- pointFromClient ---------------------------------------------------------

check("8. pointFromClient convierte coordenadas de cliente a la base canónica 0..256", () => {
  const rect = { left: 100, top: 100, width: 200, height: 200 };
  const point = editing.pointFromClient(rect, 200, 150);
  assertSameJson(point, { x: 128, y: 64 });
});

check("9. pointFromClient clampea un punto fuera del marco a 0..256", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assertSameJson(editing.pointFromClient(rect, -50, 500), { x: 0, y: 256 });
});

check("10. pointFromClient devuelve null si el marco no tiene tamaño (aún no montado)", () => {
  assert.equal(editing.pointFromClient({ left: 0, top: 0, width: 0, height: 0 }, 10, 10), null);
});

// --- BBOX move/resize ---------------------------------------------------------

check("11. moveBbox traslada la caja manteniendo su tamaño", () => {
  const bbox = { type: "BBOX", x: 50, y: 50, width: 20, height: 10 };
  assertSameJson(editing.moveBbox(bbox, 5, -5), { type: "BBOX", x: 55, y: 45, width: 20, height: 10 });
});

check("12. moveBbox nunca deja la caja salir del cuadrado canónico", () => {
  const bbox = { type: "BBOX", x: 240, y: 240, width: 20, height: 20 };
  const moved = editing.moveBbox(bbox, 100, 100);
  assert.ok(moved.x + moved.width <= editing.CANONICAL_MAX);
  assert.ok(moved.y + moved.height <= editing.CANONICAL_MAX);
});

check("13. resizeBboxHandle 'se' agranda la caja arrastrando la esquina inferior derecha", () => {
  const bbox = { type: "BBOX", x: 10, y: 10, width: 20, height: 20 };
  const resized = editing.resizeBboxHandle(bbox, "se", { x: 50, y: 60 });
  assertSameJson(resized, { type: "BBOX", x: 10, y: 10, width: 40, height: 50 });
});

check("14. resizeBboxHandle respeta un tamaño mínimo: no invierte la caja", () => {
  const bbox = { type: "BBOX", x: 100, y: 100, width: 20, height: 20 };
  const resized = editing.resizeBboxHandle(bbox, "se", { x: 50, y: 50 });
  assert.ok(resized.width > 0);
  assert.ok(resized.height > 0);
  assert.ok(resized.x + resized.width > resized.x);
});

check("15. resizeBboxHandle clampea al máximo canónico al arrastrar más allá de 256", () => {
  const bbox = { type: "BBOX", x: 200, y: 200, width: 20, height: 20 };
  const resized = editing.resizeBboxHandle(bbox, "se", { x: 500, y: 500 });
  assert.ok(resized.x + resized.width <= editing.CANONICAL_MAX);
  assert.ok(resized.y + resized.height <= editing.CANONICAL_MAX);
});

check("16. bboxHandlePositions devuelve las cuatro esquinas correctas", () => {
  const bbox = { type: "BBOX", x: 10, y: 20, width: 30, height: 40 };
  assertSameJson(editing.bboxHandlePositions(bbox), {
    nw: { x: 10, y: 20 }, ne: { x: 40, y: 20 }, sw: { x: 10, y: 60 }, se: { x: 40, y: 60 },
  });
});

// --- ELLIPSE move/resize -------------------------------------------------------

check("17. moveEllipseCenter mueve el centro clampeado a 0..256", () => {
  const ellipse = { type: "ELLIPSE", centerX: 128, centerY: 128, radiusX: 10, radiusY: 10 };
  assertSameJson(editing.moveEllipseCenter(ellipse, { x: -20, y: 300 }), { type: "ELLIPSE", centerX: 0, centerY: 256, radiusX: 10, radiusY: 10 });
});

check("18. resizeEllipseRadius('x') calcula el radio como distancia al centro", () => {
  const ellipse = { type: "ELLIPSE", centerX: 100, centerY: 100, radiusX: 10, radiusY: 10 };
  const resized = editing.resizeEllipseRadius(ellipse, "x", { x: 130, y: 100 });
  assert.equal(resized.radiusX, 30);
  assert.equal(resized.radiusY, 10);
});

check("19. resizeEllipseRadius topea el radio para que la elipse no salga del cuadrado canónico", () => {
  const ellipse = { type: "ELLIPSE", centerX: 20, centerY: 20, radiusX: 10, radiusY: 10 };
  const resized = editing.resizeEllipseRadius(ellipse, "x", { x: 500, y: 20 });
  assert.ok(resized.centerX - resized.radiusX >= editing.CANONICAL_MIN - 1e-9);
});

check("20. defaultBbox/defaultEllipse arrancan dentro del cuadrado canónico", () => {
  const bbox = editing.defaultBbox();
  const ellipse = editing.defaultEllipse();
  assert.ok(bbox.x >= 0 && bbox.x + bbox.width <= 256);
  assert.ok(ellipse.centerX - ellipse.radiusX >= 0 && ellipse.centerX + ellipse.radiusX <= 256);
});

// --- geometryToRequestMap: debe coincidir con lo que espera EvidenceGeometry.fromMap (Backend) --

check("21. geometryToRequestMap(BBOX) usa las claves x/y/width/height", () => {
  assertSameJson(editing.geometryToRequestMap({ type: "BBOX", x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 });
});

check("22. geometryToRequestMap(ELLIPSE) usa las claves centerX/centerY/radiusX/radiusY", () => {
  assertSameJson(editing.geometryToRequestMap({ type: "ELLIPSE", centerX: 1, centerY: 2, radiusX: 3, radiusY: 4 }), { centerX: 1, centerY: 2, radiusX: 3, radiusY: 4 });
});

// --- write-response contract parsing -------------------------------------------

function regionResponse(overrides = {}) {
  return {
    evidenceId: "region-1",
    analysisRunId: "run-1",
    plane: "sagittal",
    level: "L4-L5",
    structure: "disc",
    sliceIndex: 6,
    origin: "professional",
    geometryType: "BBOX",
    geometry: { x: 10, y: 10, width: 20, height: 20 },
    label: "Región de interés",
    experimental: false,
    createdAt: "2026-09-05T12:00:00Z",
    ...overrides,
  };
}

check("23. parseEvidenceRegionResponse parsea una región profesional creada", () => {
  const parsed = annotationApi.parseEvidenceRegionResponse(regionResponse());
  assert.equal(parsed.origin, "professional");
  assertSameJson(parsed.geometry, { type: "BBOX", x: 10, y: 10, width: 20, height: 20 });
});

check("24. parseEvidenceRegionResponse nunca expone authoredBy/reviewedBy aunque el JSON los traiga", () => {
  const raw = regionResponse({ authoredBy: "dr-secreta", reviewedBy: "dr-secreta" });
  const parsed = annotationApi.parseEvidenceRegionResponse(raw);
  assert.equal("authoredBy" in parsed, false);
  assert.equal("reviewedBy" in parsed, false);
});

check("25. parseEvidenceRegionResponse rechaza un origin desconocido (fail-closed, no adivina)", () => {
  assert.throws(() => annotationApi.parseEvidenceRegionResponse(regionResponse({ origin: "robot" })), annotationApi.ProfessionalAnnotationContractError);
});

check("26. parseEvidenceRegionCorrectionResponse conserva la geometría original Y la corregida", () => {
  const parsed = annotationApi.parseEvidenceRegionCorrectionResponse({
    correctionId: "correction-1",
    evidenceRegionId: "region-1",
    analysisRunId: "run-1",
    originalGeometryType: "BBOX",
    originalGeometry: { x: 10, y: 10, width: 20, height: 20 },
    correctedGeometryType: "ELLIPSE",
    correctedGeometry: { centerX: 20, centerY: 20, radiusX: 8, radiusY: 6 },
    comment: null,
    createdAt: "2026-09-05T12:05:00Z",
  });
  assert.equal(parsed.originalGeometryType, "BBOX");
  assert.equal(parsed.correctedGeometryType, "ELLIPSE");
});

check("27. parseEvidenceRegionCorrectionResponse rechaza una geometría corregida malformada (fail-closed)", () => {
  assert.throws(() => annotationApi.parseEvidenceRegionCorrectionResponse({
    correctionId: "correction-1",
    evidenceRegionId: "region-1",
    analysisRunId: "run-1",
    originalGeometryType: "BBOX",
    originalGeometry: { x: 10, y: 10, width: 20, height: 20 },
    correctedGeometryType: "ELLIPSE",
    correctedGeometry: { centerX: 20 },
    comment: null,
    createdAt: "2026-09-05T12:05:00Z",
  }), annotationApi.ProfessionalAnnotationContractError);
});

console.log(`\n${passed} tests OK — EXT-04B5 professional annotation editing math + write-response contract`);
