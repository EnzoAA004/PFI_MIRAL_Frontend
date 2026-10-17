import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * Fixtures de la comparación de hallazgos degenerativos del visor dual. Los comparten el E2E contra 8288/8280
 * (`playwright-dual-findings-e2e.mjs`, que los sirve con page.route) y la demostración interactiva
 * (`demo/dual-findings/`, que los sirve desde su propio servidor).
 *
 * Un estudio de fixture tiene la ESTRUCTURA de un estudio real (la plantilla) con todos los identificadores
 * cambiados y con hallazgos inventados para el caso. No son datos clínicos ni la evolución de ningún paciente.
 */

export const hex = (seed, length) => crypto.createHash("sha256").update(seed).digest("hex").slice(0, length);

/** Altura relativa de cada disco en la imagen simulada de la demostración. */
export const LEVEL_Y = { "L1-L2": 0.2, "L2-L3": 0.33, "L3-L4": 0.46, "L4-L5": 0.6, "L5-S1": 0.74 };

const DEFAULT_SHA = "16eccff327e6794b127fe372ecd03ea619a0f69d939b84ae1aa2e904191c6293";

/**
 * Un hallazgo con el contrato público. `ids` son los de SU estudio, así que las regiones nunca se comparten.
 * `region`: "t1" | "t2" | "both" | "none" (la clasificación sigue válida, sin región).
 */
export function finding(ids, {
  level = "L4-L5", type = "disc_bulging", label = "absent", probs, region = "t2", slice = 4, status, sha, modelId, dataset, roles = ["t1", "t2"], byLevel = false,
}) {
  // `byLevel` ubica la región a la altura del disco en la imagen simulada de la demostración; por defecto todas caen en el mismo lugar.
  const cy = byLevel ? LEVEL_Y[level] ?? 0.45 : 0.45;
  const binary = !["pfirrmann_grade", "modic_change"].includes(type);
  const catalog = type === "pfirrmann_grade" ? ["I", "II", "III", "IV", "V"] : type === "modic_change" ? ["none", "I", "II", "III"] : ["absent", "present"];
  const support = { pfirrmann_grade: "experimental", modic_change: "not_product_supported", disc_herniation: "not_product_supported", spondylolisthesis: "not_product_supported" };
  const distribution = probs ?? Object.fromEntries(catalog.map((item) => [item, item === label ? 0.7 : 0.3 / (catalog.length - 1)]));
  const sources = roles.map((role) => {
    const input = role === "t1" ? ids.t1 : ids.t2;
    const space = role === "t1" ? 320 : 384;
    const entry = { role: role === "t1" ? "sagittal_t1" : "sagittal_t2", available: true, positions: [slice - 1, slice, slice + 1] };
    const wantsRegion = region === "both" || region === role;
    if (wantsRegion) {
      Object.assign(entry, {
        inputId: input, sliceIndex: slice, pointYx: [space * cy, space * 0.5], bboxYx: [space * (cy - 0.07), space * (cy + 0.07), space * 0.35, space * 0.65],
        coordinateSpaceHeight: space, coordinateSpaceWidth: space,
      });
    }
    return entry;
  });
  return {
    findingId: crypto.randomUUID(),
    findingType: type,
    anatomy: { level },
    classification: { kind: binary ? "binary" : "categorical", label, confidence: distribution[label], classProbabilities: distribution },
    evidence: { deploymentStatus: status ?? support[type] ?? "supported_internal", evaluationDataset: dataset ?? "SPIDER_internal_test", externalValidationAvailable: false },
    evaluation: { status: "evaluated" },
    localization: { source: "segmentation_derived_disc_level", researchOnly: true, automaticAnatomicalLocalizationValidated: false },
    model: { modelId: modelId ?? "spider_degenerative_multitask_sagittal_t1_t2_2p5d", modelSha256: sha ?? DEFAULT_SHA },
    review: { required: true, status: "pending" },
    notClinicalDiagnosis: true,
    sourceSeries: sources,
  };
}

