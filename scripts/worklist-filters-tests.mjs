import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Filtros de la lista de estudios.
 *
 * Los cinco chips excluyentes (Pendientes / Observados / Prioridad alta /
 * Finalizados / Total) pasaron a ser cinco filtros combinables. Lo que se
 * protege acá es lo que la combinación tiene que seguir cumpliendo:
 *
 * - los filtros se cruzan entre sí y con la búsqueda, no se pisan;
 * - un estudio sin fecha —dato del archivo DICOM que falta en estudios
 *   reales— no desaparece de la lista mientras no se pida un rango;
 * - los contadores de estado cuentan lo que quedaría al elegir cada estado,
 *   no lo que ya quedó filtrado por el estado vigente.
 */
function load(path) {
  return fs.readFileSync(path, "utf8")
    .replace(/^import .*$/gm, "")
    .replace(/export /g, "");
}

const js = ts.transpileModule(
  `${load("src/clinicalDisplay.ts")}\n${load("src/studyDisplay.ts")}\n${load("src/features/worklist/studyFilters.ts")}`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const sandbox = { exports: {}, console };
vm.runInNewContext(
  `${js}\nexports.filterStudies = filterStudies;\nexports.countsByReviewStatus = countsByReviewStatus;\nexports.activeFilterCount = activeFilterCount;\nexports.subjectOptions = subjectOptions;\nexports.modalityOptions = modalityOptions;\nexports.EMPTY_FILTERS = EMPTY_FILTERS;`,
  sandbox,
);
const { filterStudies, countsByReviewStatus, activeFilterCount, subjectOptions, modalityOptions, EMPTY_FILTERS } = sandbox.exports;

const NOW = Date.parse("2026-08-20T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

function study(overrides) {
  return {
    caseId: "CASE-001",
    subjectRef: "PAC-0001",
    studyDate: new Date(NOW - day).toISOString(),
    modality: "MR",
    description: "RM lumbar",
    status: "completed",
    planes: ["sagittal"],
    primaryPlane: "sagittal",
    latestRunId: "run-1",
    modelKey: "model",
    modelStatus: "ready",
    reviewStatus: "pendiente",
    priority: "media",
    dataOrigin: "database",
    ...overrides,
  };
}

const STUDIES = [
  study({ caseId: "CASE-001", subjectRef: "PAC-0001", reviewStatus: "pendiente", priority: "alta" }),
  study({ caseId: "CASE-002", subjectRef: "PAC-0001", reviewStatus: "observado", priority: "media", studyDate: new Date(NOW - 40 * day).toISOString() }),
  study({ caseId: "CASE-003", subjectRef: "PAC-0002", reviewStatus: "pendiente", priority: "baja", modality: "CT" }),
  study({ caseId: "CASE-004", subjectRef: "PAC-0002", reviewStatus: "aceptado", priority: "alta", studyDate: null }),
];

const filters = (overrides) => ({ ...EMPTY_FILTERS, ...overrides });
const ids = (rows) => rows.map((row) => row.caseId);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

check("sin filtros ni búsqueda la lista es completa", () => {
  assert.deepEqual(ids(filterStudies(STUDIES, EMPTY_FILTERS, "", NOW)), ["CASE-001", "CASE-002", "CASE-003", "CASE-004"]);
});

check("los filtros se cruzan entre sí", () => {
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ subjectRef: "PAC-0002", priority: "alta" }), "", NOW)), ["CASE-004"]);
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ reviewStatus: "pendiente", priority: "alta" }), "", NOW)), ["CASE-001"]);
});

check("el filtro se cruza con la búsqueda", () => {
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ subjectRef: "PAC-0001" }), "CASE-002", NOW)), ["CASE-002"]);
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ subjectRef: "PAC-0002" }), "CASE-002", NOW)), []);
});

check("un estudio sin fecha se lista mientras no se pida un rango", () => {
  assert.ok(ids(filterStudies(STUDIES, EMPTY_FILTERS, "", NOW)).includes("CASE-004"));
  assert.ok(!ids(filterStudies(STUDIES, filters({ dateRange: "90d" }), "", NOW)).includes("CASE-004"));
});

check("el rango de fechas recorta por antigüedad real", () => {
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ dateRange: "7d" }), "", NOW)), ["CASE-001", "CASE-003"]);
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ dateRange: "90d" }), "", NOW)), ["CASE-001", "CASE-002", "CASE-003"]);
});

check("la modalidad filtra por el valor del contrato", () => {
  assert.deepEqual(ids(filterStudies(STUDIES, filters({ modality: "CT" }), "", NOW)), ["CASE-003"]);
});

check("los contadores de estado ignoran el estado vigente pero respetan el resto", () => {
  const counts = countsByReviewStatus(STUDIES, filters({ reviewStatus: "aceptado", subjectRef: "PAC-0002" }), "", NOW);
  assert.equal(counts.pendiente, 1);
  assert.equal(counts.aceptado, 1);
  assert.equal(counts.observado, 0);
});

check("el contador de filtros activos es lo único que delata una lista recortada", () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(activeFilterCount(filters({ priority: "alta", dateRange: "7d" })), 2);
});

/* Las listas vienen del contexto de vm, así que se comparan por contenido. */
check("las opciones salen de los datos y no de un catálogo fijo", () => {
  assert.equal(subjectOptions(STUDIES).join(","), "PAC-0001,PAC-0002");
  assert.equal(modalityOptions(STUDIES).join(","), "CT,MR");
  assert.equal(modalityOptions([study({ modality: null })]).length, 0);
});

console.log(`Worklist filters tests: ${passed} passed`);
