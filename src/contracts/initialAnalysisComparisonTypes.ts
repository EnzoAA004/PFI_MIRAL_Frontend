/**
 * Contrato de `GET /api/studies/{caseId}/initial-analysis-comparison` y de `.../candidates`
 * (`pfi.initial-analysis-comparison.v1`): comparación entre estudios sobre las mediciones REALES del
 * análisis inicial. No es el contrato de la comparación longitudinal del circuito de producto
 * (`longitudinalComparisonTypes.ts`), que lee otra fuente.
 *
 * Convención: `deltaAbsolute = estudio abierto − referencia`. Todo lo calculado viene del Backend; el
 * Frontend solo da formato.
 */

export type PatientLink = "patient_id" | "subject_ref_historical" | "none";
export type PercentStatus = "ok" | "not_computable_reference_zero";
export type ComparisonTrend = "increased" | "decreased" | "unchanged";
export type ExclusionSide = "current" | "reference" | "both";

export type ComparisonStudySide = {
  caseId: string;
  studyDate: string | null;
  runId: string | null;
  runCreatedAt: string | null;
  runStatus: string | null;
  reviewStatus: string | null;
  modelKey: string | null;
  sagittalSequence: string | null;
  /** `user_declared`, `auto_detected` o `unknown`: una declaración no es una detección ni una validación. */
  sagittalSequenceSource: string | null;
  /** Texto libre de la secuencia «Otra»; solo informativo. */
  sagittalSequenceDescription: string | null;
  usableMeasurementCount: number;
  patientLink: PatientLink;
};

export type LocationStatus = "located" | "slice_only" | "not_located";
export type GeometryKind = "segment" | "angle" | "none";
export type GeometryPoint = { x: number; y: number };

/**
 * Dónde está la medición en la imagen, tal como la corrida la persistió. `geometry` es el trazo de la IA en el
 * espacio `coordinateSpace` (base 0..256 del plano) y solo se dibuja sobre `sliceIndex` de la serie `inputId`;
 * `correctedGeometry` solo existe si el revisor guardó un trazo propio. Un valor corregido no modifica el trazo.
 */
export type ComparisonLocation = {
  plane: string;
  planeRunId: string | null;
  inputId: string | null;
  sliceIndex: number | null;
  coordinateSpace: string | null;
  coordinateWidth: number | null;
  coordinateHeight: number | null;
  geometryKind: GeometryKind;
  geometry: GeometryPoint[];
  correctedGeometry: GeometryPoint[];
  status: LocationStatus;
  reason: string | null;
};

export type ComparisonValue = {
  measurementId: string;
  effectiveValue: number;
  originalValue: number;
  correctedValue: number | null;
  corrected: boolean;
  sliceIndex: number | null;
  /** `null` si el Backend no la informó o no se pudo leer: no se dibuja nada. */
  location: ComparisonLocation | null;
};

export type InitialComparisonRow = {
  level: string;
  structure: string;
  metric: string;
  plane: string;
  unit: string;
  experimental: boolean;
  reference: ComparisonValue;
  current: ComparisonValue;
  deltaAbsolute: number;
  deltaPercent: number | null;
  percentStatus: PercentStatus;
  trend: ComparisonTrend;
};

export type InitialComparisonExclusion = {
  side: ExclusionSide;
  level: string | null;
  plane: string | null;
  metricKey: string | null;
  measurementIds: string[];
  reasonCode: string;
  reason: string;
};

export type InitialComparisonResult = {
  schemaVersion: string;
  source: "initial_analysis";
  differenceDefinition: string;
  current: ComparisonStudySide;
  reference: ComparisonStudySide;
  summary: { comparedCount: number; excludedCount: number; currentMeasurementCount: number; referenceMeasurementCount: number };
  comparisons: InitialComparisonRow[];
  excluded: InitialComparisonExclusion[];
  limitations: string[];
};

export type InitialComparisonCandidate = {
  caseId: string;
  studyDate: string | null;
  runId: string | null;
  runCreatedAt: string | null;
  usableMeasurementCount: number;
  eligible: boolean;
  reasonCode: string | null;
  reason: string | null;
  patientLink: PatientLink;
};

export type InitialComparisonCandidates = {
  schemaVersion: string;
  current: ComparisonStudySide;
  candidates: InitialComparisonCandidate[];
  runSelectionRule: string;
};
