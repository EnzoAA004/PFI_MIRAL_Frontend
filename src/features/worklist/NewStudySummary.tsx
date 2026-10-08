import type { Patient } from "../../patientApi";
import { patientDisplayName } from "../../patientApi";
import { formatIsoDateDMY } from "../../studyAge";
import type { ImagesStatus } from "./newStudyForm";

type Props = {
  patient: Patient | null;
  withoutPatient: boolean;
  caseId: string;
  studyDate: string;
  images: ImagesStatus;
};

/**
 * Resumen lateral, de solo lectura. Muestra únicamente lo que ya hay: un dato que todavía no se
 * cargó no aparece como renglón vacío. Las imágenes sí tienen siempre un estado, porque "sin
 * cargar" es información.
 */
export function NewStudySummary({ patient, withoutPatient, caseId, studyDate, images }: Props) {
  const patientName = patient ? patientDisplayName(patient) || "Sin nombre" : withoutPatient ? "Sin asociación" : "";
  return (
    <aside aria-label="Resumen del estudio" className="ns-summary">
      <h2>Resumen</h2>
      <dl>
        {patientName && (
          <div>
            <dt>Paciente</dt>
            <dd>{patientName}{patient && <span className="ns-summary-sub">{patient.patientReference}</span>}</dd>
          </div>
        )}
        {caseId.trim() && <div><dt>ID del estudio</dt><dd>{caseId.trim()}</dd></div>}
        {studyDate && <div><dt>Fecha</dt><dd>{formatIsoDateDMY(studyDate)}</dd></div>}
        <div><dt>Imágenes</dt><dd className={`is-${images.state}`}>{images.label}</dd></div>
      </dl>
    </aside>
  );
}
