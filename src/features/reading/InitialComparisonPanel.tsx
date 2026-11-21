import { useInitialComparison } from "./useInitialComparison";
import { emptyKindOf } from "./initialComparisonState";
import {
  COMPARISON_SOURCE_LINE,
  DIFFERENCE_NOTE,
  EMPTY_TEXT,
  describeAnalysis,
  describeSide,
  displayMetricName,
  displayUnit,
  exclusionSideText,
  formatDelta,
  formatPercent,
  formatStudyDate,
  formatValue,
  groupExclusions,
  groupRowsByLevel,
  patientLinkText,
  trendArrow,
  trendText,
} from "./initialComparisonDisplay";
import type { ComparisonValue, InitialComparisonRow } from "../../contracts/initialAnalysisComparisonTypes";

type Props = {
  /** El estudio abierto en el visor: siempre el lado "estudio abierto" de la diferencia. */
  caseId: string;
  /** La corrida del análisis inicial que el visor muestra; el Backend consulta esa y no otra. */
  currentRunId: string | null;
  /** Abre la comparación visual con la referencia indicada (vacía si todavía no hay una elegida). */
  onOpenVisual?: (referenceCaseId: string) => void;
};

function ValueCell({ value }: { value: ComparisonValue }) {
  return (
    <td className="rr-cmp-num">
      {formatValue(value.effectiveValue)}
      {value.corrected && (
        <small className="rr-cmp-corrected" data-testid="corrected-value" title="Valor corregido por el profesional; el original de la IA se conserva.">
          corregido · IA {formatValue(value.originalValue)}
        </small>
      )}
    </td>
  );
}

function ComparisonRow({ row }: { row: InitialComparisonRow }) {
  const percent = formatPercent(row);
  return (
    <tr data-trend={row.trend} data-testid="comparison-row">
      <th scope="row">
        {displayMetricName(row.structure, row.metric)}
        <small className="rr-cmp-unit"> ({displayUnit(row.unit)})</small>
        {row.experimental && <small className="rr-cmp-flag">derivada · experimental</small>}
      </th>
      <ValueCell value={row.reference} />
      <ValueCell value={row.current} />
      <td className="rr-cmp-num" data-testid="delta-absolute">
        {formatDelta(row.deltaAbsolute)}
        <small className="rr-cmp-trend">{[trendArrow(row.trend), trendText(row.trend)].filter(Boolean).join(" ")}</small>
      </td>
      <td className="rr-cmp-num" data-testid="delta-percent" data-status={row.percentStatus}>{percent}</td>
    </tr>
  );
}

/**
 * "Comparación entre estudios" sobre el análisis inicial REAL: las mediciones que ya muestra el visor, de
 * otro estudio del mismo paciente. No consulta el análisis de demostración ni ejecuta ningún análisis.
 *
 * La tabla agrupa por nivel y da, por métrica, el valor de la referencia, el del estudio abierto, la
 * diferencia (abierto − referencia) y el porcentaje. Todo viene calculado del Backend; acá solo se da
 * formato. Lo que no se pudo emparejar con certeza se lista aparte con su motivo.
 */
