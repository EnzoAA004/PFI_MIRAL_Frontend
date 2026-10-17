import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCases } from "./lib/disc-findings-parity-cases.mjs";

/**
 * El TS actual sigue dando el resultado que se guardó en el archivo de paridad compartido con el Backend. Si cambia una
 * regla de la comparación de hallazgos hay que regenerar el archivo (node scripts/gen-disc-findings-parity.mjs) Y ajustar
 * `DiscFindingsComparator.java`: la prueba del Backend falla si el Java no da lo mismo.
 */
const FILE = "../PFI_MVPTest_Enzo_Backend/src/test/resources/parity/disc-findings-comparison-cases.json";
const stored = JSON.parse(readFileSync(FILE, "utf8"));
const current = buildCases();
assert.equal(stored.cases.length, current.length, "cantidad de casos distinta: regenerar el archivo de paridad");
let passed = 0;
for (let index = 0; index < current.length; index += 1) {
  // Se compara el JSON (lo que hay en el archivo), sin imprimir el volcado completo si difiere.
  const same = JSON.stringify(current[index]) === JSON.stringify(stored.cases[index]);
  assert.ok(same, `el caso «${current[index].name}» ya no coincide con el archivo de paridad`);
  passed += 1;
  console.log(`ok ${passed} - ${current[index].name}`);
}
console.log(`${passed} casos de paridad TS ↔ archivo compartido`);
