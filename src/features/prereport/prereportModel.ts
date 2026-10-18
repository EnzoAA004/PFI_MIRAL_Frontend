import type {
  PreReportEdits,
  PreReportFinding,
  PreReportGenerated,
  PreReportMeasurement,
  PreReportRegion,
} from "./prereportTypes";

/**
 * Lógica pura del preinforme: qué se incluye, qué texto rige, cómo se agrupan las imágenes por nivel y qué evidencia falta.
 * Sin React ni red. El contenido generado viene del Backend; acá solo se combina con las decisiones del profesional.
 *
 * Reglas que se respetan acá:
 * - Excluir un resultado del documento no lo borra del estudio: es solo una decisión de este borrador.
 * - Sin geometría o sin imagen se conserva el resultado textual y se dice por qué falta la evidencia; nunca se sustituye por
 *   un corte genérico ni se reconstruye una ubicación a partir del nombre del nivel.
 * - No hay veredictos «dentro/fuera de rango» ni conteo de «atípicos».
 */

export const MAIN_CATEGORIES = ["disc_bulging", "disc_narrowing", "upper_endplate_change", "lower_endplate_change"] as const;
export const MATRIX_COLUMNS = [...MAIN_CATEGORIES, "pfirrmann_grade"] as const;
export const COLUMN_LABEL: Record<string, string> = {
  disc_bulging: "Abombamiento discal",
  disc_narrowing: "Estrechamiento discal",
  upper_endplate_change: "Platillo superior",
  lower_endplate_change: "Platillo inferior",
  pfirrmann_grade: "Pfirrmann (experimental)",
};
export const LUMBAR_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];

export const DRAFT_BANNER = "Preinforme · Borrador pendiente de revisión profesional";

/* ------------------------------------------------------------------ formato */

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatUnit(unit: string): string {
  if (unit === "mm2") return "mm²";
  if (unit === "deg") return "°";
  return unit;
}

export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "—";
  const u = formatUnit(unit);
  return `${formatNumber(value)}${u === "°" ? "" : " "}${u}`.trim();
}

export function formatPercent(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined ? "—" : `${formatNumber(fraction * 100)} %`;
}

/* ------------------------------------------------------------------ decisiones del profesional */

export function isIncluded(edits: PreReportEdits, key: string, fallback: boolean): boolean {
  const value = edits.include?.[key];
  return typeof value === "boolean" ? value : fallback;
}

export const levelKey = (level: string) => `level:${level}`;

export function levelIncluded(model: PreReportGenerated, edits: PreReportEdits, level: string): boolean {
  const entry = model.levels.find((item) => item.level === level);
  return isIncluded(edits, levelKey(level), entry?.defaultCard ?? false);
}

export function effectiveText(edits: PreReportEdits, key: string, generated: string): string {
  const edited = edits.text?.[key];
  return typeof edited === "string" && edited.trim() ? edited : generated;
}

export function isEdited(edits: PreReportEdits, key: string, generated: string): boolean {
  const edited = edits.text?.[key];
  return typeof edited === "string" && edited.trim() !== "" && edited !== generated;
}

export function withInclude(edits: PreReportEdits, key: string, value: boolean): PreReportEdits {
  return { ...edits, include: { ...(edits.include ?? {}), [key]: value } };
}

/** Un texto igual al generado no es una edición: se quita para que lo generado siga rigiendo. */
export function withText(edits: PreReportEdits, key: string, value: string, generated: string): PreReportEdits {
  const next = { ...(edits.text ?? {}) };
  if (!value.trim() || value === generated) delete next[key];
  else next[key] = value;
  return { ...edits, text: next };
}

export function withLevelNote(edits: PreReportEdits, level: string, value: string): PreReportEdits {
  const next = { ...(edits.levelNotes ?? {}) };
  if (!value.trim()) delete next[level];
  else next[level] = value;
  return { ...edits, levelNotes: next };
}

export function withObservations(edits: PreReportEdits, value: string): PreReportEdits {
  return { ...edits, observations: value };
}

export function sameEdits(a: PreReportEdits, b: PreReportEdits): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(edits: PreReportEdits) {
  return {
    include: sorted(edits.include),
    text: sorted(edits.text),
    levelNotes: sorted(edits.levelNotes),
    observations: edits.observations ?? "",
  };
}

