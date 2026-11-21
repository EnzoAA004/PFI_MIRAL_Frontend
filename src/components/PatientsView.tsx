import { useEffect, useMemo, useState } from "react";
import type { SubjectSummary } from "../appTypes";
import { displayStudyDate } from "../studyDisplay";
import { fetchSubjectList } from "../subjectHistoryApi";
import { RegisteredPatientsPanel } from "../features/patients/RegisteredPatientsPanel";
import { OperationsPageHeader } from "./OperationsPageHeader";

interface PatientsViewProps {
  onOpenPatient: (subjectRef: string) => void;
}

type PatientListState =
  | { status: "loading"; patients: SubjectSummary[] }
  | { status: "ready"; patients: SubjectSummary[] }
  | { status: "error"; patients: SubjectSummary[] };

/**
 * Stage 85-Q: mismo vocabulario post-e50 (completed/partial/failed) que el resto del producto --
 * mapeo local, nunca el enum crudo. Sigue el mismo patrón que `PatientHistoryView.tsx` (Stage 84)
 * para el mismo vocabulario, no una convención nueva.
 */
const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  completed: "Completado",
  partial: "Parcial",
  failed: "Fallido",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  observed: "Observada",
  rejected: "Rechazada",
};

function displayAnalysisStatus(value: string | null): string {
  if (!value) return "Sin análisis";
  return ANALYSIS_STATUS_LABELS[value] ?? value;
}

function displayReviewStatusLabel(value: string | null): string {
  if (!value) return "—";
  return REVIEW_STATUS_LABELS[value] ?? value;
}

export function PatientsView({ onOpenPatient }: PatientsViewProps) {
  const [query, setQuery] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<PatientListState>({ status: "loading", patients: [] });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ status: "loading", patients: current.patients }));
    void fetchSubjectList()
      .then((patients) => {
        if (!cancelled) setState({ status: "ready", patients });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", patients: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  const normalizedQuery = query.trim().toLowerCase();
  // Stage 85-H: se busca por caseId, que ya se muestra en todo el producto -- nunca por
  // subjectRef, que Stage 85-I decide no exponer como texto visible en esta pantalla.
  const visiblePatients = useMemo(() => {
    if (!normalizedQuery) return state.patients;
    return state.patients.filter((patient) => patient.latestCaseId.toLowerCase().includes(normalizedQuery));
  }, [state.patients, normalizedQuery]);

  const initialEmpty = state.status === "ready" && !normalizedQuery && state.patients.length === 0;
  const searchEmpty = state.status === "ready" && Boolean(normalizedQuery) && visiblePatients.length === 0 && state.patients.length > 0;

  return (
    <div className="view-stack patient-directory-view">
      <OperationsPageHeader
        title="Pacientes"
        description="Agrupado por referencia longitudinal de estudios, no una lista de pacientes registrados aparte."
        meta={(
          <span className="patient-directory-total" aria-live="polite">
            {state.status === "ready" ? visiblePatients.length : "—"} {normalizedQuery ? "resultados" : "pacientes"}
          </span>
        )}
      />

      <RegisteredPatientsPanel />

      <section className="panel-card patient-directory-panel">
        <div className="patient-directory-search">
          <label className="worklist-search-input" htmlFor="patient-directory-query">
            <span>Buscar por caso</span>
            <input
              autoComplete="off"
              id="patient-directory-query"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="CASE-001"
              type="search"
              value={query}
            />
          </label>
          {query && (
            <button className="ghost-button" onClick={() => setQuery("")} type="button">
              Limpiar búsqueda
            </button>
          )}
        </div>

        <div aria-live="polite" aria-busy={state.status === "loading"}>
          {state.status === "loading" && (
            <div className="panel-hidden-placeholder">Consultando pacientes…</div>
          )}
          {state.status === "error" && (
            <div className="clinical-empty-state" role="alert">
              <h3>No se pudo cargar la lista de pacientes</h3>
              <p>Revisá la conexión e intentá nuevamente.</p>
              <button className="ghost-button" onClick={() => setRetryNonce((value) => value + 1)} type="button">Reintentar</button>
            </div>
          )}
          {initialEmpty && (
            <div className="clinical-empty-state">
              <h3>No hay pacientes con historial longitudinal disponible.</h3>
            </div>
          )}
          {searchEmpty && (
            <div className="clinical-empty-state">
              <h3>No se encontraron pacientes</h3>
              <p>Probá con otro identificador de caso.</p>
              <button className="ghost-button" onClick={() => setQuery("")} type="button">Ver todos</button>
            </div>
          )}
          {state.status === "ready" && visiblePatients.length > 0 && (
            <ul className="patient-directory-list" aria-label="Pacientes">
              {visiblePatients.map((patient) => (
                <li key={patient.subjectRef}>
                  <div>
                    <strong>Paciente</strong>
                    <span>
                      {patient.studyCount === 1 ? "1 estudio" : `${patient.studyCount} estudios`}
                      {" · "}Último: {displayStudyDate(patient.latestStudyDate)}
                      {" · "}Caso: {patient.latestCaseId}
                    </span>
                    <span>
                      Análisis: {displayAnalysisStatus(patient.latestAnalysisStatus)}
                      {patient.latestAnalysisStatus ? ` · Revisión: ${displayReviewStatusLabel(patient.latestReviewStatus)}` : ""}
                    </span>
                  </div>
                  <button className="ghost-button" onClick={() => onOpenPatient(patient.subjectRef)} type="button">
                    Abrir historial
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
