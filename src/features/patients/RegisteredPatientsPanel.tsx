import { useCallback, useEffect, useState } from "react";
import { searchPatients, setPatientActive, updatePatient, type Patient, type PatientEdit } from "../../patientApi";

function fullName(patient: Patient): string {
  return [patient.firstName, patient.lastName].filter(Boolean).join(" ") || "Sin nombre";
}

function toEdit(patient: Patient): PatientEdit {
  return {
    patientReference: patient.patientReference,
    firstName: patient.firstName ?? "",
    lastName: patient.lastName ?? "",
    dateOfBirth: patient.dateOfBirth ?? "",
  };
}

/**
 * Pacientes registrados: permite corregir un dato mal cargado y deshabilitar (o volver a habilitar)
 * a un paciente sin borrarlo. Un paciente deshabilitado conserva su historial, pero no se ofrece
 * al crear análisis nuevos.
 */
export function RegisteredPatientsPanel() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PatientEdit>({ patientReference: "", firstName: "", lastName: "", dateOfBirth: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async (text: string) => {
    setStatus("loading");
    try {
      setPatients(await searchPatients(text, { includeInactive: true, limit: 50 }));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 250);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  function replace(updated: Patient) {
    setPatients((current) => current.map((patient) => (patient.id === updated.id ? updated : patient)));
  }

  async function toggleActive(patient: Patient) {
    const next = patient.active === false;
    setBusyId(patient.id);
    setMessage(null);
    try {
      replace(await setPatientActive(patient.id, next));
      setMessage({ tone: "ok", text: next ? "Paciente habilitado." : "Paciente deshabilitado. Conserva su historial, pero ya no se ofrece para nuevos análisis." });
    } catch {
      setMessage({ tone: "error", text: "No se pudo cambiar el estado del paciente. Intentá de nuevo." });
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(patient: Patient) {
    if (!draft.patientReference.trim()) {
      setMessage({ tone: "error", text: "El código del paciente no puede quedar vacío." });
      return;
    }
    setBusyId(patient.id);
    setMessage(null);
    try {
      replace(await updatePatient(patient.id, draft));
      setEditingId(null);
      setMessage({ tone: "ok", text: "Datos del paciente actualizados." });
    } catch {
      setMessage({ tone: "error", text: "No se pudieron guardar los cambios. Revisá el código (puede estar repetido) e intentá de nuevo." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel-card patient-directory-panel registered-patients" aria-labelledby="registered-patients-title">
      <div className="section-title"><h2 id="registered-patients-title">Pacientes registrados</h2></div>
      <p className="muted">Corregí los datos de un paciente o deshabilitalo si se cargó por error. No ingreses DNI, domicilio ni otros datos administrativos.</p>
      <div className="patient-directory-search">
        <label className="worklist-search-input" htmlFor="registered-patient-query">
          <span>Buscar por código o nombre</span>
          <input autoComplete="off" id="registered-patient-query" onChange={(event) => setQuery(event.target.value)} placeholder="PAC-001" type="search" value={query} />
        </label>
      </div>
      {message && <p className={message.tone === "ok" ? "registered-patients-ok" : "registered-patients-error"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
      <div aria-busy={status === "loading"}>
        {status === "loading" && patients.length === 0 && <div className="panel-hidden-placeholder">Consultando pacientes…</div>}
        {status === "error" && (
          <div className="clinical-empty-state" role="alert">
            <h3>No se pudo cargar la lista de pacientes registrados</h3>
            <button className="ghost-button" onClick={() => void load(query)} type="button">Reintentar</button>
          </div>
        )}
        {status === "ready" && patients.length === 0 && <div className="clinical-empty-state"><h3>{query.trim() ? "No se encontraron pacientes." : "Todavía no hay pacientes registrados."}</h3></div>}
        {patients.length > 0 && (
          <ul className="patient-directory-list" aria-label="Pacientes registrados">
            {patients.map((patient) => {
              const editing = editingId === patient.id;
              const inactive = patient.active === false;
              const busy = busyId === patient.id;
              return (
                <li key={patient.id} className={inactive ? "patient-row-inactive" : undefined}>
                  {editing ? (
                    <div className="registered-patient-form">
                      <label>Código visible<input disabled={busy} onChange={(event) => setDraft({ ...draft, patientReference: event.target.value })} value={draft.patientReference} /></label>
                      <label>Nombre<input disabled={busy} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} value={draft.firstName} /></label>
                      <label>Apellido<input disabled={busy} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} value={draft.lastName} /></label>
                      <label>Fecha de nacimiento<input disabled={busy} onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })} type="date" value={draft.dateOfBirth} /></label>
                      <div className="registered-patient-actions">
                        <button className="ghost-button" disabled={busy} onClick={() => void saveEdit(patient)} type="button">{busy ? "Guardando…" : "Guardar"}</button>
                        <button className="ghost-button" disabled={busy} onClick={() => setEditingId(null)} type="button">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>{fullName(patient)}</strong>
                        <span>
                          {patient.patientReference}
                          {patient.dateOfBirth ? ` · Nacimiento: ${patient.dateOfBirth}` : ""}
                          {inactive ? " · Deshabilitado" : ""}
                        </span>
                      </div>
                      <div className="registered-patient-actions">
                        <button className="ghost-button" disabled={busy} onClick={() => { setEditingId(patient.id); setDraft(toEdit(patient)); setMessage(null); }} type="button">Editar</button>
                        <button className="ghost-button" disabled={busy} onClick={() => void toggleActive(patient)} type="button">{inactive ? "Habilitar" : "Deshabilitar"}</button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
