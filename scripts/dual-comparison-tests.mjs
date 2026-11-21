import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Visor de comparación: filtros de diferencias, recorrido anterior/siguiente, qué se dibuja en cada lado y
 * lectura de la ubicación que informa el Backend. Se ejecuta el código real transpilado.
 */
function loadModule(path, exportNames) {
  const source = readFileSync(path, "utf8").replace(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+"[^"]+";\s*/g, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, DOMException };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const logic = loadModule("src/features/reading/dualComparisonLogic.ts", [
  "rowKey", "metricKeyOf", "NO_FILTER", "isFilterActive", "passesFilter", "applyFilter", "parseMinimum", "setMinimum", "metricsOf",
  "stepFrom", "resolveSideOverlay", "resolveOverlay", "effectiveGeometry", "destinationFor", "locationBadge", "paneViewOf", "checkExpectedRun", "clamp",
]);
const api = loadModule("src/initialAnalysisComparisonApi.ts", ["parseInitialComparisonResult", "parseLocation"]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

const located = (over = {}) => ({
  plane: "sagittal", planeRunId: "plane-1", inputId: "inp-1", sliceIndex: 7, coordinateSpace: "model_256x256",
  coordinateWidth: 256, coordinateHeight: 256, geometryKind: "segment", geometry: [{ x: 10, y: 20 }, { x: 11, y: 30 }],
  correctedGeometry: [], status: "located", reason: null, ...over,
});
const value = (id, effective, over = {}) => ({
  measurementId: id, effectiveValue: effective, originalValue: effective, correctedValue: null, corrected: false, sliceIndex: 7, location: located(), ...over,
});
const row = (over = {}) => ({
  level: "L4-L5", structure: "disc", metric: "height", plane: "sagittal", unit: "mm", experimental: false,
  reference: value("r", 5.79), current: value("c", 7.3), deltaAbsolute: 1.51, deltaPercent: 26.1, percentStatus: "ok", trend: "increased", ...over,
});
const heightMm = (delta, level = "L4-L5") => row({ level, deltaAbsolute: delta });
const areaMm2 = (delta) => row({ structure: "disc", metric: "area", unit: "mm2", deltaAbsolute: delta });
const angleDeg = (delta) => row({ structure: "segment", metric: "angle", unit: "deg", deltaAbsolute: delta, experimental: true });

const analyzed = { inputId: "inp-1", planeRunId: "plane-1", total: 15 };
const view = (over = {}) => ({ viewedSeriesId: null, plane: "sagittal", slice: 7, analyzed, ...over });

/* ------------------------------------------------------------------------------------ filtros */

check("sin filtro todas las filas pasan y ninguna queda oculta", () => {
  const rows = [heightMm(0), heightMm(1.5), areaMm2(-3)];
  const { visible, hiddenCount } = logic.applyFilter(rows, logic.NO_FILTER);
  assert.equal(visible.length, 3);
  assert.equal(hiddenCount, 0);
  assert.equal(logic.isFilterActive(logic.NO_FILTER), false);
});

check("distintas de cero oculta solo la diferencia exactamente cero, aunque se muestre como 0,00", () => {
  const rows = [heightMm(0), heightMm(0.001), heightMm(-0.4)];
  const { visible, hiddenCount } = logic.applyFilter(rows, { onlyNonZero: true, minMagnitude: {} });
  assert.equal(visible.length, 2);
  assert.equal(hiddenCount, 1);
});

check("la magnitud mínima es por métrica: un umbral de mm no toca mm² ni grados", () => {
  const filter = logic.setMinimum(logic.NO_FILTER, "disc.height", 2);
  const rows = [heightMm(1.9), heightMm(2.5), areaMm2(0.5), angleDeg(0.2)];
  const { visible } = logic.applyFilter(rows, filter);
  same(visible.map((r) => `${r.structure}.${r.metric}`), ["disc.height", "disc.area", "segment.angle"]);
  assert.equal(visible.filter((r) => r.metric === "height").length, 1);
  assert.equal(visible.find((r) => r.metric === "height").deltaAbsolute, 2.5);
});

check("el límite es inclusivo y se compara sin redondear", () => {
  const filter = logic.setMinimum(logic.NO_FILTER, "disc.height", 1.5);
  assert.equal(logic.passesFilter(heightMm(1.5), filter), true, "igual al umbral se muestra");
  assert.equal(logic.passesFilter(heightMm(-1.5), filter), true, "la magnitud es absoluta");
  assert.equal(logic.passesFilter(heightMm(1.4999), filter), false, "1,4999 se ve como 1,50 pero no llega al mínimo");
  assert.equal(logic.passesFilter(heightMm(1.5001), filter), true);
});

check("un umbral cero o vacío no cuenta como filtro", () => {
  assert.equal(logic.isFilterActive(logic.setMinimum(logic.NO_FILTER, "disc.height", 0)), false);
  assert.equal(logic.isFilterActive(logic.setMinimum(logic.NO_FILTER, "disc.height", null)), false);
  const withMin = logic.setMinimum(logic.NO_FILTER, "disc.height", 1);
  assert.equal(logic.isFilterActive(withMin), true);
  assert.equal(logic.isFilterActive(logic.setMinimum(withMin, "disc.height", null)), false, "borrar el umbral lo quita");
});

check("setMinimum no muta el filtro anterior", () => {
  const before = logic.NO_FILTER;
  logic.setMinimum(before, "disc.height", 3);
  same(before, { onlyNonZero: false, minMagnitude: {} });
});

check("el umbral se escribe con coma o punto; lo inválido es 'sin mínimo'", () => {
  assert.equal(logic.parseMinimum("1,5"), 1.5);
  assert.equal(logic.parseMinimum(" 2.25 "), 2.25);
  assert.equal(logic.parseMinimum(""), null);
  assert.equal(logic.parseMinimum("abc"), null);
  assert.equal(logic.parseMinimum("-1"), null);
  assert.equal(logic.parseMinimum("1,5mm"), null);
});

check("las métricas ofrecidas conservan su unidad y no se mezclan", () => {
  const metrics = logic.metricsOf([heightMm(1), heightMm(2, "L3-L4"), areaMm2(1), angleDeg(1)]);
  same(metrics.map((m) => [m.key, m.unit]), [["disc.height", "mm"], ["disc.area", "mm2"], ["segment.angle", "deg"]]);
});

check("no hay orden por magnitud: el filtro conserva el orden de entrada", () => {
  const rows = [heightMm(0.1), areaMm2(500), angleDeg(0.3), heightMm(9, "L3-L4")];
  same(logic.applyFilter(rows, { onlyNonZero: true, minMagnitude: {} }).visible.map((r) => r.deltaAbsolute), [0.1, 500, 0.3, 9]);
});

/* ------------------------------------------------------------------------------------ recorrido */

check("anterior/siguiente recorre solo las filas visibles", () => {
  const rows = [heightMm(1, "L3-L4"), heightMm(2, "L4-L5"), heightMm(3, "L5-S1")];
  const keys = rows.map(logic.rowKey);
  const next = logic.stepFrom(rows, keys[0], 1);
  assert.equal(next.key, keys[1]);
  assert.equal(next.hasNext, true);
  assert.equal(logic.stepFrom(rows, keys[1], 1).key, keys[2]);
  assert.equal(logic.stepFrom(rows, keys[2], 1).key, keys[2], "no da la vuelta");
  assert.equal(logic.stepFrom(rows, keys[2], 1).hasNext, false);
  assert.equal(logic.stepFrom(rows, keys[0], -1).hasPrevious, false);
  assert.equal(logic.stepFrom(rows, keys[2], -1).key, keys[1]);
});

check("sin selección, siguiente va a la primera y anterior a la última; sin filas no hay nada", () => {
  const rows = [heightMm(1, "L3-L4"), heightMm(2, "L4-L5")];
  assert.equal(logic.stepFrom(rows, null, 1).key, logic.rowKey(rows[0]));
  assert.equal(logic.stepFrom(rows, null, -1).key, logic.rowKey(rows[1]));
  assert.equal(logic.stepFrom(rows, "no-existe", 1).key, logic.rowKey(rows[0]), "una selección fuera del filtro empieza de nuevo");
  const empty = logic.stepFrom([], null, 1);
  assert.equal(empty.key, null);
  assert.equal(empty.hasNext, false);
  assert.equal(empty.hasPrevious, false);
});

/* ------------------------------------------------------------------------- qué se dibuja por lado */

check("se dibuja el trazo solo cuando se mira la serie, el plano y el corte de la medición", () => {
  const overlay = logic.resolveSideOverlay(value("r", 5.79), view());
  assert.equal(overlay.state, "draw");
  assert.equal(overlay.figure.kind, "distance");
  assert.equal(overlay.figure.geometry, "ai");
  same(overlay.figure.points, [{ x: 10, y: 20 }, { x: 11, y: 30 }]);
});

check("al cambiar de corte el trazo desaparece y se ofrece volver", () => {
  const overlay = logic.resolveSideOverlay(value("r", 5.79), view({ slice: 8 }));
  assert.equal(overlay.state, "elsewhere");
  assert.equal(overlay.canReturn, true);
  assert.match(overlay.reason, /corte 8/);
  assert.match(overlay.reason, /viendo el 9/);
});

check("otra serie, otro plano o otra corrida: no se dibuja sobre una imagen que no es", () => {
  assert.equal(logic.resolveSideOverlay(value("r", 1), view({ viewedSeriesId: "otra-serie" })).state, "elsewhere");
  assert.equal(logic.resolveSideOverlay(value("r", 1), view({ plane: "axial" })).state, "elsewhere");
  assert.equal(logic.resolveSideOverlay(value("r", 1), view({ analyzed: { ...analyzed, inputId: "inp-2" } })).state, "elsewhere");
  assert.equal(logic.resolveSideOverlay(value("r", 1), view({ analyzed: { ...analyzed, planeRunId: "plane-2" } })).state, "elsewhere");
});

check("cada lado usa SU corte: el mismo número en el otro estudio no es equivalencia", () => {
  const reference = value("r", 5, { location: located({ sliceIndex: 7 }) });
  const current = value("c", 6, { location: located({ sliceIndex: 11, planeRunId: "plane-2", inputId: "inp-2" }) });
  const refOverlay = logic.resolveSideOverlay(reference, view({ slice: 7 }));
  const curOnSeven = logic.resolveSideOverlay(current, view({ slice: 7, analyzed: { inputId: "inp-2", planeRunId: "plane-2", total: 15 } }));
  const curOnEleven = logic.resolveSideOverlay(current, view({ slice: 11, analyzed: { inputId: "inp-2", planeRunId: "plane-2", total: 15 } }));
  assert.equal(refOverlay.state, "draw");
  assert.equal(curOnSeven.state, "elsewhere", "mirar el corte 8 del actual no dibuja la medición del corte 12");
  assert.equal(curOnEleven.state, "draw");
});

check("sin trazo, sin corte o sin ubicación: no se inventa nada y se dice por qué", () => {
  const sliceOnly = logic.resolveSideOverlay(value("r", 1, { location: located({ status: "slice_only", geometryKind: "none", geometry: [], reason: "Las áreas no tienen trazo." }) }), view());
  assert.equal(sliceOnly.state, "unavailable");
  assert.equal(sliceOnly.code, "slice_only");
  assert.match(sliceOnly.reason, /áreas/);
  const noSlice = logic.resolveSideOverlay(value("r", 1, { location: located({ status: "not_located", sliceIndex: null, geometryKind: "none", geometry: [], reason: "Sin corte." }) }), view());
  assert.equal(noSlice.code, "not_located");
  const noLocation = logic.resolveSideOverlay(value("r", 1, { location: null }), view());
  assert.equal(noLocation.code, "no_location");
  assert.equal(logic.resolveSideOverlay(value("r", 1), null).code, "no_series");
  assert.equal(logic.resolveSideOverlay(null, view()).state, "unavailable");
});

check("un valor corregido NO cambia el trazo; solo uno guardado por el revisor lo reemplaza", () => {
  const numeric = value("r", 7.3, { corrected: true, correctedValue: 7.3, originalValue: 5.79 });
  const overlay = logic.resolveSideOverlay(numeric, view());
  assert.equal(overlay.figure.geometry, "ai");
  same(overlay.figure.points, [{ x: 10, y: 20 }, { x: 11, y: 30 }]);
  const moved = value("r", 7.3, { corrected: true, location: located({ correctedGeometry: [{ x: 10, y: 20 }, { x: 12, y: 33 }] }) });
  const movedOverlay = logic.resolveSideOverlay(moved, view());
  assert.equal(movedOverlay.figure.geometry, "reviewer");
  same(movedOverlay.figure.points, [{ x: 10, y: 20 }, { x: 12, y: 33 }]);
  same(logic.effectiveGeometry(moved.location).points, [{ x: 10, y: 20 }, { x: 12, y: 33 }]);
});

check("el ángulo se dibuja como ángulo", () => {
  const angle = value("g", 12, { location: located({ geometryKind: "angle", geometry: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }] }) });
  assert.equal(logic.resolveSideOverlay(angle, view()).figure.kind, "angle");
});

