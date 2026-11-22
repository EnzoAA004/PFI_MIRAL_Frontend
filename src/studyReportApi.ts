import { API_BASE_URL } from "./api";
import { authHeaders, refreshDoctorSession } from "./authClient";
import { ensureAuthSession } from "./authStorage";
import type { StudyReport } from "./contracts/studyReportTypes";
import type { EvidenceBaseImageRef, EvidenceGeometry, VisualEvidenceItem } from "./contracts/visualEvidenceTypes";
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

function parseLongitudinalHistory(value: unknown): StudyReport["longitudinalHistory"] {
  if (value == null) return null;
  const raw = asRecord(value);
  if (!raw) throw new StudyReportContractError("Contrato de informe inválido: longitudinalHistory mal formado.");
  const currentStudy = asRecord(raw.currentStudy);
  if (!currentStudy) throw new StudyReportContractError("Contrato de informe inválido: falta longitudinalHistory.currentStudy.");
  return {
    available: requiredBoolean(raw.available, "longitudinalHistory.available"),
    currentStudy: {
      caseId: requiredText(currentStudy.caseId, "longitudinalHistory.currentStudy.caseId"),
      studyDate: nullableText(currentStudy.studyDate),
      analysisRunId: nullableText(currentStudy.analysisRunId),
    },
    previousStudies: asArray(raw.previousStudies).map((item) => {
      const previous = asRecord(item);
      if (!previous) throw new StudyReportContractError("Contrato de informe inválido: previousStudies[] mal formado.");
      return {
        caseId: requiredText(previous.caseId, "longitudinalHistory.previousStudies[].caseId"),
        studyDate: nullableText(previous.studyDate),
        analysisRunId: nullableText(previous.analysisRunId),
        comparisonStatus: requiredText(previous.comparisonStatus, "longitudinalHistory.previousStudies[].comparisonStatus"),
        comparableMeasurementCount: requiredNumber(previous.comparableMeasurementCount, "longitudinalHistory.previousStudies[].comparableMeasurementCount"),
        nonComparableMeasurementCount: requiredNumber(previous.nonComparableMeasurementCount, "longitudinalHistory.previousStudies[].nonComparableMeasurementCount"),
      };
    }),
    comparisons: asArray(raw.comparisons).map((item) => {
      const comparison = asRecord(item);
      if (!comparison) throw new StudyReportContractError("Contrato de informe inválido: longitudinalHistory.comparisons[] mal formado.");
      return {
        previousCaseId: requiredText(comparison.previousCaseId, "longitudinalHistory.comparisons[].previousCaseId"),
        previousStudyDate: nullableText(comparison.previousStudyDate),
        currentStudyDate: nullableText(comparison.currentStudyDate),
        level: nullableText(comparison.level),
        plane: nullableText(comparison.plane),
        structure: nullableText(comparison.structure),
        metric: requiredText(comparison.metric, "longitudinalHistory.comparisons[].metric"),
        unit: requiredText(comparison.unit, "longitudinalHistory.comparisons[].unit"),
        previousEffectiveValue: nullableNumber(comparison.previousEffectiveValue),
        currentEffectiveValue: nullableNumber(comparison.currentEffectiveValue),
        absoluteDelta: nullableNumber(comparison.absoluteDelta),
        percentageDelta: nullableNumber(comparison.percentageDelta),
        previousValueSource: nullableText(comparison.previousValueSource),
        currentValueSource: nullableText(comparison.currentValueSource),
        previousAutomaticValue: nullableNumber(comparison.previousAutomaticValue),
        currentAutomaticValue: nullableNumber(comparison.currentAutomaticValue),
        previousCorrectedValue: nullableNumber(comparison.previousCorrectedValue),
        currentCorrectedValue: nullableNumber(comparison.currentCorrectedValue),
      };
    }),
    message: requiredText(raw.message, "longitudinalHistory.message"),
  };
}

const CANONICAL_MIN = 0;
const CANONICAL_MAX = 256;

function isFiniteNumberInCanonicalRange(value: number): boolean {
  return Number.isFinite(value) && value >= CANONICAL_MIN - 1e-6 && value <= CANONICAL_MAX + 1e-6;
}

function numberField(raw: Record<string, unknown>, field: string): number | null {
  const value = raw[field];
  return typeof value === "number" && isFiniteNumberInCanonicalRange(value) ? value : null;
}

/**
 * Replica `EvidenceGeometry.fromMap` (Backend) campo por campo, incluido el mismo chequeo de rango
 * 0..256 que `EvidenceCoordinateNormalizer` garantiza al escribir. Nunca lanza excepción: un
 * `geometryType` desconocido, un mapa malformado o una coordenada fuera de rango devuelve `null` para que quien llama
 * pueda descartar solo esa región (fail-safe estilo 89-CONT — tests 7/12 de EXT-04B3).
 */
