import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const drawer = readFileSync(join(root, "src/features/worklist/NewAnalysisDrawer.tsx"), "utf8");
const selector = readFileSync(join(root, "src/features/worklist/PatientContextSelector.tsx"), "utf8");
const metadata = readFileSync(join(root, "src/studyMetadata.ts"), "utf8");
const api = readFileSync(join(root, "src/patientApi.ts"), "utf8");

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("1 la pantalla dedicada usa el selector de pacientes", () => {
  assert.match(drawer, /<PatientContextSelector/);
  assert.match(drawer, /dedicated \? "wl-new-study-page"/);
});
test("2 permite buscar pacientes por código o nombre", () => {
  assert.match(selector, /searchPatients\(query\)/);
  assert.match(api, /URLSearchParams/);
  assert.match(api, /\/api\/patients\?/);
});
test("3 permite crear un paciente compacto sin exigir nombre", () => {
  assert.match(selector, /Crear paciente/);
  assert.match(selector, /patientReference/);
  assert.match(selector, /dateOfBirth/);
});
test("4 conserva el camino explícito desidentificado", () => {
  assert.match(selector, /Continuar sin asociar paciente/);
  assert.match(drawer, /onContinueDeidentified/);
});
test("5 no expone el identificador interno del paciente", () => {
  assert.doesNotMatch(selector, />\s*\{(?:selected|patient)\.id\}\s*</);
  assert.match(selector, /patientReference/);
});
test("6 contexto clínico separado del estudio e identifica procedencia de edad", () => {
  assert.match(drawer, /Contexto clínico/);
  assert.match(drawer, /ageProvenance/);
  assert.match(metadata, /contextVersion/);
});
test("7 conserva síntomas, duración y antecedentes como opcionales", () => {
  assert.match(drawer, /symptoms/);
  assert.match(drawer, /symptomDuration/);
  assert.match(drawer, /relevantHistory/);
});
test("8 advierte discrepancias entre edad informada y calculada", () => {
  assert.match(drawer, /no coincide con la calculada/);
  assert.match(drawer, /function ageOn/);
});
test("9 el ID sigue siendo requisito antes de subir imágenes", () => {
  assert.match(drawer, /caseIdReady/);
  assert.match(drawer, /const studyIdentityReady = caseIdReady/);
});
test("10 la carga por ZIP y por plano se conservan", () => {
  assert.match(drawer, /uploadStudyArchive/);
  assert.match(drawer, /uploadAiInput/);
});
test("11 el análisis sigue bloqueado durante su ejecución", () => {
  assert.match(drawer, /runInFlightRef\.current/);
  assert.match(drawer, /disabled=\{Boolean\(analyzeBlocker\) \|\| running\}/);
});
test("12 el selector descarta respuestas de búsqueda obsoletas", () => {
  assert.match(selector, /let cancelled = false/);
  assert.match(selector, /if \(!cancelled\)/);
});
test("13 cada carga protege su respuesta contra reemplazo y desmontaje", () => {
  assert.match(drawer, /planeUploadRequestRef/);
  assert.match(drawer, /studyUploadRequestRef/);
  assert.match(drawer, /mountedRef\.current/);
  assert.match(drawer, /requestId !== planeUploadRequestRef\.current\[plane\]/);
});
test("14 se conserva el retorno y el foco del panel", () => {
  assert.match(drawer, /previousActiveElementRef/);
  assert.match(drawer, /backButtonRef\.current\?\.focus/);
  assert.match(drawer, /previousActiveElementRef\.current\?\.focus/);
});
test("15 los nuevos campos viajan en studyMetadata", () => {
  assert.match(drawer, /normalizeStudyMetadataInput\(metadata\)/);
  assert.match(metadata, /clinicalReason/);
  assert.match(metadata, /ageAtStudy/);
});
test("16 el módulo de pacientes usa el backend y no un almacén local", () => {
  assert.match(api, /multiplanarRequest/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
});
test("17 no se agregan rutas de visor ni asociación posterior", () => {
  assert.doesNotMatch(drawer, /associationState|attemptPatientAssociation/);
  assert.match(drawer, /onAnalysisReady/);
});
test("18 el selector muestra el paciente elegido con contexto permitido", () => {
  assert.match(selector, /Paciente desidentificado/);
  assert.match(selector, /Cambiar/);
  assert.match(selector, /patient\.patientReference/);
});
test("19 no quedan los contratos retirados del flujo nuevo", () => {
  assert.ok(!existsSync(join(root, "src/features/worklist/PatientSelector.tsx")));
  assert.ok(!existsSync(join(root, "src/features/worklist/patientStudyAssociation.ts")));
});

console.log(`Post-E50 new analysis flow tests passed: ${count}`);
