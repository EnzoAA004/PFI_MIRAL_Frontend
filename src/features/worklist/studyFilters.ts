import type { Priority, ReviewStatus, StudyRow } from "../../appTypes";
import { displayModality, displayReviewStatus } from "../../clinicalDisplay";
import { displayPrimaryPlane, displayStudyDate, displaySubjectRef } from "../../studyDisplay";

/**
 * Worklist filtering, kept pure so it can be tested without React.
 *
 * Replaces the two byte-identical `matchesQuery` implementations that lived in
 * StudiesView and DashboardView, and the `mode: "all" | "queue"` flag that made
 * the same screen render under three different routes.
 *
 * Los cinco chips excluyentes (Pendientes / Observados / Prioridad alta /
 * Finalizados / Total) se volvieron cinco filtros independientes: el chip podía
 * responder "los pendientes" o "los de prioridad alta", nunca "los pendientes de
 * prioridad alta de este paciente", que es la pregunta con la que un médico
 * abre la lista. Los contadores que vivían en el chip no se perdieron: están en
 * las opciones del filtro de estado.
 */

export const ANY = "todos";

export type DateRangeId = "todos" | "7d" | "30d" | "90d";

export type WorklistFilters = {
  /** `todos` o una referencia de paciente exacta. */
  subjectRef: string;
  dateRange: DateRangeId;
  /** `todos` o un `ReviewStatus`. */
  reviewStatus: string;
  /** `todos` o una `Priority`. */
  priority: string;
  /** `todos` o el valor de modalidad tal como lo transporta el contrato. */
  modality: string;
};

export const EMPTY_FILTERS: WorklistFilters = {
  subjectRef: ANY,
  dateRange: ANY,
  reviewStatus: ANY,
  priority: ANY,
  modality: ANY,
};

export const DATE_RANGES: Array<{ id: DateRangeId; label: string; days: number | null }> = [
  { id: "todos", label: "Cualquier fecha", days: null },
  { id: "7d", label: "Últimos 7 días", days: 7 },
  { id: "30d", label: "Últimos 30 días", days: 30 },
  { id: "90d", label: "Últimos 90 días", days: 90 },
];

export const REVIEW_STATUS_OPTIONS: ReviewStatus[] = ["pendiente", "observado", "aceptado", "descartado"];
export const PRIORITY_OPTIONS: Priority[] = ["alta", "media", "baja"];

export function activeFilterCount(filters: WorklistFilters) {
  return Object.values(filters).filter((value) => value !== ANY).length;
}

/**
 * Un estudio sin fecha no se oculta mientras no se pida un rango: la fecha es
 * un dato del archivo DICOM y falta en estudios reales. Pero si el médico pide
 * "últimos 7 días", un estudio sin fecha no puede afirmarse dentro del rango,
 * así que queda fuera.
 */
function matchesDateRange(study: StudyRow, dateRange: DateRangeId, now: number) {
  const range = DATE_RANGES.find((item) => item.id === dateRange);
  if (!range || range.days === null) return true;
  const parsed = Date.parse(study.studyDate ?? "");
  if (!Number.isFinite(parsed)) return false;
  return parsed >= now - range.days * 24 * 60 * 60 * 1000;
}

export function matchesFilters(study: StudyRow, filters: WorklistFilters, now: number = Date.now()) {
  if (filters.subjectRef !== ANY && (study.subjectRef ?? "") !== filters.subjectRef) return false;
  if (filters.reviewStatus !== ANY && study.reviewStatus !== filters.reviewStatus) return false;
  if (filters.priority !== ANY && study.priority !== filters.priority) return false;
  if (filters.modality !== ANY && (study.modality ?? "") !== filters.modality) return false;
  return matchesDateRange(study, filters.dateRange, now);
}

export function matchesQuery(study: StudyRow, query: string) {
  if (!query.trim()) return true;
  const normalized = query.trim().toLowerCase();
  return [
    study.caseId,
    displaySubjectRef(study.subjectRef),
    displayPrimaryPlane(study.primaryPlane),
    displayStudyDate(study.studyDate),
    study.modality,
    displayModality(study.modality),
    study.modelStatus,
    study.reviewStatus,
    displayReviewStatus(study.reviewStatus),
    study.priority,
    study.description,
  ].some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

export function filterStudies(studies: StudyRow[], filters: WorklistFilters, query: string, now: number = Date.now()) {
  return studies.filter((study) => matchesFilters(study, filters, now) && matchesQuery(study, query));
}

/** Valores presentes en los datos, no un catálogo fijo: un filtro que ofrece una opción sin filas miente. */
export function subjectOptions(studies: StudyRow[]) {
  return [...new Set(studies.map((study) => study.subjectRef ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function modalityOptions(studies: StudyRow[]) {
  return [...new Set(studies.map((study) => study.modality ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Cuántas filas quedarían al elegir cada estado, con el resto de los filtros y
 * la búsqueda ya aplicados. Se ignora el filtro de estado vigente a propósito:
 * si contara sobre sí mismo, todas las opciones menos la elegida dirían 0.
 */
export function countsByReviewStatus(
  studies: StudyRow[],
  filters: WorklistFilters,
  query: string,
  now: number = Date.now(),
): Record<ReviewStatus, number> {
  const scoped = filterStudies(studies, { ...filters, reviewStatus: ANY }, query, now);
  return REVIEW_STATUS_OPTIONS.reduce((counts, status) => {
    counts[status] = scoped.filter((study) => study.reviewStatus === status).length;
    return counts;
  }, {} as Record<ReviewStatus, number>);
}
