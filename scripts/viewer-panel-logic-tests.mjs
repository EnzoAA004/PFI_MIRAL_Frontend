import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Panel derecho del visor, etapa 1: la lógica de presentación que decide qué dice y qué permite
 * cada control. Se ejecuta el código real (transpilado), no se busca texto en el fuente:
 * ancho ajustable con teclado y mouse, conteos, alcance de las clasificaciones del disco,
 * estado de las acciones de revisión y filas de contexto.
 */
function loadModule(path, exportNames) {
  const source = readFileSync(path, "utf8").replace(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+"[^"]+";\s*/g, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const layout = loadModule("src/features/reading/inspectorLayout.ts", [
  "inspectorWidthLimits", "clampInspectorWidth", "defaultInspectorWidth", "inspectorWidthForKey",
  "inspectorWidthForPointer", "parseStoredInspectorWidth", "INSPECTOR_MIN_WIDTH", "INSPECTOR_KEY_STEP", "INSPECTOR_KEY_STEP_LARGE",
]);
const display = loadModule("src/features/reading/inspectorDisplay.ts", [
  "measurementCountLabel", "discClassificationScope", "reviewActionState", "clinicalContextRows", "hasAnyClinicalContext", "NOT_REPORTED",
]);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

/* ------------------------------------------------------------------------------ ancho */

check("anchos iniciales: 1366×768 deja casi 1000 px a la imagen y 1920×1080 más de 1400", () => {
  const w1366 = layout.defaultInspectorWidth(1366);
  const w1920 = layout.defaultInspectorWidth(1920);
  assert.ok(w1366 >= 360 && w1366 <= 400, `1366 → ${w1366}`);
  assert.equal(w1920, 480);
  assert.ok(1366 - w1366 >= 960);
  assert.ok(1920 - w1920 >= 1400);
});

check("los límites nunca dejan al panel ocupar más de la mitad de la ventana ni menos del mínimo", () => {
  for (const viewport of [1024, 1366, 1920, 2560]) {
    const { min, max } = layout.inspectorWidthLimits(viewport);
    assert.equal(min, layout.INSPECTOR_MIN_WIDTH);
    assert.ok(max <= 640 && max >= min);
    assert.ok(max <= Math.max(viewport * 0.5, min + 40));
    assert.equal(layout.clampInspectorWidth(10, viewport), min);
    assert.equal(layout.clampInspectorWidth(99999, viewport), max);
  }
});

check("el teclado cambia el ancho: ← ensancha, → angosta, Mayús da pasos grandes, Inicio/Fin van a los límites", () => {
  const start = 400;
  assert.equal(layout.inspectorWidthForKey("ArrowLeft", start, 1920), start + layout.INSPECTOR_KEY_STEP);
  assert.equal(layout.inspectorWidthForKey("ArrowRight", start, 1920), start - layout.INSPECTOR_KEY_STEP);
  assert.equal(layout.inspectorWidthForKey("ArrowLeft", start, 1920, true), start + layout.INSPECTOR_KEY_STEP_LARGE);
  const { min, max } = layout.inspectorWidthLimits(1920);
  assert.equal(layout.inspectorWidthForKey("Home", start, 1920), min);
  assert.equal(layout.inspectorWidthForKey("End", start, 1920), max);
  assert.equal(layout.inspectorWidthForKey("Enter", start, 1920), null, "otras teclas no mueven el separador");
});

check("el teclado no pasa de los límites", () => {
  const { min, max } = layout.inspectorWidthLimits(1366);
  assert.equal(layout.inspectorWidthForKey("ArrowRight", min, 1366), min);
  assert.equal(layout.inspectorWidthForKey("ArrowLeft", max, 1366), max);
});

check("arrastrar: el panel termina donde está el puntero, medido desde el borde derecho", () => {
  assert.equal(layout.inspectorWidthForPointer(1000, 1366, 1366), 366);
  assert.equal(layout.inspectorWidthForPointer(100, 1366, 1366), layout.inspectorWidthLimits(1366).max);
  assert.equal(layout.inspectorWidthForPointer(1360, 1366, 1366), layout.INSPECTOR_MIN_WIDTH);
});

check("un ancho guardado se respeta, se ajusta a los límites actuales y lo inválido se ignora", () => {
  assert.equal(layout.parseStoredInspectorWidth("450", 1920), 450);
  assert.equal(layout.parseStoredInspectorWidth("5000", 1366), layout.inspectorWidthLimits(1366).max);
  assert.equal(layout.parseStoredInspectorWidth("abc", 1366), null);
  assert.equal(layout.parseStoredInspectorWidth(null, 1366), null);
  assert.equal(layout.parseStoredInspectorWidth("", 1366), null);
});

/* ---------------------------------------------------------------------------- conteos */

check("los conteos dicen qué cuentan: '5 mediciones', '1 medición', 'Sin mediciones'", () => {
  assert.equal(display.measurementCountLabel(5), "5 mediciones");
  assert.equal(display.measurementCountLabel(1), "1 medición");
  assert.equal(display.measurementCountLabel(0), "Sin mediciones");
});

/* ------------------------------------------------------------ alcance de clasificaciones */

const finding = (findingType, label, deploymentStatus = "supported_internal") => ({ findingType, label, deploymentStatus });
const FOUR_ABSENT = [
  finding("disc_bulging", "absent"), finding("disc_narrowing", "absent"),
  finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  finding("pfirrmann_grade", "II", "experimental"),
];

