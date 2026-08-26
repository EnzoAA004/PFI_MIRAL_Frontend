import type { StudyReportMeasurement } from "../../contracts/studyReportTypes";

export const REPORT_SAFETY_TEXT = "Salida revisable: no constituye diagnóstico clínico autónomo.";

export function displayReportStatus(status: string): string {
  if (status === "ready") return "Listo para revisión";
  if (status === "no_effective_analysis") return "Sin análisis utilizable";
  return status;
}

export function displayReportMetric(metric: string): string {
  if (metric === "areaMm2") return "Área";
  if (metric === "majorAxisMm") return "Eje mayor";
  if (metric === "minorAxisMm") return "Eje menor";
  return metric;
}

export function displayReportPlane(plane: string | null): string {
  if (plane === "sagittal") return "Sagital";
  if (plane === "axial") return "Axial";
  return "No informado";
}

export function formatReportValue(value: number | null, unit: string): string {
  if (value === null) return "No disponible";
  return `${value.toFixed(unit === "mm²" ? 1 : 2)} ${unit}`;
}

export function reportMeasurementLine(measurement: StudyReportMeasurement): string {
  const reviewed = measurement.correctedValue !== null
    ? `IA ${formatReportValue(measurement.automaticValue, measurement.unit)} → Revisor ${formatReportValue(measurement.correctedValue, measurement.unit)}`
    : `IA ${formatReportValue(measurement.automaticValue, measurement.unit)}`;
  return `${measurement.level ?? "Sin nivel"} · ${displayReportPlane(measurement.plane)} · ${measurement.structure ?? "estructura"} · ${displayReportMetric(measurement.metric)} · ${reviewed}`;
}
