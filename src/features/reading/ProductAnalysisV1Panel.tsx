import { useState } from "react";
import { useProductAnalysisV1 } from "./useProductAnalysisV1";
import {
  CORRECTION_FIELD_LABELS,
  DISC_LEVEL_UNASSIGNED_TEXT,
  MORPHOMETRY_DISCLAIMER,
  DEMO_ANALYSIS_NOTICE,
  REVIEW_ACTION_LABELS,
  REVIEW_REJECT_CONFIRMATION_TEXT,
  displayAxialPairingStatus,
  displayDegenerativeFindingsStatus,
  displayDiscLevel,
  displayLocalizationStatus,
  displayProductAnalysisWarning,
  displayReviewedBy,
  displayReviewStatus,
  formatMeasurementFieldValue,
} from "./productAnalysisDisplay";
import type {
  ProductAnalysisDiscLevel,
  ProductAnalysisMeasurement,
  ProductAnalysisResult,
  ProductAnalysisReview,
} from "../../contracts/productAnalysisV1Types";

type Props = {
  caseId: string;
};

type CorrectionField = "areaMm2" | "majorAxisMm" | "minorAxisMm";
type ReviewDecision = "accepted" | "observed" | "rejected";

/**
 * Panel de "Análisis de producto (Post-E50)" — POST/GET/PATCH contra
 * `/api/studies/{caseId}/product-analys(is|es)`. Vive dentro de la pestaña "ai" de
 * `StudyReviewView`, al lado de los otros paneles de resultados asistidos por IA (Stage 77-O).
 *
 * Componente deliberadamente autocontenido: sólo recibe `caseId` y maneja su propio estado vía
 * `useProductAnalysisV1`, para no acoplarse al resto del estado (viewer, mediciones manuales,
 * etc.) de `StudyReviewView`.
 */
