import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

/**
 * Comportamiento de la edad al estudio (src/studyAge.ts): se transpila y se ejecuta.
 * Cubre el cálculo con límite de cumpleaños, la edad declarada, la discrepancia visible y la
 * ausencia de edad cuando no hay con qué calcularla ni nadie la declaró.
 */
const source = fs.readFileSync("src/studyAge.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, console };
vm.runInNewContext(js, sandbox);
const { calculateAgeOn, resolveStudyAge, ageProvenanceLabel } = sandbox.exports;

test("la edad cumple en el día del cumpleaños, no antes", () => {
  assert.equal(calculateAgeOn("1980-06-15", "2026-06-14"), 45);
  assert.equal(calculateAgeOn("1980-06-15", "2026-06-15"), 46);
  assert.equal(calculateAgeOn("1980-06-15", "2026-06-16"), 46);
});

test("la fecha del estudio manda: el mismo paciente tiene otra edad en otro estudio", () => {
  assert.equal(calculateAgeOn("1990-01-01", "2016-12-31"), 26);
  assert.equal(calculateAgeOn("1990-01-01", "2026-01-01"), 36);
});

test("nacer un 29 de febrero se cumple en año no bisiesto el 1 de marzo", () => {
  assert.equal(calculateAgeOn("2000-02-29", "2025-02-28"), 24);
  assert.equal(calculateAgeOn("2000-02-29", "2025-03-01"), 25);
});

test("faltan fechas, fechas inválidas o estudio anterior al nacimiento: no hay edad", () => {
  assert.equal(calculateAgeOn(null, "2026-01-01"), null);
  assert.equal(calculateAgeOn("1980-01-01", ""), null);
  assert.equal(calculateAgeOn("1980-02-31", "2026-01-01"), null);
  assert.equal(calculateAgeOn("2030-01-01", "2026-01-01"), null);
});

test("sin declarar, la edad calculada queda con procedencia calculated", () => {
  const age = resolveStudyAge({ dateOfBirth: "1980-06-15", studyDate: "2026-10-06", declared: "" });
  assert.equal(age.value, 46);
  assert.equal(age.provenance, "calculated");
  assert.equal(age.discrepancy, false);
});

test("sin con qué calcular y sin declarar no se inventa una edad, y se dice qué falta", () => {
  const noDob = resolveStudyAge({ dateOfBirth: null, studyDate: "2026-10-06", declared: "" });
  assert.equal(noDob.value, null);
  assert.equal(noDob.provenance, null);
  assert.match(noDob.missingForCalculation, /fecha de nacimiento/);
  const noDate = resolveStudyAge({ dateOfBirth: "1980-01-01", studyDate: "", declared: "" });
  assert.equal(noDate.value, null);
  assert.match(noDate.missingForCalculation, /fecha del estudio/);
});

test("la edad declarada se guarda como reported cuando no se puede calcular", () => {
  const age = resolveStudyAge({ dateOfBirth: null, studyDate: null, declared: " 62 " });
  assert.equal(age.value, 62);
  assert.equal(age.provenance, "reported");
  assert.equal(age.discrepancy, false);
});

test("una edad declarada distinta de la calculada se conserva y la diferencia queda visible", () => {
  const age = resolveStudyAge({ dateOfBirth: "1980-06-15", studyDate: "2026-10-06", declared: "50" });
  assert.equal(age.value, 50);
  assert.equal(age.provenance, "reported");
  assert.equal(age.calculated, 46);
  assert.equal(age.discrepancy, true);
});

test("declarar la misma edad que la calculada no es discrepancia, pero sigue siendo declarada", () => {
  const age = resolveStudyAge({ dateOfBirth: "1980-06-15", studyDate: "2026-10-06", declared: "46" });
  assert.equal(age.provenance, "reported");
  assert.equal(age.discrepancy, false);
});

test("una edad declarada inválida se rechaza con un mensaje y no produce valor", () => {
  for (const bad of ["abc", "-1", "131", "4.5", "1e2", "999"]) {
    const age = resolveStudyAge({ dateOfBirth: null, studyDate: null, declared: bad });
    assert.equal(age.value, null, bad);
    assert.match(age.issue, /entre 0 y 130/, bad);
  }
  assert.equal(resolveStudyAge({ dateOfBirth: null, studyDate: null, declared: "0" }).value, 0);
  assert.equal(resolveStudyAge({ dateOfBirth: null, studyDate: null, declared: "130" }).value, 130);
});

test("las procedencias tienen una etiqueta legible y la desconocida se dice como tal", () => {
  assert.match(ageProvenanceLabel("calculated"), /Calculada/);
  assert.match(ageProvenanceLabel("reported"), /Declarada/);
  assert.match(ageProvenanceLabel(null), /no informada/);
});
