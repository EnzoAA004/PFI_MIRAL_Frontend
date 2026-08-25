import { multiplanarRequest } from "./multiplanarApi";
import type {
  ProductAnalysisDiscLevel,
  ProductAnalysisHistory,
  ProductAnalysisMeasurement,
  ProductAnalysisResult,
  ProductAnalysisReview,
  ProductAnalysisStartRequest,
  ProductAnalysisStatus,
} from "./contracts/productAnalysisV1Types";

/**
 * Cliente para `POST/GET /api/studies/{caseId}/product-analys(is|es)` (Backend Post-E50, etapas
 * 75/76). Nunca envía `sagittalInputId`/`axialInputId` — el Backend los resuelve internamente
 * desde el Study — y nunca llama a FastAPI directamente: siempre pasa por `multiplanarRequest`,
 * que habla exclusivamente con Spring Boot.
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

function parseMeasurement(value: unknown): ProductAnalysisMeasurement {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: measurement mal formado.");
  return {
    plane: nullableText(raw.plane),
    level: nullableText(raw.level),
    structure: requiredText(raw.structure, "measurements[].structure"),
    areaMm2: nullableNumber(raw.areaMm2),
    majorAxisMm: nullableNumber(raw.majorAxisMm),
    minorAxisMm: nullableNumber(raw.minorAxisMm),
    reviewRequired: requiredBoolean(raw.reviewRequired, "measurements[].reviewRequired"),
  };
}

function parseDiscLevel(value: unknown): ProductAnalysisDiscLevel {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: discLevel mal formado.");
  return {
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
  };
}

function parseReview(value: unknown): ProductAnalysisReview {
  const raw = asRecord(value);
  if (!raw) throw new ProductAnalysisV1ContractError("Contrato de análisis de producto inválido: falta review.");
  return {
    required: requiredBoolean(raw.required, "review.required"),
    status: requiredText(raw.status, "review.status"),
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
