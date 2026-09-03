import { API_BASE_URL } from "../../api";
import type { EvidenceBaseImageRef, EvidenceGeometryMaskReference, EvidenceSource, VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportPlane } from "./studyReportDisplay";

/**
 * EXT-04B3: neutral, non-diagnostic labels for the four EXT-04B1 DERIVED origin/state
 * concepts. Never "patología confirmada"/"diagnóstico" — see
 * `EXT_04B_FRONTEND_VISUAL_EVIDENCE.md` "Visual language". An unrecognised `source` string
 * (future Backend value this Frontend doesn't know yet) falls back to the raw value rather
 * than guessing a label — still neutral, never invented clinical wording.
 */
const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  ai_suggested: "Región sugerida por IA",
  ai_validated: "Región revisada por profesional",
  professional_corrected: "Región corregida por profesional",
  professional_drawn: "Región creada por profesional",
};

export function displayEvidenceSource(source: string): string {
  return (EVIDENCE_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/**
 * A visual-only grouping used for CSS colour, never a severity scale. "ai" vs "professional"
 * only distinguishes provenance for the reader's eye (EXT-04B3 "Colores": red/other colours
 * must never mean grave/patológico/peor).
 */
export function evidenceVisualGroup(source: string): "ai" | "professional" {
  return source === "ai_suggested" ? "ai" : "professional";
}

export function displayEvidenceReviewStatus(status: string | null): string {
  if (status === "accepted") return "revisión: aceptada";
  if (status === "observed") return "revisión: observada";
  if (status === "rejected") return "revisión: rechazada";
  if (status === "pending" || status === null) return "revisión: pendiente";
  return `revisión: ${status}`;
}

/**
 * Compact, screen-reader-first description for one region — EXT-04B3 accessibility
 * requirement ("Región sugerida por IA — L4-L5 — plano sagital"). Never depends on colour.
 */
export function evidenceAriaLabel(item: VisualEvidenceItem): string {
  const parts = [displayEvidenceSource(item.source), item.level ?? "sin nivel", displayReportPlane(item.plane)];
  if (item.experimental) parts.push("experimental");
  return parts.join(" — ");
}

export const NO_VISUAL_EVIDENCE_MESSAGE = "No hay evidencia visual disponible para este análisis.";

export const EXPERIMENTAL_BADGE_TEXT = "Experimental";

/**
 * The same authenticated-asset endpoint the multiplanar viewer already uses
 * (`aiAssetUrl` in `multiplanarApi.ts`, `/api/ai/assets/{runId}/{plane}/{assetName}`) —
 * duplicated here rather than imported because that helper's `assetName` parameter is typed
 * to the closed multiplanar-run asset vocabulary (`"input.png" | "overlay.png" |
 * "mask-preview.png"`), which a `MASK_REFERENCE`'s free-form (but path-traversal-guarded,
 * see `parseEvidenceGeometry`) `assetName` does not necessarily satisfy. Only ever built from
 * the three already-parsed, already-validated identifiers — never a raw URL from the report
 * JSON (EXT-04B3 "Imagen base": no aceptar URL arbitraria del JSON).
 */
export function evidenceMaskAssetUrl(geometry: EvidenceGeometryMaskReference): string {
  return `${API_BASE_URL}/api/ai/assets/${encodeURIComponent(geometry.runId)}/${geometry.plane}/${encodeURIComponent(geometry.assetName)}`;
}

export const NO_BASE_IMAGE_MESSAGE = "Imagen base no disponible.";

/**
 * EXT-04B3.5: the same `GET /api/ai/series/{inputId}/slices/{index}` endpoint the multi-slice
 * viewer already calls (`analyzedSliceSource.ts#resolveAnalyzedSliceSource`) — duplicated as a
 * one-line template here rather than imported because that helper also encodes viewer-only
 * navigation rules (skipping the AI-analyzed index, falling back to legacy preview URLs) that
 * do not apply to a report evidence item. Only ever built from `baseImage`'s two already-parsed
 * fields — never a raw URL from the report JSON.
 */
export function evidenceBaseImageSliceUrl(baseImage: EvidenceBaseImageRef): string {
  return `${API_BASE_URL}/api/ai/series/${encodeURIComponent(baseImage.inputId)}/slices/${baseImage.sliceIndex}`;
}
