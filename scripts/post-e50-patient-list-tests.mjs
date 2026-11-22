import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Etapa 85: `/pacientes` cierra el último vínculo roto del flujo visible del producto. `PatientsView.tsx`
 * ahora llama a la proyección real `GET /api/subjects` (agrupada por `Study.subjectRef`, nunca una
 * entidad Patient persistida) en lugar del nunca implementado `GET /api/patients`. Este archivo sigue
 * la misma convención de source-regex + ejecución en vm que todo otro script de test post-e50 de este repo
 * (los componentes `.tsx` no pueden renderizarse sin un DOM acá, así que su comportamiento observable se verifica
 * contra su propio texto fuente -- ver `p8e2-subject-history-tests.mjs` como precedente).
 */
const root = process.cwd();
const patientsViewSource = readFileSync(join(root, "src/components/PatientsView.tsx"), "utf8");
const subjectHistoryApiSource = readFileSync(join(root, "src/subjectHistoryApi.ts"), "utf8");

class ContractError extends Error {
  constructor(message, path) {
    super(message);
    this.path = path;
  }
}

function loadPatientsViewHelpers() {
  const source = patientsViewSource
    .replace(/^import[\s\S]*?from "[^"]+";$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const sandbox = {
    exports: {},
    console,
    require: (id) => id === "react/jsx-runtime" ? { jsx: () => ({}), jsxs: () => ({}), Fragment: "Fragment" } : {},
  };
  vm.runInNewContext(`${js}
exports.displayAnalysisStatus = displayAnalysisStatus;
exports.displayReviewStatusLabel = displayReviewStatusLabel;`, sandbox);
  return sandbox.exports;
}

function loadSubjectHistoryApiFragment() {
  const source = subjectHistoryApiSource
    .replace(/^import[\s\S]*?from "[^"]+";$/gm, "")
    .replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = {
    exports: {},
    console,
    ContractError,
    URLSearchParams,
    generateTraceId: () => "trace-test",
    authHeaders: () => ({}),
    refreshDoctorSession: async () => {},
    validateVisibleDataOrigin: () => {},
    applyCorrectionsToMeasurements: (byPlane) => byPlane,
    normalizePersistedCorrection: () => null,
    toSafeFrontendError: () => ({ message: "error" }),
    API_BASE_URL: "http://backend.test",
    ApiError: class ApiError extends Error {
      constructor(message, options) {
        super(message);
        Object.assign(this, options);
      }
    },
    fetch: undefined,
  };
  vm.runInNewContext(`${js}
exports.normalizeSubjectSummary = normalizeSubjectSummary;
exports.fetchSubjectList = fetchSubjectList;`, sandbox);
  return sandbox;
}

const helpers = loadPatientsViewHelpers();

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("1 la vista consulta la proyeccion real por subjectRef, no una entidad Patient", () => {
  assert.match(patientsViewSource, /fetchSubjectList\(\)/);
});

