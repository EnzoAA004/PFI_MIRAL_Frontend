import { useEffect, useState } from "react";
import { PanelRightClose, ScanLine } from "lucide-react";
import type { Plane, StudyArchiveSeries, StudyDetailResponse, StudyRow } from "../../appTypes";
import { displayModality, displayPlane, displayReviewStatus } from "../../clinicalDisplay";
import { displayOptionalSubjectRef, displayStudyDate } from "../../studyDisplay";
import { fetchStudyDetail } from "../../studyApi";
import { aiAssetUrl } from "../../multiplanarApi";
import { useAuthenticatedImageUrl } from "../../authenticatedAssets";
import { PriorityBadge, ReviewBadge } from "../../components/StatusBadge";

/**
 * Panel del estudio seleccionado.
 *
 * Existe para responder "¿es éste?" sin salir de la lista: antes había que
 * abrir la sala de lectura —que carga corridas, assets y máscaras— para ver qué
 * series traía el estudio, y volver si no era el que se buscaba.
 *
 * Lo que muestra es lo que el producto tiene. No hay filiación del paciente
 * (la historia es seudonimizada), ni accession number, ni médico solicitante,
 * ni centro derivador: el contrato de estudios no los transporta y un panel que
 * los mostrara vacíos sería peor que uno que no los promete.
 *
 * El detalle se pide acá y se descarta acá. La sala de lectura sigue teniendo
 * su propio dueño del detalle (App): dos fetch del mismo caseId escribiendo la
 * misma clave era exactamente el bug por el que a veces hacía falta hacer clic
 * dos veces en una fila.
 */

interface SelectedStudyPanelProps {
  study: StudyRow;
  onClose: () => void;
  onOpen: (study: StudyRow) => void;
}

function planeLabel(plane: StudyArchiveSeries["plane"]) {
  if (plane === "unknown") return "Plano no informado";
  return displayPlane(plane);
}

function weightingLabel(weighting: string) {
  if (!weighting || weighting === "unknown") return "Ponderación no informada";
  return weighting.toUpperCase();
}

/** Por qué una serie no pudo ser entrada de una corrida, en los términos del médico. */
function unusableReason(series: StudyArchiveSeries) {
  if (series.multiplanar) return "Localizador: sus cortes no comparten plano.";
  if (series.derived) return "Imagen derivada: captura o reformateo, no adquisición.";
  return "Sin modelo para esta combinación de plano y ponderación.";
}

function SeriesThumbnail({ runId, plane, label }: { runId?: string | null; plane: Plane | null; label: string }) {
  const url = runId && plane ? aiAssetUrl(runId, plane, "input.png") : undefined;
  const image = useAuthenticatedImageUrl(url);
  if (image.state === "loaded") return <img alt={`Vista previa de ${label}`} className="wl-series-thumb" src={image.url} />;
  return (
    <span className="wl-series-thumb is-placeholder" aria-hidden="true">
      <ScanLine size={18} />
    </span>
  );
}

