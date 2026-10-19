import { useState } from "react";
import type { HistoryTarget, PatientHistorySummary, PatientStudy } from "../appTypes";
import { displayModality, displayReviewStatus } from "../clinicalDisplay";
import { displayStudyDate } from "../studyDisplay";
import { analysisOf, formatDateTime, measurementCountLabel, shortRunId, studiesWithResults } from "../features/history/historyAnalysis";
import { PriorityBadge, ReviewBadge, StatusBadge } from "./StatusBadge";

interface PatientHistoryViewProps {
  studies: PatientStudy[];
  target?: HistoryTarget | null;
  subjectRef?: string | null;
  summary?: PatientHistorySummary;
  error?: string;
  onOpenStudyReview?: (caseId: string) => void;
  /** Stage 84-P: el Study desde el que se abrió este historial, si corresponde -- se marca "Estudio actual". */
  currentCaseId?: string | null;
  /**
   * "Comparar" abre la comparación visual del estudio actual con el elegido, sobre las mediciones reales del
   * análisis inicial. La identidad del paciente y los permisos de ambos estudios los valida el Backend al
   * pedir la comparación; acá no se decide nada.
   */
  onCompareStudies?: (currentCaseId: string, referenceCaseId: string) => void;
}

type HistoryTab = "overview" | "repository" | "activity";

function formatDate(value?: string | null) {
  return value && value.trim() ? displayStudyDate(value) : "Fecha no informada";
}

function studyCountLabel(count: number) {
  return count === 1 ? "1 estudio" : `${count} estudios`;
}

function planeLabel(value?: string | null) {
  return value && value.trim() ? value : "No informados";
}

function EmptyState({ detail }: { detail: string }) {
  return (
    <div className="panel-hidden-placeholder honest-empty-state">
      <strong>{detail}</strong>
    </div>
  );
}

/**
 * Tarjeta de un estudio. El estado del análisis, las mediciones y la corrida salen de la corrida REAL del análisis
 * inicial (`latestRun`), la misma que muestra el visor; no del circuito de demostración. Un dato ausente se dice
 * «No informado»: nunca se convierte en 0.
 */
function StudyCard({
  study,
  isCurrent,
  onOpen,
  onCompare,
}: {
  study: PatientStudy;
  isCurrent: boolean;
  onOpen?: (caseId: string) => void;
  onCompare?: (caseId: string) => void;
}) {
  const analysis = analysisOf(study);
  const counts = measurementCountLabel(analysis);
  const reviewedAt = formatDateTime(study.reviewedAt);
  return (
    <article className={`patient-study-card${isCurrent ? " patient-timeline-current" : ""}`} aria-label={`Estudio ${study.caseId}`}>
      <header className="patient-study-head">
        <h3>{study.caseId}</h3>
        <div className="patient-study-badges">
          {isCurrent && <StatusBadge tone="teal">Estudio actual</StatusBadge>}
          <ReviewBadge status={study.reviewStatus} />
          <PriorityBadge priority={study.priority} />
        </div>
      </header>
      <dl className="patient-study-facts">
        <div><dt>Fecha del estudio</dt><dd>{formatDate(study.studyDate)}</dd></div>
        <div><dt>Planos</dt><dd>{planeLabel(study.planes)}</dd></div>
        <div><dt>Modalidad</dt><dd>{displayModality(study.modality)}</dd></div>
        <div className="is-wide"><dt>Descripción</dt><dd>{study.description || "No informada"}</dd></div>
        <div>
          <dt>Análisis</dt>
          <dd>
            <span className={`patient-analysis-state is-${analysis.state}`}>{analysis.label}</span>
            {analysis.state === "available" && <span className="patient-study-sub">Corrida {shortRunId(analysis.runId)}{analysis.createdAt ? ` · ${formatDateTime(analysis.createdAt)}` : ""}</span>}
            {counts && <span className="patient-study-sub">{counts}</span>}
          </dd>
        </div>
        <div>
          <dt>Revisión</dt>
          <dd>
            {displayReviewStatus(study.reviewStatus)}
            <span className="patient-study-sub">{study.reviewer ? `Revisor: ${study.reviewer}` : "Revisor: no informado"}</span>
            {reviewedAt && <span className="patient-study-sub">Revisado: {reviewedAt}</span>}
          </dd>
        </div>
      </dl>
      <div className="patient-timeline-actions">
        {onOpen && <button className="ghost-button" onClick={() => onOpen(study.caseId)} type="button">Abrir estudio</button>}
        {onCompare && !isCurrent && <button className="ghost-button" onClick={() => onCompare(study.caseId)} type="button">Comparar con el estudio actual</button>}
      </div>
    </article>
  );
}

function StudyList({
  studies,
  onOpen,
  currentCaseId,
  onCompare,
}: {
  studies: PatientStudy[];
  onOpen?: (caseId: string) => void;
  currentCaseId?: string | null;
  onCompare?: (caseId: string) => void;
}) {
  if (studies.length === 0) return <EmptyState detail="No hay estudios persistidos para esta referencia." />;
  return (
    <div className="patient-study-list">
      {studies.map((study) => (
        <StudyCard
          key={study.caseId}
          study={study}
          isCurrent={Boolean(currentCaseId) && study.caseId === currentCaseId}
          onOpen={onOpen}
          onCompare={currentCaseId ? onCompare : undefined}
        />
      ))}
    </div>
  );
}

