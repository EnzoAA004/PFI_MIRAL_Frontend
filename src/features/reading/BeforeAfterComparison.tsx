import type { StudyReport } from "../../contracts/studyReportTypes";
import { EvidenceRegionOverlay } from "./EvidenceRegionOverlay";
import {
  BEFORE_AFTER_TITLE,
  NO_BEFORE_AFTER_MESSAGE,
  beforeAfterDeltaLine,
  beforeAfterRowLabel,
  beforeAfterRows,
  beforeAfterValueLine,
  matchingEvidence,
  type BeforeAfterRow,
} from "./beforeAfterDisplay";
import { displayStudyDate } from "../../studyDisplay";

/**
 * EXT-07B: "Comparación con estudio previo" — Anterior vs Actual, lado a lado, reutilizando las
 * filas numéricas que el Backend ya calcula (`longitudinalHistory.comparisons`, EXT-04A) y,
 * cuando existe una región coincidente, el `EvidenceRegionOverlay` de solo lectura de EXT-04B3 para la
 * imagen+overlay de cada lado. Nunca un segundo cálculo de delta/porcentaje de este lado — el Backend
 * es la única fuente de verdad de esos números, la misma regla que ya sigue la tabla
 * "Evolución".
 *
 * El vocabulario es deliberadamente neutral (`Anterior`/`Actual`/`Delta`/`Variación`), nunca
 * mejoró/empeoró/progresión — la misma regla que 84-N ya aplica a la tabla "Evolución".
 */
export function BeforeAfterComparison({ current, previous }: { current: StudyReport; previous: StudyReport | null }) {
  const rows = beforeAfterRows(current.longitudinalHistory);
  if (rows.length === 0) {
    return <p className="rr-note" data-testid="before-after-empty">{NO_BEFORE_AFTER_MESSAGE}</p>;
  }

  return (
    <div className="before-after-comparison" data-testid="before-after-comparison">
      {rows.map((row, index) => (
        <BeforeAfterRowCard key={`${row.previousCaseId}-${row.level}-${row.metric}-${index}`} row={row} current={current} previous={previous} />
      ))}
    </div>
  );
}

function BeforeAfterRowCard({ row, current, previous }: { row: BeforeAfterRow; current: StudyReport; previous: StudyReport | null }) {
  const previousEvidence = previous ? matchingEvidence(row, previous.visualEvidence) : null;
  const currentEvidence = matchingEvidence(row, current.visualEvidence);

  return (
    <article className="before-after-row" data-testid="before-after-row">
      <h4 className="before-after-row-title">{beforeAfterRowLabel(row)}</h4>
      <div className="before-after-columns">
        <section className="before-after-column" aria-label="Estudio anterior">
          <p className="before-after-column-title">Anterior</p>
          <p className="before-after-date">{displayStudyDate(row.previousStudyDate)}</p>
          {previousEvidence ? <EvidenceRegionOverlay item={previousEvidence} /> : <p className="rr-note">Sin evidencia visual comparable.</p>}
          <p className="before-after-value">Valor previo: {beforeAfterValueLine(row.previousEffectiveValue, row.unit, row.previousValueSource)}</p>
        </section>
        <section className="before-after-column" aria-label="Estudio actual">
          <p className="before-after-column-title">Actual</p>
          <p className="before-after-date">{displayStudyDate(row.currentStudyDate)}</p>
          {currentEvidence ? <EvidenceRegionOverlay item={currentEvidence} /> : <p className="rr-note">Sin evidencia visual comparable.</p>}
          <p className="before-after-value">Valor actual: {beforeAfterValueLine(row.currentEffectiveValue, row.unit, row.currentValueSource)}</p>
        </section>
      </div>
      <p className="before-after-delta">Variación: {beforeAfterDeltaLine(row)}</p>
    </article>
  );
}

export { BEFORE_AFTER_TITLE };
