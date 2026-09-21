import { multiplanarRequest } from "./multiplanarApi";
import { fetchSubjectHistory } from "./subjectHistoryApi";
import type {
  ComparisonStatus,
  ComparisonTrend,
  LongitudinalComparisonResult,
  LongitudinalEffectiveValue,
  LongitudinalMeasurementComparison,
} from "./contracts/longitudinalComparisonTypes";

/**
 * Cliente para `GET /api/studies/{caseId}/longitudinal-comparison` (Backend Post-E50, stage 79).
 * Nunca llama a FastAPI — la comparación es puro cálculo Backend/DB sobre datos ya persistidos
 * (etapas 76/78) — y nunca calcula el delta en el Frontend: siempre confía en el valor que
 * devuelve el Backend, para que exista una única fuente de verdad determinística.
 */

export class LongitudinalComparisonContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongitudinalComparisonContractError";
  }
}

const COMPARISON_STATUSES: ComparisonStatus[] = ["comparable", "missing_baseline", "missing_current", "level_unresolved", "unit_mismatch"];
const TRENDS: ComparisonTrend[] = ["increased", "decreased", "unchanged"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LongitudinalComparisonContractError(`Contrato de comparación longitudinal inválido: falta ${field}.`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEffectiveValue(value: unknown): LongitudinalEffectiveValue | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    automaticValue: nullableNumber(raw.automaticValue),
    correctedValue: nullableNumber(raw.correctedValue),
    effectiveValue: nullableNumber(raw.effectiveValue),
    source: requiredText(raw.source, "baseline/current.source"),
  };
}

function parseComparisonStatus(value: unknown): ComparisonStatus {
  if (typeof value === "string" && (COMPARISON_STATUSES as string[]).includes(value)) return value as ComparisonStatus;
  throw new LongitudinalComparisonContractError("Contrato de comparación longitudinal inválido: comparisonStatus desconocido.");
}

function parseTrend(value: unknown): ComparisonTrend | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && (TRENDS as string[]).includes(value)) return value as ComparisonTrend;
  throw new LongitudinalComparisonContractError("Contrato de comparación longitudinal inválido: trend desconocido.");
}

function parseMeasurementComparison(value: unknown): LongitudinalMeasurementComparison {
  const raw = asRecord(value);
  if (!raw) throw new LongitudinalComparisonContractError("Contrato de comparación longitudinal inválido: measurement mal formado.");
  return {
    level: nullableText(raw.level),
    plane: nullableText(raw.plane),
    structure: requiredText(raw.structure, "measurements[].structure"),
    metric: requiredText(raw.metric, "measurements[].metric"),
    unit: requiredText(raw.unit, "measurements[].unit"),
    baseline: parseEffectiveValue(raw.baseline),
    current: parseEffectiveValue(raw.current),
    deltaAbsolute: nullableNumber(raw.deltaAbsolute),
    deltaPercent: nullableNumber(raw.deltaPercent),
    trend: parseTrend(raw.trend),
    comparisonStatus: parseComparisonStatus(raw.comparisonStatus),
  };
}

/** Parseo estricto, fail-closed — un campo faltante nunca se completa con un default inventado. */
export function parseLongitudinalComparisonResult(value: unknown): LongitudinalComparisonResult {
  const raw = asRecord(value);
  if (!raw) throw new LongitudinalComparisonContractError("Contrato de comparación longitudinal inválido: respuesta vacía.");
  return {
    baselineCaseId: requiredText(raw.baselineCaseId, "baselineCaseId"),
    currentCaseId: requiredText(raw.currentCaseId, "currentCaseId"),
    baselineStudyId: requiredText(raw.baselineStudyId, "baselineStudyId"),
    currentStudyId: requiredText(raw.currentStudyId, "currentStudyId"),
    baselineAnalysisRunId: requiredText(raw.baselineAnalysisRunId, "baselineAnalysisRunId"),
    currentAnalysisRunId: requiredText(raw.currentAnalysisRunId, "currentAnalysisRunId"),
    baselineStudyDate: nullableText(raw.baselineStudyDate),
    currentStudyDate: nullableText(raw.currentStudyDate),
    generatedAt: requiredText(raw.generatedAt, "generatedAt"),
    measurements: asArray(raw.measurements).map(parseMeasurementComparison),
  };
}

export async function getLongitudinalComparison(currentCaseId: string, baselineCaseId: string): Promise<LongitudinalComparisonResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(currentCaseId)}/longitudinal-comparison?baselineCaseId=${encodeURIComponent(baselineCaseId)}`,
  );
  return parseLongitudinalComparisonResult(raw);
}

export type ComparableStudy = {
  caseId: string;
  studyDate: string | null;
};

/**
 * Stage 79-W/79-U: candidatos de baseline — otros Studies del mismo paciente, excluyendo el
 * estudio actual. Reutiliza `fetchSubjectHistory` (ya validado/testeado en
 * `scripts/p8e2-subject-history-tests.mjs`) en vez de inventar un segundo endpoint de listado;
 * el orden que ya trae el Backend (más reciente primero) se preserva tal cual.
 */
export async function getComparableStudies(subjectRef: string, excludeCaseId: string): Promise<ComparableStudy[]> {
  const history = await fetchSubjectHistory(subjectRef);
  return history.studies
    .filter((study) => study.caseId !== excludeCaseId)
    .map((study) => ({ caseId: study.caseId, studyDate: study.studyDate ?? null }));
}
