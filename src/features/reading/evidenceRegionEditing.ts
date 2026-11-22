import type {
  EvidenceGeometry,
  EvidenceGeometryBbox,
  EvidenceGeometryEllipse,
  EvidenceGeometryType,
} from "../../contracts/visualEvidenceTypes";

/**
 * EXT-04B5: matemática pura de edición de geometría para el flujo de anotación/corrección profesional —
 * mantenida deliberadamente libre de React/DOM para poder testearla de forma unitaria igual que este repo ya
 * testea `measurements.ts`/`studyReportApi.ts` (ver `scripts/ext04b5-professional-annotations-tests.mjs`),
 * sin renderizar el componente interactivo en sí. `EvidenceRegionEditor.tsx` es un wrapper delgado
 * sobre estas funciones: nunca recalcula por sí mismo un clamp ni un resize.
 *
 * Base: el mismo cuadrado canónico 0..256 que ya usa todo otro overlay de esta sala de lectura
 * (`MeasurementLayer`, `EvidenceRegionOverlay`) — nunca píxeles CSS.
 */

export const CANONICAL_MIN = 0;
export const CANONICAL_MAX = 256;

/** Por debajo de esto, un BBOX/ELLIPSE deja de ser algo que un profesional pueda agarrar o leer con utilidad. */
const MIN_SIZE = 4;

export function clampCanonical(value: number): number {
  return Math.min(CANONICAL_MAX, Math.max(CANONICAL_MIN, value));
}

/** Solo BBOX y ELLIPSE son editables gráficamente en esta etapa — POLYGON queda de solo lectura (limitación
 * documentada) y MASK_REFERENCE nunca es editable (es un asset raster, no una forma vectorial). */
export function isGraphicallyEditable(geometryType: EvidenceGeometryType): boolean {
  return geometryType === "BBOX" || geometryType === "ELLIPSE";
}

/**
 * Convierte las coordenadas de cliente de un pointer event a la base canónica 0..256, dada la
 * bounding rect del marco de imagen sobre el que se capturó. Replica exactamente la conversión
 * `pointFromEvent` propia de `MriSliceViewer.tsx` (`(clientX - rect.left) / rect.width * 256`, con clamp) —
 * duplicada en lugar de importada porque ese helper es un closure sobre el
 * ref interno propio de `MriSliceViewer` y no se exporta.
 */
export function pointFromClient(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clampCanonical((clientX - rect.left) / rect.width * 256),
    y: clampCanonical((clientY - rect.top) / rect.height * 256),
  };
}

export type BboxHandle = "nw" | "ne" | "sw" | "se";

/** Traslación de la caja completa, con clamp para que la caja nunca salga del cuadrado canónico. */
export function moveBbox(bbox: EvidenceGeometryBbox, dx: number, dy: number): EvidenceGeometryBbox {
  const x = Math.min(CANONICAL_MAX - bbox.width, Math.max(CANONICAL_MIN, bbox.x + dx));
  const y = Math.min(CANONICAL_MAX - bbox.height, Math.max(CANONICAL_MIN, bbox.y + dy));
  return { ...bbox, x, y };
}

/**
 * Redimensiona arrastrando un handle de esquina a `point` (ya en coordenadas canónicas). La
 * esquina opuesta queda fija. Aplica `MIN_SIZE` impidiendo que la esquina arrastrada
 * cruce más allá de la esquina opuesta, y hace clamp al cuadrado canónico — nunca
 * ancho/alto negativos, nunca una coordenada fuera de 0..256.
 */
