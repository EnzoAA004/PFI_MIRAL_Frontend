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
