import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

/**
 * Textos del resultado de cargar un ZIP (src/studyWarnings.ts) y fechas de lectura
 * (src/studyAge.ts#formatIsoDateDMY). Se transpilan y se ejecutan.
 */
function load(path) {
  const js = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(js, sandbox);
  return sandbox.exports;
}
const { describeStudyWarning, describeSeriesUse, seriesPlaneLabel, seriesSequenceLabel } = load("src/studyWarnings.ts");
const { formatIsoDateDMY } = load("src/studyAge.ts");

// Los mensajes exactos que emite el modulo de IA (study_ingestion.py).
const FROM_AI_MODULE = [
  "no se encontro serie sagital en el estudio",
  "sagital sin T2 disponible; se usa t1",
  "no se encontro serie sagital T1 ni T2 utilizable para P10.7",
  "solo una ponderacion sagital (T1 o T2) esta disponible para P10.7; el hallazgo se generara con una sola modalidad",
  "no se encontro serie axial en el estudio",
  "axial sin T2 real; el modelo axial espera T2 (encontrado t1)",
];

test("cada advertencia conocida se reformula y conserva el original", () => {
  for (const raw of FROM_AI_MODULE) {
    const described = describeStudyWarning(raw);
    assert.equal(described.technical, raw, "el original queda intacto");
    assert.notEqual(described.text, raw, `se reformuló: ${raw}`);
    assert.doesNotMatch(described.text, /P10\.7/, "la jerga interna no llega al texto principal");
  }
});

test("la advertencia de P10.7 conserva su limitación real: una sola modalidad en los hallazgos discales", () => {
  const described = describeStudyWarning(FROM_AI_MODULE[3]);
  assert.match(described.text, /una sola ponderación sagital/);
  assert.match(described.text, /hallazgos degenerativos discales/);
  assert.match(described.text, /una sola modalidad/);
});

test("la ponderación encontrada se nombra en mayúsculas", () => {
  assert.match(describeStudyWarning(FROM_AI_MODULE[1]).text, /sagital T1/);
  assert.match(describeStudyWarning(FROM_AI_MODULE[5]).text, /axial es T1/);
});

test("una advertencia desconocida se muestra tal cual, sin interpretarla", () => {
  const raw = "advertencia nueva del módulo";
  assert.deepEqual({ ...describeStudyWarning(raw) }, { text: raw, technical: raw });
});

test("plano y secuencia legibles, y el desconocido se dice como tal", () => {
  assert.equal(seriesPlaneLabel("sagittal"), "Sagital");
  assert.equal(seriesPlaneLabel("axial"), "Axial");
  assert.equal(seriesPlaneLabel("unknown"), "Plano no informado");
  assert.equal(seriesSequenceLabel("t2"), "T2");
  assert.equal(seriesSequenceLabel("unknown"), "Secuencia no informada");
});

test("se dice para qué se usa cada serie, o por qué no", () => {
  const normal = { multiplanar: false, derived: false };
  const used = describeSeriesUse(["sagittal", "findings-t2"], normal);
  assert.equal(used.used, true);
  assert.match(used.text, /análisis sagital · hallazgos discales T2/);
  assert.match(describeSeriesUse(["axial"], normal).text, /axial \(experimental\)/);
  assert.match(describeSeriesUse([], { multiplanar: true, derived: false }).text, /localizador/);
  assert.match(describeSeriesUse([], { multiplanar: false, derived: true }).text, /derivada/);
  assert.equal(describeSeriesUse([], normal).used, false);
});

test("las fechas de lectura son dd/mm/aaaa, sin pasar por Date ni por la zona horaria", () => {
  assert.equal(formatIsoDateDMY("1990-01-01"), "01/01/1990");
  assert.equal(formatIsoDateDMY("2026-12-31"), "31/12/2026");
  assert.equal(formatIsoDateDMY("2000-02-29"), "29/02/2000");
  assert.equal(formatIsoDateDMY(null), "");
  assert.equal(formatIsoDateDMY("no es fecha"), "no es fecha");
  // Con cualquier zona horaria el resultado es el mismo: es solo texto.
  const source = fs.readFileSync("src/studyAge.ts", "utf8");
  const body = source.slice(source.indexOf("export function formatIsoDateDMY"));
  assert.doesNotMatch(body, /new Date|toLocale|getTimezoneOffset|Date\.parse/);
});
