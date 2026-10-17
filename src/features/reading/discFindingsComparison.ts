import type { DiscEvaluatedRegion, DiscFinding, DiscFindingType, DiscLevel, DiscSeriesRole, RejectedDiscFinding } from "./discDegenerativeFindings";
import { DISC_FINDING_TYPES, DISC_LEVELS, labelsFor, preferredRegion, regionToViewerBase } from "./discDegenerativeFindings";

/**
 * Comparación de hallazgos discales (P10.7) entre dos estudios del mismo paciente. Lógica pura, sin React ni red.
 *
 * Qué se compara y qué no:
 * - Se empareja por nivel anatómico y tipo de clasificación, y solo si las dos definiciones son compatibles
 *   (mismo modelo y checkpoint, mismo estado de soporte y base de evaluación, mismas modalidades de entrada).
 *   Si no se puede establecer, la fila es «No comparable» y dice por qué.
 * - Un dato ausente, no evaluado, inválido o que no se pudo cargar NUNCA equivale a «Ausente». «Ausente» es una
 *   clase que el modelo evaluó y devolvió.
 * - Cambia la clasificación solo si cambia la clase. Una variación de probabilidad con la misma clase no cuenta.
 * - No hay umbrales clínicos ni de confianza, y ningún texto interpreta el cambio (mejora, empeoramiento,
 *   progresión): se informa qué clase tenía cada lado.
 */

export type ComparisonSide = "reference" | "current";

/** Lo que se sabe de los hallazgos de un lado, distinguiendo cada forma de no tenerlos. */
export type FindingsSide =
  | { status: "ready"; caseId: string; runId: string | null; findings: DiscFinding[]; rejected?: RejectedDiscFinding[] }
  /** Todavía no hay una corrida cargada que sea la de la comparación (cargando, o llegó una distinta). */
  | { status: "pending"; reason: string }
  /** La corrida no tiene hallazgos discales persistidos. */
  | { status: "no_data"; reason: string }
  /** La corrida los tiene pero no cumplen el contrato: no se muestra nada parcial. */
  | { status: "invalid"; reason: string }
  /** No se pudo cargar el estudio de ese lado. */
  | { status: "failed"; reason: string };

export type FindingComparisonStatus =
  | "unchanged"
  | "absent_to_present"
  | "present_to_absent"
  | "category_changed"
  | "not_comparable";

export const STATUS_LABEL: Record<FindingComparisonStatus, string> = {
  unchanged: "Sin cambio de clasificación",
  absent_to_present: "Ausente → Presente",
  present_to_absent: "Presente → Ausente",
  category_changed: "Cambio de grado o categoría",
  not_comparable: "No comparable",
};

export const CHANGE_STATUSES: readonly FindingComparisonStatus[] = ["absent_to_present", "present_to_absent", "category_changed"];

export type NotComparableCode =
  | "side_pending"
  | "side_no_data"
  | "side_invalid"
  | "side_failed"
  | "classification_invalid"
  | "missing_reference"
  | "missing_current"
  | "duplicate_result"
  | "model_differs"
  | "checkpoint_differs"
  | "support_status_differs"
  | "evaluation_basis_differs"
  | "input_modalities_differ";

export type FindingComparisonRow = {
  /** `nivel|tipo`: identifica la fila entre las dos corridas. */
  key: string;
  level: DiscLevel;
  findingType: DiscFindingType;
  /** Las principales (y Pfirrmann, experimental) van aparte de los resultados de investigación. */
  section: "main" | "research";
  reference: DiscFinding | null;
  current: DiscFinding | null;
  status: FindingComparisonStatus;
  reason: { code: NotComparableCode; text: string } | null;
  /** Lado cuyo resultado para esta fila no cumple el contrato: se muestra como inválido, nunca como «Ausente» ni como «Sin dato». */
  rejected: Partial<Record<ComparisonSide, string>>;
};

