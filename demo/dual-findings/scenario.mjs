import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createFixtureFactory, finding, LEVEL_Y, syntheticPng } from "../../scripts/lib/dual-findings-fixtures.mjs";

/**
 * Escenario SIMULADO de la demostración de hallazgos A/B. Reutiliza los fixtures del E2E del visor dual
 * (`scripts/lib/dual-findings-fixtures.mjs`): la estructura de un estudio real con otros identificadores y hallazgos
 * inventados. No hay ningún dato clínico ni evolución de un paciente; las imágenes son dibujos sintéticos.
 */

export const REFERENCE_CASE = "DEMO-A";
export const CURRENT_CASE = "DEMO-B";

const template = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./template.json", import.meta.url)), "utf8"));
template.detail.runs = template.runs.runs; // la plantilla guarda una sola copia de las corridas

const factory = createFixtureFactory(template);

/**
 * La plantilla viene de un estudio real: sus fechas de análisis y su conteo de mediciones no se muestran. Las fechas
 * pasan a una fecha fija e inverosímil y el conteo a 0 (esta demostración no trae mediciones numéricas).
 */
const SIMULATED_DATE = "2000-01-01T00:00:00Z";
const neutralize = (value) => JSON.parse(
  JSON.stringify(value)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, SIMULATED_DATE)
    .replace(/"usableMeasurementCount":\d+/g, '"usableMeasurementCount":0'),
);
/**
 * La plantilla trae máscaras, puntos y mediciones de un estudio real, que no encajan con las imágenes simuladas y no
 * deben aparecer dibujadas sobre ellas. Se vacían; los hallazgos discales (inventados) son lo único que queda.
 */
function stripRealOverlays(run) {
  const planesOf = (container) => Object.values(container?.planes ?? {});
  for (const plane of [...planesOf(run.metricsSnapshot), ...planesOf(run.canonicalRun)]) {
    if (!plane || typeof plane !== "object") continue;
    plane.masks = [];
    plane.landmarks = [];
    plane.measurements = Array.isArray(plane.measurements) ? [] : plane.measurements;
    delete plane.segmentation;
    if (plane.quality?.discLevels) plane.quality.discLevels = [];
  }
  run.measurementsByPlane = { sagittal: [], axial: [] };
}
const makeStudy = (options) => {
  const study = factory.makeStudy(options);
  study.detail.runs.forEach(stripRealOverlays);
  study.runs.runs.forEach(stripRealOverlays);
  return { ...study, detail: neutralize(study.detail), runs: neutralize(study.runs) };
};
const comparisonFor = (current, reference) => neutralize(factory.comparisonFor(current, reference));
const candidatesFor = (current, references) => neutralize(factory.candidatesFor(current, references));
const at = { byLevel: true };

/* A · «Referencia»: cada fila de abajo existe para mostrar un caso distinto de la comparación. */
const studyA = makeStudy({
  caseId: REFERENCE_CASE,
  patient: "DEMO-SIMULADO",
  findings: (ids) => [
    // Misma clase, otra probabilidad: NO cuenta como cambio.
    finding(ids, { ...at, level: "L2-L3", label: "absent", probs: { absent: 0.9, present: 0.1 }, slice: 5 }),
    // Cambio de Pfirrmann (experimental).
    finding(ids, { ...at, level: "L3-L4", type: "pfirrmann_grade", label: "II", slice: 6 }),
    // Ausente → Presente.
    finding(ids, { ...at, level: "L4-L5", label: "absent", slice: 4 }),
    // Presente → Ausente.
    finding(ids, { ...at, level: "L5-S1", label: "present", slice: 7 }),
    // Sin resultado del otro lado (no evaluado en B): No comparable, nunca «Ausente».
    finding(ids, { ...at, level: "L1-L2", type: "disc_narrowing", label: "absent", slice: 3 }),
    // Clasificación válida cuya región el otro estudio no guardó.
    finding(ids, { ...at, level: "L5-S1", type: "upper_endplate_change", label: "absent", slice: 7 }),
    // Investigación (aparte de las principales).
    finding(ids, { ...at, level: "L4-L5", type: "modic_change", label: "none", slice: 4 }),
    finding(ids, { ...at, level: "L3-L4", type: "disc_herniation", label: "absent", slice: 6 }),
  ],
});

