import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/**
 * Comparación de hallazgos discales en el visor dual: emparejado por nivel y clasificación, estados, compatibilidad,
 * filtros, recorrido y ubicación de la región evaluada. Se ejecuta el código real transpilado; los datos son
 * fixtures de contrato, no resultados de ningún estudio.
 */
function loadModules(paths, exportNames) {
  const source = paths
    .map((path) => readFileSync(path, "utf8").replace(/^import .*$/gm, "").replace(/export /g, ""))
    .join("\n");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(`${js}\n${exportNames.map((name) => `exports.${name} = ${name};`).join("\n")}`, sandbox);
  return sandbox.exports;
}

const m = loadModules(
  ["src/features/reading/discDegenerativeFindings.ts", "src/features/reading/discFindingsComparison.ts"],
  [
    "parseDiscFinding", "compareFindings", "filterRows", "defaultFilter", "emptyGroupMessage", "noRowsMessage", "stepRows", "statusOf",
    "incompatibility", "sideFromSnapshot", "resolveRegionTarget", "resolveRegionOverlay", "orderedDistribution", "STATUS_LABEL",
    "FILTER_LABEL", "rowKeyOf", "sectionOf", "labelsFor",
  ],
);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const eq = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const SHA = "16eccff327e6794b127fe372ecd03ea619a0f69d939b84ae1aa2e904191c6293";
const SUPPORT = {
  disc_bulging: "supported_internal", disc_narrowing: "supported_internal", upper_endplate_change: "supported_internal",
  lower_endplate_change: "supported_internal", pfirrmann_grade: "experimental", modic_change: "not_product_supported",
  disc_herniation: "not_product_supported", spondylolisthesis: "not_product_supported",
};
let counter = 0;
function raw({ level = "L4-L5", type = "disc_bulging", label = "absent", probs, tag = "a", roles = ["sagittal_t1", "sagittal_t2"], noRegion = false, region = {}, ...over } = {}) {
  counter += 1;
  const binary = !["pfirrmann_grade", "modic_change"].includes(type);
  const catalog = type === "pfirrmann_grade" ? ["I", "II", "III", "IV", "V"] : type === "modic_change" ? ["none", "I", "II", "III"] : ["absent", "present"];
  const distribution = probs ?? Object.fromEntries(catalog.map((item) => [item, item === label ? 0.7 : 0.3 / (catalog.length - 1)]));
  return {
    findingId: `f-${counter}`,
    findingType: type,
    anatomy: { level },
    classification: { kind: binary ? "binary" : "categorical", label, confidence: distribution[label], classProbabilities: distribution },
    evidence: { deploymentStatus: over.status ?? SUPPORT[type], evaluationDataset: over.dataset ?? "SPIDER_internal_test", externalValidationAvailable: false },
    localization: { source: "segmentation_derived_disc_level", researchOnly: true, automaticAnatomicalLocalizationValidated: false },
    model: { modelId: over.modelId ?? "spider_degenerative_multitask_sagittal_t1_t2_2p5d", modelSha256: over.sha ?? SHA },
    review: { required: true, status: "pending" },
    notClinicalDiagnosis: true,
    sourceSeries: roles.map((role) => ({
      role, available: true, positions: [3, 4, 5],
      ...(noRegion ? {} : {
        inputId: `inp-${role}-${tag}`, sliceIndex: 4, pointYx: [120, 96], bboxYx: [108, 132, 84, 108],
        coordinateSpaceHeight: 256, coordinateSpaceWidth: 200, ...region,
      }),
    })),
  };
}
const parsed = (overrides) => m.parseDiscFinding(raw(overrides));
const ready = (findings, caseId = "A", runId = "run-a") => ({ status: "ready", caseId, runId, findings });
function rowOf(comparison, level, type) {
  return comparison.rows.find((row) => row.key === m.rowKeyOf(level, type));
}

check("Ausente → Presente y Presente → Ausente, con sus textos exactos", () => {
  const up = m.compareFindings(ready([parsed({ label: "absent" })]), ready([parsed({ label: "present", tag: "b" })], "B", "run-b"));
  assert.equal(rowOf(up, "L4-L5", "disc_bulging").status, "absent_to_present");
  assert.equal(m.STATUS_LABEL.absent_to_present, "Ausente → Presente");
  const down = m.compareFindings(ready([parsed({ label: "present" })]), ready([parsed({ label: "absent", tag: "b" })], "B", "run-b"));
  assert.equal(rowOf(down, "L4-L5", "disc_bulging").status, "present_to_absent");
  assert.equal(m.STATUS_LABEL.present_to_absent, "Presente → Ausente");
  assert.equal(m.STATUS_LABEL.unchanged, "Sin cambio de clasificación");
  assert.equal(m.STATUS_LABEL.category_changed, "Cambio de grado o categoría");
  assert.equal(m.STATUS_LABEL.not_comparable, "No comparable");
});