check("un lado sin ubicación no bloquea al otro", () => {
  const withLocation = logic.resolveSideOverlay(value("c", 7), view());
  const without = logic.resolveSideOverlay(value("r", 5, { location: null }), view());
  assert.equal(withLocation.state, "draw");
  assert.equal(without.state, "unavailable");
});

check("la insignia de ubicación distingue ubicada, solo corte y sin ubicación", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(logic.locationBadge(value("r", 1)))), { text: "corte 8", available: true });
  assert.equal(logic.locationBadge(value("r", 1, { location: located({ status: "slice_only", geometryKind: "none", geometry: [] }) })).available, false);
  assert.equal(logic.locationBadge(value("r", 1, { location: null })).text, "sin ubicación");
});

check("si el corte de la medición no existe en la serie cargada no se ofrece volver: se explica", () => {
  const far = value("r", 1, { location: located({ sliceIndex: 40 }) });
  const overlay = logic.resolveOverlay(far, view(), { sagittal: analyzed, axial: null });
  assert.equal(overlay.state, "unavailable");
  assert.match(overlay.reason, /no existe/);
  const otherRun = value("r", 1, { location: located({ planeRunId: "otra" }) });
  assert.equal(logic.resolveOverlay(otherRun, view(), { sagittal: analyzed, axial: null }).state, "unavailable");
  // un corte válido pero distinto del que se mira sí permite volver
  assert.equal(logic.resolveOverlay(value("r", 1), view({ slice: 3 }), { sagittal: analyzed, axial: null }).canReturn, true);
  assert.equal(logic.resolveOverlay(value("r", 1), view(), { sagittal: analyzed, axial: null }).state, "draw");
});