/**
 * Fábrica de estudios de fixture a partir de una plantilla `{ templateCase, detail, runs, candidates, comparison }`
 * (respuestas de la API de un estudio real, o la copia saneada que viaja con la demostración).
 */
export function createFixtureFactory(templates) {
  const { templateCase, detail: templateDetail, runs: templateRuns, candidates: templateCandidates, comparison: templateComparison } = templates;

  /** Un estudio de fixture: la estructura del estudio real con otros identificadores, y los hallazgos que se le pasen. */
  function makeStudy({ caseId, findings, patient = "FXDF-PACIENTE" }) {
    const ids = {
      runId: `multi-fx${hex(`${caseId}-run`, 18)}`,
      sagittalRun: hex(`${caseId}-sag`, 16),
      axialRun: hex(`${caseId}-ax`, 16),
      t2: `inp_${hex(`${caseId}-t2`, 32)}`,
      t1: `inp_${hex(`${caseId}-t1`, 32)}`,
      axT2: `inp_${hex(`${caseId}-axt2`, 32)}`,
      axT1: `inp_${hex(`${caseId}-axt1`, 32)}`,
    };
    const swap = (value) => {
      let text = JSON.stringify(value);
      const map = [
        [templateCase, caseId], ["MENDELEY-0015", patient],
        ["multi-38f0a06917542db52358", ids.runId], ["d4ab637fe9d3146f", ids.sagittalRun], ["8d0be911b5b4a121", ids.axialRun],
        ["inp_40733d7921bd4fbe9a544366fdedbcf7", ids.t2], ["inp_7404268627a44462976c90c0258e1bda", ids.t1],
        ["inp_e4f4561ace8b42d7b68f9ba2fdd642dd", ids.axT2], ["inp_6151a667e9ab4e40b930db95a58c99d6", ids.axT1],
      ];
      for (const [from, to] of map) text = text.split(from).join(to);
      return JSON.parse(text);
    };
    const setFindings = (run) => {
      const snapshot = run.metricsSnapshot;
      if (findings === null) {
        delete snapshot.discDegenerativeFindings;
        delete snapshot.discDegenerativeGovernance;
      } else {
        snapshot.discDegenerativeFindings = { schemaVersion: "pfi.disc-degenerative-findings.v1", findings: findings(ids) };
      }
    };
    const detail = swap(templateDetail);
    detail.runs.forEach(setFindings);
    const runs = swap(templateRuns);
    runs.runs.forEach(setFindings);
    return { caseId, ids, detail, runs };
  }

  function comparisonFor(current, reference) {
    const body = JSON.parse(JSON.stringify(templateComparison));
    body.current = { ...body.current, caseId: current.caseId, runId: current.ids.runId };
    body.reference = { ...body.reference, caseId: reference.caseId, runId: reference.ids.runId };
    body.comparisons = [];
    body.excluded = [];
    body.summary = { ...body.summary, comparedCount: 0, excludedCount: 0 };
    return body;
  }

  function candidatesFor(current, references) {
    const body = JSON.parse(JSON.stringify(templateCandidates));
    body.current = { ...body.current, caseId: current.caseId, runId: current.ids.runId };
    const base = templateCandidates.candidates[0];
    body.candidates = references.map((reference) => ({ ...base, caseId: reference.caseId, runId: reference.ids.runId }));
    return body;
  }

  return { makeStudy, comparisonFor, candidatesFor };
}

/* ------------------------------------------------------------------------------------------ PNG sintético */

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG en escala de grises-RGB con un patrón sintético. `pixel(x, y)` puede devolver un valor 0..255 propio. */
export function syntheticPng(size = 128, pixel = null) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x += 1) {
      const value = pixel ? pixel(x, y) : 70 + Math.round(50 * Math.sin(x / 9) * Math.cos(y / 11)) + (x === size / 2 ? 40 : 0);
      raw[row + 1 + x * 3] = value;
      raw[row + 2 + x * 3] = value;
      raw[row + 3 + x * 3] = value;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