export type SectionCounts = { all: number; changes: number; unchanged: number; notComparable: number };

export type FindingsComparison = {
  rows: FindingComparisonRow[];
  counts: Record<"main" | "research", SectionCounts>;
  sides: Record<ComparisonSide, FindingsSide>;
  /** Resultados inválidos de los que ni el nivel ni el tipo se pudieron identificar: no caben en ninguna fila, pero se cuentan. */
  unreadable: Record<ComparisonSide, number>;
};

export type FindingsFilter = "changes" | "all" | "noncomparable";

export const FILTER_LABEL: Record<FindingsFilter, string> = {
  changes: "Cambios de clasificación",
  all: "Todos",
  noncomparable: "No comparables",
};

const SIDE_NAME: Record<ComparisonSide, string> = { reference: "La referencia", current: "El estudio actual" };
const SIDE_SHORT: Record<ComparisonSide, string> = { reference: "Referencia", current: "Actual" };
const ROLE_SHORT: Record<DiscSeriesRole, string> = { sagittal_t1: "T1", sagittal_t2: "T2" };

export function rowKeyOf(level: DiscLevel, findingType: DiscFindingType): string {
  return `${level}|${findingType}`;
}

export function sectionOf(finding: DiscFinding): "main" | "research" {
  return finding.deploymentStatus === "not_product_supported" ? "research" : "main";
}

/**
 * Los hallazgos de un lado, a partir de lo que el visor cargó. Si lo cargado no es el estudio ni la corrida que usó
 * la comparación, no se usa: una respuesta tardía de otra referencia nunca alimenta esta vista.
 */
export function sideFromSnapshot(
  loaded: { caseId: string; runId: string | null } | null,
  expected: { caseId: string; runId: string | null },
  snapshot: { findings: DiscFinding[]; rejected?: RejectedDiscFinding[]; unavailable?: string; contractError?: string } | null,
): FindingsSide {
  if (!loaded || !snapshot) return { status: "pending", reason: "El estudio de este lado todavía no está cargado." };
  if (loaded.caseId !== expected.caseId || (expected.runId && loaded.runId !== expected.runId)) {
    return { status: "pending", reason: "Lo cargado en este lado no es el estudio y la corrida de la comparación: no se usa." };
  }
  if (snapshot.contractError) return { status: "invalid", reason: snapshot.contractError };
  if (snapshot.unavailable) return { status: "no_data", reason: snapshot.unavailable };
  return { status: "ready", caseId: loaded.caseId, runId: loaded.runId, findings: snapshot.findings, rejected: snapshot.rejected ?? [] };
}

function sideReason(side: ComparisonSide, state: FindingsSide): { code: NotComparableCode; text: string } | null {
  switch (state.status) {
    case "ready": return null;
    case "pending": return { code: "side_pending", text: `${SIDE_NAME[side]} todavía no está lista: ${state.reason}` };
    case "no_data": return { code: "side_no_data", text: `${SIDE_NAME[side]} no tiene hallazgos discales persistidos. Sin datos no hay «Ausente».` };
    case "invalid": return { code: "side_invalid", text: `Los hallazgos de ${SIDE_NAME[side].toLowerCase()} no cumplen el contrato y no se muestran: ${state.reason}` };
    case "failed": return { code: "side_failed", text: `No se pudo cargar ${SIDE_NAME[side].toLowerCase()}: ${state.reason}` };
  }
}

function availableRoles(finding: DiscFinding): string {
  return finding.sources.filter((source) => source.available).map((source) => ROLE_SHORT[source.role]).sort().join("+") || "sin modalidad";
}