check("misma clase con probabilidades muy distintas NO es un cambio de clasificación", () => {
  const a = parsed({ label: "present", probs: { absent: 0.49, present: 0.51 } });
  const b = parsed({ label: "present", tag: "b", probs: { absent: 0.02, present: 0.98 } });
  const row = rowOf(m.compareFindings(ready([a]), ready([b], "B", "run-b")), "L4-L5", "disc_bulging");
  assert.equal(row.status, "unchanged");
  assert.equal(row.reason, null);
});

check("Pfirrmann y Modic cambian de categoría sin lenguaje de evolución", () => {
  const c = m.compareFindings(
    ready([parsed({ type: "pfirrmann_grade", label: "II" }), parsed({ type: "modic_change", label: "none" })]),
    ready([parsed({ type: "pfirrmann_grade", label: "III", tag: "b" }), parsed({ type: "modic_change", label: "II", tag: "b" })], "B", "run-b"),
  );
  assert.equal(rowOf(c, "L4-L5", "pfirrmann_grade").status, "category_changed");
  assert.equal(rowOf(c, "L4-L5", "modic_change").status, "category_changed");
  const wording = JSON.stringify([m.STATUS_LABEL, m.FILTER_LABEL]).toLowerCase();
  for (const forbidden of ["mejor", "empeor", "progres", "nuevo", "confirmad"]) assert.ok(!wording.includes(forbidden), forbidden);
});

check("Pfirrmann queda en las principales (experimental); Modic, hernia y espondilolistesis en investigación", () => {
  const types = ["disc_bulging", "pfirrmann_grade", "modic_change", "disc_herniation", "spondylolisthesis"];
  const side = (tag) => ready(types.map((type) => parsed({ type, label: type === "pfirrmann_grade" ? "II" : type === "modic_change" ? "none" : "absent", tag })));
  const c = m.compareFindings(side("a"), side("b"));
  const sections = Object.fromEntries(c.rows.map((row) => [row.findingType, row.section]));
  eq(sections, { disc_bulging: "main", pfirrmann_grade: "main", modic_change: "research", disc_herniation: "research", spondylolisthesis: "research" });
  assert.equal(c.counts.main.all, 2);
  assert.equal(c.counts.research.all, 3);
  assert.equal(rowOf(c, "L4-L5", "pfirrmann_grade").reference.deploymentStatus, "experimental");
});

check("resultado ausente en un lado: No comparable, nunca «Ausente»", () => {
  const c = m.compareFindings(ready([parsed({ label: "absent" })]), ready([], "B", "run-b"));
  const row = rowOf(c, "L4-L5", "disc_bulging");
  assert.equal(row.status, "not_comparable");
  assert.equal(row.reason.code, "missing_current");
  assert.match(row.reason.text, /no equivale a «Ausente»/);
  assert.equal(row.current, null);
  const other = m.compareFindings(ready([], "A"), ready([parsed({ label: "present", tag: "b" })], "B", "run-b"));
  assert.equal(rowOf(other, "L4-L5", "disc_bulging").reason.code, "missing_reference");
});

check("lado sin datos, inválido, fallido o pendiente: todas las filas No comparable, con motivo propio", () => {
  const live = ready([parsed({ label: "absent" })], "B", "run-b");
  const cases = {
    no_data: [{ status: "no_data", reason: "sin datos" }, "side_no_data"],
    invalid: [{ status: "invalid", reason: "región inválida" }, "side_invalid"],
    failed: [{ status: "failed", reason: "red" }, "side_failed"],
    pending: [{ status: "pending", reason: "cargando" }, "side_pending"],
  };
  for (const [name, [state, code]] of Object.entries(cases)) {
    const c = m.compareFindings(state, live);
    const row = rowOf(c, "L4-L5", "disc_bulging");
    assert.equal(row.status, "not_comparable", name);
    assert.equal(row.reason.code, code, name);
    assert.equal(c.counts.main.changes, 0, name);
    assert.equal(c.counts.main.unchanged, 0, name);
  }
  assert.match(rowOf(m.compareFindings(cases.no_data[0], live), "L4-L5", "disc_bulging").reason.text, /Sin datos no hay «Ausente»/);
});

