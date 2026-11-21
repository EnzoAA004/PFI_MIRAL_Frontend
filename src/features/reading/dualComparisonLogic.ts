import type { ComparisonSideState } from "./useComparisonSide";
import type {
  ComparisonLocation,
  ComparisonValue,
  GeometryPoint,
  InitialComparisonRow,
} from "../../contracts/initialAnalysisComparisonTypes";

/**
 * Lógica pura del visor de comparación: qué filas se ven, cuál está seleccionada y qué se dibuja sobre cada
 * imagen. No sabe de React ni de la red, así que se prueba sola.
 *
 * Reglas que acá se sostienen:
 * - Un filtro solo oculta filas en pantalla; no cambia ningún resultado del Backend.
 * - La magnitud se compara sin redondear y por métrica, nunca con un umbral común a mm, mm² y grados.
 * - Solo se dibuja un trazo cuando la serie, el plano y el corte que se miran son los de la medición.
 *   Un número de corte igual en el otro estudio no prueba equivalencia anatómica y no se usa.
 */

export type Side = "reference" | "current";

export function rowKey(row: Pick<InitialComparisonRow, "level" | "structure" | "metric" | "plane">): string {
  return `${row.level}|${row.structure}|${row.metric}|${row.plane}`;
}

/** Una métrica es una estructura más una magnitud: cada una tiene su propia unidad y su propio umbral. */
export function metricKeyOf(row: Pick<InitialComparisonRow, "structure" | "metric">): string {
  return `${row.structure}.${row.metric}`;
}

export type DifferenceFilter = {
  /** Oculta las filas cuya diferencia es exactamente cero. */
  onlyNonZero: boolean;
  /** Magnitud mínima por métrica, en la unidad de esa métrica. Ausente = sin umbral. */
  minMagnitude: Record<string, number>;
};

export const NO_FILTER: DifferenceFilter = { onlyNonZero: false, minMagnitude: {} };

export function isFilterActive(filter: DifferenceFilter): boolean {
  return filter.onlyNonZero || Object.keys(filter.minMagnitude).length > 0;
}

/**
 * Pasa el filtro si la diferencia sin redondear cumple las dos condiciones. El mínimo es inclusivo: una
 * diferencia exactamente igual al umbral se muestra.
 */
export function passesFilter(row: InitialComparisonRow, filter: DifferenceFilter): boolean {
  const magnitude = Math.abs(row.deltaAbsolute);
  if (filter.onlyNonZero && magnitude === 0) return false;
  const minimum = filter.minMagnitude[metricKeyOf(row)];
  if (minimum !== undefined && magnitude < minimum) return false;
  return true;
}

export type FilteredRows = { visible: InitialComparisonRow[]; hiddenCount: number };

export function applyFilter(rows: InitialComparisonRow[], filter: DifferenceFilter): FilteredRows {
  const visible = rows.filter((row) => passesFilter(row, filter));
  return { visible, hiddenCount: rows.length - visible.length };
}

