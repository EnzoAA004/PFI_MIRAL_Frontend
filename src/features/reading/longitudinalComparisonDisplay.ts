/**
 * Presentación pura para la comparación longitudinal Post-E50 (stage 79). Ninguna función de acá
 * calcula un delta ni reinterpreta un valor — sólo formatea lo que el Backend ya calculó
 * determinísticamente. Nunca usar semántica de color clínico (verde=mejora/rojo=empeora, 79-S) ni
 * lenguaje de diagnóstico/evolución — sólo flechas y el signo del número.
 */

import type { ComparisonStatus } from "../../contracts/longitudinalComparisonTypes";

export const METRIC_LABELS: Record<string, string> = {
  areaMm2: "Área",
  majorAxisMm: "Eje mayor",
  minorAxisMm: "Eje menor",
};

export function displayMetricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

/** El valor crudo nunca se toca — esto sólo elige cuántos decimales mostrar. */
export function formatComparisonValue(value: number | null, unit: string): string {
  if (value === null) return "—";
  return `${value.toFixed(2)} ${unit}`;
}

export function formatDeltaAbsolute(deltaAbsolute: number | null, unit: string): string {
  if (deltaAbsolute === null) return "—";
  const sign = deltaAbsolute > 0 ? "+" : deltaAbsolute < 0 ? "" : "±";
  return `${sign}${deltaAbsolute.toFixed(2)} ${unit}`;
}

export function formatDeltaPercent(deltaPercent: number | null): string {
  if (deltaPercent === null) return "—";
  const sign = deltaPercent > 0 ? "+" : deltaPercent < 0 ? "" : "±";
  return `${sign}${deltaPercent.toFixed(2)} %`;
}

/**
 * Sólo una flecha, nunca un color clínico (79-S: "NO usar automáticamente verde=mejora,
 * rojo=empeora"). `unchanged` no lleva flecha.
 */
export function trendArrow(trend: "increased" | "decreased" | "unchanged" | null): string {
  if (trend === "increased") return "↑";
  if (trend === "decreased") return "↓";
  return "";
}

const COMPARISON_STATUS_TEXT: Record<ComparisonStatus, string> = {
  comparable: "Comparable.",
  missing_baseline: "No disponible en el estudio de referencia.",
  missing_current: "No disponible en el estudio actual.",
  level_unresolved: "Nivel no asignado automáticamente — no se compara con otro nivel sin asignar.",
  unit_mismatch: "Unidades incompatibles entre estudios.",
};

export function displayComparisonStatus(status: ComparisonStatus): string {
  return COMPARISON_STATUS_TEXT[status] ?? "Estado de comparación no reconocido.";
}

export const NO_BASELINE_STUDY_TEXT = "No hay otro estudio disponible para comparar.";
export const NO_COMPARABLE_MEASUREMENTS_TEXT = "No hay mediciones comparables entre estos estudios.";
export const NO_USABLE_ANALYSIS_TEXT = "No hay un análisis utilizable para uno de los estudios.";

export const LONGITUDINAL_DISCLAIMER = "Comparación técnica automática entre estudios. No constituye una interpretación de evolución clínica.";

export function displayCorrectedNote(source: string): string | null {
  return source === "professional_correction" ? "Valor revisado" : null;
}