export function PatientHistoryView({ studies, target, subjectRef, summary, error, onOpenStudyReview, currentCaseId, onCompareStudies }: PatientHistoryViewProps) {
  const [activeTab, setActiveTab] = useState<HistoryTab>("overview");
  const studyTraceabilityMode = target?.kind === "study";
  const displayReference = studyTraceabilityMode ? target.caseId : subjectRef ?? (target?.kind === "subject" ? target.subjectRef : null);
  const totalStudies = summary?.totalStudies ?? studies.length;
  const firstStudy = summary?.firstStudy ?? studies[studies.length - 1]?.studyDate;
  const mostRecent = summary?.mostRecent ?? studies[0]?.studyDate;
  const withResults = studiesWithResults(studies);
  const compare = currentCaseId && onCompareStudies ? (caseId: string) => onCompareStudies(currentCaseId, caseId) : undefined;

  if (!displayReference) {
    return (
      <section className="panel-card clinical-empty-state">
        <h2>Sin paciente seleccionado</h2>
        <p>Seleccioná una referencia de paciente o un estudio real para consultar la información disponible.</p>
      </section>
    );
  }

  return (
    <div className="view-stack clinical-quiet patient-longitudinal-view">
      <section className="history-hero compact-heading patient-history-header">
        <div className="patient-avatar" aria-hidden="true">{studyTraceabilityMode ? displayReference.slice(0, 1) : "H"}</div>
        <div className="patient-history-title">
          <p>{studyTraceabilityMode ? "Trazabilidad del estudio" : "Historial por referencia de paciente"}{studyTraceabilityMode && <> / <strong>{displayReference}</strong></>}</p>
          <h1>{studyTraceabilityMode ? "Trazabilidad del estudio" : "Historial del paciente"}</h1>
          {studyTraceabilityMode ? (
            <p className="viewer-limit-note">No existe una referencia estable de paciente. Esta vista corresponde a un único estudio y no representa un historial longitudinal.</p>
          ) : (
            <p className="viewer-limit-note">Los estudios se agrupan por la referencia de paciente. No cargues identificadores directos en notas ni descripciones.</p>
          )}
        </div>
        <dl className="patient-header-grid">
          <div><dt>Total de estudios</dt><dd>{studyCountLabel(totalStudies)}</dd></div>
          <div><dt>Pendientes</dt><dd>{summary?.pending ?? studies.filter((study) => study.reviewStatus === "pendiente").length}</dd></div>
          <div><dt>Finalizados</dt><dd>{summary?.completed ?? studies.filter((study) => study.reviewStatus === "aceptado").length}</dd></div>
          <div><dt>Observados</dt><dd>{summary?.observed ?? studies.filter((study) => study.reviewStatus === "observado").length}</dd></div>
          <div><dt>Con resultados</dt><dd>{withResults} de {totalStudies}</dd></div>
          <div><dt>Con fecha informada</dt><dd>{summary?.withStudyDate ?? studies.filter((study) => Boolean(study.studyDate)).length}</dd></div>
          <div><dt>Primer estudio</dt><dd>{formatDate(firstStudy)}</dd></div>
          <div><dt>Más reciente</dt><dd>{formatDate(mostRecent)}</dd></div>
        </dl>
      </section>

      {error && <div className="toast error" role="alert">No se pudo consultar el historial. {error}</div>}
      <div className="toast info">Uso académico. Requiere revisión humana y no constituye diagnóstico clínico.</div>

      <div className="workspace-tabs history-tabs" role="tablist" aria-label="Tabs de historial de paciente">
        <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")} role="tab" aria-selected={activeTab === "overview"} type="button">{studyTraceabilityMode ? "Resumen del estudio" : "Resumen"}</button>
        <button className={activeTab === "repository" ? "active" : ""} onClick={() => setActiveTab("repository")} role="tab" aria-selected={activeTab === "repository"} type="button">Repositorio de estudios</button>
        <button className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")} role="tab" aria-selected={activeTab === "activity"} type="button">Actividad y auditoría</button>
      </div>

      {activeTab === "overview" && (
        <section className="panel-card compact-card">
          <div className="section-title"><h2>{`Estudios (${totalStudies})`}</h2></div>
          <StudyList studies={studies} onOpen={onOpenStudyReview} currentCaseId={currentCaseId} onCompare={compare} />
          {!studyTraceabilityMode && studies.length > 1 && (
            <p className="viewer-limit-note patient-compare-note">
              Para comparar mediciones entre estudios del paciente, abrí uno y usá Herramientas del estudio → Comparación entre estudios.
              La diferencia numérica no indica evolución clínica.
            </p>
          )}
        </section>
      )}

      {activeTab === "repository" && (
        <section className="panel-card compact-card">
          <div className="section-title"><h2>Repositorio de estudios</h2></div>
          <StudyList studies={studies} onOpen={onOpenStudyReview} currentCaseId={currentCaseId} />
        </section>
      )}

      {activeTab === "activity" && (
        <section className="panel-card compact-card">
          <div className="section-title"><h2>Actividad y auditoría</h2></div>
          {studies.length ? (
            <div className="patient-study-list">
              {studies.map((study) => {
                const when = formatDateTime(study.reviewedAt ?? study.updatedAt ?? study.createdAt);
                return (
                  <article className="patient-study-card patient-activity-card" key={`${study.caseId}-activity`}>
                    <header className="patient-study-head">
                      <h3>{displayReviewStatus(study.reviewStatus)}</h3>
                      <div className="patient-study-badges"><PriorityBadge priority={study.priority} /></div>
                    </header>
                    <dl className="patient-study-facts">
                      <div><dt>Estudio</dt><dd>{study.caseId}</dd></div>
                      <div><dt>Fecha de la última actividad</dt><dd>{when ?? "No informada"}</dd></div>
                      <div><dt>Correcciones guardadas</dt><dd>{study.corrections?.length ?? 0}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          ) : <EmptyState detail="No hay actividad registrada para esta referencia." />}
        </section>
      )}
    </div>
  );
}
