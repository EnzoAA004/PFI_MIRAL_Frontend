/**
 * Contrato HTTP de POST/GET `/api/studies/{caseId}/product-analys(is|es)` — Backend Post-E50,
 * etapas 75/76 (`pfi.ai-product-result.v1`). Distinto del contrato viejo P10.9 modelado en
 * `../productAnalysisApi.ts` (series-segmentation/disc-degenerative-findings): ese sigue vivo
 * para el flujo de carga, este es el análisis de producto persistido por Study.
 *
 * El Frontend nunca ve ni envía `sagittalInputId`/`axialInputId`, la URL del AI Module, ni un
 * SHA de checkpoint — el Backend los resuelve internamente.
 */

export type ProductAnalysisStatus = "completed" | "partial" | "failed";

/** `null` es un estado válido y esperado, nunca "el dato faltó por error". */
export type ProductAnalysisMeasurement = {
  plane: string | null;
  level: string | null;
  structure: string;
  areaMm2: number | null;
  majorAxisMm: number | null;
  minorAxisMm: number | null;
  reviewRequired: boolean;
};

/**
 * Un nivel discal del contrato. `level` es `null` cuando 67B2 se abstuvo o no está
 * disponible en esta versión — nunca se reemplaza por un valor por defecto.
 */
export type ProductAnalysisDiscLevel = {
  level: string | null;
  localizationStatus: string | null;
  localizationValidated: boolean;
  abstentionPreserved: boolean;
  axialPairingStatus: string | null;
  axialPairingValidated: boolean;
  axialPairingExperimental: boolean;
  axialPairingReviewRequired: boolean;
  degenerativeFindingsStatus: string | null;
  automaticInferenceEnabled: boolean;
  measurements: ProductAnalysisMeasurement[];
};

export type ProductAnalysisReview = {
  required: boolean;
  status: string;
};

export type ProductAnalysisResult = {
  analysisRunId: string;
  studyId: string;
  caseId: string;
  status: ProductAnalysisStatus;
  warnings: string[];
  discLevels: ProductAnalysisDiscLevel[];
  review: ProductAnalysisReview;
  humanReviewRequired: boolean;
  notClinicalDiagnosis: boolean;
  autonomousDiagnosis: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type ProductAnalysisHistory = {
  caseId: string;
  analyses: ProductAnalysisResult[];
};

/** El único campo que el Frontend puede enviar hoy — nunca inputIds. */
export type ProductAnalysisStartRequest = {
  metadata?: Record<string, unknown>;
};
