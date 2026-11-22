import { API_BASE_URL } from "../../api";
import type { EvidenceBaseImageRef, EvidenceGeometryMaskReference, EvidenceSource, VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportPlane } from "./studyReportDisplay";

/**
 * EXT-04B3: etiquetas neutrales, no diagnósticas, para los cuatro conceptos DERIVADOS de origen/estado
 * de EXT-04B1. Nunca "patología confirmada"/"diagnóstico" — ver
 * `EXT_04B_FRONTEND_VISUAL_EVIDENCE.md` "Visual language". Un string `source` no reconocido
 * (un valor futuro del Backend que este Frontend todavía no conoce) recurre al valor crudo en lugar
 * de adivinar una etiqueta — sigue siendo neutral, nunca una redacción clínica inventada.
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
 * Una agrupación solo visual usada para el color CSS, nunca una escala de severidad. "ai" vs "professional"
 * solo distingue la procedencia para el ojo del lector (EXT-04B3 "Colores": el rojo u otros colores
 * nunca deben significar grave/patológico/peor).
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
 * Descripción compacta, pensada primero para lectores de pantalla, de una región — requisito de accesibilidad
 * de EXT-04B3 ("Región sugerida por IA — L4-L5 — plano sagital"). Nunca depende del color.
 */
export function evidenceAriaLabel(item: VisualEvidenceItem): string {
  const parts = [displayEvidenceSource(item.source), item.level ?? "sin nivel", displayReportPlane(item.plane)];
  if (item.experimental) parts.push("experimental");
  return parts.join(" — ");
}

export const NO_VISUAL_EVIDENCE_MESSAGE = "No hay evidencia visual disponible para este análisis.";

export const EXPERIMENTAL_BADGE_TEXT = "Experimental";

/**
 * El mismo endpoint de asset autenticado que ya usa el viewer multiplanar
 * (`aiAssetUrl` en `multiplanarApi.ts`, `/api/ai/assets/{runId}/{plane}/{assetName}`) —
 * duplicado acá en lugar de importado porque el parámetro `assetName` de ese helper está tipado
 * al vocabulario cerrado de assets de corrida multiplanar (`"input.png" | "overlay.png" |
 * "mask-preview.png"`), que el `assetName` de forma libre de un `MASK_REFERENCE` (pero protegido contra path traversal,
 * ver `parseEvidenceGeometry`) no necesariamente satisface. Solo se construye a partir de
 * los tres identificadores ya parseados y ya validados — nunca una URL cruda del reporte
 * JSON (EXT-04B3 "Imagen base": no aceptar URL arbitraria del JSON).
 */
export function evidenceMaskAssetUrl(geometry: EvidenceGeometryMaskReference): string {
  return `${API_BASE_URL}/api/ai/assets/${encodeURIComponent(geometry.runId)}/${geometry.plane}/${encodeURIComponent(geometry.assetName)}`;
}

export const NO_BASE_IMAGE_MESSAGE = "Imagen base no disponible.";

/**
 * EXT-04B3.5: el mismo endpoint `GET /api/ai/series/{inputId}/slices/{index}` que el viewer
 * multi-slice ya llama (`analyzedSliceSource.ts#resolveAnalyzedSliceSource`) — duplicado como una
 * plantilla de una línea acá en lugar de importado porque ese helper también codifica reglas de
 * navegación solo del viewer (saltear el índice analizado por la IA, recurrir a URLs de preview legacy) que
 * no aplican a un ítem de evidencia de un reporte. Solo se construye a partir de los dos
 * campos ya parseados de `baseImage` — nunca una URL cruda del JSON del reporte.
 */
export function evidenceBaseImageSliceUrl(baseImage: EvidenceBaseImageRef): string {
  return `${API_BASE_URL}/api/ai/series/${encodeURIComponent(baseImage.inputId)}/slices/${baseImage.sliceIndex}`;
}
