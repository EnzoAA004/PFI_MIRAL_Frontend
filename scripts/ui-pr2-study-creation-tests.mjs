import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worklist = readFileSync("src/features/worklist/Worklist.tsx", "utf8");
const filters = readFileSync("src/features/worklist/studyFilters.ts", "utf8");
const drawer = readFileSync("src/features/worklist/NewAnalysisDrawer.tsx", "utf8");
const selector = readFileSync("src/features/worklist/SubjectSelector.tsx", "utf8");
const routes = readFileSync("src/routes.ts", "utf8");

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("Worklist elimina la columna Modelo y conserva las columnas operativas", () => {
  assert.doesNotMatch(worklist, /column="modelKey"|data-label="Modelo"|>Modelo</);
  for (const label of ["Paciente", "ID estudio", "Fecha", "Modalidad", "Prioridad", "Estado", "Series"]) {
    assert.match(worklist, new RegExp(label));
  }
});

test("Worklist no presenta el modelo como criterio de búsqueda visible", () => {
  assert.match(worklist, /Buscar por paciente, ID de estudio, fecha o descripción/);
  assert.doesNotMatch(filters, /displayModelKey|study\.modelKey/);
});

test("la referencia del estudio usa copy operativo", () => {
  assert.match(selector, /Referencia interna del estudio \(opcional\)/);
  assert.match(selector, /referencia breve para reconocer este estudio/);
  assert.doesNotMatch(selector, /Referencia técnica legacy del estudio/);
});

test("el placeholder ya no parece un dataset técnico", () => {
  assert.match(selector, /placeholder="EST-2026-001"/);
  assert.doesNotMatch(selector, /placeholder="SPIDER-101"/);
});

/*
 * Los "01 / 02 / 03" en color de acento salieron en la pasada de densidad: no
 * eran pasos —nada impide escribir el ID de caso antes de elegir el paciente—
 * y el número pesaba más que el nombre de la sección. El intento del test no
 * cambia: el formulario tiene que seguir nombrando sus tres partes y decir en
 * una línea qué se hace ahí.
 */
test("el flujo explica paciente, estudio, imágenes y análisis", () => {
  assert.match(drawer, /Cargá las imágenes del estudio, completá sus datos y, si corresponde, asociá un paciente existente/);
  assert.match(drawer, /<h2 id="new-study-data-title">Datos del estudio<\/h2>/);
  assert.match(drawer, /<h2 id="new-study-images-title">Imágenes<\/h2>/);
  assert.doesNotMatch(drawer, /aria-hidden="true">0\d<\/span>/);
});

test("el análisis muestra progreso honesto sin porcentaje inventado", () => {
  assert.match(drawer, /aria-label="Progreso del análisis"/);
  assert.match(drawer, /Procesando imágenes/);
  assert.match(drawer, /Completando resultados/);
  assert.match(drawer, /El sistema no informa porcentajes/);
  assert.doesNotMatch(drawer, /progressPercent|setInterval/);
});

test("doble submit queda bloqueado de forma síncrona", () => {
  assert.match(drawer, /runInFlightRef\.current/);
  assert.match(drawer, /if \(!sagittalReady \|\| uploading \|\| running \|\| runInFlightRef\.current\) return/);
  assert.match(drawer, /disabled=\{!sagittalReady \|\| uploading \|\| running\}/);
});

test("éxito completo abre automáticamente el Study creado con subjectRef", () => {
  const successBlock = drawer.slice(drawer.indexOf("const nextProductState = await runProductExtensions(context)"), drawer.indexOf("// La corrida existe"));
  assert.match(successBlock, /\["completed", "degraded"\]\.includes\(nextProductState\.phase\)/);
  assert.match(successBlock, /openCompletedStudy\(context\.caseId\)/);
  assert.doesNotMatch(drawer, /attemptPatientAssociation|associatePatientAfterAnalysis/);
});

test("un error de análisis no navega y mantiene el contexto", () => {
  const runStart = drawer.indexOf("async function run()");
  const catchStart = drawer.indexOf("catch (error)", runStart);
  const errorBlock = drawer.slice(catchStart, drawer.indexOf("finally", catchStart));
  assert.match(errorBlock, /setMessage\(apiErrorMessage/);
  assert.match(errorBlock, /setAnalysisStage\("idle"\)/);
  assert.doesNotMatch(errorBlock, /onAnalysisReady|openCompletedStudy/);
});

test("no existe un paso de asociación posterior a la corrida (Stage 86)", () => {
  assert.doesNotMatch(drawer, /associationState|attemptPatientAssociation|retryPatientAssociation|patientStudyAssociation/);
});

test("el estudio se crea con el subjectRef elegido en un único request", () => {
  assert.match(drawer, /studyMetadata: normalizedStudyMetadata/);
  assert.doesNotMatch(drawer, /PUT.*\/patient|associateStudyPatient/);
});

test("Study Review conserva la ruta funcional por caseId", () => {
  assert.match(routes, /return `\$\{ROUTES\.study\}\/\$\{encodeURIComponent\(caseId\)\}`/);
  assert.match(routes, /study: "\/estudio"/);
});

/*
 * "Nuevo estudio" es una vista que reemplaza a la lista, no un panel ni una capa.
 */
test("Nuevo estudio reemplaza a la lista y no se renderiza debajo ni como overlay", () => {
  const gate = worklist.indexOf("if (drawerOpen) {");
  assert.ok(gate > 0, "la lista corta su render cuando la vista está abierta");
  assert.ok(gate < worklist.indexOf('<div className="wl">'), "el corte ocurre antes de pintar la tabla");
  assert.doesNotMatch(worklist, /drawerOpen && \(/);
  assert.doesNotMatch(drawer, /wl-drawer-backdrop|aria-modal|role="dialog"/);
});

test("al volver, la lista conserva filtros y página y el foco regresa al control de origen", () => {
  assert.match(worklist, /newStudyButtonRef\.current\?\.focus\(\)/);
  assert.match(worklist, /returnFocusRef\.current = true; setDrawerOpen\(false\)/);
  assert.doesNotMatch(worklist, /setFilters\(EMPTY_FILTERS\);\s*setDrawerOpen/);
});

test("al abrir la vista el foco va al encabezado y no hay trampa de Tab", () => {
  assert.match(drawer, /headingRef\.current\?\.focus\(\)/);
  assert.match(drawer, /<h1 id="new-study-title" ref=\{headingRef\} tabIndex=\{-1\}>Nuevo estudio<\/h1>/);
  assert.doesNotMatch(drawer, /key === "Tab"|focusTrap/i);
});

test("la carga usa botones accesibles, muestra el archivo y explica qué falta", () => {
  assert.match(drawer, /"Seleccionar ZIP"/);
  assert.match(drawer, /Ningún archivo seleccionado/);
  assert.match(drawer, /aria-expanded=\{byPlaneOpen\}/);
  assert.match(drawer, /Cargar archivos por plano/);
  assert.match(drawer, /ID del estudio/);
});

test("las respuestas tardías de una carga se descartan por casillero y por ID", () => {
  assert.match(drawer, /requestGate\.begin\("study"\)/);
  assert.match(drawer, /requestGate\.begin\(plane\)/);
  assert.equal((drawer.match(/requestGate\.isCurrent\(token\)/g) ?? []).length, 4);
  assert.match(drawer, /requestGate\.invalidateAll\(\);\s+setCaseId\(nextValue\)/);
});

console.log(`UI-PR2 study creation tests: ${count} passed`);
