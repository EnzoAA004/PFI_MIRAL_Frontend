import { API_BASE_URL } from "./api";
import { authHeaders, refreshDoctorSession } from "./authClient";
import { ensureAuthSession } from "./authStorage";
import type { StudyReport } from "./contracts/studyReportTypes";
import { parseLongitudinalComparisonResult } from "./longitudinalComparisonApi";
import { BackendApiError, multiplanarRequest } from "./multiplanarApi";
import { generateTraceId } from "./security/traceId";

export class StudyReportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyReportContractError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StudyReportContractError(`Contrato de informe inválido: falta ${field}.`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new StudyReportContractError(`Contrato de informe inválido: ${field} no es booleano.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudyReportContractError(`Contrato de informe inválido: ${field} no es numérico.`);
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function parseAnalysis(value: unknown): StudyReport["analysis"] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: falta analysis.");
  return {
    analysisRunId: nullableText(raw.analysisRunId),
    analysisStatus: requiredText(raw.analysisStatus, "analysis.analysisStatus"),
    releaseId: nullableText(raw.releaseId),
    createdAt: nullableText(raw.createdAt),
    completedAt: nullableText(raw.completedAt),
    humanReviewRequired: requiredBoolean(raw.humanReviewRequired, "analysis.humanReviewRequired"),
  };
}

function parseReview(value: unknown): StudyReport["review"] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: falta review.");
  return {
    reviewStatus: requiredText(raw.reviewStatus, "review.reviewStatus"),
    reviewComment: nullableText(raw.reviewComment),
    reviewedAt: nullableText(raw.reviewedAt),
  };
}

function parseDiscLevel(value: unknown): StudyReport["discLevels"][number] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: discLevel mal formado.");
  return {
    discLevelResultId: requiredText(raw.discLevelResultId, "discLevels[].discLevelResultId"),
    rankIndex: requiredNumber(raw.rankIndex, "discLevels[].rankIndex"),
    level: nullableText(raw.level),
    localizationStatus: nullableText(raw.localizationStatus),
    localizationSource: nullableText(raw.localizationSource),
    localizationValidated: requiredBoolean(raw.localizationValidated, "discLevels[].localizationValidated"),
    abstentionPreserved: requiredBoolean(raw.abstentionPreserved, "discLevels[].abstentionPreserved"),
    axialPairingStatus: nullableText(raw.axialPairingStatus),
    axialPairingValidated: requiredBoolean(raw.axialPairingValidated, "discLevels[].axialPairingValidated"),
    axialPairingExperimental: requiredBoolean(raw.axialPairingExperimental, "discLevels[].axialPairingExperimental"),
    axialPairingReviewRequired: requiredBoolean(raw.axialPairingReviewRequired, "discLevels[].axialPairingReviewRequired"),
    degenerativeFindingsStatus: nullableText(raw.degenerativeFindingsStatus),
    automaticInferenceEnabled: requiredBoolean(raw.automaticInferenceEnabled, "discLevels[].automaticInferenceEnabled"),
    reviewStatus: requiredText(raw.reviewStatus, "discLevels[].reviewStatus"),
    reviewComment: nullableText(raw.reviewComment),
    reviewedAt: nullableText(raw.reviewedAt),
  };
}

function parseMeasurement(value: unknown): StudyReport["measurements"][number] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: measurement mal formado.");
  const unit = requiredText(raw.unit, "measurements[].unit");
  if (unit !== "mm" && unit !== "mm²") {
    throw new StudyReportContractError("Contrato de informe inválido: unidad de medición no soportada.");
  }
  return {
    level: nullableText(raw.level),
    plane: nullableText(raw.plane),
    structure: nullableText(raw.structure),
    metric: requiredText(raw.metric, "measurements[].metric"),
    unit,
    automaticValue: nullableNumber(raw.automaticValue),
    correctedValue: nullableNumber(raw.correctedValue),
    effectiveValue: nullableNumber(raw.effectiveValue),
    effectiveSource: requiredText(raw.effectiveSource, "measurements[].effectiveSource"),
  };
}

function parseSafety(value: unknown): StudyReport["safety"] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: falta safety.");
  return {
    humanReviewRequired: requiredBoolean(raw.humanReviewRequired, "safety.humanReviewRequired"),
    notClinicalDiagnosis: requiredBoolean(raw.notClinicalDiagnosis, "safety.notClinicalDiagnosis"),
    autonomousDiagnosis: requiredBoolean(raw.autonomousDiagnosis, "safety.autonomousDiagnosis"),
    disclaimer: requiredText(raw.disclaimer, "safety.disclaimer"),
  };
}

function parseTraceability(value: unknown): StudyReport["traceability"] {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: falta traceability.");
  return {
    caseId: requiredText(raw.caseId, "traceability.caseId"),
    analysisRunId: nullableText(raw.analysisRunId),
    analysisSchemaVersion: nullableText(raw.analysisSchemaVersion),
    releaseId: nullableText(raw.releaseId),
    generatedAt: requiredText(raw.generatedAt, "traceability.generatedAt"),
  };
}

export function parseStudyReport(value: unknown): StudyReport {
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: respuesta vacía.");
  const schemaVersion = requiredText(raw.schemaVersion, "schemaVersion");
  if (schemaVersion !== "pfi.study-report.v1") {
    throw new StudyReportContractError("Contrato de informe inválido: schemaVersion desconocido.");
  }
  const report: StudyReport = {
    schemaVersion,
    generatedAt: requiredText(raw.generatedAt, "generatedAt"),
    reportStatus: requiredText(raw.reportStatus, "reportStatus"),
    caseId: requiredText(raw.caseId, "caseId"),
    studyDate: nullableText(raw.studyDate),
    modality: nullableText(raw.modality),
    analysis: parseAnalysis(raw.analysis),
    review: parseReview(raw.review),
    discLevels: asArray(raw.discLevels).map(parseDiscLevel),
    measurements: asArray(raw.measurements).map(parseMeasurement),
    warnings: optionalStrings(raw.warnings),
    limitations: optionalStrings(raw.limitations),
    longitudinalComparison: raw.longitudinalComparison == null ? null : parseLongitudinalComparisonResult(raw.longitudinalComparison),
    safety: parseSafety(raw.safety),
    traceability: parseTraceability(raw.traceability),
  };
  if (!report.safety.notClinicalDiagnosis || report.safety.autonomousDiagnosis) {
    throw new StudyReportContractError("Contrato de informe inválido: flags de seguridad incompatibles con el MVP.");
  }
  return report;
}

export async function getStudyReport(caseId: string, baselineCaseId?: string): Promise<StudyReport> {
  const query = baselineCaseId ? `?baselineCaseId=${encodeURIComponent(baselineCaseId)}` : "";
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(caseId)}/report${query}`);
  return parseStudyReport(raw);
}

export type StudyReportDownload = {
  filename: string;
  blob: Blob;
};

export async function fetchStudyReportExport(caseId: string, format: "json" | "pdf", baselineCaseId?: string): Promise<StudyReportDownload> {
  const query = baselineCaseId ? `?baselineCaseId=${encodeURIComponent(baselineCaseId)}` : "";
  const path = `/api/studies/${encodeURIComponent(caseId)}/report.${format}${query}`;
  const traceId = generateTraceId("frontend-study-report");
  await ensureAuthSession();
  const init = (): RequestInit => ({ headers: { "X-Trace-Id": traceId, ...authHeaders() } });
  let response = await fetch(`${API_BASE_URL}${path}`, init());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, init());
  }
  if (!response.ok) {
    throw new BackendApiError("No se pudo generar el informe estructurado.", response.status, path, traceId);
  }
  return {
    filename: filenameFromDisposition(response.headers.get("Content-Disposition")) ?? `study-report-${caseId}.${format}`,
    blob: await response.blob(),
  };
}

export function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8) return decodeURIComponent(utf8[1].replace(/^"|"$/g, ""));
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain ? plain[1] : null;
}