/* -------------------------------------------------------------------------------- destino de la selección */

const byPlane = { sagittal: analyzed, axial: null };

check("la selección abre el corte de origen de ese lado", () => {
  const destination = logic.destinationFor(value("r", 1), byPlane);
  assert.equal(destination.ok, true);
  assert.equal(destination.slice, 7);
  assert.equal(destination.plane, "sagittal");
});

check("no se abre un corte que no existe, de otra serie ni de otra corrida", () => {
  assert.equal(logic.destinationFor(value("r", 1, { location: located({ sliceIndex: 40 }) }), byPlane).ok, false);
  assert.equal(logic.destinationFor(value("r", 1, { location: located({ inputId: "otra" }) }), byPlane).ok, false);
  assert.equal(logic.destinationFor(value("r", 1, { location: located({ planeRunId: "otra" }) }), byPlane).ok, false);
  assert.equal(logic.destinationFor(value("r", 1, { location: located({ plane: "axial" }) }), byPlane).ok, false);
  assert.equal(logic.destinationFor(value("r", 1, { location: null }), byPlane).ok, false);
  assert.equal(logic.destinationFor(value("r", 1, { location: located({ status: "not_located", sliceIndex: null }) }), byPlane).ok, false);
});

check("una medición solo-corte igual abre su corte (se ve la imagen, sin marca)", () => {
  const destination = logic.destinationFor(value("a", 1, { location: located({ status: "slice_only", geometryKind: "none", geometry: [] }) }), byPlane);
  assert.equal(destination.ok, true);
  assert.equal(destination.slice, 7);
});

