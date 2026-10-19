import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Protección de ediciones sin guardar (lógica pura). El comportamiento en pantalla (diálogo, «atrás» del navegador,
 * guardado fallido) lo cubre scripts/playwright-unsaved-changes-e2e.mjs contra 8288.
 */
const root = process.cwd();
function load(path, names, extra = {}) {
  const source = readFileSync(join(root, path), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console, ...extra };
  vm.runInNewContext(`${js}\n${names.map((n) => `exports.${n} = ${n};`).join("\n")}`, sandbox);
  return sandbox.exports;
}
const store = load("src/features/navigation/unsavedChanges.ts", ["setPending", "hasPending", "pendingItems", "requestLeave", "openConfirmation", "resolveConfirmation", "getSnapshot", "subscribe", "resetForTests"]);
const review = load("src/features/navigation/pendingReviewItems.ts", ["pendingReviewItems"]);

let n = 0;
function test(name, fn) {
  store.resetForTests();
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}
const base = { notes: "", savedNotes: "", status: "pendiente", savedStatus: "pendiente", annotationsUnsaved: false, annotationTextDraft: "", measurementDraftCount: 0, contourDraftCount: 0 };
const j = (v) => JSON.parse(JSON.stringify(v));

test("sin cambios no hay nada pendiente", () => {
  assert.deepEqual(j(review.pendingReviewItems(base)), []);
  // un espacio al final no es un cambio
  assert.deepEqual(j(review.pendingReviewItems({ ...base, notes: "nota ", savedNotes: "nota" })), []);
});

test("cada tipo de edición de la Revisión se detecta contra lo guardado", () => {
  assert.deepEqual(j(review.pendingReviewItems({ ...base, notes: "nueva", savedNotes: "vieja" })), ["Notas de la revisión"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, status: "aceptado" })), ["Estado de revisión elegido, sin confirmar"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, annotationsUnsaved: true })), ["Anotaciones y marcas sin guardar"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, annotationTextDraft: "texto" })), ["Texto de una anotación sin agregar"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, measurementDraftCount: 1 })), ["1 corrección de medición sin guardar"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, measurementDraftCount: 3 })), ["3 correcciones de mediciones sin guardar"]);
  assert.deepEqual(j(review.pendingReviewItems({ ...base, contourDraftCount: 2 })), ["2 contornos en borrador"]);
});

test("el guardado exitoso (nuevo estado de referencia) limpia lo pendiente", () => {
  const edited = { ...base, notes: "nota nueva", savedNotes: "" };
  assert.equal(review.pendingReviewItems(edited).length, 1);
  assert.equal(review.pendingReviewItems({ ...edited, savedNotes: "nota nueva" }).length, 0);
});

test("el registro de lo pendiente se suma y se limpia por vista", () => {
  store.setPending("review", "Revisión", ["Notas de la revisión"]);
  store.setPending("prereport", "Preinforme", ["Ediciones del preinforme"]);
  assert.equal(store.hasPending(), true);
  assert.equal(store.hasPending("review"), true);
  assert.deepEqual(j(store.pendingItems()), ["Notas de la revisión", "Ediciones del preinforme"]);
  store.setPending("review", "Revisión", []);
  assert.equal(store.hasPending("review"), false);
  assert.equal(store.hasPending("prereport"), true);
  assert.equal(store.hasPending(), true);
});

test("sin cambios, requestLeave sigue de inmediato y no abre el diálogo", () => {
  let left = 0;
  assert.equal(store.requestLeave(() => { left += 1; }), true);
  assert.equal(left, 1);
  assert.equal(store.getSnapshot().request, null);
});

test("con cambios, requestLeave pregunta; «Seguir editando» no sale y «Salir sin guardar» sí", () => {
  store.setPending("review", "Revisión", ["Notas de la revisión"]);
  let left = 0;
  let cancelled = 0;
  assert.equal(store.requestLeave(() => { left += 1; }, { cancel: () => { cancelled += 1; } }), false);
  assert.notEqual(store.getSnapshot().request, null);
  assert.equal(left, 0);
  store.resolveConfirmation("stay");
  assert.equal(left, 0);
  assert.equal(cancelled, 1);
  assert.equal(store.getSnapshot().request, null);
  store.requestLeave(() => { left += 1; });
  store.resolveConfirmation("leave");
  assert.equal(left, 1);
});

test("el alcance de requestLeave ignora lo pendiente de otras vistas", () => {
  store.setPending("review", "Revisión", ["Notas de la revisión"]);
  let left = 0;
  // el editor del preinforme se cierra sin preguntar por la Revisión, que sigue abierta debajo
  assert.equal(store.requestLeave(() => { left += 1; }, { scope: "prereport" }), true);
  assert.equal(left, 1);
  store.setPending("prereport", "Preinforme", ["Ediciones del preinforme"]);
  assert.equal(store.requestLeave(() => { left += 1; }, { scope: "prereport" }), false);
  assert.equal(store.getSnapshot().request.scope, "prereport");
});

test("desmontar la vista (función devuelta) quita lo pendiente", () => {
  const remove = store.setPending("review", "Revisión", ["Notas de la revisión"]);
  assert.equal(store.hasPending(), true);
  remove();
  assert.equal(store.hasPending(), false);
});

test("el estado de referencia y los guardados no cambian el estado del estudio: la lógica no importa ninguna API", () => {
  const source = readFileSync(join(root, "src/features/navigation/unsavedChanges.ts"), "utf8");
  assert.doesNotMatch(source, /fetch\(|Api\b|onSaveReview|savePreReport/);
});

console.log(`Ediciones sin guardar: ${n} pruebas pasaron`);