check("versiones o definiciones incompatibles se muestran como No comparable con motivo", () => {
  const base = parsed({ label: "absent" });
  const cases = [
    [{ modelId: "otro_modelo" }, "model_differs"],
    [{ sha: "b".repeat(64) }, "checkpoint_differs"],
    [{ status: "experimental" }, "support_status_differs"],
    [{ dataset: "OTRA_BASE" }, "evaluation_basis_differs"],
    [{ roles: ["sagittal_t2"] }, "input_modalities_differ"],
  ];
  for (const [overrides, code] of cases) {
    const other = parsed({ label: "absent", tag: "b", ...overrides });
    const conflict = m.incompatibility(base, other);
    assert.equal(conflict.code, code, JSON.stringify(overrides));
    const row = rowOf(m.compareFindings(ready([base]), ready([other], "B", "run-b")), "L4-L5", "disc_bulging");
    assert.equal(row.status, "not_comparable");
    assert.equal(row.reason.code, code);
  }
  assert.equal(m.incompatibility(base, parsed({ label: "present", tag: "b" })), null);
});

check("conteos por sección, filtros y filtro inicial", () => {
  const a = ready([
    parsed({ level: "L1-L2", label: "absent" }), parsed({ level: "L2-L3", label: "present" }), parsed({ level: "L3-L4", label: "absent" }),
    parsed({ level: "L4-L5", type: "modic_change", label: "none" }),
  ]);
  const b = ready([
    parsed({ level: "L1-L2", label: "present", tag: "b" }), parsed({ level: "L2-L3", label: "present", tag: "b" }),
    parsed({ level: "L4-L5", type: "modic_change", label: "II", tag: "b" }),
  ], "B", "run-b");
  const c = m.compareFindings(a, b);
  eq({ ...c.counts.main }, { all: 3, changes: 1, unchanged: 1, notComparable: 1 });
  eq({ ...c.counts.research }, { all: 1, changes: 1, unchanged: 0, notComparable: 0 });
  assert.equal(m.filterRows(c.rows, "all").length, 4);
  eq(m.filterRows(c.rows, "changes").map((row) => row.key), ["L1-L2|disc_bulging", "L4-L5|modic_change"]);
  eq(m.filterRows(c.rows, "noncomparable").map((row) => row.key), ["L3-L4|disc_bulging"]);
  assert.equal(m.defaultFilter(c), "changes");
  const none = m.compareFindings(ready([parsed({ label: "absent" })]), ready([parsed({ label: "absent", tag: "b" })], "B", "run-b"));
  assert.equal(m.defaultFilter(none), "all");
});

check("sin cambios pero con no comparables: nunca se dice que todo permanece igual", () => {
  const a = ready([parsed({ level: "L1-L2", label: "absent" }), parsed({ level: "L2-L3", label: "absent" })]);
  const b = ready([parsed({ level: "L1-L2", label: "absent", tag: "b" })], "B", "run-b");
  const c = m.compareFindings(a, b);
  assert.equal(c.counts.main.changes, 0);
  const message = m.emptyGroupMessage(c, "changes");
  assert.match(message, /no se puede afirmar que el resto permanezca igual/);
  assert.doesNotMatch(message, /permanecen iguales|todos los hallazgos/i);
  const clean = m.compareFindings(ready([parsed({ label: "absent" })]), ready([parsed({ label: "absent", tag: "b" })], "B", "run-b"));
  assert.match(m.emptyGroupMessage(clean, "changes"), /Una variación de probabilidad con la misma clase no cuenta/);
});

check("ningún lado con hallazgos (par OSF): se informa sin inventar filas", () => {
  const none = { status: "no_data", reason: "Esta corrida no tiene hallazgos discales persistidos." };
  const c = m.compareFindings(none, none);
  assert.equal(c.rows.length, 0);
  const message = m.noRowsMessage(c);
  assert.match(message, /No hay hallazgos comparables/);
  assert.match(message, /Sin datos no hay «Ausente»/);
  assert.match(message, /No se inventan resultados/);
  assert.equal(m.noRowsMessage(m.compareFindings(ready([parsed()]), none)), null);
});

check("recorrido anterior/siguiente sobre las filas del filtro activo, sin dar la vuelta", () => {
  const rows = [1, 2, 3].map((n) => ({ key: `k${n}` }));
  eq(m.stepRows(rows, null, 1), { key: "k1", index: 0, total: 3, hasPrevious: true, hasNext: true });
  assert.equal(m.stepRows(rows, null, -1).key, "k3");
  assert.equal(m.stepRows(rows, "k2", 1).key, "k3");
  assert.equal(m.stepRows(rows, "k3", 1).key, "k3");
  assert.equal(m.stepRows(rows, "k3", 1).hasNext, false);
  assert.equal(m.stepRows(rows, "k1", -1).hasPrevious, false);
  assert.equal(m.stepRows(rows, "fuera", 1).key, "k1");
  assert.equal(m.stepRows([], null, 1).key, null);
});

