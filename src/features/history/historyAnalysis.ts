import type { PatientStudy, Plane } from "../../appTypes";

/**
 * Estado del análisis inicial de un estudio según la corrida REAL (la que alimenta el visor), no el circuito de
 * demostración (`productAnalysis`).
 *
 * Distingue cuatro estados que en pantalla no deben confundirse:
 *  - none: el estudio no tiene corrida;
 *  - running: hay una corrida en curso;
 *  - failed: la corrida terminó con error;
 *  - available: hay resultados.
 * `unknown` cubre un estado que el backend informó pero esta pantalla no conoce: se dice tal cual, sin asumir.
 */

export type HistoryAnalysisState = "none" | "running" | "failed" | "available" | "unknown";

export type HistoryAnalysis = {
  state: HistoryAnalysisState;
  label: string;
  runId: string | null;
  createdAt: string | null;
  /** Mediciones de ESA corrida, o null si el contrato no las informa (nunca 0 por ausencia de dato). */
  measurementCount: number | null;
  correctedMeasurementCount: number | null;
};

const RUNNING = new Set(["created", "queued", "pending", "running", "processing", "in_progress", "started"]);
const FAILED = new Set(["failed", "error", "errored", "cancelled", "canceled", "timeout"]);

const STATE_LABEL: Record<HistoryAnalysisState, string> = {
  none: "Sin análisis",
  running: "Análisis en curso",
  failed: "Análisis fallido",
  available: "Resultados disponibles",
  unknown: "Estado del análisis no informado",
};

function countFromMeasurements(study: PatientStudy): number | null {
  const byPlane = study.measurementsByPlane;
  if (!byPlane) return null;
  const total = (["sagittal", "axial"] as Plane[]).reduce((sum, plane) => sum + (byPlane[plane]?.length ?? 0), 0);
  return total > 0 ? total : null;
}

export function analysisOf(study: PatientStudy): HistoryAnalysis {
  const run = study.latestRun;
  if (!run) {
    // Respuesta anterior del backend (sin `latestRun`): si hay corrida, el estudio tiene resultados; el conteo sale de lo recibido.
    if (study.latestRunId) {
      return { state: "available", label: STATE_LABEL.available, runId: study.latestRunId, createdAt: null, measurementCount: countFromMeasurements(study), correctedMeasurementCount: study.corrections ? new Set(study.corrections.map((c) => c.measurementId)).size : null };
    }
    return { state: "none", label: STATE_LABEL.none, runId: null, createdAt: null, measurementCount: null, correctedMeasurementCount: null };
  }
  const status = run.status.trim().toLowerCase();
  const state: HistoryAnalysisState = status === "completed" || status === "complete" || status === "succeeded" ? "available" : RUNNING.has(status) ? "running" : FAILED.has(status) ? "failed" : "unknown";
  return {
    state,
    label: STATE_LABEL[state],
    runId: run.runId,
    createdAt: run.createdAt ?? null,
    measurementCount: state === "available" ? run.measurementCount : null,
    correctedMeasurementCount: state === "available" ? run.correctedMeasurementCount : null,
  };
}

/** Cantidad de estudios con resultados disponibles, para el encabezado («X de N»); no suma mediciones de corridas distintas. */
export function studiesWithResults(studies: PatientStudy[]): number {
  return studies.filter((study) => analysisOf(study).state === "available").length;
}

/** Fecha y hora con el formato de la interfaz (es-AR), o null si falta o es inválida. */
export function formatDateTime(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

/** Identificador de corrida abreviado para mostrar («multi-…778187»). */
export function shortRunId(runId: string | null | undefined): string {
  if (!runId) return "No informada";
  return runId.length > 14 ? `${runId.slice(0, 6)}…${runId.slice(-6)}` : runId;
}

export function measurementCountLabel(analysis: HistoryAnalysis): string | null {
  if (analysis.state !== "available") return null;
  if (analysis.measurementCount === null) return "Mediciones: no informadas";
  const base = `${analysis.measurementCount} ${analysis.measurementCount === 1 ? "medición" : "mediciones"}`;
  const corrected = analysis.correctedMeasurementCount;
  return corrected ? `${base} · ${corrected} ${corrected === 1 ? "corregida" : "corregidas"}` : base;
}
