import { useEffect, useState } from "react";
import { fetchSubjectHistory } from "../subjectHistoryApi";
import type { PatientHistoryResponse } from "../appTypes";
import { PatientHistoryView } from "./PatientHistoryView";
import { searchPatients } from "../patientApi";
import { LoadFailureState } from "../features/errors/LoadFailureState";
import { classifyLoadFailure, patientWithoutStudiesState, type LoadFailure } from "../features/errors/loadFailure";

interface PatientHistoryPageProps {
  /** El segmento de ruta `/pacientes/:id` -- tratado como `subjectRef` (Stage 84: identidad = Study.subjectRef, no un Patient separado). */
  subjectRef: string;
  /** El Study desde el que se navegó, si corresponde -- se marca "Estudio actual" en la línea de tiempo. */
  currentCaseId?: string | null;
  onBack: () => void;
  onOpenStudy: (caseId: string) => void;
  onCompareStudies?: (currentCaseId: string, referenceCaseId: string) => void;
}

type PageState =
  | { status: "loading" }
  | { status: "ready"; history: PatientHistoryResponse; emptyKind: "exists_without_studies" | "not_found" | "unknown" | null }
  | { status: "error"; failure: LoadFailure };

/**
 * Stage 84: reemplaza el antiguo `PatientDetailView` en la ruta `/pacientes/:id` -- aquel llamaba
 * a `GET /api/patients/{id}` y `/api/patients/{id}/studies`, endpoints que nunca existieron en el
 * Backend (confirmado por grep: ningún controller mapea `/api/patients`), por lo que esa ruta
 * estaba rota independientemente del valor de `:id`. `PatientHistoryView` ya existía, probado,
 * pero nunca había sido conectado al routing -- este componente es esa conexión real, usando el
 * endpoint que sí funciona (`/api/subjects/{subjectRef}/history`, Stage 8E/79/84).
 */
export function PatientHistoryPage({ subjectRef, currentCaseId, onBack, onOpenStudy, onCompareStudies }: PatientHistoryPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSubjectHistory(subjectRef)
      .then(async (history) => {
        let emptyKind: "exists_without_studies" | "not_found" | "unknown" | null = null;
        if (history.studies.length === 0) {
          // El historial se arma desde los estudios: vacío no distingue «paciente sin estudios» de «paciente inexistente».
          // Se pregunta por la referencia exacta a los registros de pacientes.
          try {
            const patients = await searchPatients(subjectRef, 20);
            emptyKind = patientWithoutStudiesState(subjectRef, patients.map((patient) => patient.patientReference));
          } catch {
            emptyKind = "unknown";
          }
        }
        if (!cancelled) setState({ status: "ready", history, emptyKind });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", failure: classifyLoadFailure(error, "paciente", subjectRef) });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectRef, nonce]);

  if (state.status === "loading") {
    return (
      <section className="panel-card clinical-loading-state" aria-live="polite">
        <span className="clinical-spinner" />
        <div><h2>Cargando historial</h2><p>Consultando estudios asociados.</p></div>
      </section>
    );
  }

  if (state.status === "error") {
    return <LoadFailureState failure={state.failure} backLabel="Volver a pacientes" onBack={onBack} onRetry={() => setNonce((value) => value + 1)} />;
  }

  if (state.emptyKind === "not_found") {
    return (
      <LoadFailureState
        failure={{ kind: "not_found", title: "Paciente no encontrado", message: `No existe un paciente con la referencia «${subjectRef}». Revisá el enlace o buscalo desde la lista de pacientes.`, detail: null, retryable: false }}
        backLabel="Volver a pacientes"
        onBack={onBack}
      />
    );
  }

  if (state.emptyKind === "exists_without_studies") {
    return (
      <section className="panel-card clinical-empty-state" data-testid="patient-without-studies">
        <h2>Este paciente todavía no tiene estudios</h2>
        <p>La referencia «{subjectRef}» existe, pero no hay estudios cargados para ella. Cuando se cargue uno desde «Nuevo estudio», aparecerá acá.</p>
        <div className="clinical-empty-actions">
          <button className="ghost-button" onClick={onBack} type="button">Volver a pacientes</button>
        </div>
      </section>
    );
  }

  return (
    <PatientHistoryView
      studies={state.history.studies}
      subjectRef={state.history.subjectRef}
      target={{ kind: "subject", subjectRef: state.history.subjectRef }}
      summary={state.history.summary}
      currentCaseId={currentCaseId}
      onOpenStudyReview={onOpenStudy}
      onCompareStudies={onCompareStudies}
    />
  );
}