export function SelectedStudyPanel({ study, onClose, onOpen }: SelectedStudyPanelProps) {
  const [detail, setDetail] = useState<StudyDetailResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let active = true;
    setDetail(null);
    setState("loading");
    fetchStudyDetail({ caseId: study.caseId })
      .then((response) => {
        if (!active) return;
        setDetail(response);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setState("failed");
      });
    return () => { active = false; };
  }, [study.caseId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const run = detail?.runs?.[0];
  const review = detail?.review;
  const series = detail?.archiveSeries ?? [];
  const runIdForPlane = (plane: Plane) => (plane === "sagittal" ? run?.sagittalRunId : run?.axialRunId) ?? run?.runId ?? study.latestRunId;

  return (
    <aside className="wl-panel" aria-label={`Estudio seleccionado ${study.caseId}`}>
      <header className="wl-panel-head">
        <div>
          <h2>Resumen del estudio</h2>
          <span className="wl-panel-case-id">{study.caseId}</span>
        </div>
        <button className="wl-panel-close" onClick={onClose} type="button" aria-label="Cerrar el panel del estudio">
          <PanelRightClose aria-hidden size={16} />
        </button>
      </header>

      <div className="wl-panel-body">
        <dl className="wl-panel-facts">
              <div><dt>Paciente</dt><dd>{study.patientName || displayOptionalSubjectRef(study.patientCode || study.subjectRef)}</dd></div>
              {study.patientName && study.patientCode ? <div><dt>Código</dt><dd>{study.patientCode}</dd></div> : null}
              {study.ageAtStudy !== null && study.ageAtStudy !== undefined ? <div><dt>Edad al estudio</dt><dd>{study.ageAtStudy} años</dd></div> : null}
          <div><dt>Fecha</dt><dd>{displayStudyDate(study.studyDate)}</dd></div>
          <div><dt>Modalidad</dt><dd>{displayModality(study.modality)}</dd></div>
          {study.description ? <div><dt>Descripción</dt><dd>{study.description}</dd></div> : null}
        </dl>

        <div className="wl-panel-badges">
          <ReviewBadge status={study.reviewStatus} />
          <PriorityBadge priority={study.priority} />
        </div>

        <section className="wl-panel-section">
          <h3>Revisión profesional</h3>
          {state === "loading" ? <p className="wl-panel-note" role="status">Consultando el estudio…</p> : null}
          {state === "failed" ? <p className="wl-panel-note">No se pudo consultar el detalle del estudio.</p> : null}
          {state === "ready" ? (
            <dl className="wl-panel-facts">
              <div><dt>Estado</dt><dd>{displayReviewStatus(review?.status ?? study.reviewStatus)}</dd></div>
              {review?.reviewer?.trim() ? <div><dt>Profesional</dt><dd>{review.reviewer}</dd></div> : null}
              {review?.reviewedAt?.trim() ? <div><dt>Fecha de aceptación</dt><dd>{new Date(review.reviewedAt).toLocaleString("es-AR")}</dd></div> : null}
            </dl>
          ) : null}
          {state === "ready" && (review?.status === "aceptado" || study.reviewStatus === "aceptado") ? (
            <p className="wl-panel-accepted" role="status">Informe aceptado por el profesional.</p>
          ) : null}
        </section>

        <section className="wl-panel-section">
          <h3>Series disponibles</h3>
          {state === "ready" && !series.length ? <p className="wl-panel-note">El estudio no registra series.</p> : null}
          <ul className="wl-panel-series-list">
            {series.map((item) => (
              <li key={item.inputId} className={item.analyzable ? "wl-series" : "wl-series is-unusable"}>
                <SeriesThumbnail
                  runId={item.plane === "sagittal" || item.plane === "axial" ? runIdForPlane(item.plane) : null}
                  plane={item.plane === "sagittal" || item.plane === "axial" ? item.plane : null}
                  label={item.description || planeLabel(item.plane)}
                />
                <div className="wl-series-text">
                  <strong>{item.description || planeLabel(item.plane)}</strong>
                  <span>{planeLabel(item.plane)} · {weightingLabel(item.weighting)} · {item.sliceCount} {item.sliceCount === 1 ? "corte" : "cortes"}</span>
                  {item.analyzable ? null : <em>{unusableReason(item)}</em>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="wl-panel-section">
          <h3>Planos analizados</h3>
          {study.planes.length
            ? <p className="wl-panel-note">{study.planes.map((plane) => displayPlane(plane)).join(" · ")}</p>
            : <p className="wl-panel-note">Ninguno: el estudio todavía no tiene una corrida persistida.</p>}
        </section>
      </div>

      <footer className="wl-panel-foot">
        <button className="wl-primary" onClick={() => onOpen(study)} type="button">Abrir estudio</button>
      </footer>
    </aside>
  );
}
