import type { ReviewStatusResponse, StudyArchiveSeries, StudyRun } from "../../appTypes";

/**
 * Datos del panel «Estudio seleccionado» que salen de la fuente real.
 *
 * El revisor y la fecha de la revisión viven en la corrida (`runs[0]`), que es lo que guarda «Guardar borrador» y
 * «Finalizar»; el objeto `review` del detalle pertenece a otro circuito y llega vacío. Un dato que falta se dice
 * como «No informado»: nunca se convierte en 0 ni en «sin revisiones» cuando la revisión existe.
 */

const NOT_REPORTED = "No informado";

export function reviewerFact(run: Pick<StudyRun, "reviewer"> | undefined, review: ReviewStatusResponse | undefined, finalized: boolean): string {
  const name = run?.reviewer?.trim() || review?.reviewer?.trim();
  if (name) return name;
  return finalized ? NOT_REPORTED : "Sin revisor asignado";
}

export function formatReviewDate(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function lastReviewFact(run: Pick<StudyRun, "reviewedAt"> | undefined, review: ReviewStatusResponse | undefined, finalized: boolean): string {
  const formatted = formatReviewDate(run?.reviewedAt) ?? formatReviewDate(review?.reviewedAt);
  if (formatted) return formatted;
  return finalized ? NOT_REPORTED : "Sin revisiones";
}

/**
 * Cortes de una serie. El catálogo de series de estudios anteriores puede traer 0 porque no los registraba: en ese caso se
 * usa la cantidad que la corrida guardó para ese plano; si tampoco existe, se dice que no está informada.
 */
export function sliceCountFact(series: Pick<StudyArchiveSeries, "plane" | "sliceCount">, run: Pick<StudyRun, "metricsSnapshot"> | undefined): string {
  if (series.sliceCount > 0) return `${series.sliceCount} ${series.sliceCount === 1 ? "corte" : "cortes"}`;
  const fromRun = runSliceCount(run, series.plane);
  if (fromRun !== null) return `${fromRun} ${fromRun === 1 ? "corte" : "cortes"}`;
  return "Cortes no informados";
}

export function runSliceCount(run: Pick<StudyRun, "metricsSnapshot"> | undefined, plane: string): number | null {
  const planes = (run?.metricsSnapshot as { planes?: Record<string, { input?: { sliceCount?: unknown } }> } | undefined)?.planes;
  const value = planes?.[plane]?.input?.sliceCount;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
