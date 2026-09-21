import { API_BASE_URL, ApiError, ContractError } from "./api";
import { authHeaders, refreshDoctorSession } from "./authClient";
import { validateVisibleDataOrigin } from "./dataMode";
import { toSafeFrontendError } from "./security/safeError";
import { generateTraceId } from "./security/traceId";
import type { Measurement, MeasurementSeries, MeasurementSeriesKey, PatientHistoryGovernance, PatientHistoryResponse, PatientHistorySummary, PatientStudy, PatientStudyProductAnalysis, PersistedReviewCorrection, Plane, Priority, ReviewStatus, SubjectSummary } from "./appTypes";
import { applyCorrectionsToMeasurements, normalizePersistedCorrection } from "./studyApi";

function mapPriority(value?: string): Priority {
  if (value === "alta" || value === "high") return "alta";
  if (value === "baja" || value === "low") return "baja";
  return "media";
}

function mapReviewStatus(value?: string): ReviewStatus {
  if (value === "accepted") return "aceptado";
  if (value === "observed" || value === "edited") return "observado";
  if (value === "rejected") return "descartado";
  if (value === "aceptado" || value === "observado" || value === "descartado") return value;
  return "pendiente";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function mapPlane(value: unknown): Plane | undefined {
  return value === "sagittal" || value === "axial" ? value : undefined;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isValue(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

function normalizePlanes(value: unknown): string {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  return typeof value === "string" ? value : "";
}

function contractError(payload: Record<string, unknown> | undefined, path: string) {
  const code = typeof payload?.code === "string" ? payload.code : typeof payload?.errorCode === "string" ? payload.errorCode : undefined;
  const traceId = typeof payload?.traceId === "string" ? payload.traceId : undefined;
  return new ContractError("Respuesta incompatible con el historial de sujetos.", path, { code, traceId, body: payload });
}

function normalizeMeasurement(value: unknown, _index: number, plane: Plane): Measurement | null {
  const item = asRecord(value);
  if (!item) return null;
  const id = optionalString(item, "id") ?? optionalString(item, "measurementId");
  const label = optionalString(item, "label") ?? optionalString(item, "name");
  const aiValue = item.aiValue ?? item.value;
  const rawValue = item.value;
  const reviewerValue = item.reviewerValue;
  if (!id || !label || !isValue(aiValue)) {
    console.warn("[subject-history] Medición excluida: falta id, label o valor IA real.");
    return null;
  }
  return {
    id,
    label,
    value: isValue(reviewerValue) ? reviewerValue : isValue(rawValue) ? rawValue : aiValue,
    aiValue,
    reviewerValue: isValue(reviewerValue) || reviewerValue === null ? reviewerValue : undefined,
    unit: optionalString(item, "unit") ?? "",
    confidence: typeof item.confidence === "number" ? item.confidence : undefined,
    plane: mapPlane(item.plane) ?? plane,
    source: reviewerValue === undefined || reviewerValue === null ? "AI" : "Reviewer",
    status: reviewerValue === undefined || reviewerValue === null ? "pendiente" : "editado",
    outlier: Boolean(item.outlier),
    dataOrigin: "database",
  };
}

function normalizeMeasurementsByPlane(value: unknown): Partial<Record<Plane, Measurement[]>> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Partial<Record<Plane, Measurement[]>> = {};
  for (const plane of ["sagittal", "axial"] as const) {
    const rows = record[plane];
    if (!Array.isArray(rows)) continue;
    result[plane] = rows.flatMap((row, index) => {
      const measurement = normalizeMeasurement(row, index, plane);
      return measurement ? [measurement] : [];
    });
  }
  return result;
}

function normalizeCorrections(value: unknown): PersistedReviewCorrection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const correction = normalizePersistedCorrection(entry, index);
    return correction ? [correction] : [];
  });
}

/**
 * Stage 84-D/84-H: `null` cuando el Study no tiene un análisis efectivo (estado normal, no un
 * error) -- fail-closed en cualquier otro caso: un objeto mal formado nunca se completa con
 * defaults inventados, se descarta como si no hubiese análisis.
 */
function normalizeProductAnalysis(value: unknown): PatientStudyProductAnalysis | null {
  if (value === null || value === undefined) return null;
  const record = asRecord(value);
  if (!record) return null;
  const analysisRunId = optionalString(record, "analysisRunId");
  const status = optionalString(record, "status");
  const reviewStatus = optionalString(record, "reviewStatus");
  if (!analysisRunId || !status || !reviewStatus) return null;
  const warnings = Array.isArray(record.warnings) ? record.warnings.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    analysisRunId,
    status,
    reviewStatus,
    measurementCount: typeof record.measurementCount === "number" ? record.measurementCount : 0,
    correctedMeasurementCount: typeof record.correctedMeasurementCount === "number" ? record.correctedMeasurementCount : 0,
    warnings,
    humanReviewRequired: record.humanReviewRequired === true,
    notClinicalDiagnosis: record.notClinicalDiagnosis === true,
  };
}

