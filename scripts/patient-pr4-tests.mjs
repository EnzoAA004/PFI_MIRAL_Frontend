import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Stage 85-X: this file used to also cover `PatientsView.tsx`'s pre-Stage-85 search UI and
 * `PatientDetailView.tsx` in full. Stage 85 replaced `PatientsView.tsx`'s data source (now the
 * subject-list projection, see `post-e50-patient-list-tests.mjs`) and deleted `PatientDetailView.tsx`
 * (confirmed orphaned -- `App.tsx` has routed `/pacientes/:id` to `PatientHistoryPage` since Stage
 * 84, and grep found no other consumer). What survives here is `patientApi.ts`'s own parsing
 * contract, which is still live: `PatientSelector.tsx`/`NewAnalysisDrawer.tsx` (the "Nuevo análisis"
 * patient-selection step) and `patientStudyAssociation.ts` still import from it.
 */
const patientApiSource = readFileSync("src/patientApi.ts", "utf8");

class ContractError extends Error {
  constructor(message, path) {
    super(message);
    this.path = path;
  }
}

function loadPatientApi() {
  const source = patientApiSource.replace(/^import .*$/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console, ContractError, URLSearchParams, multiplanarRequest: async () => ({}) };
  vm.runInNewContext(`${js}
exports.parsePatient = parsePatient;
exports.parsePatientSearch = parsePatientSearch;
exports.parsePatientStudies = parsePatientStudies;
exports.isValidPatientId = isValidPatientId;`, sandbox);
  return sandbox.exports;
}

const api = loadPatientApi();
const patientId = "11111111-1111-4111-8111-111111111111";

function patient(overrides = {}) {
  return {
    id: patientId,
    patientReference: "PAC-001",
    createdAt: "2026-08-12T10:00:00Z",
    updatedAt: "2026-08-12T10:00:00Z",
    ...overrides,
  };
}

function study(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    caseId: "CASE-001",
    studyDate: "2026-08-12",
    modality: "MRI",
    description: "Lumbar",
    reviewPriority: "medium",
    status: "completed",
    ...overrides,
  };
}

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}

test("1 PatientSummaryDto real contiene solo identidad pseudonima y timestamps", () => {
  assert.deepEqual(Object.keys(api.parsePatient(patient())), ["id", "patientReference", "createdAt", "updatedAt"]);
});

test("2 la lista real parsea Patients persistidos sin agregados inventados", () => {
  assert.equal(api.parsePatientSearch([patient()])[0].patientReference, "PAC-001");
  assert.doesNotMatch(patientApiSource, /studyCount|latestStudyDate|latestStatus/);
});

test("3 Studies del Patient usan el contrato summary", () => {
  assert.equal(api.parsePatientStudies([study()], patientId)[0].caseId, "CASE-001");
});

test("4 Study summary acepta metadata nullable", () => {
  const parsed = api.parsePatientStudies([study({ studyDate: null, modality: null, description: null, reviewPriority: null, status: null })], patientId)[0];
  assert.equal(parsed.studyDate, null);
  assert.equal(parsed.status, null);
});

test("5 parser fail-closed rechaza payload Patient incompleto", () => {
  assert.throws(() => api.parsePatient({ id: patientId }), ContractError);
});

test("6 UUID de Patient valida formato antes de pedir al Backend", () => {
  assert.equal(api.isValidPatientId("no-es-uuid"), false);
  assert.equal(api.isValidPatientId(patientId), true);
});

console.log(`PATIENT-PR4 tests passed: ${count}`);
