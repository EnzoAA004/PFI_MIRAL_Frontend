import { API_BASE_URL, ApiError } from "./api";
import { authHeaders, refreshDoctorSession } from "./authClient";
import { toSafeFrontendError } from "./security/safeError";
import { generateTraceId } from "./security/traceId";

export type Patient = {
  id: string;
  patientReference: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
};

export type NewPatientInput = {
  patientReference: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
};

const patientErrorMessages: Record<string, string> = {
  DUPLICATE_PATIENT_REFERENCE: "Ya existe un paciente con ese código.",
  INVALID_PATIENT_REFERENCE: "El código debe tener entre 1 y 64 letras, números, punto, guion o guion bajo.",
  INVALID_PATIENT_NAME: "El nombre y el apellido admiten solo letras, espacios, punto, apóstrofe o guion.",
  INVALID_PATIENT_BIRTH_DATE: "La fecha de nacimiento debe estar entre 1900 y hoy.",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizePatient(value: unknown): Patient | null {
  const record = asRecord(value);
  const id = record && text(record, "id");
  const patientReference = record && text(record, "patientReference");
  if (!record || !id || !patientReference) return null;
  return { id, patientReference, firstName: text(record, "firstName"), lastName: text(record, "lastName"), dateOfBirth: text(record, "dateOfBirth") };
}

export function patientDisplayName(patient: Pick<Patient, "firstName" | "lastName">): string {
  return [patient.firstName, patient.lastName].filter(Boolean).join(" ");
}

async function request(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  const traceId = generateTraceId("frontend-patient");
  const build = (): RequestInit => ({
    method: init.method,
    headers: { "Content-Type": "application/json", "X-Trace-Id": traceId, ...authHeaders() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let response = await fetch(`${API_BASE_URL}${path}`, build());
  if (response.status === 401) {
    await refreshDoctorSession();
    response = await fetch(`${API_BASE_URL}${path}`, build());
  }
  if (!response.ok) {
    let body: Record<string, unknown> | undefined;
    try { body = asRecord(await response.clone().json()); } catch { body = undefined; }
    const code = typeof body?.code === "string" ? body.code : undefined;
    const responseTrace = typeof body?.traceId === "string" ? body.traceId : response.headers.get("X-Trace-Id") ?? undefined;
    const message = (code && patientErrorMessages[code]) || toSafeFrontendError(response.status, { code, traceId: responseTrace }).message;
    throw new ApiError(message, { status: response.status, code, path, traceId: responseTrace, body });
  }
  return response;
}

/** Busca por prefijo de código o por nombre/apellido. */
export async function searchPatients(query: string, limit = 8): Promise<Patient[]> {
  const response = await request(`/api/patients?query=${encodeURIComponent(query.trim())}&limit=${limit}`, { method: "GET" });
  const payload = await response.json();
  return Array.isArray(payload) ? payload.map(normalizePatient).filter((patient): patient is Patient => patient !== null) : [];
}

export async function createPatient(input: NewPatientInput): Promise<Patient> {
  const body = {
    patientReference: input.patientReference.trim(),
    firstName: input.firstName?.trim() || undefined,
    lastName: input.lastName?.trim() || undefined,
    dateOfBirth: input.dateOfBirth || undefined,
  };
  const response = await request("/api/patients", { method: "POST", body });
  const patient = normalizePatient(await response.json());
  if (!patient) throw new ApiError("La respuesta del servidor no describe un paciente válido.", { path: "/api/patients" });
  return patient;
}
