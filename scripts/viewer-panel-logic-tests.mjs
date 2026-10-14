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
  "measurementCountLabel", "discClassificationRows", "discPositivesSummary", "DISC_COUNT_NOTE", "reviewActionState",
  "clinicalContextRows", "hasAnyClinicalContext", "NOT_REPORTED", "ageProvenanceShort", "ageProvenanceHelp", "CONTEXT_HELP_NOTES",
  "annotationsPendingNotice",
]);
const tools = loadModule("src/features/reading/inspectorToolsIndex.ts", [
  "INSPECTOR_TOOLS", "INSPECTOR_TOOL_GROUPS", "inspectorToolById", "inspectorToolsInGroup",
]);

// Los módulos corren en otro contexto de vm: se compara por contenido, no por prototipo.
const deepEqual = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));

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

const finding = (findingType, label, deploymentStatus = "supported_internal", confidence = 0.8) => ({ findingType, label, deploymentStatus, confidence });
const FOUR_ABSENT = [
  finding("disc_bulging", "absent"), finding("disc_narrowing", "absent"),
  finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  finding("pfirrmann_grade", "II", "experimental"),
];

check("cuatro clasificaciones válidas: '0 de 4', sin 'normal' ni 'sin hallazgos'", () => {
  const summary = display.discPositivesSummary(FOUR_ABSENT);
  assert.equal(summary.text, "0 de 4");
  assert.equal(summary.complete, true);
  assert.equal(summary.missingText, null);
  assert.doesNotMatch(summary.text, /normal|Sin hallazgos/i);
});

check("positivas: '2 de 4' solo con las cuatro presentes en el contrato", () => {
  const summary = display.discPositivesSummary([
    finding("disc_bulging", "present"), finding("disc_narrowing", "present"),
    finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  ]);
  assert.equal(summary.text, "2 de 4");
  assert.equal(summary.positives, 2);
});

check("el grado de Pfirrmann va aparte: es solo el grado y no cuenta entre las cuatro", () => {
  const summary = display.discPositivesSummary(FOUR_ABSENT);
  assert.equal(summary.pfirrmann, "II");
  assert.equal(display.discClassificationRows(FOUR_ABSENT).length, 4);
  assert.ok(display.discClassificationRows(FOUR_ABSENT).every((row) => row.type !== "pfirrmann_grade"));
});

check("datos faltantes: nunca '0 de 4' ni negativos; se dice cuántas se evaluaron y cuáles faltan", () => {
  const summary = display.discPositivesSummary([
    finding("disc_bulging", "present"), finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  ]);
  assert.equal(summary.complete, false);
  assert.equal(summary.text, "1 de 3 evaluadas");
  assert.doesNotMatch(summary.text, /de 4/);
  assert.match(summary.missingText, /Sin dato: estrechamiento discal/);
  const rows = display.discClassificationRows([finding("disc_bulging", "present")]);
  deepEqual(rows.map((row) => row.result), ["present", "missing", "missing", "missing"]);
});

check("un valor que no es presente/ausente no cuenta como negativo ni como positivo", () => {
  const rows = display.discClassificationRows([
    finding("disc_bulging", "absent"), finding("disc_narrowing", "indeterminado"),
    finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  ]);
  const narrowing = rows.find((row) => row.type === "disc_narrowing");
  assert.equal(narrowing.result, "missing");
  assert.equal(narrowing.rawLabel, "indeterminado");
  const summary = display.discPositivesSummary([
    finding("disc_bulging", "absent"), finding("disc_narrowing", "indeterminado"),
    finding("upper_endplate_change", "absent"), finding("lower_endplate_change", "absent"),
  ]);
  assert.equal(summary.text, "0 de 3 evaluadas");
  assert.equal(summary.complete, false);
});

check("un disco sin clasificaciones: 'Sin datos', no un negativo", () => {
  const summary = display.discPositivesSummary([]);
  assert.equal(summary.text, "Sin datos");
  assert.equal(summary.positives, 0);
  assert.equal(summary.complete, false);
  assert.equal(summary.pfirrmann, null);
});

check("solo Pfirrmann informado: las cuatro clasificaciones quedan sin dato, no ausentes", () => {
  const summary = display.discPositivesSummary([finding("pfirrmann_grade", "III", "experimental")]);
  assert.equal(summary.text, "Sin datos");
  assert.equal(summary.pfirrmann, "III");
  assert.ok(display.discClassificationRows([finding("pfirrmann_grade", "III")]).every((row) => row.result === "missing"));
});

check("los resultados de investigación no entran en el conteo ni en las filas del disco", () => {
  const rows = display.discClassificationRows([
    finding("disc_bulging", "absent"), finding("disc_narrowing", "present", "not_product_supported"),
  ]);
  assert.equal(rows.find((row) => row.type === "disc_narrowing").result, "missing");
  assert.equal(display.discPositivesSummary([finding("disc_bulging", "absent"), finding("modic_change", "II", "not_product_supported")]).text, "0 de 1 evaluadas");
});