export function parseEvidenceGeometry(geometryType: unknown, geometry: unknown): EvidenceGeometry | null {
  const raw = asRecord(geometry);
  if (!raw || typeof geometryType !== "string") return null;
  if (geometryType === "BBOX") {
    const x = numberField(raw, "x");
    const y = numberField(raw, "y");
    const width = numberField(raw, "width");
    const height = numberField(raw, "height");
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null;
    return { type: "BBOX", x, y, width, height };
  }
  if (geometryType === "ELLIPSE") {
    const centerX = numberField(raw, "centerX");
    const centerY = numberField(raw, "centerY");
    const radiusX = numberField(raw, "radiusX");
    const radiusY = numberField(raw, "radiusY");
    if (centerX === null || centerY === null || radiusX === null || radiusY === null || radiusX <= 0 || radiusY <= 0) return null;
    return { type: "ELLIPSE", centerX, centerY, radiusX, radiusY };
  }
  if (geometryType === "POLYGON") {
    const rawPoints = Array.isArray(raw.points) ? raw.points : null;
    if (!rawPoints || rawPoints.length < 3) return null;
    const points: { x: number; y: number }[] = [];
    for (const item of rawPoints) {
      const point = asRecord(item);
      const x = point ? numberField(point, "x") : null;
      const y = point ? numberField(point, "y") : null;
      if (x === null || y === null) return null;
      points.push({ x, y });
    }
    return { type: "POLYGON", points };
  }
  if (geometryType === "MASK_REFERENCE") {
    const runId = typeof raw.runId === "string" && raw.runId.trim() ? raw.runId : null;
    const plane = raw.plane === "sagittal" || raw.plane === "axial" ? raw.plane : null;
    const assetName = typeof raw.assetName === "string" && raw.assetName.trim() ? raw.assetName : null;
    if (!runId || !plane || !assetName) return null;
    // El mismo guard contra path traversal que el compact constructor de `EvidenceGeometry.MaskReference` —
    // este valor luego alimenta un segmento de path de URL, nunca una URL cruda del JSON.
    if ([runId, assetName].some((value) => value.includes("..") || value.includes("/") || value.includes("\\"))) return null;
    return { type: "MASK_REFERENCE", runId, plane, assetName };
  }
  return null;
}

/**
 * EXT-04B3.5: tolerante con la misma regla que el resto de este parser — una clave faltante (reporte previo a
 * EXT-04B3.5), un `null` explícito o una forma malformada (`sliceIndex` no entero,
 * `inputId` en blanco) se resuelven todos a `null`, nunca a un error lanzado. Una región sin
 * `baseImage` utilizable igual se renderiza (su geometría, etiqueta, fuente, etc. son independientes de esto).
 */
export function parseEvidenceBaseImage(value: unknown): EvidenceBaseImageRef | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const inputId = typeof raw.inputId === "string" && raw.inputId.trim() ? raw.inputId : null;
  const sliceIndex = typeof raw.sliceIndex === "number" && Number.isInteger(raw.sliceIndex) && raw.sliceIndex >= 0 ? raw.sliceIndex : null;
  if (!inputId || sliceIndex === null) return null;
  return { inputId, sliceIndex };
}

/**
 * EXT-04B3: un ítem de `visualEvidence[]`. Devuelve `null` (nunca lanza excepción) para una región cuya
 * geometría no parsea — esa región se descarta en silencio por `parseVisualEvidence`, nunca
 * todo el reporte (test 7: "geometria desconocida fail-safe").
 */
function parseVisualEvidenceItem(value: unknown): VisualEvidenceItem | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const evidenceId = typeof raw.evidenceId === "string" && raw.evidenceId ? raw.evidenceId : null;
  const label = typeof raw.label === "string" && raw.label ? raw.label : null;
  const geometry = parseEvidenceGeometry(raw.geometryType, raw.geometry);
  if (!evidenceId || !label || !geometry) return null;
  const plane = raw.plane === "sagittal" || raw.plane === "axial" ? raw.plane : null;
  return {
    evidenceId,
    plane,
    level: nullableText(raw.level),
    structure: nullableText(raw.structure),
    geometry,
    source: typeof raw.source === "string" ? raw.source : "ai_suggested",
    reviewStatus: nullableText(raw.reviewStatus),
    label,
    warning: nullableText(raw.warning),
    experimental: raw.experimental === true,
    baseImage: parseEvidenceBaseImage(raw.baseImage),
  };
}

/**
 * Tolerante por diseño (EXT-04B3 "el parser debe ser tolerante"): una clave faltante (reporte previo a EXT-04B2),
 * un `null` explícito o cualquier cosa que no sea un array se resuelven todos a `[]` — nunca un
 * `StudyReportContractError` lanzado. Solo se descartan los ítems individuales malformados.
 */
export function parseVisualEvidence(value: unknown): VisualEvidenceItem[] {
  if (value == null) return [];
  return asArray(value)
    .map(parseVisualEvidenceItem)
    .filter((item): item is VisualEvidenceItem => item !== null);
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
    longitudinalHistory: parseLongitudinalHistory(raw.longitudinalHistory),
    visualEvidence: parseVisualEvidence(raw.visualEvidence),
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
