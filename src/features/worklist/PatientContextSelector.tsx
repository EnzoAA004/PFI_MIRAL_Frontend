import { useEffect, useState } from "react";
import { createPatient, searchPatients, type Patient } from "../../patientApi";

type Props = {
  disabled?: boolean;
  selected: Patient | null;
  onSelect: (patient: Patient | null) => void;
  onContinueDeidentified: () => void;
};

export function PatientContextSelector({ disabled = false, selected, onSelect, onContinueDeidentified }: Props) {
  const [mode, setMode] = useState<"search" | "create" | "none">(selected ? "search" : "search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ patientReference: "", firstName: "", lastName: "", dateOfBirth: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (mode !== "search" || !query.trim() || selected) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void searchPatients(query).then((items) => { if (!cancelled) setResults(items); }).catch(() => { if (!cancelled) setError("No se pudieron buscar pacientes."); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [mode, query, selected]);

  async function create() {
    if (!draft.patientReference.trim()) { setError("Ingresá un código visible de paciente."); return; }
    setCreating(true); setError("");
    try { const patient = await createPatient(draft); onSelect(patient); setMode("search"); }
    catch { setError("No se pudo crear el paciente. Revisá el código e intentá nuevamente."); }
    finally { setCreating(false); }
  }

  if (selected) {
    return <section className="ns-selected-patient" aria-live="polite">
      <div><strong>{[selected.firstName, selected.lastName].filter(Boolean).join(" ") || "Paciente desidentificado"}</strong><span>{selected.patientReference}</span></div>
      <button type="button" disabled={disabled} onClick={() => onSelect(null)}>Cambiar</button>
    </section>;
  }

  return <section className="ns-patient-block" aria-labelledby="new-study-patient-title">
    <div className="ns-section-heading"><div><h2 id="new-study-patient-title">Paciente</h2><p>Asociá el estudio para recuperar contexto longitudinal. También podés continuar sin asociación.</p></div></div>
    <div className="ns-patient-actions">
      <button type="button" className={mode === "search" ? "is-active" : ""} disabled={disabled} onClick={() => { setMode("search"); setError(""); }}>Buscar existente</button>
      <button type="button" className={mode === "create" ? "is-active" : ""} disabled={disabled} onClick={() => { setMode("create"); setError(""); }}>Crear paciente</button>
      <button type="button" className={mode === "none" ? "is-active" : ""} disabled={disabled} onClick={() => { setMode("none"); onContinueDeidentified(); }}>Continuar sin asociar paciente</button>
    </div>
    {mode === "search" && <div className="ns-patient-search"><label>Buscar por código o nombre<input value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder="PAC-001" /></label>{loading && <p>Buscando pacientes…</p>}{error && <p className="ns-error">{error}</p>}{results.length > 0 && <ul>{results.map((patient) => <li key={patient.id}><button type="button" onClick={() => onSelect(patient)}>{[patient.firstName, patient.lastName].filter(Boolean).join(" ") || "Paciente desidentificado"}<span>{patient.patientReference}</span></button></li>)}</ul>}{!loading && query.trim() && !results.length && !error && <p>No se encontraron pacientes.</p>}</div>}
    {mode === "create" && <div className="ns-patient-create"><label>Código visible<input value={draft.patientReference} disabled={disabled || creating} onChange={(event) => setDraft({ ...draft, patientReference: event.target.value })} placeholder="PAC-001" /></label><div className="ns-two-fields"><label>Nombre<input value={draft.firstName} disabled={disabled || creating} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} /></label><label>Apellido<input value={draft.lastName} disabled={disabled || creating} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} /></label></div><label>Fecha de nacimiento <span className="ns-optional">opcional</span><input type="date" value={draft.dateOfBirth} disabled={disabled || creating} onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })} /></label><p className="ns-help">No ingreses DNI, domicilio ni otros datos administrativos.</p><button type="button" className="ns-primary-small" disabled={disabled || creating} onClick={() => void create()}>{creating ? "Creando…" : "Crear y seleccionar"}</button></div>}
    {mode === "none" && <p className="ns-muted">El estudio quedará sin paciente asociado. No se crea una identidad nueva.</p>}
  </section>;
}
