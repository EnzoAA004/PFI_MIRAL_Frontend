import { useEffect, useMemo, useState } from "react";
import type { ComparisonStudySide } from "../../contracts/initialAnalysisComparisonTypes";
import type { DiscFinding } from "./discDegenerativeFindings";
import { DISC_LEVELS } from "./discDegenerativeFindings";
import {
  DEPLOYMENT_LABELS,
  DISC_FINDING_LABELS,
  DISC_SERIES_ROLE_LABELS,
  displayDiscFindingConfidence,
  displayDiscFindingValue,
} from "./discFindingDisplay";
import {
  FILTER_LABEL,
  STATUS_LABEL,
  emptyGroupMessage,
  filterRows,
  noRowsMessage,
  orderedDistribution,
  stepRows,
  type ComparisonSide,
  type FindingComparisonRow,
  type FindingsComparison,
  type FindingsFilter,
  type RegionTarget,
} from "./discFindingsComparison";
import { describeSide } from "./initialComparisonDisplay";

/**
 * Comparación de la clasificación de cada disco entre los dos estudios del visor dual.
 *
 * Es la vista principal de «Hallazgos IA» del dual. Lee solo resultados ya guardados de las corridas iniciales
 * que muestra el visor: abrirla o recorrerla no ejecuta ningún análisis ni consulta a un LLM.
 *
 * No interpreta: dice qué clase tenía cada lado y si cambió. No hay «mejoró», «empeoró» ni «progresión», y una
 * variación de probabilidad con la misma clase no se marca. Lo ausente, no evaluado o no comparable nunca se
 * presenta como «Ausente» ni como «sin cambios».
 */

const SIDE_TITLE: Record<ComparisonSide, string> = { reference: "Referencia", current: "Actual" };
const REGION_NOTICE =
  "Región evaluada por el modelo: marca el sitio sobre el que se clasificó. No delimita la lesión ni muestra tejido que cambió, "
  + "y la localización anatómica automática no está validada.";
const DISTRIBUTION_NOTICE =
  "Son los valores que el modelo asignó a cada clase. No son una segunda opinión ni hay un umbral validado para leerlos; "
  + "la revisión profesional es obligatoria.";

function resultText(finding: DiscFinding | null, rejected?: string): string {
  if (rejected) return "Resultado inválido";
  return finding ? displayDiscFindingValue(finding.label, finding.findingType) : "Sin dato";
}

