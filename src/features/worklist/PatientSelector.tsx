import { useEffect, useState, type FormEvent } from "react";
import { createPatient, patientDisplayName, searchPatients, type Patient } from "../../patientApi";
import { formatIsoDateDMY } from "../../studyAge";

type Mode = "search" | "create";

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

function summaryLine(patient: Patient) {
  const name = patientDisplayName(patient);
  return name || "Paciente sin nombre cargado";
}

/**
 * Asociación opcional de un paciente: buscar por código o nombre, crear uno nuevo, o seguir
 * sin asociar. El paciente se guarda como entidad propia; el contexto clínico del estudio
 * (edad, motivo, etc.) no vive acá.
 */
export function PatientSelector({ disabled = false, selected, withoutPatient, onSelect, onWithoutPatient }: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [retryToken, setRetryToken] = useState(0);
  const [draft, setDraft] = useState({ patientReference: "", firstName: "", lastName: "", dateOfBirth: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    if (mode !== "search" || selected || withoutPatient) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearch({ status: "idle" });
      return;
    }
    /* Una búsqueda vieja que llega tarde no pisa a la última escrita. */
    let cancelled = false;
    setSearch({ status: "loading" });
    const timer = window.setTimeout(() => {
      searchPatients(trimmed)
        .then((patients) => { if (!cancelled) setSearch({ status: "ready", patients }); })
        .catch(() => { if (!cancelled) setSearch({ status: "error" }); });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query, selected, withoutPatient, retryToken]);

  async function submitNewPatient(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    if (!draft.patientReference.trim()) {
      setCreateError("Ingresá un código visible para el paciente.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const patient = await createPatient(draft);
      setDraft({ patientReference: "", firstName: "", lastName: "", dateOfBirth: "" });
      onSelect(patient);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "No se pudo crear el paciente.");
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return (
      <section aria-live="polite" aria-label="Paciente seleccionado" className="ns-card ns-patient-summary">
        <div className="ns-card-head">
          <h2>Paciente</h2>
          <button className="ns-link-button" disabled={disabled} onClick={() => onSelect(null)} type="button">Cambiar</button>
        </div>
        <dl className="ns-facts">
          <div><dt>Nombre</dt><dd>{summaryLine(selected)}</dd></div>
          <div><dt>Código</dt><dd>{selected.patientReference}</dd></div>
          <div><dt>Nacimiento</dt><dd>{selected.dateOfBirth ? formatIsoDateDMY(selected.dateOfBirth) : "No informada"}</dd></div>
        </dl>
      </section>
    );
  }

  if (withoutPatient) {
    return (
      <section aria-live="polite" aria-label="Sin paciente asociado" className="ns-card ns-patient-summary">
        <div className="ns-card-head">
          <h2>Paciente</h2>
          <button className="ns-link-button" disabled={disabled} onClick={() => onWithoutPatient(false)} type="button">Asociar paciente</button>
        </div>
        <p className="ns-muted">El estudio se guarda sin paciente asociado. No se crea ninguna identidad.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="patient-section-title" className="ns-card">
      <div className="ns-card-head">
        <h2 id="patient-section-title">Paciente</h2>
        <span>opcional</span>
      </div>

      <div aria-label="Cómo asociar el paciente" className="ns-segmented" role="radiogroup">
        <label className={mode === "search" ? "is-active" : ""}>
          <input checked={mode === "search"} disabled={disabled} name="patient-mode" onChange={() => setMode("search")} type="radio" />
          Buscar existente
        </label>
        <label className={mode === "create" ? "is-active" : ""}>
          <input checked={mode === "create"} disabled={disabled} name="patient-mode" onChange={() => { setMode("create"); setCreateError(""); }} type="radio" />
          Crear paciente
        </label>
      </div>

      {mode === "search" ? (
        <div className="ns-patient-search">
          <label className="wl-field" htmlFor="patient-search-query">
            <span>Buscar por código o nombre</span>
            <input
              autoComplete="off"
              disabled={disabled}
              id="patient-search-query"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="PAC-001 o apellido"
              value={query}
            />
          </label>
          <div aria-live="polite" className="ns-patient-results-state">
            {search.status === "idle" && <p className="ns-muted">Escribí un código o parte del nombre.</p>}
            {search.status === "loading" && <p className="ns-muted">Buscando pacientes…</p>}
            {search.status === "error" && (
              <p className="wl-drawer-error">
                No se pudo buscar pacientes.{" "}
                <button className="ns-link-button" disabled={disabled} onClick={() => setRetryToken((token) => token + 1)} type="button">Reintentar</button>
              </p>
            )}
            {search.status === "ready" && search.patients.length === 0 && <p className="ns-muted">No se encontraron pacientes.</p>}
            {search.status === "ready" && search.patients.length > 0 && (
              <ul aria-label="Resultados de pacientes" className="ns-patient-results">
                {search.patients.map((patient) => (
                  <li key={patient.id}>
                    <button disabled={disabled} onClick={() => onSelect(patient)} type="button">
                      <strong>{summaryLine(patient)}</strong>
                      <span>{patient.patientReference}{patient.dateOfBirth ? ` · ${formatIsoDateDMY(patient.dateOfBirth)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <form className="ns-patient-create" onSubmit={(event) => { void submitNewPatient(event); }}>
          <label className="wl-field" htmlFor="new-patient-reference">
            <span>Código visible <b aria-hidden="true" className="ns-req">*</b></span>
            <input
              aria-required="true"
              autoComplete="off"
              disabled={disabled || creating}
              id="new-patient-reference"
              maxLength={64}
              onChange={(event) => { setDraft({ ...draft, patientReference: event.target.value }); setCreateError(""); }}
              placeholder="PAC-001"
              value={draft.patientReference}
            />
          </label>
          <div className="ns-two-fields">
            <label className="wl-field" htmlFor="new-patient-first-name">
              <span>Nombre <i>(opcional)</i></span>
              <input autoComplete="off" disabled={disabled || creating} id="new-patient-first-name" maxLength={80} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} value={draft.firstName} />
            </label>
            <label className="wl-field" htmlFor="new-patient-last-name">
              <span>Apellido <i>(opcional)</i></span>
              <input autoComplete="off" disabled={disabled || creating} id="new-patient-last-name" maxLength={80} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} value={draft.lastName} />
            </label>
          </div>
          <label className="wl-field" htmlFor="new-patient-birth-date">
            <span>Fecha de nacimiento <i>(opcional)</i></span>
            <input disabled={disabled || creating} id="new-patient-birth-date" onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })} type="date" value={draft.dateOfBirth} />
            <em>Permite calcular la edad al momento de cada estudio.</em>
          </label>
          <p className="ns-muted">No ingreses DNI, domicilio ni otros datos administrativos.</p>
          {createError && <p className="wl-drawer-error" role="alert">{createError}</p>}
          <button className="ns-primary-small" disabled={disabled || creating} type="submit">{creating ? "Creando…" : "Crear y seleccionar"}</button>
        </form>
      )}

      <button className="ns-link-button ns-skip" disabled={disabled} onClick={() => onWithoutPatient(true)} type="button">Continuar sin asociar paciente</button>
    </section>
  );
}
