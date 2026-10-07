import { useEffect, useState, type FormEvent } from "react";
import type { SubjectSummary } from "../../appTypes";
import { displayStudyDate } from "../../studyDisplay";
import { fetchSubjectList } from "../../subjectHistoryApi";
import { validateSubjectRef } from "../../studyMetadata";

type Mode = "existing" | "new";

type Props = {
  disabled?: boolean;
  /** El `subjectRef` efectivo -- controlado por `NewAnalysisDrawer`, va directo a `metadata.subjectRef`. */
  value: string;
  onChange: (subjectRef: string) => void;
};

type ListState =
  | { status: "loading"; subjects: SubjectSummary[] }
  | { status: "ready"; subjects: SubjectSummary[] }
  | { status: "error"; subjects: SubjectSummary[] };

/**
 * Stage 86: reemplaza `PatientSelector.tsx`. No hay entidad `Patient` -- "seleccionar un
 * paciente" es elegir (o escribir) un `Study.subjectRef`, la misma identidad longitudinal
 * que Stage 84/85 ya usan para historial y lista. Fuente de "pacientes existentes":
 * `GET /api/subjects` (Stage 85), nunca el `/api/patients` inexistente.
 *
 * Sin selección el campo queda vacío -- 86-N: un Study puede crearse sin `subjectRef`
 * ("sin asociar"), consistente con que este campo ya era opcional antes de esta stage.
 */
export function SubjectSelector({ disabled = false, value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>("existing");
  const [query, setQuery] = useState("");
  const [listState, setListState] = useState<ListState>({ status: "loading", subjects: [] });
  const [newSubjectRef, setNewSubjectRef] = useState("");
  const [newSubjectError, setNewSubjectError] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  const selectedExisting = listState.status === "ready"
    ? listState.subjects.find((subject) => subject.subjectRef === value) ?? null
    : null;

  useEffect(() => {
    if (mode !== "existing" || value) return;
    let cancelled = false;
    setListState((current) => ({ status: "loading", subjects: current.subjects }));
    void fetchSubjectList()
      .then((subjects) => {
        if (!cancelled) setListState({ status: "ready", subjects });
      })
      .catch(() => {
        if (!cancelled) setListState({ status: "error", subjects: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, value, retryToken]);

  function changeMode(next: Mode) {
    setMode(next);
    onChange("");
    setNewSubjectRef("");
    setNewSubjectError("");
    setQuery("");
  }

  function clearSelection() {
    onChange("");
    setMode("existing");
  }

  function submitNewSubject(event: FormEvent) {
    event.preventDefault();
    const trimmed = newSubjectRef.trim();
    if (!trimmed) {
      setNewSubjectError("Ingresá una referencia para el paciente nuevo.");
      return;
    }
    const issue = validateSubjectRef(trimmed);
    if (issue) {
      setNewSubjectError(issue);
      return;
    }
    setNewSubjectError("");
    onChange(trimmed);
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubjects = listState.status === "ready"
    ? (normalizedQuery ? listState.subjects.filter((subject) => subject.latestCaseId.toLowerCase().includes(normalizedQuery)) : listState.subjects)
    : [];

  if (selectedExisting) {
    return (
      <section aria-live="polite" className="wl-patient-selected">
        <span className="wl-patient-selected-label"><b aria-hidden="true">01</b> Paciente seleccionado</span>
        <strong>
          Paciente existente · {selectedExisting.studyCount === 1 ? "1 estudio" : `${selectedExisting.studyCount} estudios`} · Último: {displayStudyDate(selectedExisting.latestStudyDate)}
        </strong>
        <button disabled={disabled} onClick={clearSelection} type="button">Cambiar</button>
      </section>
    );
  }

  if (mode === "new" && value) {
    return (
      <section aria-live="polite" className="wl-patient-selected">
        <span className="wl-patient-selected-label"><b aria-hidden="true">01</b> Paciente seleccionado</span>
        <strong>Paciente nuevo</strong>
        <button disabled={disabled} onClick={clearSelection} type="button">Cambiar</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="patient-section-title" className="wl-patient-selector">
      <div className="wl-patient-heading">
        <strong id="patient-section-title">Paciente</strong>
        <span>Opcional. Sin selección, el estudio queda sin paciente asociado.</span>
      </div>

      <div aria-label="Tipo de paciente" className="wl-patient-modes" role="radiogroup">
        <label>
          <input
            checked={mode === "existing"}
            disabled={disabled}
            name="patient-mode"
            onChange={() => changeMode("existing")}
            type="radio"
          />
          Paciente existente
        </label>
        <label>
          <input
            checked={mode === "new"}
            disabled={disabled}
            name="patient-mode"
            onChange={() => changeMode("new")}
            type="radio"
          />
          Paciente nuevo
        </label>
      </div>

      {mode === "existing" ? (
        <div className="wl-patient-search">
          <label className="wl-field" htmlFor="subject-search-query">
            <span>Buscar por caso</span>
            <input
              autoComplete="off"
              disabled={disabled}
              id="subject-search-query"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="CASE-001"
              value={query}
            />
          </label>
          <div aria-live="polite" className="wl-patient-search-state">
            {listState.status === "loading" && <p>Buscando pacientes…</p>}
            {listState.status === "error" && (
              <p className="wl-drawer-error">
                No se pudieron buscar pacientes.{" "}
                <button className="wl-patient-link" disabled={disabled} onClick={() => setRetryToken((token) => token + 1)} type="button">Reintentar</button>
              </p>
            )}
            {listState.status === "ready" && visibleSubjects.length === 0 && <p>No se encontraron pacientes.</p>}
            {listState.status === "ready" && visibleSubjects.length > 0 && (
              <ul aria-label="Resultados de pacientes" className="wl-patient-results">
                {visibleSubjects.map((subject) => (
                  <li key={subject.subjectRef}>
                    <button disabled={disabled} onClick={() => onChange(subject.subjectRef)} type="button">
                      Paciente existente · {subject.studyCount === 1 ? "1 estudio" : `${subject.studyCount} estudios`} · Último: {displayStudyDate(subject.latestStudyDate)} · Caso: {subject.latestCaseId}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <form className="wl-patient-create" onSubmit={submitNewSubject}>
          <label className="wl-field" htmlFor="new-subject-reference">
            <span>Referencia interna del estudio (opcional)</span>
            <input
              aria-describedby="new-subject-help"
              autoComplete="off"
              disabled={disabled}
              id="new-subject-reference"
              maxLength={64}
              onChange={(event) => {
                setNewSubjectRef(event.target.value);
                setNewSubjectError("");
              }}
              placeholder="EST-2026-001"
              value={newSubjectRef}
            />
            <em id="new-subject-help">Usá una referencia breve para reconocer este estudio. No ingreses nombre, DNI ni otros datos identificatorios.</em>
          </label>
          {newSubjectError && <p className="wl-drawer-error">{newSubjectError}</p>}
          <button className="wl-patient-create-button" disabled={disabled} type="submit">Usar esta referencia</button>
        </form>
      )}
    </section>
  );
}
