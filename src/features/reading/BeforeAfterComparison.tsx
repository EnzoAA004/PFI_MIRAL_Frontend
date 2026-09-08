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
 * EXT-07B: "Comparación con estudio previo" — Anterior vs Actual, side by side, reusing the
 * numeric rows the Backend already computes (`longitudinalHistory.comparisons`, EXT-04A) and,
 * when a matching region exists, the read-only `EvidenceRegionOverlay` from EXT-04B3 for each
 * side's image+overlay. Never a second computation of delta/percent on this side — the Backend
 * is the only source of truth for those numbers, same rule the "Evolución" table already
 * follows.
 *
 * Vocabulary is deliberately neutral (`Anterior`/`Actual`/`Delta`/`Variación`), never
 * mejoró/empeoró/progresión — same rule 84-N already enforces for the "Evolución" table.
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