function normalizeHistoryStudy(value: unknown, index: number, path: string): PatientStudy {
  const record = asRecord(value) ?? {};
  const caseId = optionalString(record, "caseId");
  if (!caseId) throw contractError({ code: "MISSING_CASE_ID", path: `${path}/studies/${index}` }, path);
  const corrections = normalizeCorrections(record.corrections);
  const measurementsByPlane = applyCorrectionsToMeasurements(normalizeMeasurementsByPlane(record.measurementsByPlane), corrections);
  return {
    caseId,
    subjectRef: optionalString(record, "subjectRef"),
    studyDate: optionalString(record, "studyDate"),
    modality: optionalString(record, "modality"),
    description: optionalString(record, "description"),
    planes: normalizePlanes(record.planes ?? record.plane),
    modelVersion: optionalString(record, "modelVersion") ?? optionalString(record, "modelKey") ?? "",
    modelKey: optionalString(record, "modelKey"),
    latestRunId: optionalString(record, "latestRunId") ?? optionalString(record, "runId"),
    reviewStatus: mapReviewStatus(optionalString(record, "reviewStatus") ?? undefined),
    priority: mapPriority(typeof record.priority === "string" ? record.priority : undefined),
    reviewer: optionalString(record, "reviewer"),
    reviewedAt: optionalString(record, "reviewedAt"),
    measurementsByPlane,
    corrections,
    createdAt: optionalString(record, "createdAt") || undefined,
    updatedAt: optionalString(record, "updatedAt") || undefined,
    productAnalysis: normalizeProductAnalysis(record.productAnalysis),
  };
}

function normalizeSummary(value: unknown, studies: PatientStudy[]): PatientHistorySummary {
  const summary = asRecord(value);
  if (!summary) {
    return { totalStudies: studies.length };
  }
  return {
    totalStudies: typeof summary.totalStudies === "number" ? summary.totalStudies : studies.length,
    mostRecent: typeof summary.mostRecent === "string" ? summary.mostRecent : undefined,
    firstStudy: typeof summary.firstStudy === "string" ? summary.firstStudy : undefined,
    pending: typeof summary.pending === "number" ? summary.pending : undefined,
    completed: typeof summary.completed === "number" ? summary.completed : undefined,
    observed: typeof summary.observed === "number" ? summary.observed : undefined,
    withStudyDate: typeof summary.withStudyDate === "number" ? summary.withStudyDate : undefined,
  };
}

function normalizeGovernance(value: unknown): PatientHistoryGovernance | undefined {
  const governance = asRecord(value);
  if (!governance) return undefined;
  return {
    dataScope: optionalString(governance, "dataScope") ?? undefined,
    rawImagesExport: optionalString(governance, "rawImagesExport") ?? undefined,
    derivedMetricsExport: optionalString(governance, "derivedMetricsExport") ?? undefined,
    humanReviewRequired: typeof governance.humanReviewRequired === "boolean" ? governance.humanReviewRequired : undefined,
    notClinicalDiagnosis: typeof governance.notClinicalDiagnosis === "boolean" ? governance.notClinicalDiagnosis : undefined,
  };
}

export function normalizeSubjectHistoryResponse(payload: unknown, requestedSubjectRef: string): PatientHistoryResponse {
  const record = asRecord(payload);
  const path = `/api/subjects/${requestedSubjectRef}/history`;
  if (!record) throw contractError(undefined, path);
  const responseSubjectRef = optionalString(record, "subjectRef")?.trim();
  if (
    record.status !== "ok"
    || record.source !== "postgres-domain"
    || record.dataOrigin !== "database"
    || record.deidentified !== true
    || !responseSubjectRef
    || responseSubjectRef.toLowerCase() !== requestedSubjectRef.trim().toLowerCase()
    || !Array.isArray(record.studies)
    || !asRecord(record.summary)
  ) {
    throw contractError(record, path);
  }
  const studies = record.studies.map((study, index) => normalizeHistoryStudy(study, index, path));
  validateVisibleDataOrigin(`historial ${responseSubjectRef}`, "database");
  return {
    status: "ok",
    source: "postgres-domain",
    subjectRef: responseSubjectRef,
    deidentified: true,
    studies,
    summary: normalizeSummary(record.summary, studies),
    governance: normalizeGovernance(record.governance),
    humanReviewRequired: typeof record.humanReviewRequired === "boolean" ? record.humanReviewRequired : undefined,
    notClinicalDiagnosis: typeof record.notClinicalDiagnosis === "boolean" ? record.notClinicalDiagnosis : undefined,
    dataOrigin: "database",
  };
}

async function readError(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const payload = await response.clone().json();
    return asRecord(payload);
  } catch {
    return undefined;
  }
}

const historyErrorMessages: Record<string, string> = {
  DATABASE_UNAVAILABLE: "No se pudo consultar el historial porque la base de datos no está disponible.",
  INVALID_SUBJECT_REFERENCE: "La referencia de-identificada no es válida.",
};