/* B · «Seguimiento». Las regiones de B tienen su propio corte y su propia serie: nunca se copian de A. */
const studyB = makeStudy({
  caseId: CURRENT_CASE,
  patient: "DEMO-SIMULADO",
  findings: (ids) => [
    finding(ids, { ...at, level: "L2-L3", label: "absent", probs: { absent: 0.55, present: 0.45 }, slice: 9 }),
    finding(ids, { ...at, level: "L3-L4", type: "pfirrmann_grade", label: "III", slice: 10 }),
    finding(ids, { ...at, level: "L4-L5", label: "present", slice: 8, region: "t1" }),
    finding(ids, { ...at, level: "L5-S1", label: "absent", slice: 11 }),
    // Clasificación válida sin región: B la muestra y lo dice, y A conserva la suya.
    finding(ids, { ...at, level: "L5-S1", type: "upper_endplate_change", label: "present", slice: 11, region: "none" }),
    finding(ids, { ...at, level: "L4-L5", type: "modic_change", label: "II", slice: 8 }),
    finding(ids, { ...at, level: "L3-L4", type: "disc_herniation", label: "absent", slice: 10 }),
  ],
});

export const STUDIES = new Map([studyA, studyB].map((study) => [study.caseId, study]));

/* ------------------------------------------------------------------------------------------ imágenes simuladas */

function owner(inputId) {
  for (const study of STUDIES.values()) {
    const entries = { [study.ids.t1]: "T1", [study.ids.t2]: "T2", [study.ids.axT1]: "AX T1", [study.ids.axT2]: "AX T2" };
    if (entries[inputId]) return { study, role: entries[inputId], inputId };
  }
  return null;
}

function sliceCountOf(study, inputId) {
  return study.detail.inputs.find((input) => input.inputId === inputId)?.sliceCount ?? 15;
}

/* Fuente 5x7 mínima (solo mayúsculas, dígitos y signos que usan las etiquetas): la imagen es un PNG, no un SVG, porque
   el visor solo acepta tipos de imagen permitidos. */
const GLYPHS = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
};

function drawText(grid, size, text, x0, y0, scale, value) {
  let cursor = x0;
  for (const char of text) {
    const glyph = GLYPHS[char] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = cursor + col * scale + dx;
            const y = y0 + row * scale + dy;
            if (x >= 0 && x < size && y >= 0 && y < size) grid[y * size + x] = value;
          }
        }
      }
    }
    cursor += 6 * scale;
  }
}

const imageCache = new Map();

/**
 * Corte simulado: una columna con cuerpos vertebrales y discos a las alturas de LEVEL_Y (donde caen las regiones de
 * los resultados simulados), con el estudio, la secuencia y el corte escritos encima. Nada de esto es anatomía de nadie.
 */
