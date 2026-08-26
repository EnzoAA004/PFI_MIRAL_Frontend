import type { LongitudinalComparisonResult } from "./longitudinalComparisonTypes";

export type StudyReportAnalysisSummary = {
  analysisRunId: string | null;
  analysisStatus: string;
  releaseId: string | null;
  createdAt: string | null;
  completedAt: string | null;
  humanReviewRequired: boolean;
};

export type StudyReportReviewSummary = {
  reviewStatus: string;
  reviewComment: string | null;
  reviewedAt: string | null;
};

export type StudyReportDiscLevel = {
  discLevelResultId: string;
  rankIndex: number;
  level: string | null;
  localizationStatus: string | null;
  localizationSource: string | null;
  localizationValidated: boolean;
  abstentionPreserved: boolean;
  axialPairingStatus: string | null;
  axialPairingValidated: boolean;
  axialPairingExperimental: boolean;
  axialPairingReviewRequired: boolean;
  degenerativeFindingsStatus: string | null;
  automaticInferenceEnabled: boolean;
  reviewStatus: string;
  reviewComment: string | null;
  reviewedAt: string | null;
};

export type StudyReportMeasurement = {
  level: string | null;
  plane: string | null;
  structure: string | null;
  metric: string;
  unit: string;
  automaticValue: number | null;
  correctedValue: number | null;
  effectiveValue: number | null;
  effectiveSource: "ai_original" | "professional_correction" | string;
};

export type StudyReportSafetySummary = {
  humanReviewRequired: boolean;
  notClinicalDiagnosis: boolean;
  autonomousDiagnosis: boolean;
  disclaimer: string;
};

export type StudyReportTraceabilitySummary = {
  caseId: string;
  analysisRunId: string | null;
  analysisSchemaVersion: string | null;
  releaseId: string | null;
  generatedAt: string;
};

export type StudyReport = {
  schemaVersion: "pfi.study-report.v1";
  generatedAt: string;
  reportStatus: "ready" | "no_effective_analysis" | string;
  caseId: string;
  studyDate: string | null;
  modality: string | null;
  analysis: StudyReportAnalysisSummary;
  review: StudyReportReviewSummary;
  discLevels: StudyReportDiscLevel[];
  measurements: StudyReportMeasurement[];
  warnings: string[];
  limitations: string[];
  longitudinalComparison: LongitudinalComparisonResult | null;
  safety: StudyReportSafetySummary;
  traceability: StudyReportTraceabilitySummary;
};