/* --------------------------------------------------------------------------------- estado del visor */

check("el corte efectivo del visor es el de la IA hasta que se elige otro", () => {
  const ready = { status: "ready", data: { archiveSeries: [], workspaces: { sagittal: { planeRunId: "plane-1" }, axial: { planeRunId: null } }, analyzed: { sagittal: { sliceCount: 15, selectedSlice: 7, sourceInputId: "inp-1" }, axial: null } } };
  const initial = logic.paneViewOf({ plane: "sagittal", viewedSeriesId: null, slice: null }, ready);
  assert.equal(initial.slice, 7);
  assert.equal(initial.analyzed.planeRunId, "plane-1");
  assert.equal(logic.paneViewOf({ plane: "sagittal", viewedSeriesId: null, slice: 99 }, ready).slice, 14, "se acota al largo de la serie");
  assert.equal(logic.paneViewOf({ plane: "sagittal", viewedSeriesId: null, slice: null }, { status: "loading", caseId: "x" }), null);
  assert.equal(logic.paneViewOf({ plane: "sagittal", viewedSeriesId: "no-esta", slice: null }, ready), null);
});

check("la corrida cargada tiene que ser la de la comparación", () => {
  assert.equal(logic.checkExpectedRun({ caseId: "ref", runId: "run-1" }, "run-1"), null);
  assert.equal(logic.checkExpectedRun({ caseId: "ref", runId: "run-1" }, null), null);
  assert.match(logic.checkExpectedRun({ caseId: "ref", runId: "run-2" }, "run-1"), /No se muestra otra corrida/);
});

