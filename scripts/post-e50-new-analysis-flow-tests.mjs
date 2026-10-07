import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * "Nuevo estudio": paciente, edad y contexto clínico.
 *
 * Reemplaza a los chequeos de Stage 86, que fijaban un diseño sin entidad Patient (el
 * paciente era sólo un `subjectRef`). Ahora el paciente es una entidad con código, nombre,
 * apellido y fecha de nacimiento opcionales (`patientApi.ts`), se asocia por `patientId` y el
 * backend deriva `subjectRef` de su código, de modo que el historial por referencia y los
 * estudios históricos siguen funcionando.
 *
 * Los componentes son hooks de React sin DOM disponible acá, así que su comportamiento
 * observable se verifica contra su propio código fuente; la lógica pura (edad, bloqueos,
 * confirmación) se prueba ejecutándola en new-study-form-tests.mjs y study-age-tests.mjs.
 */
const root = process.cwd();
const drawerSource = readFileSync(join(root, "src/features/worklist/NewAnalysisDrawer.tsx"), "utf8");
const selectorSource = readFileSync(join(root, "src/features/worklist/PatientSelector.tsx"), "utf8");
const patientApiSource = readFileSync(join(root, "src/patientApi.ts"), "utf8");
const studyMetadataSource = readFileSync(join(root, "src/studyMetadata.ts"), "utf8");

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("1 la vista usa PatientSelector y ya no el selector de subjectRef", () => {
  assert.match(drawerSource, /<PatientSelector/);
  assert.doesNotMatch(drawerSource, /<SubjectSelector/);
  assert.ok(!existsSync(join(root, "src/features/worklist/SubjectSelector.tsx")));
});

test("2 el paciente se busca por código o nombre y muestra su estado de búsqueda", () => {
  assert.match(selectorSource, /Buscar por código o nombre/);
  assert.match(selectorSource, /searchPatients\(trimmed\)/);
  assert.match(selectorSource, /Buscando pacientes…/);
  assert.match(selectorSource, /No se encontraron pacientes/);
  assert.match(patientApiSource, /\/api\/patients\?query=/);
});

test("3 una búsqueda vieja que llega tarde no pisa a la última (cancelled)", () => {
  assert.match(selectorSource, /let cancelled = false;/);
  assert.match(selectorSource, /if \(!cancelled\) setSearch/);
  assert.match(selectorSource, /window\.clearTimeout\(timer\)/);
});

test("4 el error de búsqueda ofrece reintentar", () => {
  assert.match(selectorSource, /No se pudo buscar pacientes/);
  assert.match(selectorSource, /setRetryToken\(\(token\) => token \+ 1\)/);
});

test("5 se puede crear un paciente con código, nombre, apellido y fecha de nacimiento opcional", () => {
  assert.match(selectorSource, /Código visible/);
  assert.match(selectorSource, /Nombre <i>\(opcional\)<\/i>/);
  assert.match(selectorSource, /Apellido <i>\(opcional\)<\/i>/);
  assert.match(selectorSource, /Fecha de nacimiento <i>\(opcional\)<\/i>/);
  assert.match(patientApiSource, /method: "POST", body/);
  assert.match(selectorSource, /No ingreses DNI, domicilio/);
});

test("6 el paciente elegido se resume y se puede cambiar", () => {
  assert.match(selectorSource, /aria-label="Paciente seleccionado"/);
  assert.match(selectorSource, /onClick=\{\(\) => onSelect\(null\)\}[^>]*>Cambiar</);
});

test("7 se puede continuar explícitamente sin asociar paciente, y volver atrás", () => {
  assert.match(selectorSource, /Continuar sin asociar paciente/);
  assert.match(selectorSource, /Asociar paciente/);
  assert.match(drawerSource, /onWithoutPatient=\{setWithoutPatient\}/);
});

test("8 el modo de asociación tiene semántica de radiogroup accesible", () => {
  assert.match(selectorSource, /role="radiogroup"/);
  assert.match(selectorSource, /type="radio"/);
});

test("9 el estudio se envía con patientId, sin subjectRef armado en el cliente", () => {
  assert.match(drawerSource, /studyMetadata: normalizedStudyMetadata/);
  assert.match(drawerSource, /normalizeStudyMetadataInput\(metadata, age\)/);
  assert.match(drawerSource, /patientId: patient\?\.id \?\? ""/);
  assert.match(studyMetadataSource, /patientId: textOrNull\(draft\.patientId\)/);
});

