/**
 * Contrato de `GET /api/studies/{caseId}/longitudinal-comparison?baselineCaseId=...` — Backend
 * Post-E50, stage 79. Comparación determinística entre dos Studies del mismo paciente,
 * recalculada en cada request (nunca persistida) a partir de datos ya persistidos en las etapas
 * 76/78. Puramente descriptivo — nunca "mejoró"/"empeoró", nunca un diagnóstico.
 */

export type ComparisonTrend = "increased" | "decreased" | "unchanged";

/** "comparable" cuando ambos lados tienen la misma medición; el resto son motivos de no-comparabilidad (stage 79-Q). */
export type ComparisonStatus = "comparable" | "missing_baseline" | "missing_current" | "level_unresolved" | "unit_mismatch";

export type MeasurementField = "areaMm2" | "majorAxisMm" | "minorAxisMm";

/** La corrección profesional (si existe) siempre tiene prioridad, pero el valor original de la IA nunca se omite. */
export type LongitudinalEffectiveValue = {
  automaticValue: number | null;
  correctedValue: number | null;
  effectiveValue: number | null;
  source: "ai_original" | "professional_correction" | string;
};

/** `level` es `null` sólo en las filas `level_unresolved` — nunca se empareja un `null` con otro. */
export type LongitudinalMeasurementComparison = {
  level: string | null;
  plane: string | null;
  structure: string;
  metric: MeasurementField | string;
  unit: string;
  baseline: LongitudinalEffectiveValue | null;
  current: LongitudinalEffectiveValue | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  trend: ComparisonTrend | null;
  comparisonStatus: ComparisonStatus;
};

export type LongitudinalComparisonResult = {
  baselineCaseId: string;
  currentCaseId: string;
  baselineStudyId: string;
  currentStudyId: string;
  baselineAnalysisRunId: string;
  currentAnalysisRunId: string;
  baselineStudyDate: string | null;
  currentStudyDate: string | null;
  generatedAt: string;
  measurements: LongitudinalMeasurementComparison[];
};
