import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildCases } from "./lib/disc-findings-parity-cases.mjs";

/**
 * Regenera el archivo de casos de paridad (TS = fuente de verdad) que lee también el Backend.
 * Uso: node scripts/gen-disc-findings-parity.mjs
 */
export const PARITY_FILE = "../PFI_MVPTest_Enzo_Backend/src/test/resources/parity/disc-findings-comparison-cases.json";
mkdirSync(dirname(PARITY_FILE), { recursive: true });
const cases = buildCases();
writeFileSync(PARITY_FILE, JSON.stringify({ schema: "pfi.disc-findings-parity.v1", cases }, null, 1) + "\n");
console.log(`${cases.length} casos escritos en ${PARITY_FILE}`);
