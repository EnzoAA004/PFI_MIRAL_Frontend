import type {
  EvidenceGeometry,
  EvidenceGeometryBbox,
  EvidenceGeometryEllipse,
  EvidenceGeometryType,
} from "../../contracts/visualEvidenceTypes";

/**
 * EXT-04B5: pure geometry-editing math for the professional annotation/correction flow —
 * kept deliberately free of React/DOM so it can be unit-tested the same way this repo already
 * tests `measurements.ts`/`studyReportApi.ts` (see `scripts/ext04b5-professional-annotations-tests.mjs`),
 * without rendering the interactive component itself. `EvidenceRegionEditor.tsx` is a thin
 * wrapper over these functions: it never recomputes a clamp or a resize itself.
 *
 * Basis: the same canonical 0..256 square every other overlay in this reading room already uses
 * (`MeasurementLayer`, `EvidenceRegionOverlay`) — never CSS pixels.
 */

export const CANONICAL_MIN = 0;
export const CANONICAL_MAX = 256;

/** Below this, a BBOX/ELLIPSE stops being something a professional could usefully grab or read. */
const MIN_SIZE = 4;

export function clampCanonical(value: number): number {
  return Math.min(CANONICAL_MAX, Math.max(CANONICAL_MIN, value));
}

/** Only BBOX and ELLIPSE are graphically editable this stage — POLYGON stays read-only (documented
 * limitation) and MASK_REFERENCE is never editable (it is a raster asset, not a vector shape). */
export function isGraphicallyEditable(geometryType: EvidenceGeometryType): boolean {
  return geometryType === "BBOX" || geometryType === "ELLIPSE";
}

/**
 * Converts a pointer event's client coordinates into the canonical 0..256 basis, given the
 * bounding rect of the image frame it was captured over. Mirrors `MriSliceViewer.tsx`'s own
 * `pointFromEvent` conversion exactly (`(clientX - rect.left) / rect.width * 256`, clamped) —
 * duplicated rather than imported because that helper is a closure over `MriSliceViewer`'s own
 * internal ref and is not exported.
 */
export function pointFromClient(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clampCanonical((clientX - rect.left) / rect.width * 256),
    y: clampCanonical((clientY - rect.top) / rect.height * 256),
  };
}

export type BboxHandle = "nw" | "ne" | "sw" | "se";

/** Whole-box translate, clamped so the box never leaves the canonical square. */
export function moveBbox(bbox: EvidenceGeometryBbox, dx: number, dy: number): EvidenceGeometryBbox {
  const x = Math.min(CANONICAL_MAX - bbox.width, Math.max(CANONICAL_MIN, bbox.x + dx));
  const y = Math.min(CANONICAL_MAX - bbox.height, Math.max(CANONICAL_MIN, bbox.y + dy));
  return { ...bbox, x, y };
}

/**
 * Resize by dragging one corner handle to `point` (already in canonical coordinates). The
 * opposite corner stays fixed. Enforces `MIN_SIZE` by preventing the dragged corner from
 * crossing past the opposite corner, and clamps to the canonical square — never negative
 * width/height, never a coordinate outside 0..256.
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

/** Move the ellipse's center to `point`, clamped so the center itself stays on the canonical square. */
export function moveEllipseCenter(ellipse: EvidenceGeometryEllipse, point: { x: number; y: number }): EvidenceGeometryEllipse {
  return { ...ellipse, centerX: clampCanonical(point.x), centerY: clampCanonical(point.y) };
}

export type EllipseAxis = "x" | "y";

/**
 * Adjust one radius by dragging its handle to `point`. The radius is the distance from the
 * (fixed) center to `point` along that axis, floored at a minimum and capped so the ellipse
 * never extends past the canonical square on that axis.
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

/** Bbox corner handle positions, for rendering the four drag handles. */
export function bboxHandlePositions(bbox: EvidenceGeometryBbox): Record<BboxHandle, { x: number; y: number }> {
  return {
    nw: { x: bbox.x, y: bbox.y },
    ne: { x: bbox.x + bbox.width, y: bbox.y },
    sw: { x: bbox.x, y: bbox.y + bbox.height },
    se: { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
  };
}

/** Shape-agnostic geometry-to-request-map conversion, mirroring what the Backend's `EvidenceGeometry.fromMap` expects. */
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
