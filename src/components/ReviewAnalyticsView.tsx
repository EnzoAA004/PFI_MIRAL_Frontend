import { useEffect, useState } from "react";
import "./reviewAnalytics.css";
import {
  displayMetricGroupLabel,
  formatOptionalNumber,
  formatPercent,
  getReviewAnalytics,
  REVIEW_ANALYTICS_DISCLAIMER,
  type ReviewAnalyticsReport,
} from "../reviewAnalyticsApi";

/**
 * EXT-02: "Review Analytics" — neutral internal telemetry dashboard. Never a clinical safety
 * signal: no traffic-light coloring, no "modelo seguro"/"accuracy clínica" wording anywhere here.
 */
export function ReviewAnalyticsView({ onBack }: { onBack: () => void }) {
  const [report, setReport] = useState<ReviewAnalyticsReport | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    setPhase("loading");
    getReviewAnalytics()
      .then((data) => {
        setReport(data);
        setPhase("ready");
      })
      .catch((thrown: unknown) => {
        setPhase("error");
        setError(thrown instanceof Error ? thrown.message : "No se pudo cargar la telemetría de revisión.");
      });
  }, []);

  return (
    <div className="review-analytics-view">
      <div className="review-analytics-header">
        <button type="button" className="ghost-button" onClick={onBack}>Volver</button>
        <h1>Review Analytics</h1>
      </div>
      <p className="rr-note">{REVIEW_ANALYTICS_DISCLAIMER}</p>

      {phase === "loading" && <p className="rr-note">Cargando telemetría...</p>}
      {phase === "error" && <p className="rr-note rr-export-error">{error}</p>}

      {report && (
        <>
          <section className="review-analytics-cards">
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Mediciones automáticas</span>
              <span className="review-analytics-card-value">{report.measurements.totalAutomaticMeasurements}</span>
            </div>
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Tasa de corrección (mediciones)</span>
              <span className="review-analytics-card-value" data-testid="measurement-correction-rate">{formatPercent(report.measurements.correctionRate)}</span>
            </div>
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Regiones IA</span>
              <span className="review-analytics-card-value">{report.evidenceRegions.totalAiRegions}</span>
            </div>
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Tasa de corrección (regiones)</span>
              <span className="review-analytics-card-value" data-testid="region-correction-rate">{formatPercent(report.evidenceRegions.correctionRate)}</span>
            </div>
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Aceptadas / Observadas / Rechazadas</span>
              <span className="review-analytics-card-value">{report.evidenceRegions.accepted} / {report.evidenceRegions.observed} / {report.evidenceRegions.rejected}</span>
            </div>
            <div className="review-analytics-card">
              <span className="review-analytics-card-label">Hallazgos creados por profesional</span>
              <span className="review-analytics-card-value">{report.evidenceRegions.professionalDrawnCount}</span>
            </div>
          </section>

          <p className="rr-section-title">Error vs. corrección profesional — por nivel / plano / estructura / métrica</p>
          {report.measurements.groups.length === 0 ? (
            <p className="rr-note" data-testid="measurement-groups-empty">Sin mediciones registradas.</p>
          ) : (
            <table className="review-analytics-table" data-testid="measurement-groups-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Unidad</th>
                  <th>Automáticas</th>
                  <th>Corregidas</th>
                  <th>Tasa</th>
                  <th>MAE</th>
                  <th>Mediana |error|</th>
                  <th>Sesgo (signed mean)</th>
                </tr>
              </thead>
              <tbody>
                {report.measurements.groups.map((group, index) => (
                  <tr key={index}>
                    <td>{displayMetricGroupLabel(group)}</td>
                    <td>{group.unit}</td>
                    <td>{group.automaticCount}</td>
                    <td>{group.correctedCount}</td>
                    <td>{formatPercent(group.correctionRate)}</td>
                    <td>{formatOptionalNumber(group.meanAbsoluteError)}</td>
                    <td>{formatOptionalNumber(group.medianAbsoluteError)}</td>
                    <td>{formatOptionalNumber(group.signedMeanError)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="rr-section-title">Delta de geometría — solo pares de geometría comparables</p>
          {report.evidenceRegions.geometryDeltas.length === 0 ? (
            <p className="rr-note" data-testid="geometry-deltas-empty">Sin correcciones de geometría comparables registradas.</p>
          ) : (
            <table className="review-analytics-table" data-testid="geometry-deltas-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Desplazamiento de centroide</th>
                  <th>Delta de área</th>
                  <th>IoU</th>
                </tr>
              </thead>
              <tbody>
                {report.evidenceRegions.geometryDeltas.map((delta) => (
                  <tr key={delta.correctionId}>
                    <td>{delta.geometryType}</td>
                    <td>{delta.centroidDisplacement.toFixed(2)}</td>
                    <td>{delta.areaDelta.toFixed(2)}</td>
                    <td>{delta.intersectionOverUnion === null ? "—" : delta.intersectionOverUnion.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.limitations.length > 0 && (
            <>
              <p className="rr-section-title">Limitaciones de esta telemetría</p>
              <ul className="rr-report-loose">
                {report.limitations.map((text, index) => <li key={index}>{text}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
