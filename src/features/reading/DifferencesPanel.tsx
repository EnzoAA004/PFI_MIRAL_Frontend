import { useMemo, useState } from "react";
import type { ComparisonValue, InitialComparisonResult, InitialComparisonRow } from "../../contracts/initialAnalysisComparisonTypes";
import {
  DIFFERENCE_NOTE,
  displayMetricName,
  displayUnit,
  exclusionSideText,
  formatDelta,
  formatPercent,
  formatValue,
  groupExclusions,
  groupRowsByLevel,
  trendText,
} from "./initialComparisonDisplay";
import {
  applyFilter,
  isFilterActive,
  locationBadge,
  metricsOf,
  parseMinimum,
  rowKey,
  setMinimum,
  stepFrom,
  type DifferenceFilter,
} from "./dualComparisonLogic";

/**
 * Lista compacta de diferencias del visor de comparación.
 *
 * Es solo navegación y lectura: no calcula nada (todo viene del Backend), no colorea en rojo ni verde y no
 * califica ninguna diferencia. Los filtros ocultan filas en pantalla y siempre dicen cuántas ocultaron; las
 * mediciones excluidas se listan aparte con su motivo.
 */

type Props = {
  result: InitialComparisonResult;
  filter: DifferenceFilter;
  onFilterChange: (filter: DifferenceFilter) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
};

function Provenance({ value }: { value: ComparisonValue }) {
  return value.corrected
    ? <abbr className="rr-dual-prov is-corrected" title={`Valor corregido por el profesional. Original de la IA: ${formatValue(value.originalValue)}`}>corregido</abbr>
    : <abbr className="rr-dual-prov" title="Valor medido por la IA, sin correcciones">IA</abbr>;
}

function Place({ side, value }: { side: "Ref." | "Act."; value: ComparisonValue }) {
  const badge = locationBadge(value);
  return (
    <span className={`rr-dual-place${badge.available ? "" : " is-missing"}`} title={badge.available ? "Ubicada en la imagen" : "No se puede ubicar en la imagen"}>
      {side} {badge.text}
    </span>
  );
}

function SelectedSummary({ row }: { row: InitialComparisonRow }) {
  return (
    <div className="rr-dual-selected" data-testid="dual-selected" role="status">
      <strong>{row.level} · {displayMetricName(row.structure, row.metric)}</strong>
      <dl>
        <div><dt>Referencia</dt><dd data-testid="dual-sel-reference">{formatValue(row.reference.effectiveValue)} {displayUnit(row.unit)} <Provenance value={row.reference} /></dd></div>
        <div><dt>Actual</dt><dd data-testid="dual-sel-current">{formatValue(row.current.effectiveValue)} {displayUnit(row.unit)} <Provenance value={row.current} /></dd></div>
        <div><dt>Diferencia</dt><dd data-testid="dual-sel-delta">{formatDelta(row.deltaAbsolute)} {displayUnit(row.unit)} · {formatPercent(row)} · {trendText(row.trend)}</dd></div>
      </dl>
      {row.experimental && <small className="rr-dual-flag">Medición derivada · experimental</small>}
    </div>
  );
}

