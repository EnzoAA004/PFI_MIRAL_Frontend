import { useEffect, useState } from "react";
import { fetchSubjectHistory } from "../subjectHistoryApi";
import type { PatientHistoryResponse } from "../appTypes";
import { PatientHistoryView } from "./PatientHistoryView";

interface PatientHistoryPageProps {
  /** El segmento de ruta `/pacientes/:id` -- tratado como `subjectRef` (Stage 84: identidad = Study.subjectRef, no un Patient separado). */
  subjectRef: string;
  /** El Study desde el que se navegó, si corresponde -- se marca "Estudio actual" en la línea de tiempo. */
  currentCaseId?: string | null;
  onBack: () => void;
  onOpenStudy: (caseId: string) => void;
}

type PageState =
  | { status: "loading" }
  | { status: "ready"; history: PatientHistoryResponse }
  | { status: "error" };

/**
 * Stage 84: reemplaza el antiguo `PatientDetailView` en la ruta `/pacientes/:id` -- aquel llamaba
 * a `GET /api/patients/{id}` y `/api/patients/{id}/studies`, endpoints que nunca existieron en el
 * Backend (confirmado por grep: ningún controller mapea `/api/patients`), por lo que esa ruta
 * estaba rota independientemente del valor de `:id`. `PatientHistoryView` ya existía, probado,
 * pero nunca había sido conectado al routing -- este componente es esa conexión real, usando el
 * endpoint que sí funciona (`/api/subjects/{subjectRef}/history`, Stage 8E/79/84).
 */
export function PatientHistoryPage({ subjectRef, currentCaseId, onBack, onOpenStudy }: PatientHistoryPageProps) {
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSubjectHistory(subjectRef)
      .then((history) => {
        if (!cancelled) setState({ status: "ready", history });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectRef]);

  if (state.status === "loading") {
    return (
      <section className="panel-card clinical-loading-state" aria-live="polite">
        <span className="clinical-spinner" />
        <div><h2>Cargando historial</h2><p>Consultando estudios asociados.</p></div>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel-card clinical-empty-state" role="alert">
        <h2>No se pudo cargar el historial</h2>
        <p>Revisá la conexión e intentá nuevamente.</p>
        <button className="ghost-button" onClick={onBack} type="button">Volver a pacientes</button>
      </section>
    );
  }

  return (
    <PatientHistoryView
      studies={state.history.studies}
      subjectRef={state.history.subjectRef}
      target={{ kind: "subject", subjectRef: state.history.subjectRef }}
      source={state.history.source}
      summary={state.history.summary}
      currentCaseId={currentCaseId}
      onOpenStudyReview={onOpenStudy}
    />
  );
}
