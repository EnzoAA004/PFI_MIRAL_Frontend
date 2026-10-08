import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { patientDisplayName, searchPatients, type Patient } from "../../patientApi";
import { formatIsoDateDMY } from "../../studyAge";
import { CreatePatientDialog } from "./CreatePatientDialog";

type Props = {
  disabled?: boolean;
  selected: Patient | null;
  /** El usuario eligió explícitamente continuar sin asociar un paciente. */
  withoutPatient: boolean;
  onSelect: (patient: Patient | null) => void;
  onWithoutPatient: (value: boolean) => void;
};

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; patients: Patient[] }
  | { status: "error" };

/** Resultados que se muestran por búsqueda: pocos, para que la lista no empuje al resto del paso. */
const RESULT_LIMIT = 5;

function nameOrFallback(patient: Patient) {
  return patientDisplayName(patient) || "Paciente sin nombre cargado";
}

/**
 * Asociación opcional de un paciente. La acción principal es buscar uno existente por código o
 * nombre; crear uno abre un diálogo aparte, y seguir sin asociar es una opción explícita.
 * El paciente es una entidad propia: el contexto clínico del estudio (edad, motivo, etc.) no
 * vive acá.
 */
export function PatientSelector({ disabled = false, selected, withoutPatient, onSelect, onWithoutPatient }: Props) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [retryToken, setRetryToken] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  useEffect(() => {
    if (selected || withoutPatient) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearch({ status: "idle" });
      return;
    }
    /* Una búsqueda vieja que llega tarde no pisa a la última escrita. */
    let cancelled = false;
    setSearch({ status: "loading" });
    const timer = window.setTimeout(() => {
      searchPatients(trimmed, RESULT_LIMIT)
        .then((patients) => { if (!cancelled) setSearch({ status: "ready", patients }); })
        .catch(() => { if (!cancelled) setSearch({ status: "error" }); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, selected, withoutPatient, retryToken]);

  if (selected) {
    return (
      <div aria-label="Paciente seleccionado" className="ns-patient-selected" role="group">
        <dl className="ns-facts">
          <div><dt>Nombre</dt><dd>{nameOrFallback(selected)}</dd></div>
          <div><dt>Código</dt><dd>{selected.patientReference}</dd></div>
          <div><dt>Nacimiento</dt><dd>{selected.dateOfBirth ? formatIsoDateDMY(selected.dateOfBirth) : "No informada"}</dd></div>
        </dl>
        <button className="ns-link-button" disabled={disabled} onClick={() => { setJustCreated(false); onSelect(null); }} type="button">Cambiar</button>
        {justCreated && <p className="ns-note" role="status">Paciente creado y seleccionado. Falta continuar con el estudio.</p>}
      </div>
    );
  }

  if (withoutPatient) {
    return (
      <div aria-label="Sin paciente asociado" className="ns-patient-selected" role="group">
        <p className="ns-patient-none"><strong>Sin asociación.</strong> El estudio se guarda sin paciente; no se crea ninguna identidad.</p>
        <button className="ns-link-button" disabled={disabled} onClick={() => onWithoutPatient(false)} type="button">Asociar paciente</button>
      </div>
    );
  }

  return (
    <div className="ns-patient-search">
      <label className="wl-field" htmlFor="patient-search-query">
        <span>Buscar paciente por código o nombre</span>
        <input
          autoComplete="off"
          disabled={disabled}
          id="patient-search-query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="PAC-001 o apellido"
          value={query}
        />
      </label>
      <div aria-live="polite" className="ns-search-state">
        {search.status === "loading" && <p className="ns-muted">Buscando pacientes…</p>}
        {search.status === "error" && (
          <p className="wl-drawer-error">
            No se pudo buscar pacientes.{" "}
            <button className="ns-link-button" disabled={disabled} onClick={() => setRetryToken((token) => token + 1)} type="button">Reintentar</button>
          </p>
        )}
        {search.status === "ready" && search.patients.length === 0 && <p className="ns-muted">No se encontraron pacientes.</p>}
        {search.status === "ready" && search.patients.length > 0 && (
          <>
            <ul aria-label="Resultados de pacientes" className="ns-results">
              {search.patients.map((patient) => (
                <li key={patient.id}>
                  <button disabled={disabled} onClick={() => onSelect(patient)} type="button">
                    <strong>{nameOrFallback(patient)}</strong>
                    <span>{patient.patientReference}{patient.dateOfBirth ? ` · ${formatIsoDateDMY(patient.dateOfBirth)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            {search.patients.length >= RESULT_LIMIT && <p className="ns-muted">Se muestran los primeros {RESULT_LIMIT}. Afiná la búsqueda para ver otros.</p>}
          </>
        )}
      </div>
      <div className="ns-patient-actions">
        <button className="ns-btn" disabled={disabled} onClick={() => setDialogOpen(true)} type="button">
          <UserPlus aria-hidden size={16} />Crear paciente
        </button>
        <button className="ns-link-button" disabled={disabled} onClick={() => onWithoutPatient(true)} type="button">Continuar sin asociar paciente</button>
      </div>
      {dialogOpen && (
        <CreatePatientDialog
          onCancel={() => setDialogOpen(false)}
          onCreated={(patient) => {
            setDialogOpen(false);
            setJustCreated(true);
            onSelect(patient);
          }}
        />
      )}
    </div>
  );
}
