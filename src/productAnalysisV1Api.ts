import { multiplanarRequest } from "./multiplanarApi";
import type {
  ProductAnalysisCorrectionRequest,
  ProductAnalysisDiscLevel,
  ProductAnalysisHistory,
  ProductAnalysisMeasurement,
  ProductAnalysisMeasurementCorrection,
  ProductAnalysisResult,
  ProductAnalysisReview,
  ProductAnalysisReviewRequest,
  ProductAnalysisStartRequest,
  ProductAnalysisStatus,
} from "./contracts/productAnalysisV1Types";

/**
 * Cliente para `POST/GET/PATCH /api/studies/{caseId}/product-analys(is|es)` (Backend Post-E50,
 * etapas 75/76/78). Nunca envía `sagittalInputId`/`axialInputId` — el Backend los resuelve
 * internamente desde el Study — y nunca llama a FastAPI directamente: siempre pasa por
 * `multiplanarRequest`, que habla exclusivamente con Spring Boot.
 */

export class ProductAnalysisV1ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductAnalysisV1ContractError";
  }
}

const STATUSES: ProductAnalysisStatus[] = ["completed", "partial", "failed"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductAnalysisV1ContractError(`Contrato de análisis de producto inválido: falta ${field}.`);
  }
  return value;
}

/** Nullable por contrato — nunca se reemplaza por un placeholder. */
function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProductAnalysisV1ContractError(`Contrato de análisis de producto inválido: ${field} no es un número válido.`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ProductAnalysisV1ContractError(`Contrato de análisis de producto inválido: ${field} no es booleano.`);
  }
  return value;
}

function requiredStatus(value: unknown): ProductAnalysisStatus {
  if (typeof value === "string" && (STATUSES as string[]).includes(value)) {
    return value as ProductAnalysisStatus;
  }
  throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: status desconocido.");
}

function parseCorrection(value: unknown): ProductAnalysisMeasurementCorrection {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: correction mal formada.");
  return {
    field: requiredText(raw.field, "corrections[].field") as ProductAnalysisMeasurementCorrection["field"],
    originalValue: nullableNumber(raw.originalValue),
    correctedValue: requiredNumber(raw.correctedValue, "corrections[].correctedValue"),
    unit: requiredText(raw.unit, "corrections[].unit"),
    comment: nullableText(raw.comment),
    reviewedBy: nullableText(raw.reviewedBy),
    createdAt: requiredText(raw.createdAt, "corrections[].createdAt"),
  };
}

function parseMeasurement(value: unknown): ProductAnalysisMeasurement {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: measurement mal formado.");
  return {
    measurementId: requiredText(raw.measurementId, "measurements[].measurementId"),
    plane: nullableText(raw.plane),
    level: nullableText(raw.level),
    structure: requiredText(raw.structure, "measurements[].structure"),
    areaMm2: nullableNumber(raw.areaMm2),
    majorAxisMm: nullableNumber(raw.majorAxisMm),
    minorAxisMm: nullableNumber(raw.minorAxisMm),
    reviewRequired: requiredBoolean(raw.reviewRequired, "measurements[].reviewRequired"),
    corrections: asArray(raw.corrections).map(parseCorrection),
  };
}

function parseReview(value: unknown): ProductAnalysisReview {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: falta review.");
  return {
    required: requiredBoolean(raw.required, "review.required"),
    status: requiredText(raw.status, "review.status"),
    comment: nullableText(raw.comment),
    reviewedBy: nullableText(raw.reviewedBy),
    reviewedAt: nullableText(raw.reviewedAt),
  };
}

function parseDiscLevel(value: unknown): ProductAnalysisDiscLevel {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: discLevel mal formado.");
  return {
    discLevelId: requiredText(raw.discLevelId, "discLevels[].discLevelId"),
    level: nullableText(raw.level),
    localizationStatus: nullableText(raw.localizationStatus),
    localizationValidated: requiredBoolean(raw.localizationValidated, "discLevels[].localizationValidated"),
    abstentionPreserved: requiredBoolean(raw.abstentionPreserved, "discLevels[].abstentionPreserved"),
    axialPairingStatus: nullableText(raw.axialPairingStatus),
    axialPairingValidated: requiredBoolean(raw.axialPairingValidated, "discLevels[].axialPairingValidated"),
    axialPairingExperimental: requiredBoolean(raw.axialPairingExperimental, "discLevels[].axialPairingExperimental"),
    axialPairingReviewRequired: requiredBoolean(raw.axialPairingReviewRequired, "discLevels[].axialPairingReviewRequired"),
    degenerativeFindingsStatus: nullableText(raw.degenerativeFindingsStatus),
    automaticInferenceEnabled: requiredBoolean(raw.automaticInferenceEnabled, "discLevels[].automaticInferenceEnabled"),
    measurements: asArray(raw.measurements).map(parseMeasurement),
    review: parseReview(raw.review),
  };
}