export function historyApiError(path: string, response: Response, body?: Record<string, unknown>) {
  const code = typeof body?.code === "string" ? body.code : typeof body?.errorCode === "string" ? body.errorCode : undefined;
  const traceId = typeof body?.traceId === "string" ? body.traceId : response.headers.get("X-Trace-Id") ?? undefined;
  const candidateMessage = code ? historyErrorMessages[code] : undefined;
  const message = candidateMessage ?? toSafeFrontendError(response.status, { code, traceId }).message;
  return new ApiError(message, { status: response.status, code, path, traceId, body });
}

export async function fetchSubjectHistory(subjectRef: string): Promise<PatientHistoryResponse> {
  const path = `/api/subjects/${encodeURIComponent(subjectRef)}/history`;
  const traceId = generateTraceId("frontend-history");
  const requestInit = (): RequestInit => ({
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() },
  });
  let response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  }
  if (!response.ok) throw historyApiError(path, response, await readError(response));
  return normalizeSubjectHistoryResponse(await response.json(), subjectRef);
}

function normalizeSubjectSummary(value: unknown, path: string): SubjectSummary {
  const record = asRecord(value);
  const subjectRef = record && optionalString(record, "subjectRef");
  const latestCaseId = record && optionalString(record, "latestCaseId");
  if (!record || !subjectRef || !latestCaseId || typeof record.studyCount !== "number") {
    throw contractError(record, path);
  }
  return {
    subjectRef,
    studyCount: record.studyCount,
    latestStudyDate: optionalString(record, "latestStudyDate"),
    latestCaseId,
    latestAnalysisStatus: optionalString(record, "latestAnalysisStatus"),
    latestReviewStatus: optionalString(record, "latestReviewStatus"),
  };
}

/** Stage 85-B: la lista de pacientes -- proyección agregada sobre `Study.subjectRef`, nunca una entidad Patient. */
export async function fetchSubjectList(): Promise<SubjectSummary[]> {
  const path = "/api/subjects";
  const traceId = generateTraceId("frontend-history");
  const requestInit = (): RequestInit => ({
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() },
  });
  let response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  }
  if (!response.ok) throw historyApiError(path, response, await readError(response));
  const payload = await response.json();
  if (!Array.isArray(payload)) throw contractError(undefined, path);
  return payload.map((entry) => normalizeSubjectSummary(entry, path));
}

async function subjectGet(subjectRef: string, path: string): Promise<unknown> {
  const traceId = generateTraceId("frontend-history");
  const requestInit = (): RequestInit => ({
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() },
  });
  let response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, requestInit());
  }
  if (!response.ok) throw historyApiError(path, response, await readError(response));
  return response.json();
}

function normalizeSeriesKey(value: unknown, path: string): MeasurementSeriesKey {
  const record = asRecord(value);
  const plane = record && optionalString(record, "plane");
  const structure = record && optionalString(record, "structure");
  const metric = record && optionalString(record, "metric");
  const unit = record && optionalString(record, "unit");
  if (!record || !plane || !structure || !metric || !unit) throw contractError(record, path);
  return { level: optionalString(record, "level"), plane, structure, metric, unit };
}

/** Stage 84-M: sólo keys con datos suficientes para una serie -- ver PatientMeasurementSeriesService. */
export async function fetchAvailableMeasurementSeriesKeys(subjectRef: string): Promise<MeasurementSeriesKey[]> {
  const path = `/api/subjects/${encodeURIComponent(subjectRef)}/measurement-series/keys`;
  const payload = await subjectGet(subjectRef, path);
  if (!Array.isArray(payload)) throw contractError(undefined, path);
  return payload.map((entry) => normalizeSeriesKey(entry, path));
}

/** Stage 84-I: un valor de medición a través de N Studies -- nunca calculado en el Frontend. */
export async function fetchMeasurementSeries(subjectRef: string, key: MeasurementSeriesKey): Promise<MeasurementSeries> {
  const params = new URLSearchParams({ plane: key.plane, structure: key.structure, metric: key.metric });
  if (key.level) params.set("level", key.level);
  const path = `/api/subjects/${encodeURIComponent(subjectRef)}/measurement-series?${params.toString()}`;
  const payload = await subjectGet(subjectRef, path);
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.points)) throw contractError(record, path);
  const points = record.points.map((entry) => {
    const point = asRecord(entry);
    const caseId = point && optionalString(point, "caseId");
    if (!point || !caseId) throw contractError(point, path);
    return {
      caseId,
      studyDate: optionalString(point, "studyDate"),
      automaticValue: typeof point.automaticValue === "number" ? point.automaticValue : null,
      correctedValue: typeof point.correctedValue === "number" ? point.correctedValue : null,
      effectiveValue: typeof point.effectiveValue === "number" ? point.effectiveValue : null,
      effectiveSource: optionalString(point, "effectiveSource") ?? "ai_original",
    };
  });
  return { key: normalizeSeriesKey(record.key, path), points };
}
