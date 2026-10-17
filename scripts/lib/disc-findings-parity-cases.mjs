import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Casos de paridad de la comparación de hallazgos P10.7 entre el Frontend (TS) y el Backend (Java, que la repite en el
 * servidor para que el asistente no la calcule ni la invente). El resultado esperado sale SIEMPRE del código TS real; el
 * archivo JSON que se genera lo leen las pruebas de las dos partes:
 *  - `scripts/disc-findings-parity-tests.mjs` (Frontend) comprueba que el TS actual sigue dando ese resultado;
 *  - `DiscFindingsComparatorParityTest` (Backend) comprueba que el Java da el mismo.
 * Si una regla cambia de un lado y no del otro, una de las dos falla. Los datos son fixtures de contrato, no estudios.
 */
export function loadModules(paths, exportNames) {
  const source = paths
    .map((path) => readFileSync(path, "utf8").replace(/^import .*$/gm, "").replace(/export /g, ""))
    .join("\n");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

export const tsModules = () => loadModules(
  ["src/features/reading/discDegenerativeFindings.ts", "src/features/reading/discFindingsComparison.ts"],
  ["parsePersistedDiscDegenerativeFindingsLenient", "compareFindings", "DiscDegenerativeContractError"],
);

const SHA = "16eccff327e6794b127fe372ecd03ea619a0f69d939b84ae1aa2e904191c6293";
const SHA2 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SUPPORT = {
  disc_bulging: "supported_internal", disc_narrowing: "supported_internal", upper_endplate_change: "supported_internal",
  lower_endplate_change: "supported_internal", pfirrmann_grade: "experimental", modic_change: "not_product_supported",
  disc_herniation: "not_product_supported", spondylolisthesis: "not_product_supported",
};
const catalogOf = (type) => (type === "pfirrmann_grade" ? ["I", "II", "III", "IV", "V"] : type === "modic_change" ? ["none", "I", "II", "III"] : ["absent", "present"]);

/** Resultado tal como lo persiste el análisis (con el vector crudo `classification.probabilities`). */
function persisted({ id, level = "L4-L5", type = "disc_bulging", label = "absent", probs, roles = ["sagittal_t1", "sagittal_t2"], status, dataset, modelId, sha, noSources = false, ...patch }) {
  const catalog = catalogOf(type);
  const probabilities = probs ?? Object.fromEntries(catalog.map((item) => [item, item === label ? 0.7 : 0.3 / (catalog.length - 1)]));
  return {
    findingId: id,
    findingType: type,
    anatomy: { level },
    classification: { kind: catalog.length === 2 ? "binary" : "categorical", label, probabilities },
    evidence: { deploymentStatus: status ?? SUPPORT[type], evaluationDataset: dataset ?? "SPIDER_internal_test", externalValidationAvailable: false },
    localization: { source: "segmentation_derived_disc_level", researchOnly: true, automaticAnatomicalLocalizationValidated: false },
    model: { modelId: modelId ?? "spider_degenerative_multitask_sagittal_t1_t2_2p5d", modelSha256: sha ?? SHA },
    review: { required: true, status: "pending" },
    notClinicalDiagnosis: true,
    ...(noSources ? {} : { sourceSeries: roles.map((role) => ({ role, available: true, positions: [3, 4, 5] })) }),
    ...patch,
  };
}

/** Espejo de `DiscDegenerativeFindingsPublicProjection.sanitize` (el Backend verifica que el suyo da lo mismo). */
export function toPublic(finding) {
  const copy = JSON.parse(JSON.stringify(finding));
  const classification = copy.classification;
  if (classification && typeof classification === "object") {
    const probabilities = classification.probabilities;
    delete classification.probabilities;
    const own = probabilities && typeof probabilities === "object" ? probabilities : null;
    const value = own && typeof classification.label === "string" ? own[classification.label] : undefined;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) classification.confidence = value;
    if (own && Object.keys(own).length > 0 && Object.values(own).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) {
      classification.classProbabilities = own;
    }
  }
  return copy;
}

const governance = { humanReviewRequired: true, notClinicalDiagnosis: true, autonomousDiagnosis: false, predictionImmutable: true, reviewStoredSeparately: true };
const envelope = (findings, over = {}) => ({ schemaVersion: "pfi.disc-degenerative-findings.v1", findings, ...over });
const side = (findings, over) => ({ snapshot: { discDegenerativeFindings: envelope(findings, over), discDegenerativeGovernance: governance } });
const NO_DATA = { snapshot: {} };

let n = 0;
const f = (over) => persisted({ id: `f-${(n += 1)}`, ...over });

