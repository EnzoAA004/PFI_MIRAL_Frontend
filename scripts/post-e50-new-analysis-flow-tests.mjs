import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Stage 86: "Nuevo análisis" no depende más de la entidad Patient inexistente. El
 * paciente/subjectRef ahora se resuelve directo contra `Study.subjectRef` (Stage 84/85),
 * vía `SubjectSelector.tsx` (reemplaza `PatientSelector.tsx`) y sin un paso de asociación
 * posterior a la corrida. Sigue el mismo patrón source-regex del resto de post-e50: los
 * componentes son hooks de React sin DOM disponible acá, así que su comportamiento
 * observable se verifica contra su propio código fuente (ver p8e2/post-e50-patient-list).
 */
const root = process.cwd();
const drawerSource = readFileSync(join(root, "src/features/worklist/NewAnalysisDrawer.tsx"), "utf8");
const selectorSource = readFileSync(join(root, "src/features/worklist/SubjectSelector.tsx"), "utf8");
const studyMetadataSource = readFileSync(join(root, "src/studyMetadata.ts"), "utf8");

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("1 el drawer abre con SubjectSelector, no con PatientSelector", () => {
  assert.match(drawerSource, /<SubjectSelector/);
  assert.doesNotMatch(drawerSource, /<PatientSelector/);
});

test("2 SubjectSelector muestra un estado de carga mientras busca subjects", () => {
  assert.match(selectorSource, /Buscando pacientes…/);
});

test("3 SubjectSelector consulta la lista real de subjects", () => {
  assert.match(selectorSource, /fetchSubjectList\(\)/);
});

test("4 estado vacio de la lista de subjects tiene mensaje propio", () => {
  assert.match(selectorSource, /No se encontraron pacientes/);
});

test("5 seleccionar un subject existente fija el subjectRef elegido", () => {
  assert.match(selectorSource, /onClick=\{\(\) => onChange\(subject\.subjectRef\)\}/);
});

test("6 el label visible es generico, nunca el subjectRef crudo como nombre", () => {
  assert.match(selectorSource, /Paciente existente ·/);
  assert.doesNotMatch(selectorSource, />\{subject\.subjectRef\}</);
});

test("7 el subjectRef nunca se imprime como texto visible en la lista", () => {
  const listBlock = selectorSource.slice(selectorSource.indexOf("wl-patient-results"), selectorSource.indexOf("</ul>"));
  assert.doesNotMatch(listBlock, />\s*\{subject\.subjectRef\}\s*</);
});

test("8 la busqueda de subjects filtra por caseId, nunca por subjectRef", () => {
  assert.match(selectorSource, /latestCaseId\.toLowerCase\(\)\.includes/);
  assert.doesNotMatch(selectorSource, /subjectRef\.toLowerCase\(\)\.includes/);
});

test("9 crear el Study envia el subjectRef elegido dentro de studyMetadata", () => {
  assert.match(drawerSource, /studyMetadata: normalizedStudyMetadata/);
  assert.match(drawerSource, /normalizeStudyMetadataInput\(metadata\)/);
});

test("10 metadata.subjectRef es alimentado directo por el SubjectSelector", () => {
  assert.match(drawerSource, /setMetadata\(\(current\) => \(\{ \.\.\.current, subjectRef \}\)\)/);
  assert.match(drawerSource, /value=\{metadata\.subjectRef\}/);
});

test("11 no existe ningun paso de asociacion posterior a la corrida", () => {
  assert.doesNotMatch(drawerSource, /associationState|attemptPatientAssociation|retryPatientAssociation|patientStudyAssociation|Asociando al paciente/);
});

