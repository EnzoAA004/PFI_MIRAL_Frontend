/**
 * Contrato HTTP de POST/GET/PATCH `/api/studies/{caseId}/product-analys(is|es)` — Backend
 * Post-E50, etapas 75/76/78 (`pfi.ai-product-result.v1` + su capa de revisión profesional).
 * Distinto del contrato viejo P10.9 modelado en `../productAnalysisApi.ts`
 * (series-segmentation/disc-degenerative-findings): ese sigue vivo para el flujo de carga, este es
 * el análisis de producto persistido por Study.
 *
 * El Frontend nunca ve ni envía `sagittalInputId`/`axialInputId`, la URL del AI Module, ni un
 * SHA de checkpoint — el Backend los resuelve internamente. `discLevelId`/`measurementId` SÍ se
 * exponen (stage 78): son ids opacos generados por el Backend, sin significado clínico ni de
 * infraestructura, y el Frontend los necesita para dirigirse a los endpoints de revisión.
 */

export type ProductAnalysisStatus = "completed" | "partial" | "failed";

/** Vocabulario de revisión profesional (stage 78) — deliberadamente no clínico. */
export type ReviewStatus = "pending" | "accepted" | "observed" | "rejected";

/**
 * Decisión de revisión profesional — reutilizada igual para la corrida completa y para cada
 * nivel discal (stage 78-B/78-C). Siempre un concepto distinto de los campos de la IA
 * (`localizationStatus`, `axialPairingValidated`, etc.): aceptar una revisión nunca cambia esos.
 */
export type ProductAnalysisReview = {
  required: boolean;
  status: ReviewStatus | string;
  comment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

/** Una corrección vigente de un campo de medición — el valor original de la IA siempre se conserva junto al corregido. */
export type ProductAnalysisMeasurementCorrection = {
  field: "areaMm2" | "majorAxisMm" | "minorAxisMm";
  originalValue: number | null;
  correctedValue: number;
  unit: string;
  comment: string | null;
  reviewedBy: string | null;
  createdAt: string;
};

/** `null` es un estado válido y esperado, nunca "el dato faltó por error". */
export type ProductAnalysisMeasurement = {
  measurementId: string;
  plane: string | null;
  level: string | null;
  structure: string;
  areaMm2: number | null;
  majorAxisMm: number | null;
  minorAxisMm: number | null;
  reviewRequired: boolean;
  corrections: ProductAnalysisMeasurementCorrection[];
};

/**
 * Un nivel discal del contrato. `level` es `null` cuando 67B2 se abstuvo o no está
 * disponible en esta versión — nunca se reemplaza por un valor por defecto.
 */
export type ProductAnalysisDiscLevel = {
  discLevelId: string;
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
  review: ProductAnalysisReview;
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

/** Body de `PATCH .../review` y `PATCH .../disc-levels/{id}/review`. Nunca incluye reviewedBy: el Backend lo deriva del principal autenticado. */
export type ProductAnalysisReviewRequest = {
  status: ReviewStatus;
  comment?: string;
};

/** Body de `POST .../measurements/{id}/corrections`. `unit` nunca se envía — el Backend la deriva de `field`. */
export type ProductAnalysisCorrectionRequest = {
  field: "areaMm2" | "majorAxisMm" | "minorAxisMm";
  correctedValue: number;
  comment?: string;
};