function confidenceText(finding: DiscFinding | null): string | null {
  if (!finding) return null;
  return finding.confidence === undefined ? null : `prob. ${displayDiscFindingConfidence(finding.confidence)}`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

type Props = {
  comparison: FindingsComparison;
  reference: ComparisonStudySide;
  current: ComparisonStudySide;
  filter: FindingsFilter;
  onFilterChange: (filter: FindingsFilter) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Ubicación de la región de la fila seleccionada en cada lado. */
  targets: Record<ComparisonSide, RegionTarget | null>;
};

function RowButton({ row, selected, onSelect }: { row: FindingComparisonRow; selected: boolean; onSelect: (key: string) => void }) {
  const experimental = row.reference?.deploymentStatus === "experimental" || row.current?.deploymentStatus === "experimental";
  const changed = row.status !== "unchanged" && row.status !== "not_comparable";
  return (
    <button
      aria-pressed={selected}
      className={`rr-dfc-row${selected ? " is-selected" : ""}${changed ? " is-changed" : ""}${row.status === "not_comparable" ? " is-noncomparable" : ""}`}
      data-row-key={row.key}
      data-status={row.status}
      data-testid="dual-finding-row"
      onClick={() => onSelect(row.key)}
      type="button"
    >
      <span className="rr-dfc-name">
        {DISC_FINDING_LABELS[row.findingType]}
        {experimental && <small className="rr-dfc-tag">{DEPLOYMENT_LABELS.experimental}</small>}
      </span>
      <span className="rr-dfc-values" data-testid="dual-finding-values">
        <span aria-label="Resultado de la referencia" className={row.reference ? "" : "is-missing"}>{resultText(row.reference, row.rejected.reference)}</span>
        <i aria-hidden="true">→</i>
        <span aria-label="Resultado del estudio actual" className={row.current ? "" : "is-missing"}>{resultText(row.current, row.rejected.current)}</span>
      </span>
      <span className="rr-dfc-status" data-testid="dual-finding-status">{STATUS_LABEL[row.status]}</span>
      {row.reason && <span className="rr-dfc-reason">{row.reason.text}</span>}
    </button>
  );
}

function Groups({ rows, selectedKey, onSelect }: { rows: FindingComparisonRow[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const levels = DISC_LEVELS.filter((level) => rows.some((row) => row.level === level));
  return (
    <>
      {levels.map((level) => {
        const levelRows = rows.filter((row) => row.level === level);
        const changes = levelRows.filter((row) => row.status !== "unchanged" && row.status !== "not_comparable").length;
        return (
          <section className="rr-dfc-disc" data-level={level} data-testid={`dual-finding-disc-${level}`} key={level}>
            <h5>
              {level}
              {changes > 0 && <small>{changes === 1 ? "1 cambio de clasificación" : `${changes} cambios de clasificación`}</small>}
            </h5>
            <div className="rr-dfc-rows">
              {levelRows.map((row) => <RowButton key={row.key} onSelect={onSelect} row={row} selected={row.key === selectedKey} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

function SideResult({ side, finding, rejected, summary, target }: { side: ComparisonSide; finding: DiscFinding | null; rejected?: string; summary: ComparisonStudySide; target: RegionTarget | null }) {
  return (
    <div className="rr-dfc-side" data-side={side} data-testid={`dual-finding-selected-${side}`}>
      <strong>{SIDE_TITLE[side]} · {summary.caseId}</strong>
      <span className="rr-dfc-side-result">
        {resultText(finding, rejected)}
        {confidenceText(finding) && <small> · {confidenceText(finding)}</small>}
      </span>
      {finding ? (
        <>
          <span>
            {DEPLOYMENT_LABELS[finding.deploymentStatus]} · revisión profesional pendiente
          </span>
          {target?.state === "ready" ? (
            <span data-testid={`dual-finding-region-${side}`}>
              Región evaluada en {DISC_SERIES_ROLE_LABELS[target.role]} ({target.seriesLabel}), corte {target.sliceIndex + 1}
            </span>
          ) : (
            <span className="is-missing" data-testid={`dual-finding-region-${side}`}>{target?.reason ?? "Región no disponible."}</span>
          )}
          <small>{finding.modelId} · checkpoint {finding.modelSha256.slice(0, 8)}</small>
        </>
      ) : (
        <span className="is-missing" data-testid={`dual-finding-region-${side}`}>
          {rejected ? `Región no disponible: el resultado de este lado no cumple el contrato (${rejected}).` : "Región no disponible: este lado no tiene el resultado."}
        </span>
      )}
      <small>{describeSide(summary)}</small>
    </div>
  );
}

function Distribution({ row }: { row: FindingComparisonRow }) {
  const sides = [["reference", row.reference], ["current", row.current]] as const;
  return (
    <details className="rr-dfc-distribution" data-testid="dual-finding-distribution">
      <summary>Distribución por clase de cada lado</summary>
      <div className="rr-dfc-dist-grid">
        {sides.map(([side, finding]) => {
          const distribution = finding ? orderedDistribution(finding) : null;
          return (
            <div key={side}>
              <strong>{SIDE_TITLE[side]}</strong>
              {!finding && <p className="rr-note">Sin resultado en este lado.</p>}
              {finding && !distribution && <p className="rr-note">Distribución no informada por esta corrida.</p>}
              {distribution && (
                <ul data-testid={`dual-finding-dist-${side}`}>
                  {distribution.map((item) => (
                    <li className={finding && item.label === finding.label ? "is-reported" : ""} key={item.label}>
                      <span>{displayDiscFindingValue(item.label, row.findingType)}</span>
                      <span>{percent(item.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="rr-note">{DISTRIBUTION_NOTICE}</p>
    </details>
  );
}

export function DualFindingsComparison({ comparison, reference, current, filter, onFilterChange, selectedKey, onSelect, targets }: Props) {
  const visible = useMemo(() => filterRows(comparison.rows, filter), [comparison.rows, filter]);
  const main = visible.filter((row) => row.section === "main");
  const research = visible.filter((row) => row.section === "research");
  const ordered = useMemo(() => [...main, ...research], [main, research]);
  // La ficha solo existe mientras su fila esté en el grupo visible: si el filtro la oculta no se muestra ni un instante.
  const selected = selectedKey ? ordered.find((row) => row.key === selectedKey) ?? null : null;
  const previous = stepRows(ordered, selectedKey, -1);
  const next = stepRows(ordered, selectedKey, 1);
  const position = selectedKey ? ordered.findIndex((row) => row.key === selectedKey) : -1;
  const empty = noRowsMessage(comparison);
  const emptyGroup = emptyGroupMessage(comparison, filter);
  const counts = comparison.counts;
  // Los resultados de investigación empiezan plegados; si el recorrido llega a uno, se abre para que se vea la fila.
  const [researchOpen, setResearchOpen] = useState(false);
  useEffect(() => {
    if (selected?.section === "research") setResearchOpen(true);
  }, [selected?.key, selected?.section]);

  const options: [FindingsFilter, number][] = [
    ["changes", counts.main.changes],
    ["all", counts.main.all],
    ["noncomparable", counts.main.notComparable],
  ];

  return (
    <div className="rr-dfc" data-testid="dual-findings-comparison">
      <p className="rr-note">
        Clasificación de cada disco en los dos estudios, a partir de los resultados guardados de las corridas iniciales que muestra el
        visor. No se ejecuta ningún análisis al abrirla. Es una comparación de resultados de IA sujeta a revisión profesional, no una
        lectura de evolución clínica.
      </p>

      {empty && <p className="rr-note rr-note-warn" data-testid="dual-findings-empty" role="status">{empty}</p>}
      {(comparison.unreadable.reference > 0 || comparison.unreadable.current > 0) && (
        <p className="rr-note rr-note-warn" data-testid="dual-findings-unreadable" role="status">
          Hay resultados que no cumplen el contrato y no se pudieron identificar (referencia: {comparison.unreadable.reference}; actual:{" "}
          {comparison.unreadable.current}). No entran en la comparación ni se interpretan como «Ausente».
        </p>
      )}

      {!empty && (
        <>
          <div aria-label="Filtro de hallazgos" className="rr-dfc-filters" role="group">
            {options.map(([id, count]) => (
              <button
                aria-pressed={filter === id}
                className={filter === id ? "is-on" : ""}
                data-testid={`dual-findings-filter-${id}`}
                key={id}
                onClick={() => onFilterChange(id)}
                type="button"
              >
                {FILTER_LABEL[id]} <b>({count})</b>
              </button>
            ))}
          </div>
          <p className="rr-note" data-testid="dual-findings-counts-note">
            Los conteos son de las clasificaciones principales (incluye Pfirrmann, experimental). Los resultados de investigación se cuentan aparte
            ({counts.research.changes} con cambio de clase de {counts.research.all}).
          </p>

          <div className="rr-dfc-steps">
            <button
              data-testid="dual-findings-prev"
              disabled={ordered.length === 0 || !previous.hasPrevious}
              onClick={() => onSelect(previous.key)}
              type="button"
            >
              ‹ Anterior
            </button>
            <button
              data-testid="dual-findings-next"
              disabled={ordered.length === 0 || !next.hasNext}
              onClick={() => onSelect(next.key)}
              type="button"
            >
              Siguiente ›
            </button>
            <span data-testid="dual-findings-position">
              {ordered.length === 0 ? "Sin filas en este grupo" : position >= 0 ? `Fila ${position + 1} de ${ordered.length}` : `${ordered.length} en el grupo`}
            </span>
          </div>

          {selected && (
            <section className="rr-dfc-selected" data-testid="dual-finding-selected">
              <h5>
                {selected.level} · {DISC_FINDING_LABELS[selected.findingType]}
                <span className="rr-dfc-status">{STATUS_LABEL[selected.status]}</span>
              </h5>
              {selected.reason && <p className="rr-note" data-testid="dual-finding-reason">{selected.reason.text}</p>}
              <div className="rr-dfc-sides">
                <SideResult finding={selected.reference} rejected={selected.rejected.reference} side="reference" summary={reference} target={targets.reference} />
                <SideResult finding={selected.current} rejected={selected.rejected.current} side="current" summary={current} target={targets.current} />
              </div>
              <Distribution row={selected} />
              <p className="rr-note" data-testid="dual-finding-region-notice">{REGION_NOTICE}</p>
            </section>
          )}

          {emptyGroup && <p className="rr-note" data-testid="dual-findings-group-empty" role="status">{emptyGroup}</p>}

          <div data-testid="dual-findings-main">
            <Groups onSelect={onSelect} rows={main} selectedKey={selectedKey} />
          </div>

          {(counts.research.all > 0) && (
            <details
              className="rr-dfc-research"
              data-testid="dual-findings-research"
              onToggle={(event) => setResearchOpen(event.currentTarget.open)}
              open={researchOpen}
            >
              <summary>Resultados de investigación (no soportados para uso clínico) · {research.length} en este grupo</summary>
              <p className="rr-note">
                Hernia discal, espondilolistesis y cambio Modic se conservan para análisis de investigación y no forman parte de las
                clasificaciones principales.
              </p>
              <Groups onSelect={onSelect} rows={research} selectedKey={selectedKey} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