/** Motivo por el que dos resultados del mismo nivel y tipo no se pueden comparar, o `null` si son compatibles. */
export function incompatibility(reference: DiscFinding, current: DiscFinding): { code: NotComparableCode; text: string } | null {
  if (reference.findingType !== current.findingType) {
    return { code: "model_differs", text: "Los dos resultados no son del mismo tipo de clasificación." };
  }
  const catalog = labelsFor(reference.findingType);
  if (!catalog.includes(reference.label) || !catalog.includes(current.label)) {
    return { code: "model_differs", text: "Una de las clases no pertenece a la definición de esta clasificación." };
  }
  if (reference.modelId !== current.modelId) {
    return { code: "model_differs", text: `Modelo distinto (referencia: ${reference.modelId}; actual: ${current.modelId}).` };
  }
  if (reference.modelSha256.toLowerCase() !== current.modelSha256.toLowerCase()) {
    return { code: "checkpoint_differs", text: "Versión distinta del checkpoint del modelo: las clases no son comparables entre versiones." };
  }
  if (reference.deploymentStatus !== current.deploymentStatus) {
    return { code: "support_status_differs", text: "El estado de soporte de esta clasificación difiere entre las dos corridas." };
  }
  if (reference.evaluationDataset && current.evaluationDataset && reference.evaluationDataset !== current.evaluationDataset) {
    return { code: "evaluation_basis_differs", text: "La base de evaluación declarada difiere entre las dos corridas." };
  }
  const referenceRoles = availableRoles(reference);
  const currentRoles = availableRoles(current);
  if (referenceRoles !== currentRoles) {
    return {
      code: "input_modalities_differ",
      text: `Se calcularon con modalidades distintas (referencia: ${referenceRoles}; actual: ${currentRoles}).`,
    };
  }
  return null;
}

/** Estado de dos resultados compatibles: cambia la clase o no. La probabilidad no interviene. */
export function statusOf(reference: DiscFinding, current: DiscFinding): FindingComparisonStatus {
  if (reference.label === current.label) return "unchanged";
  const binary = labelsFor(reference.findingType).join("|") === "absent|present";
  if (binary && reference.label === "absent" && current.label === "present") return "absent_to_present";
  if (binary && reference.label === "present" && current.label === "absent") return "present_to_absent";
  return "category_changed";
}

function indexByKey(state: FindingsSide): { byKey: Map<string, DiscFinding>; duplicates: Set<string> } {
  const byKey = new Map<string, DiscFinding>();
  const duplicates = new Set<string>();
  if (state.status !== "ready") return { byKey, duplicates };
  for (const finding of state.findings) {
    const key = rowKeyOf(finding.level, finding.findingType);
    if (byKey.has(key)) duplicates.add(key);
    else byKey.set(key, finding);
  }
  return { byKey, duplicates };
}

/** Resultados inválidos de un lado, por fila. Si hay varios para la misma fila se conserva el primer motivo. */
function indexRejected(state: FindingsSide): { byKey: Map<string, RejectedDiscFinding>; unreadable: number } {
  const byKey = new Map<string, RejectedDiscFinding>();
  let unreadable = 0;
  if (state.status !== "ready") return { byKey, unreadable };
  for (const item of state.rejected ?? []) {
    if (!item.level || !item.findingType) unreadable += 1;
    else if (!byKey.has(rowKeyOf(item.level, item.findingType))) byKey.set(rowKeyOf(item.level, item.findingType), item);
  }
  return { byKey, unreadable };
}

function emptyCounts(): SectionCounts {
  return { all: 0, changes: 0, unchanged: 0, notComparable: 0 };
}