const SERIES = {
  analyzedInputId: "inp-sagittal_t2-a",
  analyzedTotal: 15,
  archive: [
    { inputId: "inp-sagittal_t1-a", sliceCount: 15, label: "t1_tse_sag · T1" },
    { inputId: "inp-sagittal_t2-a", sliceCount: 15, label: "t2_tse_sag · T2" },
  ],
};

check("región: cada lado usa SU serie y SU corte; la T2 es la preferida y la T1 se abre del archivo", () => {
  const finding = parsed({ label: "present", region: { sliceIndex: 4 } });
  const target = m.resolveRegionTarget(finding, SERIES);
  assert.equal(target.state, "ready");
  assert.equal(target.role, "sagittal_t2");
  assert.equal(target.viewedSeriesId, null);
  assert.equal(target.sliceIndex, 4);
  const t1 = m.resolveRegionTarget(finding, SERIES, "inp-sagittal_t1-a");
  assert.equal(t1.viewedSeriesId, "inp-sagittal_t1-a");
  assert.equal(t1.seriesLabel, "t1_tse_sag · T1");
  // El otro estudio tiene su propio corte: no se copia ni se equipara el número.
  const other = m.resolveRegionTarget(parsed({ tag: "b", region: { sliceIndex: 5, inputId: "inp-x" } }), { ...SERIES, analyzedInputId: "inp-x", archive: [{ inputId: "inp-x", sliceCount: 21, label: "x" }] });
  assert.equal(other.sliceIndex, 5);
  assert.equal(other.region.inputId, "inp-x");
});

check("región ausente, serie no disponible, corte fuera de la serie o resultado ausente: «Región no disponible»", () => {
  const unavailable = (target) => { assert.equal(target.state, "unavailable"); assert.match(target.reason, /^Región no disponible/); return target.reason; };
  unavailable(m.resolveRegionTarget(null, SERIES));
  unavailable(m.resolveRegionTarget(parsed({ noRegion: true }), SERIES));
  assert.match(unavailable(m.resolveRegionTarget(parsed({ tag: "z" }), SERIES)), /serie en la que se evaluó/);
  assert.match(unavailable(m.resolveRegionTarget(parsed({ region: { sliceIndex: 5 } }), { ...SERIES, analyzedTotal: 5 })), /corte 6 no existe/);
  assert.match(unavailable(m.resolveRegionTarget(parsed(), null)), /no está cargado/);
});

check("una región inválida invalida el resultado entero (todo o nada), no se dibuja a medias", () => {
  assert.equal(m.parseDiscFinding(raw({ region: { bboxYx: [132, 108, 84, 108] } })), null);
  assert.equal(m.parseDiscFinding(raw({ region: { pointYx: [500, 96] } })), null);
  assert.equal(m.parseDiscFinding(raw({ region: { sliceIndex: 9 } })), null);
  const finding = raw();
  delete finding.sourceSeries[0].bboxYx;
  assert.equal(m.parseDiscFinding(finding), null);
});

check("la marca solo se dibuja en la serie y el corte exactos; si no, se ofrece volver", () => {
  const target = m.resolveRegionTarget(parsed(), SERIES);
  const draw = m.resolveRegionOverlay(target, "L4-L5", { plane: "sagittal", viewedSeriesId: null, slice: 4 });
  assert.equal(draw.state, "draw");
  assert.equal(draw.marker.label, "L4-L5");
  assert.ok(Math.abs(draw.marker.point.x - 96 / 200 * 256) < 1e-9);
  assert.ok(Math.abs(draw.marker.point.y - 120 / 256 * 256) < 1e-9);
  eq({ ...draw.marker.box }, { x0: 84 / 200 * 256, y0: 108 / 256 * 256, x1: 108 / 200 * 256, y1: 132 / 256 * 256 });
  const neighbour = m.resolveRegionOverlay(target, "L4-L5", { plane: "sagittal", viewedSeriesId: null, slice: 5 });
  assert.equal(neighbour.state, "elsewhere");
  assert.match(neighbour.reason, /corte 5; estás viendo el 6/);
  const otherSeries = m.resolveRegionOverlay(target, "L4-L5", { plane: "sagittal", viewedSeriesId: "inp-sagittal_t1-a", slice: 4 });
  assert.equal(otherSeries.state, "elsewhere");
  assert.equal(m.resolveRegionOverlay(target, "L4-L5", { plane: "axial", viewedSeriesId: null, slice: 4 }).state, "elsewhere");
  assert.equal(m.resolveRegionOverlay(target, "L4-L5", null).state, "unavailable");
  assert.equal(m.resolveRegionOverlay(null, "L4-L5", null).state, "unavailable");
  assert.equal(m.resolveRegionOverlay({ state: "unavailable", reason: "Región no disponible: x" }, "L4-L5", { plane: "sagittal", viewedSeriesId: null, slice: 4 }).reason, "Región no disponible: x");
});

