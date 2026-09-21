import { useLongitudinalComparison } from "./useLongitudinalComparison";
import {
  LONGITUDINAL_DISCLAIMER,
  NO_BASELINE_STUDY_TEXT,
  NO_COMPARABLE_MEASUREMENTS_TEXT,
  NO_USABLE_ANALYSIS_TEXT,
  displayComparisonStatus,
  displayCorrectedNote,
  displayMetricLabel,
  formatComparisonValue,
  formatDeltaAbsolute,
  formatDeltaPercent,
  trendArrow,
} from "./longitudinalComparisonDisplay";
import { displayStudyDate } from "../../studyDisplay";
import type { LongitudinalMeasurementComparison } from "../../contracts/longitudinalComparisonTypes";

type Props = {
  /** El Study actualmente abierto — siempre el lado "actual" de la comparación. */
  caseId: string;
  /** `null` cuando el Study no tiene una referencia de-identificada estable (79-D: fail closed). */
  subjectRef: string | null;
  /** Stage 84-T: preselecciona un baseline (p.ej. desde "Comparar" en el historial del paciente). */
  initialBaselineCaseId?: string;
};

/**
 * "Evolución" (stage 79) — comparación determinística entre el Study actual y otro Study del
 * mismo paciente elegido como referencia. Vive dentro de la pestaña "Más" de `StudyReviewView`,
 * junto a la Reconstrucción 3D — un concepto cross-Study distinto del historial de corridas de
 * `ProductAnalysisV1Panel` (79-X), por eso no comparte ese panel.
 *
 * Nunca calcula un delta acá: todo el cálculo viene ya resuelto del Backend. Nunca usa semántica
 * de color clínico — sólo una flecha (↑/↓) y el signo del número (79-S).
 */
export function LongitudinalComparisonPanel({ caseId, subjectRef, initialBaselineCaseId }: Props) {
  const { state, selectBaseline } = useLongitudinalComparison(caseId, subjectRef, initialBaselineCaseId);

  if (!subjectRef) {
    return (
      <div className="panel-hidden-placeholder honest-empty-state">
        <strong>{NO_BASELINE_STUDY_TEXT}</strong>
        <span>Este estudio no tiene una referencia de paciente de-identificada estable para buscar otros estudios.</span>
      </div>
    );
  }

  return (
    <div className="longitudinal-comparison">
      <label className="rr-workspace-series">
        <span className="rr-workspace-series-label">Comparar con</span>
        <select
          aria-label="Estudio de referencia"
          value={state.selectedBaselineCaseId ?? ""}
          onChange={(event) => void selectBaseline(event.target.value)}
          // 81-G: también deshabilitado mientras carga una comparación -- sin esto, re-elegir
          // baseline rápido dispara pedidos superpuestos (el último en responder "gana" sin orden
          // garantizado).
          disabled={state.phase === "loading_candidates" || state.phase === "loading_comparison"}
        >
          <option value="">Seleccionar estudio…</option>
          {state.candidates.map((candidate) => (
            <option key={candidate.caseId} value={candidate.caseId}>
              {displayStudyDate(candidate.studyDate)} · {candidate.caseId}
            </option>
          ))}
        </select>
      </label>

      {state.phase === "loading_candidates" && <p className="rr-note">Cargando estudios disponibles…</p>}

      {state.phase !== "loading_candidates" && state.candidates.length === 0 && (
        <div className="panel-hidden-placeholder honest-empty-state">
          <strong>{NO_BASELINE_STUDY_TEXT}</strong>
          <span>No se encontraron otros estudios persistidos para este paciente.</span>
        </div>
      )}

      {state.phase === "loading_comparison" && <p className="rr-note">Calculando comparación…</p>}

      {state.phase === "error" && state.error && (
        <div className="panel-hidden-placeholder honest-empty-state">
          <strong>{errorHeadline(state.error.kind)}</strong>
          <span>{state.error.message}</span>
        </div>
      )}

      {state.result && <ComparisonTable measurements={state.result.measurements} />}
    </div>
  );
}

function errorHeadline(kind: string): string {
  if (kind === "not_found") return "Estudio no encontrado o de otro paciente.";
  if (kind === "functional") return NO_USABLE_ANALYSIS_TEXT;
  return "No se pudo calcular la comparación.";
}

function ComparisonTable({ measurements }: { measurements: LongitudinalMeasurementComparison[] }) {
  const comparable = measurements.filter((m) => m.comparisonStatus === "comparable");
  const notComparable = measurements.filter((m) => m.comparisonStatus !== "comparable");

  if (measurements.length === 0) {
    return (
      <div className="panel-hidden-placeholder honest-empty-state">
        <strong>{NO_COMPARABLE_MEASUREMENTS_TEXT}</strong>
        <span>Ninguno de los dos estudios tiene mediciones registradas.</span>
      </div>
    );
  }

  return (
    <div>
      <p className="rr-note">{LONGITUDINAL_DISCLAIMER}</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scroll horizontal accesible por teclado */}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla de comparación longitudinal">
        <table className="worklist-table longitudinal-measurements-table">
          <thead>
            <tr>
              <th>Medición</th>
              <th>Anterior</th>
              <th>Actual</th>
              <th>Cambio</th>
            </tr>
          </thead>
          <tbody>
            {comparable.map((row, index) => (
              <ComparisonRow key={index} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {notComparable.length > 0 && (
        <details className="rr-disc-research">
          <summary><span>No comparables ({notComparable.length})</span></summary>
          <div className="rr-disc-finding-rows" style={{ padding: "8px 10px" }}>
            {notComparable.map((row, index) => (
              <article className="rr-disc-finding" key={index}>
                <span>{row.level ?? "Nivel no asignado"} · {displayMetricLabel(row.metric)}</span>
                <span className="rr-disc-finding-result">{displayComparisonStatus(row.comparisonStatus)}</span>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ComparisonRow({ row }: { row: LongitudinalMeasurementComparison }) {
  const baselineCorrectedNote = row.baseline ? displayCorrectedNote(row.baseline.source) : null;
  const currentCorrectedNote = row.current ? displayCorrectedNote(row.current.source) : null;
  return (
    <tr>
      <td>
        <strong>{row.level ?? "—"}</strong>
        <small> {displayMetricLabel(row.metric)}</small>
      </td>
      <td>
        {formatComparisonValue(row.baseline?.effectiveValue ?? null, row.unit)}
        {baselineCorrectedNote && <small className="rr-note"> ({baselineCorrectedNote}: automático {formatComparisonValue(row.baseline?.automaticValue ?? null, row.unit)})</small>}
      </td>
      <td>
        {formatComparisonValue(row.current?.effectiveValue ?? null, row.unit)}
        {currentCorrectedNote && <small className="rr-note"> ({currentCorrectedNote}: automático {formatComparisonValue(row.current?.automaticValue ?? null, row.unit)})</small>}
      </td>
      <td>
        {trendArrow(row.trend)} {formatDeltaAbsolute(row.deltaAbsolute, row.unit)} ({formatDeltaPercent(row.deltaPercent)})
      </td>
    </tr>
  );
}
