import { multiplanarRequest } from "./multiplanarApi";

/**
 * EXT-02: client for the read-only "review feedback telemetry" report. Deliberately no field or
 * label here claims clinical accuracy or safety — see `displayReviewAnalyticsDisclaimer`.
 */

export type MeasurementGroup = {
  level: string | null;
  plane: string | null;
  structure: string | null;
  metric: string;
  unit: string;
  releaseId: string | null;
  automaticCount: number;
  correctedCount: number;
  correctionRate: number;
  meanAbsoluteError: number | null;
  medianAbsoluteError: number | null;
  signedMeanError: number | null;
};

export type GeometryCorrectionDelta = {
  regionId: string;
  correctionId: string;
  geometryType: string;
  centroidDisplacement: number;
  areaDelta: number;
  intersectionOverUnion: number | null;
};

export type ReviewAnalyticsReport = {
  schemaVersion: string;
  generatedAt: string;
  measurements: {
    totalAutomaticMeasurements: number;
    correctedCount: number;
    correctionRate: number;
    groups: MeasurementGroup[];
  };
  evidenceRegions: {
    totalAiRegions: number;
    accepted: number;
    observed: number;
    rejected: number;
    pending: number;
    correctedCount: number;
    correctionRate: number;
    professionalDrawnCount: number;
    geometryDeltas: GeometryCorrectionDelta[];
  };
  limitations: string[];
};

export function getReviewAnalytics(caseId?: string): Promise<ReviewAnalyticsReport> {
  const query = caseId ? `?caseId=${encodeURIComponent(caseId)}` : "";
  return multiplanarRequest<ReviewAnalyticsReport>(`/api/analytics/review-feedback${query}`);
}

export function displayMetricGroupLabel(group: MeasurementGroup): string {
  const parts = [group.level ?? "sin nivel", group.plane ?? "sin plano", group.structure ?? "sin estructura", group.metric];
  return parts.join(" · ");
}

export const REVIEW_ANALYTICS_DISCLAIMER =
  "Telemetría interna de revisión — describe cuánto difiere la corrección profesional de la salida automática. No es una medida de exactitud clínica ni de seguridad del modelo.";

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatOptionalNumber(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}