check("lo cargado que no es el estudio ni la corrida de la comparación no se usa (respuestas fuera de orden)", () => {
  const snapshot = { findings: [parsed()] };
  const expected = { caseId: "REF-2", runId: "run-2" };
  assert.equal(m.sideFromSnapshot({ caseId: "REF-1", runId: "run-1" }, expected, snapshot).status, "pending");
  assert.equal(m.sideFromSnapshot({ caseId: "REF-2", runId: "run-otra" }, expected, snapshot).status, "pending");
  assert.equal(m.sideFromSnapshot(null, expected, null).status, "pending");
  const ok = m.sideFromSnapshot({ caseId: "REF-2", runId: "run-2" }, expected, snapshot);
  assert.equal(ok.status, "ready");
  assert.equal(ok.findings.length, 1);
  assert.equal(m.sideFromSnapshot({ caseId: "REF-2", runId: "run-2" }, expected, { findings: [], unavailable: "x" }).status, "no_data");
  assert.equal(m.sideFromSnapshot({ caseId: "REF-2", runId: "run-2" }, expected, { findings: [], contractError: "y" }).status, "invalid");
  // Aun sin corrida esperada exige el mismo estudio.
  assert.equal(m.sideFromSnapshot({ caseId: "A", runId: "r" }, { caseId: "B", runId: null }, snapshot).status, "pending");
});

check("distribución por clase: se acepta solo si es creíble y se ordena según el catálogo", () => {
  const withProbs = parsed({ type: "pfirrmann_grade", label: "II", probs: { V: 0.01, IV: 0.04, III: 0.15, II: 0.45, I: 0.35 } });
  eq(m.orderedDistribution(withProbs).map((item) => item.label), ["I", "II", "III", "IV", "V"]);
  const bad = (probs) => raw({ type: "pfirrmann_grade", label: "II", probs });
  const finding = (probs) => {
    const value = bad(probs);
    value.classification.confidence = probs.II;
    return m.parseDiscFinding(value);
  };
  assert.equal(finding({ I: 0.5, II: 0.6 }).classProbabilities, undefined, "suma distinta de 1");
  assert.equal(finding({ I: 0.5, II: 0.5, X: 0 }).classProbabilities, undefined, "clase fuera del catálogo");
  assert.equal(finding({ I: -0.1, II: 1.1 }).classProbabilities, undefined, "fuera de [0,1]");
  const mismatch = bad({ I: 0.5, II: 0.5 });
  mismatch.classification.confidence = 0.9;
  assert.equal(m.parseDiscFinding(mismatch).classProbabilities, undefined, "no coincide con la confianza informada");
  assert.equal(m.orderedDistribution(parsed({ label: "absent" }, undefined)).length, 2);
  const none = raw();
  delete none.classification.classProbabilities;
  assert.equal(m.orderedDistribution(m.parseDiscFinding(none)), null);
});

check("la clave «probabilities» sigue invalidando el resultado: la distribución solo viaja como classProbabilities", () => {
  const value = raw();
  value.classification.probabilities = { absent: 0.7, present: 0.3 };
  assert.equal(m.parseDiscFinding(value), null);
});

check("filas ordenadas por nivel y clasificación, con la clave nivel|tipo", () => {
  const a = ready([parsed({ level: "L5-S1", type: "pfirrmann_grade", label: "I" }), parsed({ level: "L1-L2", type: "disc_narrowing", label: "absent" }), parsed({ level: "L1-L2", label: "absent" })]);
  const c = m.compareFindings(a, a);
  eq(c.rows.map((row) => row.key), ["L1-L2|disc_bulging", "L1-L2|disc_narrowing", "L5-S1|pfirrmann_grade"]);
});

console.log(`dual-findings-comparison: ${passed} passed`);