export function InitialComparisonPanel({ caseId, currentRunId, onOpenVisual }: Props) {
  const { state, select } = useInitialComparison(caseId, currentRunId);
  const { candidates, comparison } = state;
  const eligible = candidates?.candidates.filter((candidate) => candidate.eligible) ?? [];
  const ineligible = candidates?.candidates.filter((candidate) => !candidate.eligible) ?? [];
  const emptyKind = emptyKindOf(candidates);
  const selecting = state.phase === "loading_comparison";
  const groups = comparison ? groupRowsByLevel(comparison.comparisons) : [];
  const exclusionGroups = comparison ? groupExclusions(comparison.excluded) : [];
  const selectedCandidate = candidates?.candidates.find((candidate) => candidate.caseId === state.selectedCaseId);

  return (
    <div className="rr-cmp" data-testid="initial-comparison">
      <p className="rr-note" data-testid="comparison-source-note">{COMPARISON_SOURCE_LINE}</p>

      {state.phase === "loading_candidates" && <p className="rr-note" role="status">Buscando otros estudios del paciente…</p>}
      {state.phase === "error" && state.candidatesError && (
        <p className="rr-note rr-note-warn" role="alert">{state.candidatesError.message}</p>
      )}

      {candidates && (
        <section aria-label="Estudios que se comparan" className="rr-cmp-sides">
          <div className="rr-cmp-side" data-testid="current-side">
            <span className="rr-cmp-side-label">Estudio abierto</span>
            <strong>{describeSide(candidates.current)}</strong>
            <span className="rr-note">{describeAnalysis(candidates.current)}</span>
          </div>
          <div className="rr-cmp-side" data-testid="reference-side">
            <label className="rr-cmp-side-label" htmlFor="rr-cmp-reference">Referencia</label>
            <select
              id="rr-cmp-reference"
              aria-label="Estudio de referencia"
              disabled={emptyKind !== null}
              onChange={(event) => select(event.target.value)}
              value={state.selectedCaseId ?? ""}
            >
              <option value="">Elegir un estudio del paciente…</option>
              {eligible.map((candidate) => (
                <option key={candidate.caseId} value={candidate.caseId}>
                  {candidate.caseId} · {formatStudyDate(candidate.studyDate)} · {candidate.usableMeasurementCount} mediciones
                </option>
              ))}
            </select>
            {comparison ? (
              <>
                <strong data-testid="reference-label">{describeSide(comparison.reference)}</strong>
                <span className="rr-note" data-testid="reference-analysis">{describeAnalysis(comparison.reference)}</span>
              </>
            ) : selectedCandidate ? (
              <span className="rr-note">{describeAnalysis({ ...candidates.current, runId: selectedCandidate.runId, runCreatedAt: selectedCandidate.runCreatedAt })}</span>
            ) : null}
          </div>
        </section>
      )}

      {onOpenVisual && candidates && emptyKind === null && (
        <button
          className="rr-more-action rr-cmp-visual"
          data-testid="open-dual-comparison"
          onClick={() => onOpenVisual(state.selectedCaseId ?? "")}
          type="button"
        >
          Abrir comparación visual
        </button>
      )}

      {emptyKind && (
        <div className="panel-hidden-placeholder honest-empty-state" data-empty={emptyKind} data-testid="comparison-empty">
          <strong>{EMPTY_TEXT[emptyKind].title}</strong>
          <span>{EMPTY_TEXT[emptyKind].detail}</span>
        </div>
      )}

      {candidates && ineligible.length > 0 && emptyKind !== "current_without_measurements" && (
        <details className="rr-help" data-testid="ineligible-candidates">
          <summary>{ineligible.length === 1 ? "1 estudio del paciente no se ofrece" : `${ineligible.length} estudios del paciente no se ofrecen`}</summary>
          <ul className="rr-help-body">
            {ineligible.map((candidate) => (
              <li key={candidate.caseId}>{candidate.caseId} · {formatStudyDate(candidate.studyDate)}: {candidate.reason}</li>
            ))}
          </ul>
        </details>
      )}

      {selecting && <p className="rr-note" role="status">Comparando mediciones guardadas…</p>}
      {state.comparisonError && !selecting && (
        <p className="rr-note rr-note-warn" data-testid="comparison-error" role="alert">{state.comparisonError.message}</p>
      )}

      {comparison && !selecting && (
        <>
          <p className="rr-cmp-summary" data-testid="comparison-summary">
            <strong>{comparison.summary.comparedCount}</strong> {comparison.summary.comparedCount === 1 ? "medición comparada" : "mediciones comparadas"}
            {" · "}
            <strong>{comparison.summary.excludedCount}</strong> {comparison.summary.excludedCount === 1 ? "excluida" : "excluidas"}
            {" de "}{comparison.summary.referenceMeasurementCount} (referencia) y {comparison.summary.currentMeasurementCount} (estudio abierto)
          </p>
          <p className="rr-note" data-testid="difference-note">{DIFFERENCE_NOTE}</p>
          <p className="rr-note">{patientLinkText(comparison.current.patientLink)}</p>

          {comparison.comparisons.length === 0 ? (
            <div className="panel-hidden-placeholder honest-empty-state" data-empty="no_comparable_matches" data-testid="comparison-empty">
              <strong>{EMPTY_TEXT.no_comparable_matches.title}</strong>
              <span>{EMPTY_TEXT.no_comparable_matches.detail}</span>
            </div>
          ) : (
            groups.map((group) => (
              <table className="rr-cmp-table" data-level={group.level} key={group.level}>
                <caption>{group.level}</caption>
                <thead>
                  <tr>
                    <th scope="col">Medición</th>
                    <th scope="col">Referencia</th>
                    <th scope="col">Abierto</th>
                    <th scope="col">Diferencia</th>
                    <th scope="col">%</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <ComparisonRow key={`${row.level}-${row.structure}-${row.metric}-${row.plane}`} row={row} />
                  ))}
                </tbody>
              </table>
            ))
          )}

          {exclusionGroups.length > 0 && (
            <details className="rr-help" data-testid="excluded-details" open={comparison.comparisons.length === 0 || undefined}>
              <summary>Mediciones excluidas ({comparison.excluded.length}) y por qué</summary>
              <div className="rr-help-body">
                {exclusionGroups.map((group) => (
                  <section data-reason={group.reasonCode} key={group.reasonCode}>
                    <p><strong>{group.title}</strong> ({group.items.length})</p>
                    <ul>
                      {group.items.slice(0, 6).map((item, index) => (
                        <li key={`${item.reasonCode}-${index}`}>
                          {exclusionSideText(item.side)}{item.level ? ` · ${item.level}` : ""}{item.metricKey ? ` · ${item.metricKey}` : ""}: {item.reason}
                        </li>
                      ))}
                      {group.items.length > 6 && <li>… y {group.items.length - 6} más con el mismo motivo.</li>}
                    </ul>
                  </section>
                ))}
              </div>
            </details>
          )}

          <details className="rr-help" data-testid="comparison-limitations">
            <summary>Alcance y limitaciones</summary>
            <div className="rr-help-body">
              <p>{candidates?.runSelectionRule}</p>
              {comparison.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