test("2 la vista nunca vuelve a llamar al endpoint inexistente /api/patients", () => {
  assert.doesNotMatch(patientsViewSource, /searchPatients|from ["']\.\.\/patientApi["']|api\/patients/);
});

test("3 estado inicial vacio usa el texto exacto pedido por la especificacion", () => {
  assert.match(patientsViewSource, /No hay pacientes con historial longitudinal disponible\./);
});

test("4 loading es accesible", () => {
  assert.match(patientsViewSource, /aria-busy=\{state\.status === "loading"\}/);
  assert.match(patientsViewSource, /Consultando pacientes/);
});

test("5 error tiene mensaje y boton de reintento", () => {
  assert.match(patientsViewSource, /No se pudo cargar la lista de pacientes/);
  assert.match(patientsViewSource, /setRetryNonce/);
});

test("6 la busqueda vacia limpia el filtro", () => {
  assert.match(patientsViewSource, /setQuery\(""\)/);
});

test("7 la busqueda filtra por caseId, nunca por subjectRef", () => {
  assert.match(patientsViewSource, /latestCaseId\.toLowerCase\(\)\.includes/);
  assert.doesNotMatch(patientsViewSource, /subjectRef\.toLowerCase\(\)\.includes/);
});

test("8 cada fila muestra la cantidad de estudios", () => {
  assert.match(patientsViewSource, /studyCount === 1 \? "1 estudio"/);
});

test("9 cada fila muestra la fecha del ultimo estudio via el helper compartido", () => {
  assert.match(patientsViewSource, /displayStudyDate\(patient\.latestStudyDate\)/);
});

test("10 estado sin analisis no es un error, es un estado normal", () => {
  assert.equal(helpers.displayAnalysisStatus(null), "Sin análisis");
});

test("11 estado completed se traduce, nunca se muestra el enum crudo", () => {
  assert.equal(helpers.displayAnalysisStatus("completed"), "Completado");
  assert.doesNotMatch(patientsViewSource, />\{patient\.latestAnalysisStatus\}</);
});

test("12 estado partial se traduce", () => {
  assert.equal(helpers.displayAnalysisStatus("partial"), "Parcial");
});

test("13 revision pending/accepted/observed/rejected se traducen", () => {
  assert.equal(helpers.displayReviewStatusLabel("pending"), "Pendiente");
  assert.equal(helpers.displayReviewStatusLabel("accepted"), "Aceptada");
  assert.equal(helpers.displayReviewStatusLabel("observed"), "Observada");
  assert.equal(helpers.displayReviewStatusLabel("rejected"), "Rechazada");
});

test("14 abrir historial navega por subjectRef, no por un id de Patient inventado", () => {
  assert.match(patientsViewSource, /onOpenPatient\(patient\.subjectRef\)/);
});

test("15 el label de la tarjeta es generico, nunca el subjectRef crudo como nombre", () => {
  assert.match(patientsViewSource, /<strong>Paciente<\/strong>/);
  assert.doesNotMatch(patientsViewSource, />\{patient\.subjectRef\}</);
});

test("16 subjectRef nunca se fabrica como PatientName", () => {
  assert.doesNotMatch(patientsViewSource, /patientReference|patientName|PatientName/);
});

test("17 no hay lenguaje clinico en la lista", () => {
  assert.doesNotMatch(patientsViewSource, /paciente enfermo|patolog|normal\/anormal|mejor|empeor|diagnostic/i);
});

test("18 los botones declaran type explicito (semantica de teclado)", () => {
  const buttonOpenTags = patientsViewSource.match(/<button\b/g) ?? [];
  const typedButtons = patientsViewSource.match(/type="button"/g) ?? [];
  assert.ok(buttonOpenTags.length > 0);
  assert.equal(buttonOpenTags.length, typedButtons.length);
});

test("19 la busqueda sin resultados ofrece volver a ver todos", () => {
  assert.match(patientsViewSource, /No se encontraron pacientes/);
  assert.match(patientsViewSource, /Ver todos/);
});

test("20 la vista reusa el layout responsive existente, no introduce uno nuevo", () => {
  assert.match(patientsViewSource, /view-stack patient-directory-view/);
  assert.match(patientsViewSource, /panel-card patient-directory-panel/);
});

test("21 normalizeSubjectSummary es fail-closed ante un payload incompleto", () => {
  const sandbox = loadSubjectHistoryApiFragment();
  assert.throws(() => sandbox.exports.normalizeSubjectSummary({ subjectRef: "PAT-1" }, "/api/subjects"), /Contrato inv|Contrato incompleto|Error/);
});

test("22 normalizeSubjectSummary acepta un payload completo real", () => {
  const sandbox = loadSubjectHistoryApiFragment();
  const summary = sandbox.exports.normalizeSubjectSummary({
    subjectRef: "PAT-85-1",
    studyCount: 3,
    latestStudyDate: "2026-05-10",
    latestCaseId: "CASE-85-1",
    latestAnalysisStatus: "completed",
    latestReviewStatus: "accepted",
  }, "/api/subjects");
  assert.equal(summary.subjectRef, "PAT-85-1");
  assert.equal(summary.studyCount, 3);
});

test("23 normalizeSubjectSummary acepta analisis/revision null sin inventar valores", () => {
  const sandbox = loadSubjectHistoryApiFragment();
  const summary = sandbox.exports.normalizeSubjectSummary({
    subjectRef: "PAT-85-2",
    studyCount: 1,
    latestStudyDate: null,
    latestCaseId: "CASE-85-2",
    latestAnalysisStatus: null,
    latestReviewStatus: null,
  }, "/api/subjects");
  assert.equal(summary.latestAnalysisStatus, null);
  assert.equal(summary.latestReviewStatus, null);
});

test("24 fetchSubjectList pide GET /api/subjects, sin path variable", () => {
  assert.match(subjectHistoryApiSource, /export async function fetchSubjectList[\s\S]*?"\/api\/subjects"/);
});

console.log(`Post-E50 Stage 85 patient list tests passed: ${count}`);
