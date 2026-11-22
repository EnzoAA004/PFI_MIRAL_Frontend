/**
 * EXT-04B3: tipos para `StudyReportDto.VisualEvidenceSummary` (Backend EXT-04B2,
 * `extensions/ext-04-visual-evidence-backend` @ 37bc4c1). Los nombres de campos y las formas de los mapas de geometría
 * de abajo se copian de los records Java reales
 * (`ar.edu.uade.pfi.backend.dto.StudyReportDto.VisualEvidenceSummary`,
 * `ar.edu.uade.pfi.backend.domain.EvidenceGeometry`) — no del borrador de diseño de EXT-04B1, que
 * usaba nombres distintos en algunos lugares (p. ej. el `source="ai_validated"` del DTO para lo que
 * `DerivedEvidenceOrigin` llama `PROFESSIONAL_VALIDATED`).
 *
 * `geometry` siempre está ya en la base normalizada canónica 0..256
 * (`EvidenceCoordinateNormalizer`/`EvidenceGeometry.CANONICAL_MIN/MAX`) — la misma base en la que
 * `ReviewerAnnotation`/`MeasurementLayer` ya renderizan. Este módulo nunca vuelve a derivar esa
 * conversión; ver `evidenceRegionOverlayDisplay.ts` para el mapeo en tiempo de renderizado.
 */

export const EVIDENCE_GEOMETRY_TYPES = ["BBOX", "ELLIPSE", "POLYGON", "MASK_REFERENCE"] as const;
export type EvidenceGeometryType = (typeof EVIDENCE_GEOMETRY_TYPES)[number];

export type EvidenceGeometryPoint = { x: number; y: number };

export type EvidenceGeometryBbox = { type: "BBOX"; x: number; y: number; width: number; height: number };
export type EvidenceGeometryEllipse = { type: "ELLIPSE"; centerX: number; centerY: number; radiusX: number; radiusY: number };
export type EvidenceGeometryPolygon = { type: "POLYGON"; points: EvidenceGeometryPoint[] };
/**
 * Nunca lleva datos de píxeles inline — solo un puntero a un asset ya autenticado servido por
 * el endpoint existente `/api/ai/assets/{runId}/{plane}/{assetName}` (ver el propio guard contra path traversal de
 * `EvidenceGeometry.MaskReference` en el Backend). Este módulo
 * nunca acepta una URL cruda para esta geometría — solo estos tres identificadores, resueltos mediante
 * `evidenceMaskAssetUrl` en `evidenceRegionOverlayDisplay.ts`.
 */
export type EvidenceGeometryMaskReference = { type: "MASK_REFERENCE"; runId: string; plane: "sagittal" | "axial"; assetName: string };

/**
 * Una unión cerrada que replica la `sealed interface EvidenceGeometry` del Backend. Una geometría cuyo
 * `geometryType` no es una de las cuatro formas conocidas, o cuyo mapa carece de campos requeridos,
 * nunca se convierte en una de estas variantes — ver `parseEvidenceGeometry` (fail-safe: esa única
 * región se descarta, nunca el resto del reporte).
 */
export type EvidenceGeometry =
  | EvidenceGeometryBbox
  | EvidenceGeometryEllipse
  | EvidenceGeometryPolygon
  | EvidenceGeometryMaskReference;

/**
 * Los cuatro conceptos DERIVADOS de EXT-04B1, exactamente como los emite `StudyReportService.toVisualEvidenceSummary`
 * — esta es una unión de visualización, nunca recodificada como una máquina de estados independiente en
 * el Frontend (replica `DerivedEvidenceOrigin` del Backend, uno a uno).
 */
export const EVIDENCE_SOURCES = ["ai_suggested", "ai_validated", "professional_corrected", "professional_drawn"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * Un ítem de `StudyReportDto.visualEvidence`. Deliberadamente NO incluye `modelId`,
 * `modelSha256`, `pipelineVersion` ni `confidence` — el DTO real no los serializa
 * (solo el `AiEvidenceRegion` a nivel de dominio lleva esa procedencia; el resumen orientado al reporte
 * la omite). Modelar campos que el contrato wire no envía sería inventar una
 * capacidad no verificada — ver "Limitations" en `EXT_04B_FRONTEND_VISUAL_EVIDENCE.md`.
 */
/**
 * EXT-04B3.5: cómo obtener una imagen de slice base real para una región — aditivo en el Backend
 * (`StudyReportDto.BaseImageRef`), resuelto mediante el endpoint ya existente y ya testeado
 * `GET /api/ai/series/{inputId}/slices/{index}` (Stage 87/89), nunca un nuevo
 * mecanismo de assets. `inputId` es el mismo identificador opaco por upload que `AiProductAnalysisRun.
 * sagittalInputId`/`axialInputId` ya expone en otros lugares — nunca un path del filesystem.
 */
export type EvidenceBaseImageRef = { inputId: string; sliceIndex: number };

export type VisualEvidenceItem = {
  evidenceId: string;
  plane: "sagittal" | "axial" | null;
  level: string | null;
  structure: string | null;
  geometry: EvidenceGeometry;
  source: EvidenceSource | string;
  reviewStatus: string | null;
  label: string;
  warning: string | null;
  experimental: boolean;
  /**
   * Admite null — ausente en un reporte previo a EXT-04B3.5, o cuando el propio Backend no pudo resolver
   * una (ver el fail-safe propio de `StudyReportService.baseImageRef`). Nunca se fabrica de este lado:
   * un `baseImage` faltante renderiza el fallback "Imagen base no disponible.", no una conjetura.
   */
  baseImage: EvidenceBaseImageRef | null;
};
