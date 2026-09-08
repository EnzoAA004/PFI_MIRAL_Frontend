/**
 * EXT-04B3: types for `StudyReportDto.VisualEvidenceSummary` (Backend EXT-04B2,
 * `extensions/ext-04-visual-evidence-backend` @ 37bc4c1). Field names and the geometry map
 * shapes below are copied from the real Java records
 * (`ar.edu.uade.pfi.backend.dto.StudyReportDto.VisualEvidenceSummary`,
 * `ar.edu.uade.pfi.backend.domain.EvidenceGeometry`) — not the EXT-04B1 design draft, which
 * used different names in places (e.g. the DTO's `source="ai_validated"` for what
 * `DerivedEvidenceOrigin` calls `PROFESSIONAL_VALIDATED`).
 *
 * `geometry` is always already in the canonical normalised 0..256 basis
 * (`EvidenceCoordinateNormalizer`/`EvidenceGeometry.CANONICAL_MIN/MAX`) — the same basis
 * `ReviewerAnnotation`/`MeasurementLayer` already render in. This module never re-derives that
 * conversion; see `evidenceRegionOverlayDisplay.ts` for the render-time mapping.
 */

export const EVIDENCE_GEOMETRY_TYPES = ["BBOX", "ELLIPSE", "POLYGON", "MASK_REFERENCE"] as const;
export type EvidenceGeometryType = (typeof EVIDENCE_GEOMETRY_TYPES)[number];

export type EvidenceGeometryPoint = { x: number; y: number };

export type EvidenceGeometryBbox = { type: "BBOX"; x: number; y: number; width: number; height: number };
export type EvidenceGeometryEllipse = { type: "ELLIPSE"; centerX: number; centerY: number; radiusX: number; radiusY: number };
export type EvidenceGeometryPolygon = { type: "POLYGON"; points: EvidenceGeometryPoint[] };
/**
 * Never carries pixel data inline — only a pointer to an already-authenticated asset served by
 * the existing `/api/ai/assets/{runId}/{plane}/{assetName}` endpoint (see
 * `EvidenceGeometry.MaskReference`'s own path-traversal guard on the Backend). This module
 * never accepts a raw URL for this geometry — only these three identifiers, resolved through
 * `evidenceMaskAssetUrl` in `evidenceRegionOverlayDisplay.ts`.
 */
export type EvidenceGeometryMaskReference = { type: "MASK_REFERENCE"; runId: string; plane: "sagittal" | "axial"; assetName: string };

/**
 * A closed union mirroring the Backend's `sealed interface EvidenceGeometry`. A geometry whose
 * `geometryType` is not one of the four known shapes, or whose map is missing required fields,
 * never becomes one of these variants — see `parseEvidenceGeometry` (fail-safe: that single
 * region is dropped, never the rest of the report).
 */
export type EvidenceGeometry =
  | EvidenceGeometryBbox
  | EvidenceGeometryEllipse
  | EvidenceGeometryPolygon
  | EvidenceGeometryMaskReference;

/**
 * The four EXT-04B1 DERIVED concepts, exactly as `StudyReportService.toVisualEvidenceSummary`
 * emits them — this is a display union, never re-encoded as an independent state machine on
 * the Frontend (mirrors `DerivedEvidenceOrigin` on the Backend, one-to-one).
 */
export const EVIDENCE_SOURCES = ["ai_suggested", "ai_validated", "professional_corrected", "professional_drawn"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * One item of `StudyReportDto.visualEvidence`. Deliberately does NOT include `modelId`,
 * `modelSha256`, `pipelineVersion`, or `confidence` — the real DTO does not serialize them
 * (only the domain-level `AiEvidenceRegion` carries that provenance; the report-facing summary
 * omits it). Modeling fields the wire contract does not send would be inventing an
 * unverified capability — see `EXT_04B_FRONTEND_VISUAL_EVIDENCE.md` "Limitations".
 */
/**
 * EXT-04B3.5: how to fetch a real base slice image for a region — additive on the Backend
 * (`StudyReportDto.BaseImageRef`), resolved through the already-existing, already-tested
 * `GET /api/ai/series/{inputId}/slices/{index}` endpoint (Stage 87/89), never a new asset
 * mechanism. `inputId` is the same opaque per-upload identifier `AiProductAnalysisRun.
 * sagittalInputId`/`axialInputId` already exposes elsewhere — never a filesystem path.
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
   * Nullable — absent for a pre-EXT-04B3.5 report, or when the Backend itself could not resolve
   * one (see `StudyReportService.baseImageRef`'s own fail-safe). Never fabricated on this side:
   * a missing `baseImage` renders the "Imagen base no disponible." fallback, not a guess.
   */
  baseImage: EvidenceBaseImageRef | null;
};