/** Texto del campo de umbral a número. Acepta coma decimal; vacío o inválido = sin umbral. */
export function parseMinimum(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function setMinimum(filter: DifferenceFilter, metricKey: string, minimum: number | null): DifferenceFilter {
  const minMagnitude = { ...filter.minMagnitude };
  if (minimum === null || minimum <= 0) delete minMagnitude[metricKey];
  else minMagnitude[metricKey] = minimum;
  return { ...filter, minMagnitude };
}

/** Las métricas presentes en la comparación, con su unidad, para ofrecer un umbral a cada una. */
export function metricsOf(rows: InitialComparisonRow[]): { key: string; structure: string; metric: string; unit: string }[] {
  const seen = new Map<string, { key: string; structure: string; metric: string; unit: string }>();
  for (const row of rows) {
    const key = metricKeyOf(row);
    if (!seen.has(key)) seen.set(key, { key, structure: row.structure, metric: row.metric, unit: row.unit });
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------------------------ recorrido */

export type Step = { key: string | null; index: number; total: number; hasPrevious: boolean; hasNext: boolean };

/**
 * Anterior/siguiente sobre las filas del filtro activo. Si no hay selección (o quedó fuera del filtro),
 * "siguiente" va a la primera y "anterior" a la última. No da la vuelta: los extremos se avisan.
 */
export function stepFrom(visible: InitialComparisonRow[], selectedKey: string | null, direction: 1 | -1): Step {
  const total = visible.length;
  const current = selectedKey ? visible.findIndex((row) => rowKey(row) === selectedKey) : -1;
  let index = current;
  if (total > 0) {
    if (current < 0) index = direction === 1 ? 0 : total - 1;
    else index = Math.min(Math.max(current + direction, 0), total - 1);
  }
  return {
    key: total > 0 ? rowKey(visible[index]) : null,
    index,
    total,
    hasPrevious: current < 0 ? total > 0 : current > 0,
    hasNext: current < 0 ? total > 0 : current < total - 1,
  };
}

/* ------------------------------------------------------------------------- qué se dibuja en cada lado */

/** Lo que el visor de un lado está mostrando ahora. */
export type PaneView = {
  /** Serie de la que sale la imagen: `null` es la que analizó la IA en ese plano. */
  viewedSeriesId: string | null;
  plane: "sagittal" | "axial";
  slice: number;
  /** Datos de la serie analizada de ese plano, para saber si coincide con la medición. */
  analyzed: { inputId: string | null; planeRunId: string | null; total: number } | null;
};

export type OverlayFigure = {
  kind: "distance" | "angle";
  points: GeometryPoint[];
  /** De dónde salen los puntos: la IA, o un trazo que el revisor guardó. */
  geometry: "ai" | "reviewer";
};

export type SideOverlay =
  /** Hay un trazo y se está mirando exactamente la imagen sobre la que se midió. */
  | { state: "draw"; figure: OverlayFigure }
  /** Se conoce el lugar pero no se está mirando: ofrecer volver. */
  | { state: "elsewhere"; reason: string; canReturn: boolean }
  /** No se puede dibujar nada, y se dice por qué. */
  | { state: "unavailable"; reason: string; code: "no_location" | "slice_only" | "not_located" | "no_series" };

const PLANE_NAME: Record<string, string> = { sagittal: "sagital", axial: "axial" };

export function planeLabel(plane: string): string {
  return PLANE_NAME[plane] ?? plane;
}

/** El trazo vigente: el del revisor si guardó uno propio, y si no el de la IA. Nunca uno recalculado. */
export function effectiveGeometry(location: ComparisonLocation): { points: GeometryPoint[]; geometry: "ai" | "reviewer" } {
  if (location.correctedGeometry.length > 0) return { points: location.correctedGeometry, geometry: "reviewer" };
  return { points: location.geometry, geometry: "ai" };
}

/**
 * Corte y serie a los que hay que ir para ver la medición, o el motivo por el que no se puede.
 * El índice se valida contra la cantidad de cortes de la serie analizada de ese lado.
 */
export type Destination =
  | { ok: true; plane: "sagittal" | "axial"; slice: number }
  | { ok: false; reason: string };

export function destinationFor(value: ComparisonValue, analyzedByPlane: Record<string, { inputId: string | null; planeRunId: string | null; total: number } | null>): Destination {
  const location = value.location;
  if (!location) return { ok: false, reason: "El Backend no informó dónde está esta medición." };
  if (location.status === "not_located" || location.sliceIndex === null) {
    return { ok: false, reason: location.reason ?? "La corrida no guardó el corte de esta medición." };
  }
  if (location.plane !== "sagittal" && location.plane !== "axial") {
    return { ok: false, reason: `Plano sin visor disponible (${location.plane || "sin plano"}).` };
  }
  const analyzed = analyzedByPlane[location.plane];
  if (!analyzed) return { ok: false, reason: `Este estudio no tiene cargada la serie ${planeLabel(location.plane)} que analizó la IA.` };
  // La serie que se abre tiene que ser la misma que la corrida usó: si no coincide no se sabe sobre qué imagen está.
  if (location.inputId && analyzed.inputId && location.inputId !== analyzed.inputId) {
    return { ok: false, reason: "La serie que muestra el visor no es la que usó la corrida para esta medición." };
  }
  if (location.planeRunId && analyzed.planeRunId && location.planeRunId !== analyzed.planeRunId) {
    return { ok: false, reason: "La corrida del visor no es la que produjo esta medición." };
  }
  if (location.sliceIndex < 0 || location.sliceIndex >= analyzed.total) {
    return { ok: false, reason: `El corte ${location.sliceIndex + 1} no existe en la serie cargada (${analyzed.total} cortes).` };
  }
  return { ok: true, plane: location.plane, slice: location.sliceIndex };
}

export function resolveSideOverlay(value: ComparisonValue | null, view: PaneView | null): SideOverlay {
  if (!value) return { state: "unavailable", reason: "No hay una diferencia seleccionada.", code: "no_location" };
  const location = value.location;
  if (!location) return { state: "unavailable", reason: "El Backend no informó dónde está esta medición.", code: "no_location" };
  if (location.status === "not_located" || location.sliceIndex === null) {
    return { state: "unavailable", reason: location.reason ?? "La corrida no guardó el corte de esta medición.", code: "not_located" };
  }
  if (location.status === "slice_only" || location.geometryKind === "none" || location.geometry.length === 0) {
    return {
      state: "unavailable",
      reason: location.reason ?? "La medición no tiene un trazo guardado: se conoce el corte, no el trazo.",
      code: "slice_only",
    };
  }
  if (!view) return { state: "unavailable", reason: "Este lado todavía no tiene imagen cargada.", code: "no_series" };

  const onAnalyzed = view.viewedSeriesId === null && view.analyzed !== null;
  const samePlane = view.plane === location.plane;
  const sameSlice = view.slice === location.sliceIndex;
  const sameSeries = !location.inputId || !view.analyzed?.inputId || location.inputId === view.analyzed.inputId;
  const sameRun = !location.planeRunId || !view.analyzed?.planeRunId || location.planeRunId === view.analyzed.planeRunId;
  if (!onAnalyzed || !samePlane || !sameSeries || !sameRun) {
    return {
      state: "elsewhere",
      reason: `La medición está en el plano ${planeLabel(location.plane)}, serie analizada por la IA, corte ${location.sliceIndex + 1}. Esta imagen es otra.`,
      canReturn: true,
    };
  }
  if (!sameSlice) {
    return {
      state: "elsewhere",
      reason: `La medición está en el corte ${location.sliceIndex + 1}; estás viendo el ${view.slice + 1}.`,
      canReturn: true,
    };
  }
  const { points, geometry } = effectiveGeometry(location);
  return { state: "draw", figure: { kind: location.geometryKind === "angle" ? "angle" : "distance", points, geometry } };
}

/**
 * Lo que hay que mostrar en un lado: primero se verifica que la medición se pueda abrir en la serie cargada
 * (existe el corte, la serie y la corrida coinciden) y recién después se decide si se dibuja. Así nunca se ofrece
 * "volver a la medición" hacia un corte al que no se puede ir.
 */
export function resolveOverlay(
  value: ComparisonValue | null,
  view: PaneView | null,
  analyzedByPlane: Record<string, { inputId: string | null; planeRunId: string | null; total: number } | null>,
): SideOverlay {
  const location = value?.location;
  if (value && location && location.status === "located" && view) {
    const destination = destinationFor(value, analyzedByPlane);
    if (!destination.ok) return { state: "unavailable", reason: destination.reason, code: "not_located" };
  }
  return resolveSideOverlay(value, view);
}

/** Texto corto de la ubicación disponible de un lado, para la fila de la lista. */
export function locationBadge(value: ComparisonValue): { text: string; available: boolean } {
  const location = value.location;
  if (!location) return { text: "sin ubicación", available: false };
  if (location.status === "located") return { text: `corte ${(location.sliceIndex ?? 0) + 1}`, available: true };
  if (location.status === "slice_only") return { text: `corte ${(location.sliceIndex ?? 0) + 1} · sin trazo`, available: false };
  return { text: "sin ubicación", available: false };
}

/* ------------------------------------------------------------------------- estado de cada visor */

export type PaneState = {
  plane: "sagittal" | "axial";
  /** `null` es la serie que analizó la IA en ese plano. */
  viewedSeriesId: string | null;
  /** `null` hasta que el usuario o una selección elija un corte: mientras tanto rige el de la IA. */
  slice: number | null;
};

export function clamp(index: number, total: number) {
  return Math.min(Math.max(index, 0), Math.max(0, total - 1));
}

/** Corte efectivo y, de ese corte, la serie analizada si es la que se mira. Pura, para poder probarla. */
export function paneViewOf(state: PaneState, sideState: ComparisonSideState): PaneView | null {
  if (sideState.status !== "ready") return null;
  const analyzed = sideState.data.analyzed[state.plane];
  const archive = state.viewedSeriesId ? sideState.data.archiveSeries.find((item) => item.inputId === state.viewedSeriesId) : null;
  if (state.viewedSeriesId && !archive) return null;
  const total = archive ? Math.max(archive.sliceCount, 1) : Math.max(analyzed?.sliceCount ?? 1, 1);
  const aiIndex = clamp(analyzed?.selectedSlice ?? 0, total);
  return {
    viewedSeriesId: state.viewedSeriesId,
    plane: state.plane,
    slice: clamp(state.slice ?? (archive ? 0 : aiIndex), total),
    analyzed: analyzed
      ? { inputId: analyzed.sourceInputId ?? null, planeRunId: sideState.data.workspaces[state.plane].planeRunId, total: Math.max(analyzed.sliceCount ?? 1, 1) }
      : null,
  };
}

/** La corrida cargada tiene que ser la de la comparación; si no, se informa y no se muestra otra en silencio. */
export function checkExpectedRun(data: { caseId: string; runId: string | null }, expectedRunId: string | null): string | null {
  if (expectedRunId && data.runId !== expectedRunId) {
    return `El estudio ${data.caseId} se abriría con la corrida ${data.runId ?? "(sin identificar)"} y la comparación usó la ${expectedRunId}. No se muestra otra corrida en su lugar.`;
  }
  return null;
}