export function resizeBboxHandle(bbox: EvidenceGeometryBbox, handle: BboxHandle, point: { x: number; y: number }): EvidenceGeometryBbox {
  const left = bbox.x;
  const top = bbox.y;
  const right = bbox.x + bbox.width;
  const bottom = bbox.y + bbox.height;
  const px = clampCanonical(point.x);
  const py = clampCanonical(point.y);

  let newLeft = left;
  let newTop = top;
  let newRight = right;
  let newBottom = bottom;

  if (handle === "nw") { newLeft = Math.min(px, right - MIN_SIZE); newTop = Math.min(py, bottom - MIN_SIZE); }
  if (handle === "ne") { newRight = Math.max(px, left + MIN_SIZE); newTop = Math.min(py, bottom - MIN_SIZE); }
  if (handle === "sw") { newLeft = Math.min(px, right - MIN_SIZE); newBottom = Math.max(py, top + MIN_SIZE); }
  if (handle === "se") { newRight = Math.max(px, left + MIN_SIZE); newBottom = Math.max(py, top + MIN_SIZE); }

  newLeft = clampCanonical(newLeft);
  newTop = clampCanonical(newTop);
  newRight = clampCanonical(newRight);
  newBottom = clampCanonical(newBottom);

  return { type: "BBOX", x: newLeft, y: newTop, width: Math.max(MIN_SIZE, newRight - newLeft), height: Math.max(MIN_SIZE, newBottom - newTop) };
}

/** Mueve el centro de la elipse a `point`, con clamp para que el propio centro permanezca en el cuadrado canónico. */
export function moveEllipseCenter(ellipse: EvidenceGeometryEllipse, point: { x: number; y: number }): EvidenceGeometryEllipse {
  return { ...ellipse, centerX: clampCanonical(point.x), centerY: clampCanonical(point.y) };
}

export type EllipseAxis = "x" | "y";

/**
 * Ajusta un radio arrastrando su handle a `point`. El radio es la distancia desde el
 * centro (fijo) hasta `point` a lo largo de ese eje, con un mínimo como piso y un tope para que la elipse
 * nunca se extienda más allá del cuadrado canónico en ese eje.
 */
export function resizeEllipseRadius(ellipse: EvidenceGeometryEllipse, axis: EllipseAxis, point: { x: number; y: number }): EvidenceGeometryEllipse {
  const MIN_RADIUS = 2;
  if (axis === "x") {
    const maxRadius = Math.min(ellipse.centerX - CANONICAL_MIN, CANONICAL_MAX - ellipse.centerX);
    const radiusX = Math.min(Math.max(MIN_RADIUS, Math.abs(point.x - ellipse.centerX)), Math.max(MIN_RADIUS, maxRadius));
    return { ...ellipse, radiusX };
  }
  const maxRadius = Math.min(ellipse.centerY - CANONICAL_MIN, CANONICAL_MAX - ellipse.centerY);
  const radiusY = Math.min(Math.max(MIN_RADIUS, Math.abs(point.y - ellipse.centerY)), Math.max(MIN_RADIUS, maxRadius));
  return { ...ellipse, radiusY };
}

/** Posiciones de los handles de esquina del bbox, para renderizar los cuatro handles de arrastre. */
export function bboxHandlePositions(bbox: EvidenceGeometryBbox): Record<BboxHandle, { x: number; y: number }> {
  return {
    nw: { x: bbox.x, y: bbox.y },
    ne: { x: bbox.x + bbox.width, y: bbox.y },
    sw: { x: bbox.x, y: bbox.y + bbox.height },
    se: { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
  };
}

/** Conversión de geometría a mapa de request independiente de la forma, replicando lo que espera el `EvidenceGeometry.fromMap` del Backend. */
export function geometryToRequestMap(geometry: EvidenceGeometry): Record<string, unknown> {
  if (geometry.type === "BBOX") return { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  if (geometry.type === "ELLIPSE") return { centerX: geometry.centerX, centerY: geometry.centerY, radiusX: geometry.radiusX, radiusY: geometry.radiusY };
  if (geometry.type === "POLYGON") return { points: geometry.points };
  return { runId: geometry.runId, plane: geometry.plane, assetName: geometry.assetName };
}

export function defaultBbox(): EvidenceGeometryBbox {
  return { type: "BBOX", x: 108, y: 108, width: 40, height: 40 };
}

export function defaultEllipse(): EvidenceGeometryEllipse {
  return { type: "ELLIPSE", centerX: 128, centerY: 128, radiusX: 20, radiusY: 20 };
}
