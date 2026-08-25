import { useProductAnalysisV1 } from "./useProductAnalysisV1";
import {
  DISC_LEVEL_UNASSIGNED_TEXT,
  MORPHOMETRY_DISCLAIMER,
  PRODUCT_ANALYSIS_EMPTY_HISTORY_TEXT,
  PRODUCT_ANALYSIS_PROCESSING_TEXT,
  displayAxialPairingStatus,
  displayDegenerativeFindingsStatus,
  displayDiscLevel,
  displayLocalizationStatus,
  displayProductAnalysisWarning,
  displayReviewStatus,
  formatAreaMm2,
  formatLengthMm,
} from "./productAnalysisDisplay";
import type { ProductAnalysisResult } from "../../contracts/productAnalysisV1Types";

type Props = {
  caseId: string;
};

/**
 * Panel de "Análisis de producto (Post-E50)" — POST/GET contra
 * `/api/studies/{caseId}/product-analys(is|es)`. Vive dentro de la pestaña "ai" de
 * `StudyReviewView`, al lado de los otros paneles de resultados asistidos por IA (Stage 77-O).
 *
 * Componente deliberadamente autocontenido: sólo recibe `caseId` y maneja su propio estado vía
 * `useProductAnalysisV1`, para no acoplarse al resto del estado (viewer, mediciones manuales,
 * etc.) de `StudyReviewView`.
 */
export function ProductAnalysisV1Panel({ caseId }: Props) {
  const { state, canSubmit, canRetry, analyze, openAnalysis, retry } = useProductAnalysisV1(caseId);
  const selected = state.selected;

  return (
    <section className="rr-product-analysis" aria-label="Análisis de producto Post-E50">
      <div className="rr-disc-section-head">
        <p className="rr-section-title">Análisis de producto</p>
        <button
          className="rr-more-action"
          type="button"
          disabled={!canSubmit}
          onClick={() => void analyze()}
        >
          {state.phase === "submitting" ? PRODUCT_ANALYSIS_PROCESSING_TEXT : "Analizar estudio"}
        </button>
      </div>

      {state.phase === "submitting" && (
        <p className="rr-note" role="status">{PRODUCT_ANALYSIS_PROCESSING_TEXT}</p>
      )}

      {state.phase === "error" && state.error && (
        <p className="rr-disc-contract-error" role="alert">
          {state.error.message}
          {canRetry && (
            <button className="rr-more-action" type="button" onClick={retry} style={{ marginLeft: 8 }}>
              Reintentar
            </button>
          )}
        </p>
      )}

      {state.phase === "loading_history" && !selected && (
        <p className="rr-note">Cargando análisis registrados…</p>
      )}

      {state.phase !== "loading_history" && !selected && state.phase !== "error" && (
        <p className="rr-findings-empty">{PRODUCT_ANALYSIS_EMPTY_HISTORY_TEXT}</p>
      )}

      {selected && <AnalysisResultBody result={selected} />}

      {state.history.length > 1 && (
        <details className="rr-disc-research">
          <summary><span>Historial de análisis ({state.history.length})</span></summary>
          <div className="rr-disc-finding-rows" style={{ padding: "8px 10px" }}>
            {state.history.map((run) => (
              <article className="rr-disc-finding" key={run.analysisRunId}>
                <span>{new Date(run.createdAt).toLocaleString()}</span>
                <span className="rr-disc-finding-result">
                  <span className={`rr-disc-deployment is-${statusToneClass(run.status)}`}>{run.status}</span>
                  <button
                    className="rr-more-action"
                    type="button"
                    onClick={() => void openAnalysis(run.analysisRunId)}
                    disabled={run.analysisRunId === selected?.analysisRunId}
                  >
                    Ver
                  </button>
                </span>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function statusToneClass(status: ProductAnalysisResult["status"]): "supported_internal" | "experimental" | "not_product_supported" {
  if (status === "completed") return "supported_internal";
  if (status === "partial") return "experimental";
  return "not_product_supported";
}

function AnalysisResultBody({ result }: { result: ProductAnalysisResult }) {
  return (
    <div className="rr-product-analysis-body">
      {result.status === "partial" && (
        <p className="rr-note rr-note-warn" role="status">
          Análisis parcial: algunas capacidades no estuvieron disponibles en esta corrida. Ver detalle abajo.
        </p>
      )}
      {result.status === "failed" && (
        <p className="rr-disc-contract-error" role="alert">
          El análisis no pudo completarse para este estudio. El resto del estudio no se ve afectado.
        </p>
      )}

      {result.warnings.length > 0 && (
        <div className="rr-disc-finding-rows">
          {result.warnings.map((code) => (
            <p className="rr-note" key={code} title={code}>{displayProductAnalysisWarning(code)}</p>
          ))}
        </div>
      )}

      <p className="rr-section-title">Niveles discales</p>
      {result.discLevels.length === 0 ? (
        <p className="rr-findings-empty">Sin niveles discales informados.</p>
      ) : (
        <div className="rr-disc-overview">
          {result.discLevels.map((discLevel, index) => (
            <details className="rr-disc-level" key={`${discLevel.level ?? "unassigned"}-${index}`}>
              <summary className="rr-disc-level-summary">
                <strong>{discLevel.level ?? "—"}</strong>
                <span>{discLevel.level ? displayDiscLevel(discLevel.level) : DISC_LEVEL_UNASSIGNED_TEXT}</span>
                <span>{discLevel.measurements.length}</span>
              </summary>
              <div className="rr-disc-finding-rows" style={{ padding: "8px 10px" }}>
                <p className="rr-note">{displayLocalizationStatus(discLevel.localizationStatus)}</p>
                <p className="rr-note">
                  {displayAxialPairingStatus(discLevel.axialPairingStatus, {
                    validated: discLevel.axialPairingValidated,
                    experimental: discLevel.axialPairingExperimental,
                    reviewRequired: discLevel.axialPairingReviewRequired,
                  })}
                </p>
                <p className="rr-note">{displayDegenerativeFindingsStatus(discLevel.degenerativeFindingsStatus)}</p>
              </div>
            </details>
          ))}
        </div>
      )}

      <p className="rr-section-title">Mediciones</p>
      {allMeasurements(result).length === 0 ? (
        <p className="rr-findings-empty">Sin mediciones disponibles para este análisis.</p>
      ) : (
        <div className="rr-disc-finding-rows">
          {allMeasurements(result).map((measurement, index) => (
            <article className="rr-disc-finding" key={index}>
              <span>{measurement.structure} · {displayDiscLevel(measurement.level)}</span>
              <span className="rr-disc-finding-result">
                <strong>{formatAreaMm2(measurement.areaMm2)}</strong>
                <strong>{formatLengthMm(measurement.majorAxisMm)}</strong>
                <strong>{formatLengthMm(measurement.minorAxisMm)}</strong>
              </span>
            </article>
          ))}
        </div>
      )}
      <p className="rr-findings-foot">{MORPHOMETRY_DISCLAIMER}</p>

      <p className="rr-section-title">Revisión</p>
      <p className="rr-note">{displayReviewStatus(result.review)}</p>
    </div>
  );
}

function allMeasurements(result: ProductAnalysisResult) {
  return result.discLevels.flatMap((discLevel) => discLevel.measurements);
}
