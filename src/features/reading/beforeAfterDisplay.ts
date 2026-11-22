import type { StudyReport, StudyReportLongitudinalHistory } from "../../contracts/studyReportTypes";
import type { VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportMetric, displayReportPlane, formatReportDelta, formatReportPercent, formatReportValue, reportCorrectedMarker } from "./studyReportDisplay";

export const BEFORE_AFTER_TITLE = "Comparación con estudio previo";
export const NO_BEFORE_AFTER_MESSAGE = "No existen estudios previos comparables disponibles.";

export type BeforeAfterRow = StudyReportLongitudinalHistory["comparisons"][number];

/**
 * EXT-07B: como máximo las primeras N filas — el mismo tope que ya aplica la tabla "Evolución" existente
 * (`studyReport.longitudinalHistory.comparisons.slice(0, 8)`), de modo que esta sección nunca duplica
 * un trabajo que el reporte ya limita deliberadamente.
 */
export function beforeAfterRows(history: StudyReportLongitudinalHistory | null, limit = 4): BeforeAfterRow[] {
  return (history?.comparisons ?? []).slice(0, limit);
}

/**
 * Emparejamiento best-effort entre una fila de comparación longitudinal y un ítem de `visualEvidence[]` del
 * reporte correspondiente — por nivel/plano/estructura, los únicos campos que comparten ambas formas. `null`
 * cuando ningún ítem de evidencia coincide; en ese caso quien llama renderiza una tarjeta solo numérica, nunca una
 * imagen adivinada.
 */
export function matchingEvidence(row: BeforeAfterRow, evidence: VisualEvidenceItem[]): VisualEvidenceItem | null {
  return evidence.find((item) => item.level === row.level && item.plane === row.plane && item.structure === row.structure) ?? null;
}

export function beforeAfterRowLabel(row: BeforeAfterRow): string {
  return `${row.level ?? "Sin nivel"} · ${displayReportPlane(row.plane)} · ${row.structure ?? "estructura"} · ${displayReportMetric(row.metric)}`;
}

export function beforeAfterValueLine(value: number | null, unit: string, source: string | null): string {
  const marker = reportCorrectedMarker(source);
  return `${formatReportValue(value, unit)}${marker ? ` (${marker})` : ""}`;
}

export function beforeAfterDeltaLine(row: BeforeAfterRow): string {
  return `${formatReportDelta(row.absoluteDelta, row.unit)} · ${formatReportPercent(row.percentageDelta)}`;
}

/** Si el propio reporte del estudio actual tiene alguna fila de comparación utilizable en absoluto. */
export function hasBeforeAfter(report: StudyReport | null): boolean {
  return beforeAfterRows(report?.longitudinalHistory ?? null).length > 0;
}
