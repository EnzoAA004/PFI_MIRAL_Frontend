import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

/**
 * Regresión: la leyenda de segmentación de cada lado del visor de comparación decía «Máscara por clase no informada» porque el
 * panel armaba el modelo del visor con `masks: []`. Ahora cada lado lee las clases, etiquetas y colores de SU corrida y plano
 * con la misma función que usa el visor individual.
 */
const root = process.cwd();
const source = readFileSync(join(root, "src/features/reading/canonicalMasks.ts"), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, console, Number, String, Array };
vm.runInNewContext(`${js}\nexports.canonicalMasksForPlane = canonicalMasksForPlane;`, sandbox);
const { canonicalMasksForPlane } = sandbox.exports;
const j = (v) => JSON.parse(JSON.stringify(v));

const runWith = (canalColor, extra = {}) => ({
  planes: {
    sagittal: {
      masks: [
        { id: "m-disc", classKey: "sagittal-disc-group", color: "rgb(230, 25, 75)", ...extra },
        { id: "m-canal", classKey: "sagittal-canal", color: canalColor, geometry: { sliceIndex: 4, points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }] } },
        { id: "sin-clase", color: "rgb(1, 2, 3)" },
      ],
    },
  },
});

let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
}

test("cada corrida entrega sus propias clases y colores (no se supone una paleta común entre estudios)", () => {
  const a = j(canonicalMasksForPlane(runWith("rgb(191, 239, 69)"), "sagittal"));
  const b = j(canonicalMasksForPlane(runWith("rgb(70, 153, 144)"), "sagittal"));
  assert.equal(a.find((m) => m.className === "sagittal-canal").color, "rgb(191, 239, 69)");
  assert.equal(b.find((m) => m.className === "sagittal-canal").color, "rgb(70, 153, 144)");
});

test("una máscara sin clase declarada no se inventa; el color ausente queda vacío y no se deduce", () => {
  const masks = j(canonicalMasksForPlane(runWith("rgb(1, 1, 1)", { color: undefined }), "sagittal"));
  assert.equal(masks.length, 2, "la máscara sin classKey se descarta");
  assert.equal(masks.find((m) => m.className === "sagittal-disc-group").color, "");
});

test("la leyenda no depende de que existan contornos: una clase sin geometría se informa igual", () => {
  const masks = j(canonicalMasksForPlane(runWith("rgb(1, 1, 1)"), "sagittal"));
  assert.equal(masks.find((m) => m.className === "sagittal-disc-group").contours, undefined);
  assert.ok(masks.find((m) => m.className === "sagittal-canal").contours.length === 1);
});

test("planos o corridas sin máscaras devuelven vacío (la interfaz lo dice, no muestra una leyenda genérica)", () => {
  assert.deepEqual(j(canonicalMasksForPlane(undefined, "sagittal")), []);
  assert.deepEqual(j(canonicalMasksForPlane({}, "axial")), []);
  assert.deepEqual(j(canonicalMasksForPlane({ planes: { axial: { masks: "x" } } }, "axial")), []);
});

test("el visor de comparación ya no fija masks: [] y el individual usa la misma lectura", () => {
  const pane = readFileSync(join(root, "src/features/reading/ComparisonPane.tsx"), "utf8");
  assert.doesNotMatch(pane, /masks: \[\],/, "el lado de la comparación no puede descartar las clases de su corrida");
  assert.match(pane, /canonicalMasksForPlane\(ready\.run\.canonicalRun, state\.plane\)/);
  assert.match(pane, /ready && !archive/, "una serie del archivo que no es la analizada no hereda la leyenda de otra");
  const review = readFileSync(join(root, "src/components/StudyReviewView.tsx"), "utf8");
  assert.match(review, /canonicalMasksForPlane\(displayRun\.canonicalRun, plane\)/);
});

console.log(`Leyenda del visor dual: ${n} pruebas pasaron`);