function slicePng({ study, role, slice, total, size }) {
  const key = `${study.caseId}|${role}|${slice}|${size}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const t2 = role.endsWith("T2");
  const bone = t2 ? 95 : 130;
  const disc = t2 ? 225 : 55;
  const shift = (slice - (total - 1) / 2) * 1.6;
  const discs = Object.entries(LEVEL_Y).map(([level, y]) => ({ level, y: y * 256 }));
  const edges = [14, ...discs.map((item) => item.y), 246];
  const grid = new Uint8Array(size * size);
  const scale256 = size / 256;
  for (let py = 0; py < size; py += 1) {
    const v = py / scale256;
    for (let px = 0; px < size; px += 1) {
      const u = px / scale256;
      let value = u > 60 && u < 196 ? 24 : 12;
      if (u > 86 + shift && u < 170 + shift) {
        for (let index = 0; index < edges.length - 1; index += 1) {
          const top = index === 0 ? edges[index] : edges[index] + 7;
          const bottom = index === edges.length - 2 ? edges[index + 1] : edges[index + 1] - 7;
          if (v >= top && v <= bottom) value = bone;
        }
      }
      if (u > 88 + shift && u < 168 + shift && discs.some((item) => Math.abs(v - item.y) < 5)) value = disc;
      grid[py * size + px] = value;
    }
  }
  const text = Math.max(1, Math.round(size / 192));
  drawText(grid, size, study.caseId === REFERENCE_CASE ? "A" : "B", size - 8 * text * 6, 10 * text, text * 5, 90);
  drawText(grid, size, "SIMULADO", 6, 6, text, 235);
  drawText(grid, size, "NO ES UN ESTUDIO REAL", 6, 6 + 9 * text, text, 235);
  for (const item of discs) drawText(grid, size, item.level, Math.round((176 + shift) * scale256), Math.round(item.y * scale256) - 3 * text, text, 170);
  drawText(grid, size, `${study.caseId} ${role} CORTE ${slice + 1}/${total}`, 6, size - 10 * text, text, 235);
  const png = syntheticPng(size, (x, y) => grid[y * size + x]);
  imageCache.set(key, png);
  return png;
}

/* ------------------------------------------------------------------------------------------ rutas de la API simulada */

/**
 * Responde las rutas de la API que el visor dual usa. Devuelve `null` si la ruta no es de la demostración, así el
 * servidor contesta 404: nada se delega a ningún otro servicio.
 */
export function route(pathname, searchParams) {
  const json = (body, status = 200) => ({ status, type: "application/json", body: JSON.stringify(body) });
  let match;

  if ((match = pathname.match(/^\/api\/studies\/(DEMO-[AB])$/))) return json(STUDIES.get(match[1]).detail);
  if ((match = pathname.match(/^\/api\/studies\/(DEMO-[AB])\/runs$/))) return json(STUDIES.get(match[1]).runs);

  if ((match = pathname.match(/^\/api\/studies\/(DEMO-[AB])\/initial-analysis-comparison\/candidates$/))) {
    const current = STUDIES.get(match[1]);
    const references = [...STUDIES.values()].filter((study) => study !== current);
    return json(candidatesFor(current, references));
  }
  if ((match = pathname.match(/^\/api\/studies\/(DEMO-[AB])\/initial-analysis-comparison$/))) {
    const current = STUDIES.get(match[1]);
    const reference = STUDIES.get(searchParams.get("referenceCaseId") ?? "");
    if (!reference || reference === current) return json({ message: "La referencia no es válida en la demostración." }, 404);
    return json(comparisonFor(current, reference));
  }

  if ((match = pathname.match(/^\/api\/ai\/series\/(inp_[0-9a-f]{32})\/slices\/(\d+)$/))) {
    const found = owner(match[1]);
    if (!found) return null;
    const total = sliceCountOf(found.study, found.inputId);
    const slice = Number(match[2]);
    if (slice >= total) return { status: 404, type: "text/plain", body: "" };
    return { status: 200, type: "image/png", body: slicePng({ ...found, slice, total, size: found.role === "T1" ? 320 : 384 }) };
  }
  if ((match = pathname.match(/^\/api\/ai\/assets\/([0-9a-f]{16})\/(sagittal|axial)\/(.+)$/))) {
    const study = [...STUDIES.values()].find((item) => item.ids.sagittalRun === match[1] || item.ids.axialRun === match[1]);
    if (!study) return null;
    if (match[3] !== "input.png") return { status: 404, type: "text/plain", body: "" };
    const total = sliceCountOf(study, study.ids.t2);
    const role = match[2] === "sagittal" ? "T2" : "AX T2";
    return { status: 200, type: "image/png", body: slicePng({ study, role, slice: Math.floor(total / 2), total, size: 384 }) };
  }
  if (/^\/api\/ai\/runs\/multi-fx[0-9a-f]+\/annotations$/.test(pathname)) return json([]);
  return null;
}
