import { multiplanarRequest } from "./multiplanarApi";

export type Patient = {
  id: string;
  patientReference: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function searchPatients(query: string): Promise<Patient[]> {
  const params = new URLSearchParams({ query: query.trim(), limit: "25" });
  return multiplanarRequest<Patient[]>(`/api/patients?${params.toString()}`);
}

export async function createPatient(payload: { patientReference: string; firstName?: string; lastName?: string; dateOfBirth?: string }): Promise<Patient> {
  return multiplanarRequest<Patient>("/api/patients", { method: "POST", body: JSON.stringify(payload) });
}