export function compareFindings(reference: FindingsSide, current: FindingsSide): FindingsComparison {
  const ref = indexByKey(reference);
  const cur = indexByKey(current);
  const refRejected = indexRejected(reference);
  const curRejected = indexRejected(current);
  const referenceBlock = sideReason("reference", reference);
  const currentBlock = sideReason("current", current);
  const rows: FindingComparisonRow[] = [];

  for (const level of DISC_LEVELS) {
    for (const findingType of DISC_FINDING_TYPES) {
      const key = rowKeyOf(level, findingType);
      const ra = refRejected.byKey.get(key) ?? null;
      const rb = curRejected.byKey.get(key) ?? null;
      // Un resultado inválido en un lado manda sobre uno válido del mismo nivel y tipo: no se elige cuál creerle.
      const a = ra ? null : ref.byKey.get(key) ?? null;
      const b = rb ? null : cur.byKey.get(key) ?? null;
      if (!a && !b && !ra && !rb) continue;
      const rejected: FindingComparisonRow["rejected"] = {};
      if (ra) rejected.reference = ra.reason;
      if (rb) rejected.current = rb.reason;
      const section = a || b
        ? sectionOf((a ?? b) as DiscFinding)
        : (ra ?? rb)?.deploymentStatus === "not_product_supported" ? "research" : "main";
      let status: FindingComparisonStatus;
      let reason: FindingComparisonRow["reason"] = null;

      if (referenceBlock || currentBlock) {
        status = "not_comparable";
        reason = referenceBlock ?? currentBlock;
      } else if (ra || rb) {
        status = "not_comparable";
        const names = [ra ? "la referencia" : null, rb ? "el estudio actual" : null].filter(Boolean).join(" y ");
        reason = {
          code: "classification_invalid",
          text: `El resultado de ${names} para este nivel y clasificación no cumple el contrato y no se compara (${(ra ?? rb)?.reason}). No se interpreta como «Ausente».`,
        };
      } else if (ref.duplicates.has(key) || cur.duplicates.has(key)) {
        status = "not_comparable";
        reason = { code: "duplicate_result", text: "Hay más de un resultado para este nivel y clasificación en una de las corridas: no se elige uno." };
      } else if (!a) {
        status = "not_comparable";
        reason = { code: "missing_reference", text: "La referencia no tiene resultado para este nivel y clasificación. La falta de dato no equivale a «Ausente»." };
      } else if (!b) {
        status = "not_comparable";
        reason = { code: "missing_current", text: "El estudio actual no tiene resultado para este nivel y clasificación. La falta de dato no equivale a «Ausente»." };
      } else {
        const conflict = incompatibility(a, b);
        if (conflict) {
          status = "not_comparable";
          reason = conflict;
        } else {
          status = statusOf(a, b);
        }
      }
      rows.push({ key, level, findingType, section, reference: a, current: b, status, reason, rejected });
    }
  }

  const counts = { main: emptyCounts(), research: emptyCounts() };
  for (const row of rows) {
    const bucket = counts[row.section];
    bucket.all += 1;
    if (row.status === "not_comparable") bucket.notComparable += 1;
    else if (row.status === "unchanged") bucket.unchanged += 1;
    else bucket.changes += 1;
  }
  return { rows, counts, sides: { reference, current }, unreadable: { reference: refRejected.unreadable, current: curRejected.unreadable } };
}

export function filterRows(rows: FindingComparisonRow[], filter: FindingsFilter): FindingComparisonRow[] {
  if (filter === "all") return rows;
  if (filter === "noncomparable") return rows.filter((row) => row.status === "not_comparable");
  return rows.filter((row) => CHANGE_STATUSES.includes(row.status));
}

/** Con cambios, se empieza por ellos; si no hay, por todos (no se esconde nada detrás de un grupo vacío). */
export function defaultFilter(comparison: FindingsComparison): FindingsFilter {
  return comparison.counts.main.changes + comparison.counts.research.changes > 0 ? "changes" : "all";
}

/**
 * Lo que se dice cuando el grupo de las clasificaciones principales queda vacío. Nunca afirma que «todo sigue igual»
 * si hay resultados que no se pudieron comparar.
 */