check("'ausente' se dice sobre las clasificaciones evaluadas, nunca como disco normal", () => {
  const scope = display.discClassificationScope(FOUR_ABSENT);
  assert.equal(scope.summary, "Ausente en las 4 clasificaciones evaluadas");
  assert.equal(scope.evaluated.length, 4);
  assert.equal(scope.present.length, 0);
  assert.match(scope.scopeNote, /abombamiento, estrechamiento, cambio del platillo superior y cambio del platillo inferior/);
  assert.match(scope.scopeNote, /no descarta otras alteraciones/);
  assert.doesNotMatch(scope.summary, /normal|Sin hallazgos/i);
});

check("Pfirrmann se separa de las demás clasificaciones y no cuenta como una de ellas", () => {
  const scope = display.discClassificationScope(FOUR_ABSENT);
  assert.equal(scope.pfirrmann, "II");
  assert.ok(!scope.evaluated.includes("pfirrmann_grade"));
});

check("presente en algunas: se cuenta sobre las evaluadas", () => {
  const scope = display.discClassificationScope([
    finding("disc_bulging", "present"), finding("disc_narrowing", "present"),
    finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  ]);
  assert.equal(scope.summary, "Presente en 2 de 4 clasificaciones evaluadas");
  assert.deepEqual(scope.present, ["disc_bulging", "disc_narrowing"]);
});

check("un disco sin clasificaciones no se presenta como negativo ni como normal", () => {
  const scope = display.discClassificationScope([]);
  assert.equal(scope.summary, "Sin clasificaciones informadas");
  assert.equal(scope.scopeNote, null);
  assert.equal(scope.pfirrmann, null);
});

check("solo Pfirrmann informado: no hay clasificaciones 'ausentes' que inventar", () => {
  const scope = display.discClassificationScope([finding("pfirrmann_grade", "III", "experimental")]);
  assert.equal(scope.summary, "Sin clasificaciones informadas");
  assert.equal(scope.pfirrmann, "III");
});

check("los resultados de investigación no entran en el resumen del disco", () => {
  const scope = display.discClassificationScope([
    finding("disc_bulging", "absent"), finding("modic_change", "II", "not_product_supported"),
  ]);
  assert.equal(scope.evaluated.length, 1);
  assert.equal(scope.summary, "Ausente en la clasificación evaluada");
});

/* ----------------------------------------------------------------------------- revisión */

const review = (status, extra = {}) => display.reviewActionState({ status, saving: false, locked: false, notes: "", ...extra });

check("Pendiente: Confirmar queda deshabilitado y el motivo se muestra como texto junto al control", () => {
  const state = review("pendiente");
  assert.equal(state.confirmDisabled, true);
  assert.match(state.confirmReason, /Elegí Observado, Finalizado o Descartado/);
  assert.match(state.confirmReason, /Guardar borrador/);
  assert.equal(state.draftDisabled, false, "guardar borrador sigue disponible");
});

check("cada estado con efecto tiene una etiqueta que dice qué hace", () => {
  assert.equal(review("aceptado").confirmLabel, "Finalizar y aprobar estudio");
  assert.equal(review("observado").confirmLabel, "Marcar como observado");
  assert.equal(review("descartado").confirmLabel, "Descartar estudio");
  assert.equal(review("aceptado").confirmDisabled, false);
  assert.equal(review("aceptado").confirmReason, null);
});

check("mientras se guarda, ambas acciones se bloquean y se explica por qué", () => {
  const state = review("aceptado", { saving: true });
  assert.equal(state.confirmDisabled, true);
  assert.equal(state.draftDisabled, true);
  assert.match(state.confirmReason, /Guardando/);
  assert.match(state.draftReason, /Guardando/);
});

check("Observado y Descartado avisan de la nota mínima sin cambiar la regla del guardado", () => {
  assert.match(review("observado").notesHint, /al menos 5 caracteres/);
  assert.match(review("descartado", { notes: "abc" }).notesHint, /al menos 5 caracteres/);
  assert.equal(review("observado", { notes: "Nota completa" }).notesHint, null);
  assert.equal(review("aceptado").notesHint, null);
  // el aviso no deshabilita: lo valida el guardado, como antes
  assert.equal(review("observado").confirmDisabled, false);
});

check("un estudio finalizado avisa que los valores están bloqueados", () => {
  assert.match(review("aceptado", { locked: true }).lockedNotice, /bloqueados/);
  assert.equal(review("aceptado").lockedNotice, null);
});

/* ------------------------------------------------------------------------------ contexto */

check("el contexto muestra edad con su procedencia y marca lo no informado", () => {
  const rows = display.clinicalContextRows(
    { ageAtStudy: 51, clinicalReason: "Lumbalgia", symptoms: null, symptomDuration: null, relevantHistory: null },
    "Calculada con la fecha de nacimiento",
  );
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  assert.equal(byKey.age, "51 años · Calculada con la fecha de nacimiento");
  assert.equal(byKey.reason, "Lumbalgia");
  assert.equal(byKey.symptoms, null);
  assert.equal(byKey.duration, null);
  assert.equal(byKey.history, null);
  assert.equal(display.hasAnyClinicalContext(rows), true);
});

check("sin contexto todos los campos quedan sin informar (null), no inventados", () => {
  const rows = display.clinicalContextRows(null, "Procedencia no informada");
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.value === null));
  assert.equal(display.hasAnyClinicalContext(rows), false);
  assert.equal(display.NOT_REPORTED, "No informado");
});

check("la edad es la guardada para el estudio: no hay ninguna fecha actual en la lógica de contexto", () => {
  const source = readFileSync("src/features/reading/inspectorDisplay.ts", "utf8");
  const contextPart = source.slice(source.indexOf("export function clinicalContextRows"));
  assert.doesNotMatch(contextPart, /new Date|Date\.now/);
  const panel = readFileSync("src/features/reading/StudyContextPanel.tsx", "utf8");
  assert.doesNotMatch(panel, /new Date|Date\.now|birthDate/);
});

console.log(`Viewer panel logic tests passed: ${passed}`);