check("el conteo se explica una sola vez: qué clasificaciones cubre y que no expresa gravedad ni normalidad", () => {
  assert.match(display.DISC_COUNT_NOTE, /abombamiento, estrechamiento y cambio de platillo superior e inferior/);
  assert.match(display.DISC_COUNT_NOTE, /No expresa gravedad ni normalidad/);
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

check("el contexto muestra la edad con una etiqueta breve de procedencia y marca lo no informado", () => {
  const rows = display.clinicalContextRows(
    { ageAtStudy: 51, clinicalReason: "Lumbalgia", symptoms: null, symptomDuration: null, relevantHistory: null },
    "calculated",
  );
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  assert.equal(byKey.age, "51 años · Calculada");
  assert.equal(byKey.reason, "Lumbalgia");
  assert.equal(byKey.symptoms, null);
  assert.equal(byKey.duration, null);
  assert.equal(byKey.history, null);
  assert.equal(display.hasAnyClinicalContext(rows), true);
  const reported = display.clinicalContextRows({ ageAtStudy: 62, clinicalReason: null, symptoms: null, symptomDuration: null, relevantHistory: null }, "reported");
  assert.equal(reported[0].value, "62 años · Declarada");
});

check("la explicación completa de la edad va en la ayuda, no en la fila", () => {
  assert.match(display.ageProvenanceHelp("calculated"), /fecha de nacimiento/);
  assert.match(display.ageProvenanceHelp("reported"), /declaró quien cargó el estudio/);
  assert.match(display.ageProvenanceHelp(null), /no registra/);
  assert.equal(display.ageProvenanceShort("calculated"), "Calculada");
  assert.equal(display.ageProvenanceShort("reported"), "Declarada");
  assert.equal(display.ageProvenanceShort(undefined), "Procedencia no informada");
  assert.ok(display.CONTEXT_HELP_NOTES.some((note) => /no se recalcula/.test(note)));
  assert.ok(display.CONTEXT_HELP_NOTES.some((note) => /no se envían al asistente/.test(note)));
});

check("sin contexto todos los campos quedan sin informar (null), no inventados", () => {
  const rows = display.clinicalContextRows(null, null);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.value === null));
  assert.equal(display.hasAnyClinicalContext(rows), false);
  assert.equal(display.NOT_REPORTED, "No informado");
});

check("la edad es la guardada para el estudio: no hay ninguna fecha actual en la lógica de contexto", () => {
  const source = readFileSync("src/features/reading/inspectorDisplay.ts", "utf8");
  const contextPart = source.slice(source.indexOf("export function clinicalContextRows"), source.indexOf("export function hasAnyClinicalContext"));
  assert.doesNotMatch(contextPart, /new Date|Date\.now/);
  const panel = readFileSync("src/features/reading/StudyContextPanel.tsx", "utf8");
  assert.doesNotMatch(panel, /new Date|Date\.now|birthDate/);
});

/* --------------------------------------------------------------------------- anotaciones */

check("el aviso de anotaciones dice dónde se guardan y qué falta, solo cuando hay algo pendiente", () => {
  assert.equal(display.annotationsPendingNotice({ unsaved: false, draftText: "" }), null);
  assert.equal(display.annotationsPendingNotice({ unsaved: false, draftText: "   " }), null);
  assert.match(display.annotationsPendingNotice({ unsaved: true, draftText: "" }), /Guardar borrador/);
  assert.match(display.annotationsPendingNotice({ unsaved: false, draftText: "texto" }), /sin agregar/);
  assert.match(display.annotationsPendingNotice({ unsaved: true, draftText: "texto" }), /texto sin agregar y anotaciones sin guardar/);
});

/* --------------------------------------------------------------------- herramientas del estudio */

const EXPECTED_TOOLS = ["history", "comparison", "report", "assistant", "concordance", "feedback", "audit", "three-d", "technical", "demo"];

check("el índice contiene todas las funciones inventariadas, una sola vez cada una", () => {
  const ids = tools.INSPECTOR_TOOLS.map((tool) => tool.id);
  deepEqual([...ids].sort(), [...EXPECTED_TOOLS].sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const tool of tools.INSPECTOR_TOOLS) {
    assert.ok(tool.title && tool.hint, `título y descripción de ${tool.id}`);
    assert.ok(tools.INSPECTOR_TOOL_GROUPS.some((group) => group.id === tool.group), `grupo de ${tool.id}`);
    assert.equal(tools.inspectorToolById(tool.id), tool);
  }
});

check("las herramientas se agrupan por propósito y el análisis de demostración queda solo y separado", () => {
  for (const group of tools.INSPECTOR_TOOL_GROUPS) {
    assert.ok(tools.inspectorToolsInGroup(group.id).length > 0, `el grupo ${group.id} no está vacío`);
  }
  deepEqual(tools.inspectorToolsInGroup("demo").map((tool) => tool.id), ["demo"]);
  assert.match(tools.INSPECTOR_TOOL_GROUPS.find((group) => group.id === "demo").description, /No es el análisis real/);
  deepEqual(tools.inspectorToolsInGroup("follow-up").map((tool) => tool.id), ["history", "comparison"]);
  deepEqual(tools.inspectorToolsInGroup("delivery").map((tool) => tool.id), ["report", "assistant"]);
});

check("los consumidores del circuito de producto declaran su procedencia ya en el índice", () => {
  for (const id of ["report", "assistant"]) {
    assert.match(tools.inspectorToolById(id).provenance ?? "", /análisis de demostración/, id);
  }
  assert.match(tools.inspectorToolById("assistant").provenance, /no recibe contexto clínico/);
  // La comparación ya lee el análisis inicial real: no debe seguir advirtiendo que usa la demostración.
  assert.equal(tools.inspectorToolById("comparison").provenance, undefined);
});

check("ninguna herramienta ofrece iniciar un análisis nuevo", () => {
  const demo = tools.inspectorToolById("demo");
  assert.doesNotMatch(`${demo.title} ${demo.hint}`, /analizar|reanalizar|iniciar/i);
});

console.log(`Viewer panel logic tests passed: ${passed}`);