export function emptyGroupMessage(comparison: FindingsComparison, filter: FindingsFilter): string | null {
  const main = comparison.counts.main;
  if (comparison.rows.length === 0) return null;
  if (filter === "changes" && main.changes === 0) {
    if (main.notComparable > 0) {
      return `No hay cambios de clasificación entre los resultados comparables, pero ${main.notComparable} no se pudieron comparar: no se puede afirmar que el resto permanezca igual.`;
    }
    return "Ninguna clasificación comparable cambió de clase. Una variación de probabilidad con la misma clase no cuenta como cambio.";
  }
  if (filter === "noncomparable" && main.notComparable === 0) return "Todas las clasificaciones principales se pudieron comparar.";
  return null;
}

/** Por qué no hay nada que comparar (ningún lado tiene hallazgos), o `null` si hay filas. */
export function noRowsMessage(comparison: FindingsComparison): string | null {
  if (comparison.rows.length > 0) return null;
  const { reference, current } = comparison.sides;
  if (reference.status === "ready" && current.status === "ready") {
    const unreadable = comparison.unreadable.reference + comparison.unreadable.current;
    if (unreadable > 0) {
      return `No hay resultados que se puedan comparar: ${unreadable} no cumplen el contrato y no se pudieron identificar. No se interpreta como «Ausente».`;
    }
    return "Ninguna de las dos corridas tiene resultados de hallazgos discales para este nivel y clasificación.";
  }
  const parts = (["reference", "current"] as const).map((side) => {
    const reason = sideReason(side, comparison.sides[side]);
    return reason ? reason.text : `${SIDE_NAME[side]} tiene hallazgos persistidos.`;
  });
  return `No hay hallazgos comparables. ${parts.join(" ")} No se inventan resultados ni se interpreta la falta de datos como ausencia.`;
}

export type FindingsStep = { key: string | null; index: number; total: number; hasPrevious: boolean; hasNext: boolean };

/** Anterior/siguiente sobre las filas visibles del filtro activo. No da la vuelta: los extremos se avisan. */
export function stepRows(visible: FindingComparisonRow[], selectedKey: string | null, direction: 1 | -1): FindingsStep {
  const total = visible.length;
  const current = selectedKey ? visible.findIndex((row) => row.key === selectedKey) : -1;
  let index = current;
  if (total > 0) {
    if (current < 0) index = direction === 1 ? 0 : total - 1;
    else index = Math.min(Math.max(current + direction, 0), total - 1);
  }
  return {
    key: total > 0 ? visible[index].key : null,
    index,
    total,
    hasPrevious: current < 0 ? total > 0 : current > 0,
    hasNext: current < 0 ? total > 0 : current < total - 1,
  };
}

/* ------------------------------------------------------------------------- región evaluada por lado */

/** Lo que el visor de un lado tiene cargado, reducido a lo que hace falta para ubicar una región. */
export type SideSeriesInfo = {
  /** Serie que analizó la IA en el plano sagital, si está cargada. */
  analyzedInputId: string | null;
  analyzedTotal: number;
  /** Series del archivo del estudio que se pueden abrir en el visor. */
  archive: { inputId: string; sliceCount: number; label: string }[];
};

export type RegionTarget =
  | {
    state: "ready";
    role: DiscSeriesRole;
    inputId: string;
    sliceIndex: number;
    /** `null` es la serie analizada por la IA; si no, el `inputId` de la serie del archivo que hay que abrir. */
    viewedSeriesId: string | null;
    region: DiscEvaluatedRegion;
    seriesLabel: string;
    total: number;
  }
  | { state: "unavailable"; reason: string };

const UNAVAILABLE = "Región no disponible";

/**
 * Serie y corte donde se evaluó el resultado de un lado. Solo se usa lo que ESA corrida persistió para ESE
 * resultado: no se copian coordenadas entre estudios, no se equiparan números de corte y no se arma una región a
 * partir del nombre del nivel.
 */