/* ------------------------------------------------------------------------------ contrato de ubicación */

check("la ubicación válida se lee tal cual y la rota se trata como no localizable sin romper la comparación", () => {
  const ok = api.parseLocation(located());
  assert.equal(ok.status, "located");
  assert.equal(ok.geometry.length, 2);
  assert.equal(api.parseLocation(null), null);
  assert.equal(api.parseLocation(located({ geometry: [{ x: 1, y: 2 }] })), null, "un segmento con un punto no se dibuja");
  assert.equal(api.parseLocation(located({ geometry: [{ x: "1", y: 2 }, { x: 1, y: 2 }] })), null);
  assert.equal(api.parseLocation(located({ status: "slice_only", geometryKind: "none" })), null, "sin trazo no puede traer puntos");
  assert.equal(api.parseLocation(located({ status: "otro" })), null);
  assert.equal(api.parseLocation(located({ correctedGeometry: [{ x: 1, y: 2 }] })), null, "el trazo corregido debe ser del mismo tipo");
  const noGeometry = api.parseLocation({ ...located(), status: "slice_only", geometryKind: "none", geometry: [], reason: "x" });
  assert.equal(noGeometry.status, "slice_only");
});

check("una respuesta sin ubicación (Backend anterior) sigue siendo una comparación válida", () => {
  const r = row();
  delete r.reference.location;
  delete r.current.location;
  const parsed = api.parseInitialComparisonResult({
    schemaVersion: "v1", source: "initial_analysis", differenceDefinition: "d",
    current: { caseId: "c", studyDate: null, runId: "r1", runCreatedAt: null, runStatus: null, reviewStatus: null, modelKey: null, sagittalSequence: null, usableMeasurementCount: 1, patientLink: "patient_id" },
    reference: { caseId: "r", studyDate: null, runId: "r2", runCreatedAt: null, runStatus: null, reviewStatus: null, modelKey: null, sagittalSequence: null, usableMeasurementCount: 1, patientLink: "patient_id" },
    summary: { comparedCount: 1, excludedCount: 0, currentMeasurementCount: 1, referenceMeasurementCount: 1 },
    comparisons: [r], excluded: [], limitations: [],
  });
  assert.equal(parsed.comparisons[0].reference.location, null);
  assert.equal(parsed.comparisons[0].deltaAbsolute, 1.51);
});

console.log(`\n${passed} comprobaciones de la comparación visual correctas.`);
