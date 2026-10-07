import { API_BASE_URL, ApiError } from "./api";
import { authHeaders, refreshDoctorSession } from "./authClient";
import { normalizePatient, type Patient } from "./patientApi";
import { toSafeFrontendError } from "./security/safeError";
import { generateTraceId } from "./security/traceId";

/** Contexto clínico propio del estudio, tal como quedó guardado. */
export type StudyClinicalContext = {
  ageAtStudy: number | null;
  ageProvenance: string | null;
  clinicalReason: string | null;
  symptoms: string | null;
  symptomDuration: string | null;
  relevantHistory: string | null;
};

export type StudyContext = {
  caseId: string;
  patient: Patient | null;
  clinicalContext: StudyClinicalContext | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeStudyContext(value: unknown): StudyContext | null {
  const record = asRecord(value);
  const caseId = record && text(record, "caseId");
  if (!record || !caseId) return null;
  const context = asRecord(record.clinicalContext);
  return {
    caseId,
    patient: normalizePatient(record.patient),
    clinicalContext: context
      ? {
        ageAtStudy: typeof context.ageAtStudy === "number" ? context.ageAtStudy : null,
        ageProvenance: text(context, "ageProvenance"),
        clinicalReason: text(context, "clinicalReason"),
        symptoms: text(context, "symptoms"),
        symptomDuration: text(context, "symptomDuration"),
        relevantHistory: text(context, "relevantHistory"),
      }
      : null,
  };
}

export async function fetchStudyContext(caseId: string): Promise<StudyContext> {
  const path = `/api/studies/${encodeURIComponent(caseId)}/context`;
  const traceId = generateTraceId("frontend-study-context");
  const build = (): RequestInit => ({ headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() } });
  let response = await fetch(`${API_BASE_URL}${path}`, build());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, build());
  }
  if (!response.ok) {
    throw new ApiError(toSafeFrontendError(response.status, {}).message, { status: response.status, path });
  }
  const context = normalizeStudyContext(await response.json());
  if (!context) throw new ApiError("La respuesta del servidor no describe el contexto del estudio.", { path });
  return context;
}