export function scenarios() {
  n = 0;
  return [
    { name: "idénticos: todo sin cambio", reference: side([f({}), f({ level: "L5-S1", type: "pfirrmann_grade", label: "III" })]), current: side([f({}), f({ level: "L5-S1", type: "pfirrmann_grade", label: "III" })]) },
    { name: "Ausente → Presente y Presente → Ausente", reference: side([f({ label: "absent" }), f({ level: "L5-S1", label: "present" })]), current: side([f({ label: "present" }), f({ level: "L5-S1", label: "absent" })]) },
    { name: "Pfirrmann y Modic cambian de categoría", reference: side([f({ type: "pfirrmann_grade", label: "II" }), f({ type: "modic_change", label: "none" })]), current: side([f({ type: "pfirrmann_grade", label: "III" }), f({ type: "modic_change", label: "II" })]) },
    { name: "misma clase con probabilidades distintas no es cambio", reference: side([f({ label: "present", probs: { absent: 0.49, present: 0.51 } })]), current: side([f({ label: "present", probs: { absent: 0.02, present: 0.98 } })]) },
    { name: "falta resultado en un lado", reference: side([f({}), f({ level: "L3-L4", type: "disc_narrowing", label: "present" })]), current: side([f({}), f({ level: "L2-L3", type: "disc_narrowing", label: "present" })]) },
    { name: "modelo, checkpoint, soporte, base y modalidades distintos", reference: side([
      f({ level: "L1-L2" }), f({ level: "L2-L3" }), f({ level: "L3-L4" }), f({ level: "L4-L5" }), f({ level: "L5-S1" }),
    ]), current: side([
      f({ level: "L1-L2", modelId: "otro_modelo" }), f({ level: "L2-L3", sha: SHA2 }), f({ level: "L3-L4", status: "experimental" }),
      f({ level: "L4-L5", dataset: "OTRA_BASE" }), f({ level: "L5-S1", roles: ["sagittal_t2"] }),
    ]) },
    { name: "resultado duplicado en un lado", reference: side([f({}), f({ label: "present" })]), current: side([f({})]) },
    { name: "resultados inválidos: clase fuera del catálogo, tipo desconocido y nivel desconocido", reference: side([
      f({ label: "absent" }), f({ type: "pfirrmann_grade", label: "II" }), f({ level: "L2-L3", label: "present" }),
    ]), current: side([
      f({ label: "VI", probs: { VI: 1 } }), f({ type: "tipo_inventado" }), f({ level: "T11-T12", label: "present" }), f({ level: "L2-L3", label: "present" }),
    ]) },
    { name: "un lado sin hallazgos persistidos", reference: NO_DATA, current: side([f({})]) },
    { name: "ningún lado tiene hallazgos", reference: NO_DATA, current: NO_DATA },
    { name: "esquema inesperado", reference: side([f({})], { schemaVersion: "otro" }), current: side([f({})]) },
    { name: "lista vacía", reference: side([]), current: side([f({})]) },
    { name: "sin governance", reference: { snapshot: { discDegenerativeFindings: envelope([f({})]) } }, current: side([f({})]) },
    { name: "distribución incoherente: se conserva la clasificación", reference: side([f({ label: "present", probs: { absent: 0.3, present: 0.3 } })]), current: side([f({ label: "present" })]) },
    { name: "series de origen inválidas", reference: side([f({ sourceSeries: [{ role: "sagittal_t1", available: false, positions: [] }] })]), current: side([f({})]) },
    { name: "sin series de origen declaradas", reference: side([f({ noSources: true })]), current: side([f({ noSources: true, label: "present" })]) },
    { name: "investigación: modic y espondilolistesis", reference: side([f({ type: "modic_change", label: "none" }), f({ type: "spondylolisthesis", label: "absent", level: "L5-S1" })]), current: side([f({ type: "modic_change", label: "none" }), f({ type: "spondylolisthesis", label: "present", level: "L5-S1" })]) },
  ];
}

/** Resultado en un formato común que comparan las dos implementaciones. */
export function summarize(comparison, sideStates) {
  return {
    rows: comparison.rows.map((row) => ({
      key: row.key,
      section: row.section,
      status: row.status,
      code: row.reason ? row.reason.code : null,
      rejected: Object.keys(row.rejected).sort(),
      reference: row.reference ? row.reference.label : null,
      current: row.current ? row.current.label : null,
    })),
    counts: {
      main: [comparison.counts.main.all, comparison.counts.main.changes, comparison.counts.main.unchanged, comparison.counts.main.notComparable],
      research: [comparison.counts.research.all, comparison.counts.research.changes, comparison.counts.research.unchanged, comparison.counts.research.notComparable],
    },
    unreadable: [comparison.unreadable.reference, comparison.unreadable.current],
    sides: sideStates,
  };
}

/** Lo que hace el Frontend con el snapshot de un lado, en la misma forma que consume `compareFindings`. */
export function frontendSide(m, definition) {
  const snapshot = JSON.parse(JSON.stringify(definition.snapshot));
  const findings = snapshot.discDegenerativeFindings?.findings;
  if (Array.isArray(findings)) snapshot.discDegenerativeFindings.findings = findings.map(toPublic);
  if (!snapshot.discDegenerativeFindings) return { status: "no_data", reason: "sin datos" };
  try {
    const parsed = m.parsePersistedDiscDegenerativeFindingsLenient(snapshot);
    return { status: "ready", caseId: "X", runId: "r", findings: parsed.findings, rejected: parsed.rejected };
  } catch (error) {
    return { status: "invalid", reason: String(error.message) };
  }
}

export function sideCode(state) {
  return state.status === "ready" ? "READY" : state.status === "no_data" ? "NO_DATA" : "INVALID";
}

export function buildCases() {
  const m = tsModules();
  return scenarios().map((scenario) => {
    const reference = frontendSide(m, scenario.reference);
    const current = frontendSide(m, scenario.current);
    const comparison = m.compareFindings(reference, current);
    return {
      name: scenario.name,
      reference: scenario.reference,
      current: scenario.current,
      // La proyección pública de cada resultado, para que el Backend compruebe que la suya da lo mismo.
      publicReference: scenario.reference.snapshot.discDegenerativeFindings?.findings?.map(toPublic) ?? null,
      publicCurrent: scenario.current.snapshot.discDegenerativeFindings?.findings?.map(toPublic) ?? null,
      expected: summarize(comparison, [sideCode(reference), sideCode(current)]),
    };
  });
}