function sorted<T>(record: Record<string, T> | undefined): [string, T][] {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ selección por nivel */

export type LevelSelection = {
  level: string;
  findings: PreReportFinding[];
  measurements: PreReportMeasurement[];
};

export function findingIncluded(edits: PreReportEdits, finding: PreReportFinding): boolean {
  return isIncluded(edits, finding.key, finding.defaultInclude);
}

export function measurementIncluded(edits: PreReportEdits, measurement: PreReportMeasurement): boolean {
  return isIncluded(edits, measurement.key, measurement.defaultInclude);
}

/** Las fichas del cuerpo: niveles incluidos, con lo seleccionado en cada uno (sin los resultados de investigación). */
export function selectedLevels(model: PreReportGenerated, edits: PreReportEdits): LevelSelection[] {
  return model.levels
    .filter((entry) => levelIncluded(model, edits, entry.level))
    .map((entry) => ({
      level: entry.level,
      findings: model.findings.filter((f) => f.level === entry.level && f.section !== "investigacion" && findingIncluded(edits, f)),
      measurements: model.measurements.filter((m) => m.level === entry.level && measurementIncluded(edits, m)),
    }));
}

/** Resultados de investigación que el profesional decidió incluir: van en un apartado identificado, nunca mezclados en las fichas. */
export function includedResearch(model: PreReportGenerated, edits: PreReportEdits): PreReportFinding[] {
  return model.findings.filter((f) => f.section === "investigacion" && findingIncluded(edits, f));
}

/* ------------------------------------------------------------------ resumen compacto */

export type MatrixCell = { state: "present" | "absent" | "graded" | "not_evaluated"; text: string };

export function summaryMatrix(model: PreReportGenerated): { level: string; cells: Record<string, MatrixCell> }[] {
  return LUMBAR_LEVELS.map((level) => {
    const cells: Record<string, MatrixCell> = {};
    for (const column of MATRIX_COLUMNS) {
      const finding = model.findings.find((f) => f.level === level && f.type === column);
      if (!finding) {
        cells[column] = { state: "not_evaluated", text: "No evaluado" };
      } else if (column === "pfirrmann_grade") {
        cells[column] = { state: "graded", text: `${finding.className} · ${formatPercent(finding.confidence)}` };
      } else {
        const present = finding.label === "present";
        cells[column] = { state: present ? "present" : "absent", text: `${present ? "Presente" : "Ausente"} · ${formatPercent(finding.confidence)}` };
      }
    }
    return { level, cells };
  });
}

/* ------------------------------------------------------------------ evidencia visual */

export type TraceFigure = {
  ref: string;
  n: number;
  label: string;
  kind: string;
  points: number[][];
  space: { width: number | null; height: number | null };
  origin: "ia" | "profesional";
};

export type RegionFigure = {
  ref: string;
  n: number;
  label: string;
  positive: boolean;
  region: PreReportRegion;
};

export type EvidenceBlock = {
  id: string;
  /** El profesional puede quitar una imagen sin quitar el resultado. */
  included: boolean;
  level: string;
  kind: "trace" | "region";
  imagePath: string;
  /** Corte en base 1, tal como lo muestra el visor. */
  sliceNumber: number | null;
  sliceTotal: number | null;
  seriesLabel: string;
  traces: TraceFigure[];
  regions: RegionFigure[];
};

function seriesInfo(model: PreReportGenerated, inputId: string | null) {
  const series = inputId ? model.series.find((item) => item.inputId === inputId) : model.series.find((item) => item.analyzed && item.plane === "sagittal");
  return {
    label: series ? `${series.label}${series.sequenceSource ? ` (${series.sequenceSource})` : ""}` : "Serie sagital",
    total: series?.sliceCount ?? null,
  };
}

/**
 * Bloques de imagen de una ficha. Se agrupan por imagen para no repetir el mismo corte: todos los trazos incluidos del nivel
 * sobre el corte analizado van en un bloque; todas las regiones evaluadas incluidas sobre un mismo corte, en otro.
 */
export function evidenceBlocks(model: PreReportGenerated, edits: PreReportEdits, selection: LevelSelection, options: { all?: boolean } = {}): EvidenceBlock[] {
  type Draft = { traces: PreReportMeasurement[]; regions: { finding: PreReportFinding; region: PreReportRegion }[]; inputId: string | null };
  // Las mediciones (análisis inicial) y las regiones P10.7 vienen de circuitos distintos, con niveles asignados por separado y sin un
  // vínculo persistido entre ambos: NUNCA se dibujan en una misma imagen, aunque coincidan en el mismo corte. Una imagen por fuente.
  const byImage = new Map<string, Draft>();
  const draftFor = (kind: "trace" | "region", imagePath: string): Draft => {
    const key = `${kind}|${imagePath}`;
    const existing = byImage.get(key);
    if (existing) return existing;
    const created: Draft = { traces: [], regions: [], inputId: null };
    byImage.set(key, created);
    return created;
  };
  for (const measurement of selection.measurements) {
    if (!measurement.imagePath || measurement.trace.status !== "located" || !measurement.trace.points.length) continue;
    draftFor("trace", measurement.imagePath).traces.push(measurement);
  }
  for (const finding of selection.findings) {
    for (const source of finding.sources) {
      if (!source.region || !source.imagePath) continue;
      const draft = draftFor("region", source.imagePath);
      draft.regions.push({ finding, region: source.region });
      draft.inputId = source.region.inputId;
    }
  }
  const blocks: EvidenceBlock[] = [];
  for (const [mapKey, draft] of byImage) {
    const imagePath = mapKey.slice(mapKey.indexOf("|") + 1);
    const info = seriesInfo(model, draft.inputId);
    const first = draft.traces[0];
    const sliceNumber = first ? (first.sliceIndex === null ? null : first.sliceIndex + 1) : draft.regions[0].region.sliceIndex + 1;
    const kind: EvidenceBlock["kind"] = draft.traces.length ? "trace" : "region";
    const id = `img:${kind}:${selection.level}:${imagePath}`;
    blocks.push({
      id,
      included: isIncluded(edits, id, true),
      level: selection.level,
      kind,
      imagePath,
      sliceNumber,
      sliceTotal: info.total,
      seriesLabel: info.label,
      traces: draft.traces.map((m, index) => ({
        ref: m.key,
        n: index + 1,
        label: `${m.label} ${formatValue(m.effective, m.unit)}`,
        kind: m.trace.kind,
        points: m.trace.points,
        space: { width: m.trace.space.width, height: m.trace.space.height },
        origin: m.trace.origin === "profesional" ? "profesional" : "ia",
      })),
      regions: draft.regions.map((entry, index) => ({
        ref: entry.finding.key,
        n: index + 1,
        label: `${entry.finding.typeLabel}: ${entry.finding.className}`,
        positive: entry.finding.positive,
        region: entry.region,
      })),
    });
  }
  return options.all ? blocks : blocks.filter((block) => block.included);
}

export type MissingEvidence = { what: string; reason: string };

/**
 * Qué evidencia falta para lo que se va a exportar. Antes de generar el PDF se le informa al profesional: el resultado
 * textual se conserva siempre, pero una imagen que no existe no se reemplaza por un corte genérico.
 */
export function missingEvidence(model: PreReportGenerated, edits: PreReportEdits): MissingEvidence[] {
  const missing: MissingEvidence[] = [];
  for (const selection of selectedLevels(model, edits)) {
    for (const measurement of selection.measurements) {
      if (measurement.invalidReason) {
        missing.push({ what: `${selection.level} · ${measurement.label}`, reason: measurement.invalidReason });
      } else if (!measurement.imagePath) {
        missing.push({ what: `${selection.level} · ${measurement.label}`, reason: measurement.trace.reason ?? "La corrida no guardó un trazo ubicable. Se informa solo el valor." });
      }
    }
    for (const finding of selection.findings) {
      for (const source of finding.sources) {
        if (!source.available) continue;
        if (source.regionIssue) {
          missing.push({ what: `${selection.level} · ${finding.typeLabel} (${source.roleLabel})`, reason: `La corrida guardó una región inválida: ${source.regionIssue}. Se conserva la clasificación sin localización.` });
        } else if (!source.region) {
          missing.push({ what: `${selection.level} · ${finding.typeLabel} (${source.roleLabel})`, reason: "La corrida no guardó la región evaluada de este resultado." });
        }
      }
    }
  }
  for (const finding of includedResearch(model, edits)) {
    for (const source of finding.sources) {
      if (source.available && !source.region) {
        missing.push({ what: `${finding.level} · ${finding.typeLabel} (${source.roleLabel}, investigación)`, reason: source.regionIssue ?? "La corrida no guardó la región evaluada." });
      }
    }
  }
  return missing;
}

/* ------------------------------------------------------------------ resumen de cobertura */

export type DocumentSummary = {
  cards: number;
  findingsIncluded: number;
  measurementsIncluded: number;
  researchIncluded: number;
  imagesPlanned: number;
};

export function documentSummary(model: PreReportGenerated, edits: PreReportEdits): DocumentSummary {
  const selections = selectedLevels(model, edits);
  return {
    cards: selections.length,
    findingsIncluded: selections.reduce((total, s) => total + s.findings.length, 0),
    measurementsIncluded: selections.reduce((total, s) => total + s.measurements.length, 0),
    researchIncluded: includedResearch(model, edits).length,
    imagesPlanned: selections.reduce((total, s) => total + evidenceBlocks(model, edits, s).length, 0),
  };
}

/** Las medidas del anexo: todas, sin duplicar el cuerpo más que en la selección. Orden: nivel anatómico, plano, nombre. */
export function annexMeasurements(model: PreReportGenerated): PreReportMeasurement[] {
  const order = new Map(model.levels.map((entry, index) => [entry.level, index]));
  return model.measurements.slice().sort((a, b) => {
    const la = a.level === null ? 999 : order.get(a.level) ?? 500;
    const lb = b.level === null ? 999 : order.get(b.level) ?? 500;
    return la - lb || a.plane.localeCompare(b.plane) || a.label.localeCompare(b.label);
  });
}