export function DifferencesPanel({ result, filter, onFilterChange, selectedKey, onSelect }: Props) {
  const [minimumsOpen, setMinimumsOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { visible, hiddenCount } = useMemo(() => applyFilter(result.comparisons, filter), [result.comparisons, filter]);
  const groups = useMemo(() => groupRowsByLevel(visible), [visible]);
  const metrics = useMemo(() => metricsOf(result.comparisons), [result.comparisons]);
  const exclusionGroups = useMemo(() => groupExclusions(result.excluded), [result.excluded]);
  const active = isFilterActive(filter);
  // El orden de recorrido es el de la lista que se ve (nivel anatómico y, dentro, el del Backend).
  const ordered = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const selected = selectedKey ? ordered.find((row) => rowKey(row) === selectedKey) ?? null : null;
  const previous = stepFrom(ordered, selectedKey, -1);
  const next = stepFrom(ordered, selectedKey, 1);

  function reset() {
    setDrafts({});
    onFilterChange({ onlyNonZero: false, minMagnitude: {} });
  }

  return (
    <aside aria-label="Diferencias entre los estudios" className="rr-dual-diffs" data-testid="dual-differences">
      <div className="rr-dual-diffs-head">
      <div className="rr-dual-diffs-top">
        <p className="rr-dual-count" data-testid="dual-counts">
          <strong>{result.summary.comparedCount}</strong> comparables · <strong>{result.summary.excludedCount}</strong> excluidas
        </p>
        <div className="rr-dual-stepper" role="group" aria-label="Recorrer diferencias">
          <button data-testid="dual-prev" disabled={!previous.hasPrevious} onClick={() => onSelect(previous.key)} type="button">‹ Anterior diferencia</button>
          <button data-testid="dual-next" disabled={!next.hasNext} onClick={() => onSelect(next.key)} type="button">Siguiente diferencia ›</button>
        </div>
        <p className="rr-dual-pos" aria-live="polite" data-testid="dual-position">
          {selected ? `Diferencia ${ordered.indexOf(selected) + 1} de ${ordered.length}` : ordered.length ? `${ordered.length} en la lista` : ""}
        </p>
      </div>

      <div className="rr-dual-filters">
        <label className="rr-dual-check">
          <input
            checked={filter.onlyNonZero}
            data-testid="dual-filter-nonzero"
            onChange={(event) => onFilterChange({ ...filter, onlyNonZero: event.target.checked })}
            type="checkbox"
          />
          Solo diferencias distintas de cero
        </label>
        <button
          aria-expanded={minimumsOpen}
          className="rr-link"
          data-testid="dual-filter-minimums-toggle"
          onClick={() => setMinimumsOpen((open) => !open)}
          type="button"
        >
          Magnitud mínima por métrica
        </button>
        {minimumsOpen && (
          <ul className="rr-dual-minimums" data-testid="dual-filter-minimums">
            {metrics.map((metric) => (
              <li key={metric.key}>
                <label>
                  <span>{displayMetricName(metric.structure, metric.metric)}</span>
                  <input
                    aria-label={`Magnitud mínima de ${displayMetricName(metric.structure, metric.metric)} en ${displayUnit(metric.unit)}`}
                    data-metric={metric.key}
                    inputMode="decimal"
                    onChange={(event) => {
                      const text = event.target.value;
                      setDrafts((state) => ({ ...state, [metric.key]: text }));
                      onFilterChange(setMinimum(filter, metric.key, parseMinimum(text)));
                    }}
                    placeholder="sin mínimo"
                    value={drafts[metric.key] ?? (filter.minMagnitude[metric.key] !== undefined ? String(filter.minMagnitude[metric.key]) : "")}
                  />
                  <small>{displayUnit(metric.unit)}</small>
                </label>
              </li>
            ))}
            <li className="rr-note">Se muestran las filas cuya diferencia, sin redondear, es igual o mayor al mínimo. Es un filtro de pantalla: no indica relevancia clínica.</li>
          </ul>
        )}
        {active && (
          <p className="rr-dual-filter-state" data-testid="dual-filter-state" role="status">
            Filtro aplicado: {hiddenCount} {hiddenCount === 1 ? "fila oculta" : "filas ocultas"} de {result.comparisons.length}.{" "}
            <button className="rr-link" data-testid="dual-filter-reset" onClick={reset} type="button">Restablecer</button>
          </p>
        )}
      </div>

      {selected && <SelectedSummary row={selected} />}
      </div>

      {ordered.length === 0 ? (
        <div className="rr-dual-empty" data-testid="dual-empty">
          {result.comparisons.length === 0
            ? <p><strong>No hay mediciones comparables entre estos estudios.</strong> Revisá abajo por qué se excluyeron.</p>
            : <p><strong>No hay diferencias que cumplan el filtro.</strong> Hay {result.comparisons.length} mediciones comparables ocultas por el filtro.</p>}
        </div>
      ) : (
        <div className="rr-dual-list" data-testid="dual-list">
          {groups.map((group) => (
            <section key={group.level}>
              <h4>{group.level}</h4>
              <ul>
                {group.rows.map((row) => {
                  const key = rowKey(row);
                  const isSelected = key === selectedKey;
                  return (
                    <li key={key}>
                      <button
                        aria-current={isSelected ? "true" : undefined}
                        className={`rr-dual-row${isSelected ? " is-selected" : ""}`}
                        data-row-key={key}
                        data-testid="dual-row"
                        onClick={() => onSelect(key)}
                        type="button"
                      >
                        <span className="rr-dual-row-name">
                          {isSelected && <span aria-hidden className="rr-dual-mark">▶ </span>}
                          {displayMetricName(row.structure, row.metric)}
                          <small> ({displayUnit(row.unit)})</small>
                          {row.experimental && <small className="rr-dual-flag"> · experimental</small>}
                        </span>
                        <span className="rr-dual-row-values">
                          {formatValue(row.reference.effectiveValue)} → {formatValue(row.current.effectiveValue)}
                        </span>
                        <span className="rr-dual-row-delta" data-testid="dual-row-delta">
                          {formatDelta(row.deltaAbsolute)} <small>{formatPercent(row)}</small>
                        </span>
                        <span className="rr-dual-row-meta">
                          <Provenance value={row.reference} /> / <Provenance value={row.current} />
                          <Place side="Ref." value={row.reference} />
                          <Place side="Act." value={row.current} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="rr-note rr-dual-note-text">{DIFFERENCE_NOTE}</p>

      {exclusionGroups.length > 0 && (
        <details className="rr-help" data-testid="dual-excluded">
          <summary>Datos faltantes y excluidos ({result.excluded.length})</summary>
          <div className="rr-help-body">
            {exclusionGroups.map((group) => (
              <section data-reason={group.reasonCode} key={group.reasonCode}>
                <p><strong>{group.title}</strong> ({group.items.length})</p>
                <ul>
                  {group.items.slice(0, 4).map((item, index) => (
                    <li key={`${item.reasonCode}-${index}`}>
                      {exclusionSideText(item.side)}{item.level ? ` · ${item.level}` : ""}{item.metricKey ? ` · ${item.metricKey}` : ""}: {item.reason}
                    </li>
                  ))}
                  {group.items.length > 4 && <li>… y {group.items.length - 4} más con el mismo motivo.</li>}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}
    </aside>
  );
}