/** Parseo estricto, fail-closed: un campo de seguridad faltante nunca se completa con un default. */
export function parseProductAnalysisResult(value: unknown): ProductAnalysisResult {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: respuesta vacía.");
  return {
    analysisRunId: requiredText(raw.analysisRunId, "analysisRunId"),
    studyId: requiredText(raw.studyId, "studyId"),
    caseId: requiredText(raw.caseId, "caseId"),
    status: requiredStatus(raw.status),
    warnings: asArray(raw.warnings).filter((item): item is string => typeof item === "string"),
    discLevels: asArray(raw.discLevels).map(parseDiscLevel),
    review: parseReview(raw.review),
    humanReviewRequired: requiredBoolean(raw.humanReviewRequired, "humanReviewRequired"),
    notClinicalDiagnosis: requiredBoolean(raw.notClinicalDiagnosis, "notClinicalDiagnosis"),
    autonomousDiagnosis: requiredBoolean(raw.autonomousDiagnosis, "autonomousDiagnosis"),
    createdAt: requiredText(raw.createdAt, "createdAt"),
    completedAt: nullableText(raw.completedAt),
  };
}

export function parseProductAnalysisHistory(value: unknown): ProductAnalysisHistory {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de historial de análisis inválido: respuesta vacía.");
  return {
    caseId: requiredText(raw.caseId, "caseId"),
    analyses: asArray(raw.analyses).map(parseProductAnalysisResult),
  };
}

/**
 * El body público nunca incluye `sagittalInputId`/`axialInputId` — el Backend los resuelve
 * internamente desde el Study (stage 76-M). Sólo `metadata`, y sólo si el llamador la pasó.
 */
export function buildStartRequestBody(request?: ProductAnalysisStartRequest): Record<string, unknown> {
  return request?.metadata ? { metadata: request.metadata } : {};
}

export async function startProductAnalysis(caseId: string, request?: ProductAnalysisStartRequest): Promise<ProductAnalysisResult> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(caseId)}/product-analysis`, {
    method: "POST",
    body: JSON.stringify(buildStartRequestBody(request)),
  });
  return parseProductAnalysisResult(raw);
}

export async function getProductAnalyses(caseId: string): Promise<ProductAnalysisHistory> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(caseId)}/product-analyses`);
  return parseProductAnalysisHistory(raw);
}

export async function getProductAnalysis(caseId: string, analysisId: string): Promise<ProductAnalysisResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/product-analyses/${encodeURIComponent(analysisId)}`,
  );
  return parseProductAnalysisResult(raw);
}

/** Nunca incluye reviewedBy — el Backend lo deriva del principal autenticado, nunca de este body. */
export function buildReviewRequestBody(request: ProductAnalysisReviewRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { status: request.status };
  if (request.comment) body.comment = request.comment;
  return body;
}

/** Stage 78-B: acepta/observa/rechaza la corrida completa. */
export async function reviewProductAnalysisRun(caseId: string, analysisId: string, request: ProductAnalysisReviewRequest): Promise<ProductAnalysisResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/product-analyses/${encodeURIComponent(analysisId)}/review`,
    { method: "PATCH", body: JSON.stringify(buildReviewRequestBody(request)) },
  );
  return parseProductAnalysisResult(raw);
}

/** Stage 78-C: acepta/observa/rechaza un nivel discal puntual, sin afectar la revisión de la corrida. */
export async function reviewProductAnalysisDiscLevel(
  caseId: string,
  analysisId: string,
  discLevelId: string,
  request: ProductAnalysisReviewRequest,
): Promise<ProductAnalysisResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/product-analyses/${encodeURIComponent(analysisId)}/disc-levels/${encodeURIComponent(discLevelId)}/review`,
    { method: "PATCH", body: JSON.stringify(buildReviewRequestBody(request)) },
  );
  return parseProductAnalysisResult(raw);
}

/** Nunca incluye `unit` — el Backend la deriva de `field`, nunca de este body. */
export function buildCorrectionRequestBody(request: ProductAnalysisCorrectionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { field: request.field, correctedValue: request.correctedValue };
  if (request.comment) body.comment = request.comment;
  return body;
}

/** Stage 78-D: agrega una corrección; el valor original de la IA nunca se sobrescribe. */
export async function correctProductAnalysisMeasurement(
  caseId: string,
  analysisId: string,
  measurementId: string,
  request: ProductAnalysisCorrectionRequest,
): Promise<ProductAnalysisResult> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/product-analyses/${encodeURIComponent(analysisId)}/measurements/${encodeURIComponent(measurementId)}/corrections`,
    { method: "POST", body: JSON.stringify(buildCorrectionRequestBody(request)) },
  );
  return parseProductAnalysisResult(raw);
}
