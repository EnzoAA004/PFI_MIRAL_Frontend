import { multiplanarRequest } from "./multiplanarApi";

export type Patient = {
  id: string;
  patientReference: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  /** Los pacientes deshabilitados no aparecen en la búsqueda de nuevos análisis y no reciben estudios. */
  active?: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function searchPatients(query: string, options: { includeInactive?: boolean; limit?: number } = {}): Promise<Patient[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: String(options.limit ?? 25) });
  if (options.includeInactive) params.set("includeInactive", "true");
  return multiplanarRequest<Patient[]>(`/api/patients?${params.toString()}`);
}

export type PatientEdit = { patientReference: string; firstName: string; lastName: string; dateOfBirth: string };

/** Corrige los datos de un paciente ya registrado (el backend reemplaza nombre, apellido y fecha). */
export async function updatePatient(patientId: string, edit: PatientEdit): Promise<Patient> {
  const payload = {
    patientReference: edit.patientReference.trim(),
    firstName: edit.firstName.trim() || null,
    lastName: edit.lastName.trim() || null,
    dateOfBirth: edit.dateOfBirth || null,
  };
  return multiplanarRequest<Patient>(`/api/patients/${encodeURIComponent(patientId)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function setPatientActive(patientId: string, active: boolean): Promise<Patient> {
  return multiplanarRequest<Patient>(`/api/patients/${encodeURIComponent(patientId)}/active`, { method: "PATCH", body: JSON.stringify({ active }) });
}

export async function createPatient(payload: { patientReference: string; firstName?: string; lastName?: string; dateOfBirth?: string }): Promise<Patient> {
  return multiplanarRequest<Patient>("/api/patients", { method: "POST", body: JSON.stringify(payload) });
}

export type StudyPatientAssignment = { studyId: string; caseId: string; patientId: string; previousPatientId: string | null; reasonCode: string; changed: boolean };

/**
 * Asocia un estudio a un paciente o corrige la asociación existente.
 * El backend exige el motivo correcto (primera asociación vs. corrección) y el paciente que se creía asociado,
 * para no pisar un cambio hecho desde otra pantalla.
 */
export async function assignStudyPatient(caseId: string, patientId: string, expectedPatientId: string | null): Promise<StudyPatientAssignment> {
  const payload = { patientId, expectedPatientId, reason: expectedPatientId ? "CORRECTION" : "INITIAL_ASSIGNMENT" };
  return multiplanarRequest<StudyPatientAssignment>(`/api/studies/${encodeURIComponent(caseId)}/patient`, { method: "PUT", body: JSON.stringify(payload) });
}

/** El listado de estudios trae el código visible del paciente, no su identificador interno: se resuelve por código exacto. */
export async function findPatientByReference(patientReference: string): Promise<Patient | null> {
  const items = await searchPatients(patientReference, { includeInactive: true, limit: 25 });
  return items.find((item) => item.patientReference === patientReference) ?? null;
}

