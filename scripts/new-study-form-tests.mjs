import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

/**
 * Comportamiento de las reglas de "Nuevo estudio" (src/features/worklist/newStudyForm.ts).
 *
 * No son chequeos de texto del fuente: el módulo se transpila y se ejecuta, y se
 * ejercitan los casos que motivaron la corrección —respuestas tardías de una carga,
 * cambio de ID con archivos ya cargados, doble pedido sobre el mismo casillero— junto
 * con los mensajes que dicen qué falta y cuándo hay algo que se perdería al salir.
 */
const source = fs.readFileSync("src/features/worklist/newStudyForm.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sandbox = { exports: {}, console };
vm.runInNewContext(js, sandbox);
const {
  analyzeBlockerMessage, caseIdError, createRequestGate, hasUnsavedWork, uploadBlockerMessage,
} = sandbox.exports;

test("la respuesta tardía de un archivo A no pisa al B elegido después", () => {
  const gate = createRequestGate();
  const a = gate.begin("study");
  const b = gate.begin("study");
  assert.equal(gate.isCurrent(a), false, "A ya fue reemplazado por B");
  assert.equal(gate.isCurrent(b), true);
});

test("cada casillero es independiente: elegir sagital no invalida la carga axial", () => {
  const gate = createRequestGate();
  const axial = gate.begin("axial");
  gate.begin("sagittal");
  assert.equal(gate.isCurrent(axial), true);
});

test("cambiar el ID invalida lo que estaba en vuelo, de todos los casilleros", () => {
  const gate = createRequestGate();
  const study = gate.begin("study");
  const sagittal = gate.begin("sagittal");
  gate.invalidateAll();
  assert.equal(gate.isCurrent(study), false);
  assert.equal(gate.isCurrent(sagittal), false);
  const afterChange = gate.begin("study");
  assert.equal(gate.isCurrent(afterChange), true, "lo pedido con el ID nuevo sí vale");
});

test("descartar un casillero invalida solo su respuesta pendiente", () => {
  const gate = createRequestGate();
  const study = gate.begin("study");
  const axial = gate.begin("axial");
  gate.invalidate("study");
  assert.equal(gate.isCurrent(study), false);
  assert.equal(gate.isCurrent(axial), true);
});

test("el ID del estudio se valida con la regla del backend y nombra el carácter que sobra", () => {
  assert.equal(caseIdError("CASE-2001"), "");
  assert.equal(caseIdError(""), "");
  assert.match(caseIdError("-abc"), /empezar con una letra o un número/);
  assert.match(caseIdError("caso 1"), /No puede llevar espacios/);
  assert.match(caseIdError("caso#1"), /«#»/);
  assert.match(caseIdError("a".repeat(81)), /Máximo 80/);
});

test("sin ID válido la carga explica qué falta; con ID válido no dice nada", () => {
  assert.equal(uploadBlockerMessage("", ""), "Ingresá un ID de estudio válido para cargar las imágenes");
  assert.equal(uploadBlockerMessage("caso#1", "no permitido"), "Ingresá un ID de estudio válido para cargar las imágenes");
  assert.equal(uploadBlockerMessage("CASE-1", ""), "");
});

test("el botón de análisis dice qué falta, en orden, y se calla cuando se puede analizar", () => {
  const base = { running: false, normalizedCaseId: "CASE-1", caseIdIssue: "", uploading: false, zipLoaded: false, sagittalInputId: undefined };
  assert.equal(analyzeBlockerMessage({ ...base, normalizedCaseId: "" }), "Falta el ID del estudio.");
  assert.equal(analyzeBlockerMessage({ ...base, caseIdIssue: "x" }), "El ID del estudio no es válido.");
  assert.equal(analyzeBlockerMessage({ ...base, uploading: true }), "Esperá a que termine la carga de las imágenes.");
  assert.match(analyzeBlockerMessage(base), /Falta cargar el ZIP/);
  assert.match(analyzeBlockerMessage({ ...base, zipLoaded: true }), /no incluye una serie sagital/);
  assert.equal(analyzeBlockerMessage({ ...base, sagittalInputId: "in-1" }), "");
  assert.equal(analyzeBlockerMessage({ ...base, sagittalInputId: "in-1", ageIssue: "La edad declarada debe ser un número entero entre 0 y 130." }), "La edad declarada debe ser un número entero entre 0 y 130.");
  assert.equal(analyzeBlockerMessage({ ...base, running: true }), "", "durante la corrida el pie muestra su propio aviso");
});

test("solo se pide confirmar al salir cuando hay algo que se perdería", () => {
  const clean = { caseId: "", description: "", studyDate: "", reviewPriority: "medium", patientSelected: false, contextFilled: false, hasLoadedFiles: false, analysisPersisted: false };
  assert.equal(hasUnsavedWork(clean), false, "formulario intacto: se sale sin preguntar");
  assert.equal(hasUnsavedWork({ ...clean, caseId: "CASE-1" }), true);
  assert.equal(hasUnsavedWork({ ...clean, description: "RM" }), true);
  assert.equal(hasUnsavedWork({ ...clean, studyDate: "2026-10-06" }), true);
  assert.equal(hasUnsavedWork({ ...clean, reviewPriority: "high" }), true);
  assert.equal(hasUnsavedWork({ ...clean, patientSelected: true }), true, "elegir paciente o sin paciente cuenta");
  assert.equal(hasUnsavedWork({ ...clean, contextFilled: true }), true, "edad declarada o texto clinico cuentan");
  assert.equal(hasUnsavedWork({ ...clean, hasLoadedFiles: true }), true);
  assert.equal(hasUnsavedWork({ ...clean, caseId: "CASE-1", hasLoadedFiles: true, analysisPersisted: true }), false, "con la corrida guardada no se pierde nada");
});
