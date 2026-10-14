import { multiplanarRequest } from "./multiplanarApi";
import type {
  ComparisonStudySide,
  ComparisonTrend,
  ComparisonValue,
  ExclusionSide,
  InitialComparisonCandidate,
  InitialComparisonCandidates,
  InitialComparisonExclusion,
  InitialComparisonResult,
  InitialComparisonRow,
  PatientLink,
  PercentStatus,
} from "./contracts/initialAnalysisComparisonTypes";

/**
 * Cliente de la comparación entre estudios sobre las mediciones REALES del análisis inicial.
 *
 * Nunca llama al módulo de IA ni dispara ningún análisis: solo lee lo que ya está guardado. El parseo es
 * estricto y falla cerrado: un campo faltante no se completa con un valor inventado (un valor ausente no
 * pasa a ser cero).
 */

export class InitialComparisonContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitialComparisonContractError";
  }
}

const SIDES: ExclusionSide[] = ["current", "reference", "both"];
const TRENDS: ComparisonTrend[] = ["increased", "decreased", "unchanged"];
const PERCENT_STATUSES: PercentStatus[] = ["ok", "not_computable_reference_zero"];
const LINKS: PatientLink[] = ["patient_id", "subject_ref_historical", "none"];

function fail(field: string): never {
  throw new InitialComparisonContractError(`Contrato de comparación inválido: falta o es inválido ${field}.`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(field);
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field);
  return value;
}

function nullableFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) fail(field);
  return value as T;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field);
  return value;
}

export function parseStudySide(value: unknown, field = "estudio"): ComparisonStudySide {
  const raw = record(value, field);
  return {
    caseId: text(raw.caseId, `${field}.caseId`),
    studyDate: nullableText(raw.studyDate),
    runId: nullableText(raw.runId),
    runCreatedAt: nullableText(raw.runCreatedAt),
    runStatus: nullableText(raw.runStatus),
    reviewStatus: nullableText(raw.reviewStatus),
    modelKey: nullableText(raw.modelKey),
    sagittalSequence: nullableText(raw.sagittalSequence),
    usableMeasurementCount: finite(raw.usableMeasurementCount, `${field}.usableMeasurementCount`),
    patientLink: oneOf(raw.patientLink, LINKS, `${field}.patientLink`),
  };
}

function parseValue(value: unknown, field: string): ComparisonValue {
  const raw = record(value, field);
  return {
    measurementId: text(raw.measurementId, `${field}.measurementId`),
    effectiveValue: finite(raw.effectiveValue, `${field}.effectiveValue`),
    originalValue: finite(raw.originalValue, `${field}.originalValue`),
    correctedValue: nullableFinite(raw.correctedValue),
    corrected: raw.corrected === true,
    sliceIndex: nullableFinite(raw.sliceIndex),
  };
}

function parseRow(value: unknown): InitialComparisonRow {
  const raw = record(value, "comparisons[]");
  const percentStatus = oneOf(raw.percentStatus, PERCENT_STATUSES, "percentStatus");
  const deltaPercent = nullableFinite(raw.deltaPercent);
  // Un porcentaje "calculable" sin número, o un número con "no calculable", es un contrato roto.
  if ((percentStatus === "ok") !== (deltaPercent !== null)) fail("deltaPercent/percentStatus");
  return {
    level: text(raw.level, "comparisons[].level"),
    structure: text(raw.structure, "comparisons[].structure"),
    metric: text(raw.metric, "comparisons[].metric"),
    plane: text(raw.plane, "comparisons[].plane"),
    unit: text(raw.unit, "comparisons[].unit"),
    experimental: raw.experimental === true,
    reference: parseValue(raw.reference, "comparisons[].reference"),
    current: parseValue(raw.current, "comparisons[].current"),
    deltaAbsolute: finite(raw.deltaAbsolute, "comparisons[].deltaAbsolute"),
    deltaPercent,
    percentStatus,
    trend: oneOf(raw.trend, TRENDS, "comparisons[].trend"),
  };
}

function parseExclusion(value: unknown): InitialComparisonExclusion {
  const raw = record(value, "excluded[]");
  return {
    side: oneOf(raw.side, SIDES, "excluded[].side"),
    level: nullableText(raw.level),
    plane: nullableText(raw.plane),
    metricKey: nullableText(raw.metricKey),
    measurementIds: array(raw.measurementIds, "excluded[].measurementIds").filter((id): id is string => typeof id === "string"),
    reasonCode: text(raw.reasonCode, "excluded[].reasonCode"),
    reason: text(raw.reason, "excluded[].reason"),
  };
}

export function parseInitialComparisonResult(value: unknown): InitialComparisonResult {
  const raw = record(value, "respuesta");
  if (raw.source !== "initial_analysis") fail("source");
  const summary = record(raw.summary, "summary");
  return {
    schemaVersion: text(raw.schemaVersion, "schemaVersion"),
    source: "initial_analysis",
    differenceDefinition: text(raw.differenceDefinition, "differenceDefinition"),
    current: parseStudySide(raw.current, "current"),
    reference: parseStudySide(raw.reference, "reference"),
    summary: {
      comparedCount: finite(summary.comparedCount, "summary.comparedCount"),
      excludedCount: finite(summary.excludedCount, "summary.excludedCount"),
      currentMeasurementCount: finite(summary.currentMeasurementCount, "summary.currentMeasurementCount"),
      referenceMeasurementCount: finite(summary.referenceMeasurementCount, "summary.referenceMeasurementCount"),
    },
    comparisons: array(raw.comparisons, "comparisons").map(parseRow),
    excluded: array(raw.excluded, "excluded").map(parseExclusion),
    limitations: array(raw.limitations, "limitations").filter((item): item is string => typeof item === "string"),
  };
}

function parseCandidate(value: unknown): InitialComparisonCandidate {
  const raw = record(value, "candidates[]");
  return {
    caseId: text(raw.caseId, "candidates[].caseId"),
    studyDate: nullableText(raw.studyDate),
    runId: nullableText(raw.runId),
    runCreatedAt: nullableText(raw.runCreatedAt),
    usableMeasurementCount: finite(raw.usableMeasurementCount, "candidates[].usableMeasurementCount"),
    eligible: raw.eligible === true,
    reasonCode: nullableText(raw.reasonCode),
    reason: nullableText(raw.reason),
    patientLink: oneOf(raw.patientLink, LINKS, "candidates[].patientLink"),
  };
}

export function parseInitialComparisonCandidates(value: unknown): InitialComparisonCandidates {
  const raw = record(value, "respuesta");
  return {
    schemaVersion: text(raw.schemaVersion, "schemaVersion"),
    current: parseStudySide(raw.current, "current"),
    candidates: array(raw.candidates, "candidates").map(parseCandidate),
    runSelectionRule: text(raw.runSelectionRule, "runSelectionRule"),
  };
}

function query(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function getInitialComparisonCandidates(
  caseId: string,
  currentRunId: string | null,
  signal?: AbortSignal,
): Promise<InitialComparisonCandidates> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/initial-analysis-comparison/candidates${query({ currentRunId })}`,
    { signal },
  );
  return parseInitialComparisonCandidates(raw);
}

export async function getInitialComparison(
  caseId: string,
  referenceCaseId: string,
  currentRunId: string | null,
  referenceRunId: string | null,
  signal?: AbortSignal,
): Promise<InitialComparisonResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/initial-analysis-comparison${query({ referenceCaseId, currentRunId, referenceRunId })}`,
    { signal },
  );
  return parseInitialComparisonResult(raw);
}
