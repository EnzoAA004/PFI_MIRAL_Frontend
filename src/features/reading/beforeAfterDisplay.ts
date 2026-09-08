import type { StudyReport, StudyReportLongitudinalHistory } from "../../contracts/studyReportTypes";
import type { VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportMetric, displayReportPlane, formatReportDelta, formatReportPercent, formatReportValue, reportCorrectedMarker } from "./studyReportDisplay";

export const BEFORE_AFTER_TITLE = "Comparación con estudio previo";
export const NO_BEFORE_AFTER_MESSAGE = "No existen estudios previos comparables disponibles.";

export type BeforeAfterRow = StudyReportLongitudinalHistory["comparisons"][number];

/**
 * EXT-07B: at most the first N rows — same cap the existing "Evolución" table already applies
 * (`studyReport.longitudinalHistory.comparisons.slice(0, 8)`), so this section never duplicates
 * work the report already limits deliberately.
 */
export function beforeAfterRows(history: StudyReportLongitudinalHistory | null, limit = 4): BeforeAfterRow[] {
  return (history?.comparisons ?? []).slice(0, limit);
}

/**
 * Best-effort match between a longitudinal comparison row and a `visualEvidence[]` item from
 * the corresponding report — by level/plane/structure, the only fields both shapes share. `null`
 * when no evidence item lines up; the caller renders a numeric-only card in that case, never a
 * guessed image.
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

/** Whether the current study's own report has any usable comparison row at all. */
export function hasBeforeAfter(report: StudyReport | null): boolean {
  return beforeAfterRows(report?.longitudinalHistory ?? null).length > 0;
}