export function ProductAnalysisV1Panel({ caseId }: Props) {
  const {
    state,
    canMutate,
    openAnalysis,
    reviewRun,
    reviewDiscLevel,
    correctMeasurement,
  } = useProductAnalysisV1(caseId);
  const selected = state.selected;

  return (
    <section className="rr-product-analysis" aria-label="Análisis de producto Post-E50">
      <div className="rr-disc-section-head">
        <p className="rr-section-title">Análisis de demostración</p>
      </div>
      {/*
        Procedencia comprobada (docs/VISOR_FUNCIONES_RELEVAMIENTO.md, sección 9): todas las corridas de
        este circuito salen de POST /api/studies/{caseId}/product-analysis, que llama a /v1/product/analyze
        del módulo de IA con el pipeline en modo "contract" (contornos fijos del contrato, nivel L4-L5
        cableado). No depende de que el resultado esté completo o parcial. Desde acá ya no se inician
        corridas nuevas: se conserva lo ya registrado, con su revisión y correcciones.
      */}
      <p className="rr-note" data-testid="demo-analysis-notice">{DEMO_ANALYSIS_NOTICE}</p>

      {state.phase === "error" && state.error && (
        <p className="rr-disc-contract-error" role="alert">{state.error.message}</p>
      )}

      {state.mutationError && (
        <p className="rr-disc-contract-error" role="alert">{state.mutationError.message}</p>
      )}

      {state.phase === "loading_history" && !selected && (
        <p className="rr-note">Cargando análisis registrados…</p>
      )}

      {state.phase !== "loading_history" && !selected && state.phase !== "error" && (
        <p className="rr-findings-empty">Este estudio no tiene corridas de demostración registradas.</p>
      )}

      {selected && (
        <AnalysisResultBody
          result={selected}
          mutating={!canMutate}
          onReviewRun={(decision, comment) => void reviewRun(selected.analysisRunId, { status: decision, comment })}
          onReviewDiscLevel={(discLevelId, decision, comment) =>
            void reviewDiscLevel(selected.analysisRunId, discLevelId, { status: decision, comment })
          }
          onCorrectMeasurement={(measurementId, field, correctedValue) =>
            void correctMeasurement(selected.analysisRunId, measurementId, { field, correctedValue })
          }
        />
      )}

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

function AnalysisResultBody({
  result,
  mutating,
  onReviewRun,
  onReviewDiscLevel,
  onCorrectMeasurement,
}: {
  result: ProductAnalysisResult;
  mutating: boolean;
  onReviewRun: (decision: ReviewDecision, comment?: string) => void;
  onReviewDiscLevel: (discLevelId: string, decision: ReviewDecision, comment?: string) => void;
  onCorrectMeasurement: (measurementId: string, field: CorrectionField, correctedValue: number) => void;
}) {
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
          {result.discLevels.map((discLevel) => (
            <details className="rr-disc-level" key={discLevel.discLevelId}>
              <summary className="rr-disc-level-summary">
                <strong>{discLevel.level ?? "—"}</strong>
                <span>{discLevel.level ? displayDiscLevel(discLevel.level) : DISC_LEVEL_UNASSIGNED_TEXT}</span>
                <span>{discLevel.measurements.length}</span>
              </summary>
              <div className="rr-disc-finding-rows" style={{ padding: "8px 10px" }}>
                {/* IA vs revisión profesional: nunca combinadas en un mismo badge ambiguo (78-I). */}
                <p className="rr-note">{displayLocalizationStatus(discLevel.localizationStatus)}</p>
                <p className="rr-note">
                  {displayAxialPairingStatus(discLevel.axialPairingStatus, {
                    validated: discLevel.axialPairingValidated,
                    experimental: discLevel.axialPairingExperimental,
                    reviewRequired: discLevel.axialPairingReviewRequired,
                  })}
                </p>
                <p className="rr-note">{displayDegenerativeFindingsStatus(discLevel.degenerativeFindingsStatus)}</p>

                <MeasurementList measurements={discLevel.measurements} mutating={mutating} onCorrectMeasurement={onCorrectMeasurement} />

                <ReviewSection
                  label="Revisión de este nivel"
                  idSuffix={discLevel.discLevelId}
                  review={discLevel.review}
                  mutating={mutating}
                  onDecision={(decision, comment) => onReviewDiscLevel(discLevel.discLevelId, decision, comment)}
                />
              </div>
            </details>
          ))}
        </div>
      )}
      <p className="rr-findings-foot">{MORPHOMETRY_DISCLAIMER}</p>

      <ReviewSection label="Revisión de la corrida" review={result.review} mutating={mutating} onDecision={onReviewRun} />
    </div>
  );
}