export function resolveRegionTarget(finding: DiscFinding | null, series: SideSeriesInfo | null, viewedInputId?: string | null): RegionTarget {
  if (!finding) return { state: "unavailable", reason: `${UNAVAILABLE}: este lado no tiene el resultado.` };
  if (!series) return { state: "unavailable", reason: `${UNAVAILABLE}: el estudio de este lado no está cargado.` };
  const located = preferredRegion(finding, viewedInputId);
  if (!located) {
    const issue = finding.sources.map((source) => source.regionIssue).find(Boolean);
    if (issue) {
      return { state: "unavailable", reason: `${UNAVAILABLE}: la corrida guardó una región inválida (${issue}). Se conserva la clasificación sin localización.` };
    }
    return { state: "unavailable", reason: `${UNAVAILABLE}: la corrida no guardó la región evaluada de este nivel.` };
  }
  const { region, role } = located;

  let viewedSeriesId: string | null;
  let total: number;
  let seriesLabel: string;
  if (series.analyzedInputId && region.inputId === series.analyzedInputId) {
    viewedSeriesId = null;
    total = Math.max(series.analyzedTotal, 1);
    seriesLabel = "serie analizada por la IA";
  } else {
    const archive = series.archive.find((item) => item.inputId === region.inputId);
    if (!archive) {
      return { state: "unavailable", reason: `${UNAVAILABLE}: la serie en la que se evaluó este nivel no está disponible en el visor.` };
    }
    viewedSeriesId = archive.inputId;
    total = Math.max(archive.sliceCount, 1);
    seriesLabel = archive.label;
  }
  if (region.sliceIndex < 0 || region.sliceIndex >= total) {
    return { state: "unavailable", reason: `${UNAVAILABLE}: el corte ${region.sliceIndex + 1} no existe en la serie cargada (${total} cortes).` };
  }
  return { state: "ready", role, inputId: region.inputId, sliceIndex: region.sliceIndex, viewedSeriesId, region, seriesLabel, total };
}

export type PaneLocation = { plane: "sagittal" | "axial"; viewedSeriesId: string | null; slice: number };

export type RegionOverlay =
  /** Se mira exactamente la serie y el corte evaluados: se dibuja la marca. */
  | { state: "draw"; marker: { point: { x: number; y: number }; box: { x0: number; y0: number; x1: number; y1: number }; label: string } }
  /** Se conoce el lugar pero el visor está en otra serie u otro corte: se ofrece volver. */
  | { state: "elsewhere"; reason: string }
  | { state: "unavailable"; reason: string };

/** Marca exacta o motivo por el que no se dibuja. Un corte vecino se parece lo bastante como para pasar por bueno: no se acepta. */
export function resolveRegionOverlay(target: RegionTarget | null, level: DiscLevel, view: PaneLocation | null): RegionOverlay {
  if (!target) return { state: "unavailable", reason: "No hay una fila seleccionada." };
  if (target.state === "unavailable") return { state: "unavailable", reason: target.reason };
  if (!view) return { state: "unavailable", reason: "Este lado todavía no tiene imagen cargada." };
  if (view.plane !== "sagittal" || view.viewedSeriesId !== target.viewedSeriesId) {
    return { state: "elsewhere", reason: `La región evaluada está en ${target.seriesLabel}, corte ${target.sliceIndex + 1}. Esta imagen es otra.` };
  }
  if (view.slice !== target.sliceIndex) {
    return { state: "elsewhere", reason: `La región evaluada está en el corte ${target.sliceIndex + 1}; estás viendo el ${view.slice + 1}.` };
  }
  const base = regionToViewerBase(target.region);
  return { state: "draw", marker: { point: base.point, box: base.box, label: level } };
}

/** Distribución ordenada según el catálogo de la clasificación, para mostrarla igual en los dos lados. */
export function orderedDistribution(finding: DiscFinding): { label: string; value: number }[] | null {
  if (!finding.classProbabilities) return null;
  const order = labelsFor(finding.findingType);
  return order.filter((label) => finding.classProbabilities![label] !== undefined).map((label) => ({ label, value: finding.classProbabilities![label] }));
}

export const SIDE_LABEL = SIDE_SHORT;
