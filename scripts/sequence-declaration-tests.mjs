import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Secuencia declarada o detectada de una serie: lectura, rotulado, qué se envía al cargar, de dónde sale la del
 * visor y qué dice la comparación. Se ejecuta el código real transpilado.
 */
function loadModules(paths, exportNames) {
  const source = paths
    .map((path) => readFileSync(path, "utf8").replace(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+"[^"]+";\s*/g, "").replace(/export /g, ""))
    .join("\n");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const seq = loadModules(
  ["src/features/reading/sequenceInfo.ts", "src/features/reading/planeSeries.ts"],
  [
    "parseSequenceInfo", "sequenceFromWeighting", "sequenceFromStored", "sequenceLabel", "sequenceProvenanceLabel", "sequenceText",
    "sequenceProvenanceHint", "sequenceFromComparisonSide", "declarationFields", "declarationIssue", "declarationKey", "sequencesMatch",
    "sequenceOfPlaneRun", "sequenceComparisonNote", "isKnownSequence", "sequenceOfAnalyzedPlane", "UNKNOWN_SEQUENCE", "DEFAULT_SEQUENCE_CHOICE",
  ],
);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const declaredT1 = { value: "t1", source: "user_declared", description: null };

/* ------------------------------------------------------------------------------ lectura */

check("una declaración válida conserva valor y procedencia", () => {
  same(seq.parseSequenceInfo(declaredT1), { value: "t1", source: "user_declared", description: "" });
  same(seq.parseSequenceInfo({ value: "T2", source: "auto_detected" }), { value: "t2", source: "auto_detected", description: "" });
});

check("«Otra» exige descripción y solo se acepta declarada", () => {
  same(seq.parseSequenceInfo({ value: "other", source: "user_declared", description: " STIR sagital " }), { value: "other", source: "user_declared", description: "STIR sagital" });
  assert.equal(seq.parseSequenceInfo({ value: "other", source: "user_declared", description: "  " }).value, "unknown");
  assert.equal(seq.parseSequenceInfo({ value: "other", source: "auto_detected", description: "STIR" }).value, "unknown");
  assert.equal(seq.parseSequenceInfo({ value: "other", source: "user_declared", description: "x".repeat(81) }).value, "unknown");
});

check("cualquier forma incompleta o incoherente es desconocida, nunca T2", () => {
  for (const raw of [undefined, null, "t2", 7, {}, { value: "t2" }, { value: "t2", source: "unknown" }, { value: "unknown", source: "user_declared" }, { value: "flair", source: "user_declared" }]) {
    same(seq.parseSequenceInfo(raw), seq.UNKNOWN_SEQUENCE);
  }
});

check("el catálogo anterior a la procedencia: t1/t2 se lee como detectado y lo demás como desconocido", () => {
  same(seq.sequenceFromStored("t2", "", ""), { value: "t2", source: "auto_detected", description: "" });
  same(seq.sequenceFromStored("unknown", "", ""), seq.UNKNOWN_SEQUENCE);
  same(seq.sequenceFromStored("", undefined, undefined), seq.UNKNOWN_SEQUENCE);
  same(seq.sequenceFromStored("t1", "user_declared", ""), { value: "t1", source: "user_declared", description: "" });
  same(seq.sequenceFromStored("other", "user_declared", "STIR"), { value: "other", source: "user_declared", description: "STIR" });
  same(seq.sequenceFromStored("other", "", "STIR"), seq.UNKNOWN_SEQUENCE);
});

/* ------------------------------------------------------------------------------ rótulos */

check("el rótulo distingue una declaración de una detección y no inventa nada si falta el dato", () => {
  assert.equal(seq.sequenceText(seq.parseSequenceInfo(declaredT1)), "T1 · declarada por el usuario");
  assert.equal(seq.sequenceText(seq.parseSequenceInfo({ value: "t2", source: "auto_detected" })), "T2 · detectada del estudio DICOM");
  assert.equal(seq.sequenceText(seq.UNKNOWN_SEQUENCE), "Sin informar");
  assert.equal(seq.sequenceLabel(seq.parseSequenceInfo({ value: "other", source: "user_declared", description: "STIR" })), "Otra: STIR");
  assert.match(seq.sequenceProvenanceHint(seq.parseSequenceInfo(declaredT1)), /No es una detección automática ni una validación del modelo/);
});

/* ------------------------------------------------------------------------------ carga */

check("«Desconocida» (por defecto) no envía ningún campo: la carga sigue como siempre", () => {
  same(seq.declarationFields(seq.DEFAULT_SEQUENCE_CHOICE), {});
  assert.equal(seq.declarationIssue(seq.DEFAULT_SEQUENCE_CHOICE), "");
});

check("T1 y T2 se envían solos; «Otra» lleva su descripción recortada", () => {
  same(seq.declarationFields({ value: "t1", description: "ignorada" }), { sequence: "t1" });
  same(seq.declarationFields({ value: "t2", description: "" }), { sequence: "t2" });
  same(seq.declarationFields({ value: "other", description: "  STIR sagital " }), { sequence: "other", sequenceDescription: "STIR sagital" });
});

check("«Otra» sin descripción o demasiado larga no se puede enviar; el resto no tiene problema", () => {
  assert.notEqual(seq.declarationIssue({ value: "other", description: "   " }), "");
  assert.notEqual(seq.declarationIssue({ value: "other", description: "x".repeat(81) }), "");
  assert.equal(seq.declarationIssue({ value: "other", description: "STIR" }), "");
  assert.equal(seq.declarationIssue({ value: "t1", description: "" }), "");
});

check("la clave de la declaración cambia con el valor y con la descripción de «Otra»", () => {
  assert.notEqual(seq.declarationKey({ value: "t1", description: "" }), seq.declarationKey({ value: "t2", description: "" }));
  assert.notEqual(seq.declarationKey({ value: "other", description: "A" }), seq.declarationKey({ value: "other", description: "B" }));
  assert.equal(seq.declarationKey({ value: "t1", description: "x" }), seq.declarationKey({ value: "t1", description: "" }));
});

/* ------------------------------------------------------------------------------ coincidencias */

check("solo T1/T2 iguales coinciden: desconocida y «Otra» nunca son equivalentes entre sí", () => {
  const t1 = seq.parseSequenceInfo(declaredT1);
  const t2 = seq.parseSequenceInfo({ value: "t2", source: "user_declared" });
  const otherA = seq.parseSequenceInfo({ value: "other", source: "user_declared", description: "STIR" });
  assert.equal(seq.sequencesMatch(t1, t1), true);
  assert.equal(seq.sequencesMatch(t1, t2), false);
  assert.equal(seq.sequencesMatch(seq.UNKNOWN_SEQUENCE, seq.UNKNOWN_SEQUENCE), false);
  assert.equal(seq.sequencesMatch(otherA, otherA), false);
  assert.equal(seq.sequencesMatch(otherA, t1), false);
});

check("la nota de comparación dice qué es la coincidencia y qué no garantiza", () => {
  const t1 = seq.parseSequenceInfo(declaredT1);
  const detected = seq.parseSequenceInfo({ value: "t1", source: "auto_detected" });
  const note = seq.sequenceComparisonNote(detected, t1);
  assert.match(note, /T1 en ambos estudios/);
  assert.match(note, /referencia: detectada del estudio DICOM; actual: declarada por el usuario/);
  assert.match(note, /declaración, no una detección automática ni una validación del modelo/);
  assert.match(note, /no garantiza el mismo protocolo/);
  // Dos detecciones no son una declaración: no se dice lo contrario.
  assert.doesNotMatch(seq.sequenceComparisonNote(detected, detected), /Es una declaración/);
});

check("la nota no presenta como iguales una secuencia desconocida ni dos «Otra»", () => {
  const t1 = seq.parseSequenceInfo(declaredT1);
  const other = seq.parseSequenceInfo({ value: "other", source: "user_declared", description: "STIR" });
  assert.match(seq.sequenceComparisonNote(seq.UNKNOWN_SEQUENCE, seq.UNKNOWN_SEQUENCE), /no está informada/);
  assert.match(seq.sequenceComparisonNote(t1, seq.UNKNOWN_SEQUENCE), /no está informada/);
  assert.match(seq.sequenceComparisonNote(other, other), /«Otra»/);
  assert.match(seq.sequenceComparisonNote(t1, seq.parseSequenceInfo({ value: "t2", source: "user_declared" })), /Secuencias distintas \(T1 en la referencia, T2 en el estudio abierto\)/);
});

check("la secuencia de un lado de la comparación sale de los tres campos del Backend", () => {
  same(seq.sequenceFromComparisonSide({ sagittalSequence: "t1", sagittalSequenceSource: "user_declared", sagittalSequenceDescription: null }), { value: "t1", source: "user_declared", description: "" });
  same(seq.sequenceFromComparisonSide({ sagittalSequence: "t2", sagittalSequenceSource: "auto_detected", sagittalSequenceDescription: null }), { value: "t2", source: "auto_detected", description: "" });
  same(seq.sequenceFromComparisonSide({ sagittalSequence: null, sagittalSequenceSource: "unknown", sagittalSequenceDescription: null }), seq.UNKNOWN_SEQUENCE);
  // Un Backend anterior no manda la procedencia: no se puede afirmar de dónde sale, queda desconocida.
  same(seq.sequenceFromComparisonSide({ sagittalSequence: "t2" }), seq.UNKNOWN_SEQUENCE);
});

/* ------------------------------------------------------------------------------ el visor */

const run = (planeInput) => ({ planes: { sagittal: { input: planeInput } }, canonicalRun: undefined });

check("el visor lee la secuencia que la corrida publicó", () => {
  same(seq.sequenceOfAnalyzedPlane(run({ inputId: "inp-1", sequence: declaredT1 }), "sagittal", []), { value: "t1", source: "user_declared", description: "" });
});

check("una corrida anterior sin el dato cae al catálogo y, sin catálogo, queda desconocida (no T2)", () => {
  const catalogue = [{ inputId: "inp-1", sequence: { value: "t2", source: "auto_detected", description: "" } }];
  same(seq.sequenceOfAnalyzedPlane(run({ inputId: "inp-1" }), "sagittal", catalogue), catalogue[0].sequence);
  same(seq.sequenceOfAnalyzedPlane(run({ inputId: "inp-1" }), "sagittal", []), seq.UNKNOWN_SEQUENCE);
  same(seq.sequenceOfAnalyzedPlane(run(undefined), "sagittal", []), seq.UNKNOWN_SEQUENCE);
  same(seq.sequenceOfAnalyzedPlane({ planes: {} }, "axial", []), seq.UNKNOWN_SEQUENCE);
});

check("la corrida manda sobre el catálogo: si publicó desconocida no se toma la del catálogo", () => {
  const catalogue = [{ inputId: "inp-1", sequence: { value: "t2", source: "auto_detected", description: "" } }];
  same(seq.sequenceOfAnalyzedPlane(run({ inputId: "inp-1", sequence: { value: "unknown", source: "unknown", description: null } }), "sagittal", catalogue), seq.UNKNOWN_SEQUENCE);
});

/* ------------------------------------------------------------------------------ cableado (código real) */

const read = (path) => readFileSync(path, "utf8");

check("la carga envía los campos solo si hay declaración", () => {
  const api = read("src/multiplanarApi.ts");
  assert.match(api, /declaration: SequenceChoice = DEFAULT_SEQUENCE_CHOICE/);
  assert.match(api, /if \(fields\.sequence\) formData\.append\("sequence", fields\.sequence\)/);
  assert.match(api, /if \(fields\.sequenceDescription\) formData\.append\("sequenceDescription"/);
});

check("el selector es opcional (predeterminado «Desconocida») y un archivo con otra declaración no se analiza", () => {
  const drawer = read("src/features/worklist/NewAnalysisDrawer.tsx");
  assert.match(drawer, /useState<Record<Plane, SequenceChoice>>\(\{ sagittal: DEFAULT_SEQUENCE_CHOICE, axial: DEFAULT_SEQUENCE_CHOICE \}\)/);
  assert.match(drawer, /declarationStale\("sagittal"\) \? undefined/);
  assert.match(drawer, /declarationIssue\(declaration\)/);
  assert.match(drawer, /Sin secuencia el análisis se hace igual/);
  assert.match(drawer, /no la verifica ni la detecta/);
});

check("la selección de secuencia no habilita Hallazgos IA ni el flujo de producto", () => {
  const drawer = read("src/features/worklist/NewAnalysisDrawer.tsx");
  // El flujo de hallazgos solo recibe el estudio ZIP; la declaración por plano no entra ahí.
  assert.doesNotMatch(drawer, /runP109ProductFlow\([^)]*declared/);
  assert.doesNotMatch(drawer, /sagittalT1:\s*declared|sagittalT2:\s*declared/);
});

check("los dos visores muestran la secuencia con su procedencia", () => {
  assert.match(read("src/features/reading/PlaneViewport.tsx"), /data-testid="viewport-sequence"/);
  assert.match(read("src/features/reading/ComparisonPane.tsx"), /data-testid=\{`dual-sequence-\$\{side\}`\}/);
  assert.match(read("src/components/StudyReviewView.tsx"), /sequenceOfAnalyzedPlane\(run, planeName, studySeries\)/);
  assert.match(read("src/features/reading/DualComparisonView.tsx"), /data-testid="dual-sequence-note"/);
});

console.log(`\n${passed} verificaciones de secuencia declarada OK`);