function MeasurementList({
  measurements,
  mutating,
  onCorrectMeasurement,
}: {
  measurements: ProductAnalysisMeasurement[];
  mutating: boolean;
  onCorrectMeasurement: (measurementId: string, field: CorrectionField, correctedValue: number) => void;
}) {
  if (measurements.length === 0) return <p className="rr-findings-empty">Sin mediciones disponibles para este nivel.</p>;
  const fields: CorrectionField[] = ["areaMm2", "majorAxisMm", "minorAxisMm"];
  return (
    <div className="rr-disc-finding-rows">
      {measurements.map((measurement) => (
        <div key={measurement.measurementId} className="rr-product-analysis-measurement">
          <p className="rr-note"><strong>{measurement.structure}</strong> · {displayDiscLevel(measurement.level)}</p>
          {fields
            .filter((field) => measurement[field] !== null || measurement.corrections.some((c) => c.field === field))
            .map((field) => (
              <MeasurementFieldRow
                key={field}
                field={field}
                aiValue={measurement[field]}
                correction={measurement.corrections.find((c) => c.field === field)}
                mutating={mutating}
                onCorrect={(value) => onCorrectMeasurement(measurement.measurementId, field, value)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function MeasurementFieldRow({
  field,
  aiValue,
  correction,
  mutating,
  onCorrect,
}: {
  field: CorrectionField;
  aiValue: number | null;
  correction?: ProductAnalysisMeasurement["corrections"][number];
  mutating: boolean;
  onCorrect: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => String(correction?.correctedValue ?? aiValue ?? ""));

  if (editing) {
    return (
      <div className="rr-disc-finding" role="group" aria-label={`Corregir ${CORRECTION_FIELD_LABELS[field]}`}>
        <span>{CORRECTION_FIELD_LABELS[field]}</span>
        <span className="rr-disc-finding-result">
          <input
            type="number"
            step="any"
            value={draft}
            aria-label={`Valor revisado de ${CORRECTION_FIELD_LABELS[field]}`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="rr-more-action"
            type="button"
            disabled={mutating}
            onClick={() => {
              const parsed = Number(draft);
              if (Number.isFinite(parsed)) onCorrect(parsed);
              setEditing(false);
            }}
          >
            Guardar
          </button>
          <button className="rr-more-action" type="button" onClick={() => setEditing(false)}>Cancelar</button>
        </span>
      </div>
    );
  }

  return (
    <div className="rr-disc-finding">
      <span>{CORRECTION_FIELD_LABELS[field]}</span>
      <span className="rr-disc-finding-result">
        <span>Valor automático: {formatMeasurementFieldValue(field, aiValue)}</span>
        {correction && <strong>Valor revisado: {formatMeasurementFieldValue(field, correction.correctedValue)}</strong>}
        <button className="rr-more-action" type="button" disabled={mutating} onClick={() => setEditing(true)}>
          Corregir
        </button>
      </span>
    </div>
  );
}

function ReviewSection({
  label,
  idSuffix,
  review,
  mutating,
  onDecision,
}: {
  label: string;
  idSuffix?: string;
  review: ProductAnalysisReview;
  mutating: boolean;
  onDecision: (decision: ReviewDecision, comment?: string) => void;
}) {
  const [pendingAction, setPendingAction] = useState<"observed" | "rejected" | null>(null);
  const [comment, setComment] = useState("");
  const reviewedBy = displayReviewedBy(review.reviewedBy);
  // 81-P: `label` es un texto fijo reutilizado en cada nivel de disco -- usar sólo `label` como id
  // produce ids de DOM duplicados cuando hay varios `<details>` abiertos a la vez, rompiendo la
  // asociación label/textarea para todos menos el primero. `idSuffix` (p.ej. discLevelId) lo hace
  // único por instancia; "run" es el fallback para la única instancia sin un nivel asociado.
  const fieldId = `review-comment-${idSuffix ?? "run"}`;

  return (
    <div className="rr-product-analysis-review">
      <p className="rr-section-title">{label}</p>
      <p className="rr-note">{displayReviewStatus(review)}</p>
      {review.comment && <p className="rr-note">"{review.comment}"</p>}
      {reviewedBy && <p className="rr-note">Revisado por: {reviewedBy}</p>}

      {pendingAction ? (
        <div className="rr-product-analysis-review-form">
          <label className="rr-note" htmlFor={fieldId}>
            {pendingAction === "rejected" ? "Motivo del rechazo" : "Comentario de la observación"}
          </label>
          <textarea
            id={fieldId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {pendingAction === "rejected" && <p className="rr-note">{REVIEW_REJECT_CONFIRMATION_TEXT}</p>}
          <div className="rr-disc-finding-result">
            <button
              className="rr-more-action"
              type="button"
              disabled={mutating}
              onClick={() => {
                onDecision(pendingAction, comment.trim() || undefined);
                setPendingAction(null);
                setComment("");
              }}
            >
              Confirmar
            </button>
            <button className="rr-more-action" type="button" onClick={() => { setPendingAction(null); setComment(""); }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="rr-disc-finding-result">
          <button className="rr-more-action" type="button" disabled={mutating} onClick={() => onDecision("accepted")}>
            {REVIEW_ACTION_LABELS.accepted}
          </button>
          <button className="rr-more-action" type="button" disabled={mutating} onClick={() => setPendingAction("observed")}>
            {REVIEW_ACTION_LABELS.observed}
          </button>
          <button className="rr-more-action" type="button" disabled={mutating} onClick={() => setPendingAction("rejected")}>
            {REVIEW_ACTION_LABELS.rejected}
          </button>
        </div>
      )}
    </div>
  );
}