test("10 el contexto clínico y la edad viajan solo si hay algo (payload histórico intacto)", () => {
  assert.match(studyMetadataSource, /if \(value !== null && value !== undefined\)/);
  for (const key of ["ageAtStudy", "ageProvenance", "clinicalReason", "symptoms", "symptomDuration", "relevantHistory"]) {
    assert.match(studyMetadataSource, new RegExp(`${key}:`));
  }
});

test("11 no existe ningún paso de asociación posterior a la corrida", () => {
  assert.doesNotMatch(drawerSource, /associationState|attemptPatientAssociation|retryPatientAssociation|patientStudyAssociation|Asociando al paciente/);
  assert.doesNotMatch(drawerSource, /\/patient["'`]|associateStudyPatient/);
});

test("12 un estudio puede crearse sin paciente ni contexto", () => {
  assert.match(drawerSource, /const studyIdentityReady = caseIdReady;/);
  assert.doesNotMatch(drawerSource, /disabled=\{[^}]*selectedPatient/);
});

test("13 la edad se resuelve en un módulo puro, con procedencia explícita", () => {
  assert.match(drawerSource, /resolveStudyAge\(/);
  assert.match(drawerSource, /Calculada/);
  assert.match(drawerSource, /Declarada/);
  assert.match(drawerSource, /Declarar otra edad/);
  assert.match(drawerSource, /Usar la edad calculada/);
});

test("14 una discrepancia entre edad declarada y calculada se muestra, no se resuelve en silencio", () => {
  assert.match(drawerSource, /difiere de la calculada/);
  assert.match(drawerSource, /age\.discrepancy/);
});

test("15 lo declarado nunca se descarta al cambiar de paciente", () => {
  assert.match(drawerSource, /metadata\.ageDeclared\.trim\(\) !== ""/);
});

test("16 los detalles clínicos extensos van en una sección plegable con indicación de contenido", () => {
  assert.match(drawerSource, /<details className="ns-clinical-details">/);
  assert.match(drawerSource, /Con información/);
  assert.match(drawerSource, /Sin completar/);
  for (const label of ["Motivo del estudio", "Síntomas", "Tiempo de evolución", "Antecedentes relevantes"]) {
    assert.match(drawerSource, new RegExp(label));
  }
});

test("17 la edad queda visible, fuera de la sección plegable", () => {
  const detailsStart = drawerSource.indexOf('<details className="ns-clinical-details">');
  assert.ok(drawerSource.indexOf("Edad al estudio") < detailsStart);
});

test("18 el botón de analizar se deshabilita mientras corre", () => {
  assert.match(drawerSource, /disabled=\{!sagittalReady \|\| uploading \|\| running\}/);
});

test("19 doble submit queda bloqueado por una referencia sincrónica", () => {
  assert.match(drawerSource, /runInFlightRef\.current/);
  assert.match(drawerSource, /if \(!sagittalReady \|\| uploading \|\| running \|\| runInFlightRef\.current\) return/);
});

test("20 un error de creación muestra mensaje y no rompe el flujo", () => {
  assert.match(drawerSource, /setMessage\(apiErrorMessage\(error, "ejecutar el análisis"\)\)/);
});

test("21 la carga de imágenes sigue igual, no fue reescrita", () => {
  assert.match(drawerSource, /uploadAiInput\(file, normalizedCaseId, plane\)/);
  assert.match(drawerSource, /uploadStudyArchive\(file, normalizedCaseId\)/);
});

test("22 éxito completo navega al Study creado", () => {
  assert.match(drawerSource, /function openCompletedStudy\(caseIdToOpen: string\)/);
  assert.match(drawerSource, /onAnalysisReady\(caseIdToOpen\)/);
});

test("23 un error de análisis conserva paciente y contexto (no se resetea metadata)", () => {
  const runStart = drawerSource.indexOf("async function run()");
  const catchStart = drawerSource.indexOf("catch (error)", runStart);
  const errorBlock = drawerSource.slice(catchStart, drawerSource.indexOf("finally", catchStart));
  assert.doesNotMatch(errorBlock, /setMetadata\(|setSelectedPatient\(/);
});

test("24 salir de la vista pasa por una sola puerta que se bloquea al analizar y confirma si hay datos", () => {
  assert.match(drawerSource, /function requestExit\(\) \{\s+if \(interactionLocked\) return;/);
  assert.match(drawerSource, /className="ns-back" disabled=\{interactionLocked\} onClick=\{requestExit\}/);
  assert.match(drawerSource, /<button className="wl-drawer-cancel" disabled=\{interactionLocked\} onClick=\{requestExit\}/);
  assert.doesNotMatch(drawerSource, /key === "Escape"/, "es una pantalla, no un diálogo");
});

test("25 el chat y el LLM no se tocan: nada de esta vista los importa", () => {
  assert.doesNotMatch(drawerSource, /chatApi|chatTypes|llm/i);
  assert.doesNotMatch(selectorSource, /chatApi|chatTypes|llm/i);
});

test("26 los textos de datos personales no se imprimen en logs ni en el payload de auditoría del cliente", () => {
  assert.doesNotMatch(drawerSource, /console\.(log|info|warn|error)\([^)]*(patient|firstName|lastName|clinical)/i);
  assert.doesNotMatch(selectorSource, /console\.(log|info|warn|error)/);
});

test("27 el contexto clínico dice una sola línea y deja la explicación en una ayuda accesible", () => {
  assert.match(drawerSource, /Información clínica registrada para este estudio/);
  assert.match(drawerSource, /aria-controls="ns-context-help"/);
  assert.match(drawerSource, /aria-expanded=\{contextHelpOpen\}/);
});

test("28 el motivo por el que no se calcula la edad sale de lo que falta, y con edad declarada no se repite la instrucción", () => {
  assert.match(drawerSource, /ageUnavailableReason\(age\.missing, Boolean\(selectedPatient\)\)/);
  assert.match(drawerSource, /Se guardará como edad declarada\. No se calculó:/);
});

test("29 Calculada y Declarada usan el mismo estilo neutro; solo la discrepancia advierte", () => {
  assert.match(drawerSource, /className="ns-badge"/);
  assert.doesNotMatch(drawerSource, /ns-badge is-/);
  assert.match(drawerSource, /className="ns-warning"/);
});

test("30 el resultado del ZIP ordena archivo, series, uso, limitaciones y detalles técnicos", () => {
  assert.match(drawerSource, /"Cambiar ZIP"/);
  assert.match(drawerSource, /serie detectada" : "series detectadas"/);
  assert.match(drawerSource, /seriesPlaneLabel\(series\.plane\)/);
  assert.match(drawerSource, /seriesSequenceLabel\(series\.weighting\)/);
  assert.match(drawerSource, /series\.sliceCount\} cortes/);
  assert.match(drawerSource, /describeSeriesUse\(roles, series\)/);
  assert.match(drawerSource, /<strong>Limitaciones<\/strong>/);
  assert.match(drawerSource, /<summary>Detalles técnicos<\/summary>/);
  const visible = drawerSource.slice(drawerSource.indexOf('className="ns-study-result"'), drawerSource.indexOf('<details className="ns-tech">'));
  assert.doesNotMatch(visible, /\{series\.description \|\||\{series\.inputId\}|P10\.7/, "identificadores y jerga técnica solo en los detalles");
});

test("31 la confirmación de salida se cierra al iniciar el análisis y su botón queda protegido", () => {
  assert.match(drawerSource, /if \(interactionLocked\) setConfirmingExit\(false\);/);
  assert.match(drawerSource, /disabled=\{interactionLocked\} onClick=\{\(\) => \{ if \(!interactionLocked\) onClose\(\); \}\}[^>]*>Salir sin guardar</);
});

test("32 una advertencia desconocida del ZIP se muestra tal cual en Limitaciones", () => {
  assert.match(drawerSource, /describeStudyWarning\(warning\)\.text/);
  const limitations = drawerSource.slice(drawerSource.indexOf('className="ns-limitations"'), drawerSource.indexOf('<details className="ns-tech">'));
  assert.doesNotMatch(limitations, /\.filter\(|known/i, "no se filtran advertencias");
});

console.log(`Post-E50 new study (patient + context) tests passed: ${count}`);
