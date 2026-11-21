import { useEffect, useState } from "react";
import { assignStudyPatient, findPatientByReference, searchPatients, type Patient } from "../../patientApi";

type Props = {
  caseId: string;
  /** Código visible del paciente hoy asociado (null si el estudio no tiene paciente). */
  currentPatientCode: string | null;
  /** Se llama con el paciente nuevo una vez guardado. */
  onAssigned: (patient: Patient) => void;
};

function label(patient: Patient): string {
  return [patient.firstName, patient.lastName].filter(Boolean).join(" ") || "Sin nombre";
}

/**
 * Asignar o corregir el paciente de un estudio ya cargado: sirve tanto si se olvidó asociarlo
 * como si se eligió el paciente equivocado. Solo se ofrecen pacientes habilitados.
 */
export function StudyPatientEditor({ caseId, currentPatientCode, onAssigned }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [chosen, setChosen] = useState<Patient | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!open || chosen || !query.trim()) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchPatients(query)
        .then((items) => { if (!cancelled) setResults(items); })
        .catch(() => { if (!cancelled) setMessage({ tone: "error", text: "No se pudieron buscar pacientes." }); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query, chosen]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setChosen(null);
  }

  async function save() {
    if (!chosen) return;
    setSaving(true);
    setMessage(null);
    try {
      let expectedPatientId: string | null = null;
      if (currentPatientCode) {
        const current = await findPatientByReference(currentPatientCode);
        if (!current) throw new Error("current-not-found");
        expectedPatientId = current.id;
      }
      const result = await assignStudyPatient(caseId, chosen.id, expectedPatientId);
      onAssigned(chosen);
      close();
      setMessage({ tone: "ok", text: result.changed ? "Paciente del estudio actualizado." : "El estudio ya estaba asociado a ese paciente." });
    } catch {
      setMessage({ tone: "error", text: "No se pudo guardar el cambio. Actualizá la lista y volvé a intentar; el paciente tiene que estar habilitado." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="study-patient-editor">
      {!open && (
        <button className="ghost-button" onClick={() => { setOpen(true); setMessage(null); }} type="button">
          {currentPatientCode ? "Cambiar paciente" : "Asignar paciente"}
        </button>
      )}
      {open && (
        <div className="study-patient-editor-form">
          <label>
            <span>{currentPatientCode ? "Nuevo paciente" : "Paciente"} (código o nombre)</span>
            <input autoComplete="off" disabled={saving} onChange={(event) => { setQuery(event.target.value); setChosen(null); }} placeholder="PAC-001" value={chosen ? `${label(chosen)} · ${chosen.patientReference}` : query} />
          </label>
          {searching && <p className="wl-panel-note">Buscando…</p>}
          {!chosen && results.length > 0 && (
            <ul className="study-patient-results">
              {results.map((patient) => (
                <li key={patient.id}><button onClick={() => setChosen(patient)} type="button">{label(patient)}<span>{patient.patientReference}</span></button></li>
              ))}
            </ul>
          )}
          {!chosen && !searching && query.trim() && results.length === 0 && <p className="wl-panel-note">No se encontraron pacientes habilitados.</p>}
          <div className="study-patient-actions">
            <button className="ghost-button" disabled={!chosen || saving} onClick={() => void save()} type="button">{saving ? "Guardando…" : "Guardar"}</button>
            <button className="ghost-button" disabled={saving} onClick={close} type="button">Cancelar</button>
          </div>
        </div>
      )}
      {message && <p className={message.tone === "ok" ? "registered-patients-ok" : "registered-patients-error"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
    </div>
  );
}