test("12 ni el drawer ni el selector importan o llaman a patientApi.ts", () => {
  assert.doesNotMatch(drawerSource, /from ["']\.\.\/\.\.\/patientApi["']|from ["']\.\/patientApi["']/);
  assert.doesNotMatch(selectorSource, /from ["']\.\.\/\.\.\/patientApi["']|from ["']\.\/patientApi["']/);
});

test("13 ni el drawer ni el selector llaman al endpoint legacy de asociacion", () => {
  assert.doesNotMatch(drawerSource, /\/patient["'`]|associateStudyPatient/);
  assert.doesNotMatch(selectorSource, /\/patient["'`]|associateStudyPatient/);
});

test("14 un Study puede crearse sin subject seleccionado (86-N)", () => {
  assert.match(drawerSource, /const studyIdentityReady = caseIdReady;/);
});

test("15 el modo Paciente nuevo permite declarar un subjectRef manual", () => {
  assert.match(selectorSource, /Paciente nuevo/);
  assert.match(selectorSource, /validateSubjectRef\(trimmed\)/);
});

test("15b la validacion de subjectRef nuevo reutiliza el helper existente, no inventa una regla", () => {
  assert.match(studyMetadataSource, /export function validateSubjectRef/);
  assert.match(selectorSource, /import \{ validateSubjectRef \} from "\.\.\/\.\.\/studyMetadata"/);
});

test("16 el boton de analizar se deshabilita mientras corre", () => {
  assert.match(drawerSource, /disabled=\{!sagittalReady \|\| running\}/);
});

test("17 doble submit queda bloqueado por una referencia sincronica", () => {
  assert.match(drawerSource, /runInFlightRef\.current/);
  assert.match(drawerSource, /if \(!sagittalReady \|\| running \|\| runInFlightRef\.current\) return/);
});

test("18 un error de creacion muestra mensaje y no rompe el flujo", () => {
  assert.match(drawerSource, /setMessage\(apiErrorMessage\(error, "ejecutar el análisis"\)\)/);
});

test("19 la carga de imagenes sigue igual, no fue reescrita", () => {
  assert.match(drawerSource, /uploadAiInput\(file, normalizedCaseId, plane\)/);
  assert.match(drawerSource, /uploadStudyArchive\(file, normalizedCaseId\)/);
});

test("20 exito completo navega al Study creado", () => {
  assert.match(drawerSource, /function openCompletedStudy\(caseIdToOpen: string\)/);
  assert.match(drawerSource, /onAnalysisReady\(caseIdToOpen\)/);
});

test("21 un error de analisis conserva el subjectRef ya elegido (no se resetea metadata)", () => {
  const runStart = drawerSource.indexOf("async function run()");
  const catchStart = drawerSource.indexOf("catch (error)", runStart);
  const errorBlock = drawerSource.slice(catchStart, drawerSource.indexOf("finally", catchStart));
  assert.doesNotMatch(errorBlock, /setMetadata\(/);
});

test("22 el selector de modo tiene semantica de radiogroup accesible", () => {
  assert.match(selectorSource, /role="radiogroup"/);
  assert.match(selectorSource, /type="radio"/);
});

test("23 cerrar el drawer sigue funcionando igual (Escape y boton)", () => {
  assert.match(drawerSource, /if \(event\.key === "Escape"\) onClose\(\);/);
  assert.match(drawerSource, /onClick=\{onClose\}/);
});

test("24 la carga de subjects maneja una respuesta obsoleta (cancelled flag)", () => {
  assert.match(selectorSource, /let cancelled = false;/);
  assert.match(selectorSource, /if \(!cancelled\) setListState/);
});

test("25 nunca se fabrica un PatientName ni se usa patientReference", () => {
  assert.doesNotMatch(drawerSource, /patientReference|PatientName|patientName/);
  assert.doesNotMatch(selectorSource, /patientReference|PatientName|patientName/);
});

test("26 PatientSelector.tsx y patientStudyAssociation.ts fueron retirados", () => {
  assert.ok(!existsSync(join(root, "src/features/worklist/PatientSelector.tsx")));
  assert.ok(!existsSync(join(root, "src/features/worklist/patientStudyAssociation.ts")));
});

test("27 patientApi.ts fue retirado (sin consumidores reales restantes)", () => {
  assert.ok(!existsSync(join(root, "src/patientApi.ts")));
});

test("28 no hay entidad Patient nueva en el dominio del flujo (sólo Study.subjectRef)", () => {
  assert.doesNotMatch(drawerSource, /new Patient|PatientRepository|patient_id/);
  assert.doesNotMatch(selectorSource, /new Patient|PatientRepository|patient_id/);
});

console.log(`Post-E50 Stage 86 new analysis flow tests passed: ${count}`);
