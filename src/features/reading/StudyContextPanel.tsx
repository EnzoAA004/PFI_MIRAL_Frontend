import { useCallback, useEffect, useState } from "react";
import { patientDisplayName } from "../../patientApi";
import { ageProvenanceLabel } from "../../studyAge";
import { fetchStudyContext, type StudyContext } from "../../studyContextApi";
import { InspectorGroup } from "./InspectorSection";
import { NOT_REPORTED, clinicalContextRows, hasAnyClinicalContext } from "./inspectorDisplay";

type Props = {
  caseId: string;
  /** Referencia de estudio ya conocida por la sala, para cuando no hay paciente asociado. */
  subjectLabel?: string;
};

type Phase = "loading" | "ready" | "error";

/**
 * Paciente y contexto clínico del estudio, tal como quedaron guardados con él
 * (`GET /api/studies/{caseId}/context`). Solo lectura: no escribe nada, no recalcula la edad con
 * la fecha de hoy ni con datos actuales del paciente, y no envía estos datos a ningún servicio.
 */
export function StudyContextPanel({ caseId, subjectLabel }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [context, setContext] = useState<StudyContext | null>(null);

  const load = useCallback(() => {
    let active = true;
    setPhase("loading");
    fetchStudyContext(caseId)
      .then((response) => {
        if (!active) return;
        setContext(response);
        setPhase("ready");
      })
      .catch(() => {
        if (!active) return;
        setContext(null);
        setPhase("error");
      });
    return () => { active = false; };
  }, [caseId]);

  useEffect(() => load(), [load]);

  const rows = clinicalContextRows(context?.clinicalContext ?? null, ageProvenanceLabel(context?.clinicalContext?.ageProvenance));
  const patientName = context?.patient ? patientDisplayName(context.patient) : "";

  return (
    <InspectorGroup id="patient-context" title="Paciente y contexto del estudio">
      {phase === "loading" && <p className="rr-note" role="status">Consultando el contexto del estudio…</p>}
      {phase === "error" && (
        <p className="rr-note rr-note-warn" role="alert">
          No se pudo consultar el contexto del estudio.{" "}
          <button className="rr-link" onClick={() => load()} type="button">Reintentar</button>
        </p>
      )}
      {phase === "ready" && (
        <>
          <dl className="rr-facts" data-testid="study-context">
            <div className="rr-fact">
              <dt>Paciente</dt>
              <dd>
                {context?.patient
                  ? `${patientName || "Sin nombre cargado"} · ${context.patient.patientReference}`
                  : <span className="rr-not-reported">{subjectLabel ? `Sin paciente asociado · referencia de estudio ${subjectLabel}` : "Sin paciente asociado"}</span>}
              </dd>
            </div>
            {rows.map((row) => (
              <div className="rr-fact" data-field={row.key} key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value ?? <span className="rr-not-reported">{NOT_REPORTED}</span>}</dd>
              </div>
            ))}
          </dl>
          {!hasAnyClinicalContext(rows) && (
            <p className="rr-note" data-testid="study-context-empty">
              Este estudio no tiene contexto clínico registrado (por ejemplo, fue cargado antes de que existiera).
            </p>
          )}
          <p className="rr-note">
            Es el contexto de este estudio al momento de cargarlo: la edad no se recalcula con datos actuales.
            Estos datos no se envían al asistente.
          </p>
        </>
      )}
    </InspectorGroup>
  );
}
