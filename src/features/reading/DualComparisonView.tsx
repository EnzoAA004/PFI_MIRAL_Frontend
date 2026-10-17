import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiRunResponse, StudyArchiveSeries } from "../../appTypes";
import type { ComparisonValue, InitialComparisonRow } from "../../contracts/initialAnalysisComparisonTypes";
import { ComparisonPane } from "./ComparisonPane";
import { DifferencesPanel } from "./DifferencesPanel";
import { DualFindingsPanel, findingsSideFor, sagittalSeriesInfoOf } from "./DualFindingsPanel";
import {
  compareFindings,
  defaultFilter,
  filterRows,
  resolveRegionOverlay,
  resolveRegionTarget,
  type FindingComparisonRow,
  type FindingsFilter,
} from "./discFindingsComparison";
import { useCurrentSide, useReferenceSide, type ComparisonSideState } from "./useComparisonSide";
import { useInitialComparison } from "./useInitialComparison";
import {
  NO_FILTER,
  applyFilter,
  destinationFor,
  paneViewOf,
  resolveOverlay,
  rowKey,
  type DifferenceFilter,
  type PaneState,
  type Side,
} from "./dualComparisonLogic";
import { sequenceComparisonNote, sequenceFromComparisonSide } from "./sequenceInfo";
import { COMPARISON_SOURCE_LINE, displayUnit, formatDelta, formatStudyDate, formatValue, patientLinkText } from "./initialComparisonDisplay";
import { emptyKindOf } from "./initialComparisonState";
import { EMPTY_TEXT } from "./initialComparisonDisplay";
import type { MeasurementFigure } from "./MeasurementLayer";

/**
 * Comparación visual: referencia a la izquierda, estudio actual a la derecha y, al costado, las diferencias
 * del comparador de mediciones reales. Elegir una diferencia abre el corte de origen de cada lado y resalta
 * únicamente su trazo.
 *
 * - Solo lectura: no edita, no aprueba y nunca dispara un análisis.
 * - Cada lado tiene su propia serie, corte, zoom, desplazamiento y W/L. Nada se sincroniza por índice de
 *   corte: dos estudios no están registrados anatómicamente.
 * - La ubicación sale de lo que la corrida persistió. Si falta de un lado, ese lado lo dice y el otro sigue.
 * - Se monta sobre el visor individual sin desmontarlo, así que al volver conserva su estado.
 */

type Props = {
  caseId: string;
  run: AiRunResponse;
  archiveSeries: StudyArchiveSeries[];
  /** La corrida del análisis inicial que muestra el visor individual. */
  currentRunId: string | null;
  initialReferenceCaseId: string | null;
  /** Pestaña con la que abre el panel derecho (la demostración de hallazgos abre directamente en «Hallazgos IA»). */
  initialRightTab?: "differences" | "findings";
  onClose: () => void;
};

const EMPTY_FIGURES: MeasurementFigure[] = [];
const INITIAL_PANE: PaneState = { plane: "sagittal", viewedSeriesId: null, slice: null };

function analyzedInfo(state: ComparisonSideState) {
  if (state.status !== "ready") return { sagittal: null, axial: null };
  const info = (plane: "sagittal" | "axial") => {
    const series = state.data.analyzed[plane];
    if (!series) return null;
    return { inputId: series.sourceInputId ?? null, planeRunId: state.data.workspaces[plane].planeRunId, total: Math.max(series.sliceCount ?? 1, 1) };
  };
  return { sagittal: info("sagittal"), axial: info("axial") };
}

function figureLabel(value: ComparisonValue, unit: string) {
  return `${formatValue(value.effectiveValue)} ${displayUnit(unit)}`.trim();
}

export function DualComparisonView({ caseId, run, archiveSeries, currentRunId, initialReferenceCaseId, initialRightTab = "differences", onClose }: Props) {
  const { state, select } = useInitialComparison(caseId, currentRunId);
  const { candidates, comparison } = state;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<DifferenceFilter>(NO_FILTER);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"differences" | "findings">(initialRightTab);
  /* Selección y filtro de la comparación de hallazgos. El filtro `null` es el inicial (cambios si los hay, si no todos). */
  const [findingKey, setFindingKey] = useState<string | null>(null);
  const [findingFilterChoice, setFindingFilterChoice] = useState<FindingsFilter | null>(null);
  const [panes, setPanes] = useState<Record<Side, PaneState>>({ reference: INITIAL_PANE, current: INITIAL_PANE });

  // La referencia pedida desde la herramienta se resuelve una sola vez al abrir.
  useEffect(() => {
    if (initialReferenceCaseId) select(initialReferenceCaseId);
  }, [initialReferenceCaseId, select]);

  // Escape cierra. El foco entra al diálogo y vuelve a donde estaba al salir.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    // El diálogo es modal: el foco no se escapa al visor que queda debajo.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active && dialogRef.current.contains(active));
      if (!inside || (event.shiftKey && (active === first || active === dialogRef.current))) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const referenceCaseId = comparison?.reference.caseId ?? null;
  const currentSide = useCurrentSide(caseId, run, archiveSeries, comparison?.current.runId ?? currentRunId);
  const referenceSide = useReferenceSide(referenceCaseId, comparison?.reference.runId ?? null);

  // Cambiar de referencia descarta la selección y el estado del visor de ese lado: es otro estudio.
  useEffect(() => {
    setSelectedKey(null);
    setFindingKey(null);
    setFindingFilterChoice(null);
    setPanes((current) => ({ ...current, reference: INITIAL_PANE }));
  }, [referenceCaseId]);

  const rows = comparison?.comparisons ?? [];
  const selectedRow: InitialComparisonRow | null = selectedKey ? rows.find((row) => rowKey(row) === selectedKey) ?? null : null;

  const sideStates: Record<Side, ComparisonSideState> = { reference: referenceSide, current: currentSide };

  /*
   * Comparación de hallazgos P10.7. Se arma solo con lo que cada lado cargó de SU corrida y solo si es el estudio y la
   * corrida de la comparación: una respuesta tardía de otra referencia queda como «pendiente», nunca se mezcla.
   */
  const findingsComparison = useMemo(() => {
    if (!comparison) return null;
    return compareFindings(
      findingsSideFor(referenceSide, { caseId: comparison.reference.caseId, runId: comparison.reference.runId ?? null }),
      findingsSideFor(currentSide, { caseId: comparison.current.caseId, runId: comparison.current.runId ?? null }),
    );
  }, [comparison, currentSide, referenceSide]);
  const findingFilter: FindingsFilter = findingFilterChoice ?? (findingsComparison ? defaultFilter(findingsComparison) : "all");
  const selectedFinding: FindingComparisonRow | null = findingKey && findingsComparison
    ? findingsComparison.rows.find((row) => row.key === findingKey) ?? null
    : null;
  const regionTargets = useMemo(() => ({
    reference: selectedFinding ? resolveRegionTarget(selectedFinding.reference, sagittalSeriesInfoOf(referenceSide)) : null,
    current: selectedFinding ? resolveRegionTarget(selectedFinding.current, sagittalSeriesInfoOf(currentSide)) : null,
  }), [currentSide, referenceSide, selectedFinding]);

  /** Abre en cada visor su propia serie y su propio corte de origen. Un lado sin región queda como está y lo dice. */
  const openFindingRegions = useCallback((row: FindingComparisonRow, only?: Side) => {
    for (const side of only ? [only] : (["reference", "current"] as const)) {
      const target = resolveRegionTarget(side === "reference" ? row.reference : row.current, sagittalSeriesInfoOf(side === "reference" ? referenceSide : currentSide));
      if (target.state !== "ready") continue;
      setPanes((current) => ({ ...current, [side]: { plane: "sagittal", viewedSeriesId: target.viewedSeriesId, slice: target.sliceIndex } }));
    }
  }, [currentSide, referenceSide]);

  const selectFinding = useCallback((key: string | null) => {
    setFindingKey(key);
    // Un solo tipo de selección a la vez: la medición y la región no se dibujan juntas.
    setSelectedKey(null);
    const row = key && findingsComparison ? findingsComparison.rows.find((item) => item.key === key) : null;
    if (row) openFindingRegions(row);
  }, [findingsComparison, openFindingRegions]);

  // Si el filtro oculta el hallazgo seleccionado, la selección se suelta en vez de quedar invisible.
  useEffect(() => {
    if (!findingKey || !findingsComparison) return;
    if (!filterRows(findingsComparison.rows, findingFilter).some((row) => row.key === findingKey)) setFindingKey(null);
  }, [findingFilter, findingKey, findingsComparison]);

  const regionOverlayOf = (side: Side) => {
    if (!selectedFinding) return null;
    const view = paneViewOf(panes[side], sideStates[side]);
    return resolveRegionOverlay(regionTargets[side], selectedFinding.level, view ? { plane: view.plane, viewedSeriesId: view.viewedSeriesId, slice: view.slice } : null);
  };

  const goTo = useCallback((side: Side, row: InitialComparisonRow) => {
    const value = side === "reference" ? row.reference : row.current;
    const destination = destinationFor(value, analyzedInfo(side === "reference" ? referenceSide : currentSide));
    if (!destination.ok) return;
    setPanes((current) => ({ ...current, [side]: { plane: destination.plane, viewedSeriesId: null, slice: destination.slice } }));
  }, [currentSide, referenceSide]);

  const select_ = useCallback((key: string | null) => {
    setSelectedKey(key);
    if (key) setFindingKey(null);
    const row = key ? rows.find((item) => rowKey(item) === key) : null;
    if (!row) return;
    goTo("reference", row);
    goTo("current", row);
  }, [goTo, rows]);

  // Si el filtro oculta la diferencia seleccionada, la selección se suelta en vez de quedar invisible.
  useEffect(() => {
    if (!selectedKey) return;
    const { visible } = applyFilter(rows, filter);
    if (!visible.some((row) => rowKey(row) === selectedKey)) setSelectedKey(null);
  }, [filter, rows, selectedKey]);

  const overlays = (["reference", "current"] as const).map((side) => {
    const value = selectedRow ? (side === "reference" ? selectedRow.reference : selectedRow.current) : null;
    return [side, resolveOverlay(value, paneViewOf(panes[side], sideStates[side]), analyzedInfo(sideStates[side]))] as const;
  });
  const overlayOf = Object.fromEntries(overlays) as Record<Side, ReturnType<typeof resolveOverlay>>;

  const emptyKind = emptyKindOf(candidates);
  const eligible = candidates?.candidates.filter((candidate) => candidate.eligible) ?? [];
  const summaryBySide = comparison
    ? { reference: comparison.reference, current: comparison.current }
    : candidates ? { reference: null, current: candidates.current } : null;

  return (
    <div
      aria-label="Comparación visual entre estudios"
      aria-modal="true"
      className="rr-dual"
      data-testid="dual-comparison"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <header className="rr-dual-bar">
        <div className="rr-dual-bar-title">
          <strong>Comparación visual</strong>
          <span className="rr-note" data-testid="dual-source-note">{COMPARISON_SOURCE_LINE}</span>
        </div>
        <label className="rr-dual-select">
          <span>Referencia</span>
          <select
            aria-label="Estudio de referencia"
            data-testid="dual-reference-select"
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
        </label>
        <button className="rr-dual-close" data-testid="dual-close" onClick={onClose} type="button">Volver al visor</button>
      </header>

      {state.phase === "error" && state.candidatesError && <p className="rr-note rr-note-warn" role="alert">{state.candidatesError.message}</p>}
      {state.phase === "loading_comparison" && <p className="rr-note" role="status">Comparando mediciones guardadas…</p>}
      {state.comparisonError && state.phase !== "loading_comparison" && (
        <p className="rr-note rr-note-warn" data-testid="dual-comparison-error" role="alert">{state.comparisonError.message}</p>
      )}
      {emptyKind && (
        <div className="panel-hidden-placeholder honest-empty-state" data-empty={emptyKind} data-testid="dual-empty-state">
          <strong>{EMPTY_TEXT[emptyKind].title}</strong>
          <span>{EMPTY_TEXT[emptyKind].detail}</span>
        </div>
      )}
      {comparison && <p className="rr-note rr-dual-link">{patientLinkText(comparison.current.patientLink)}</p>}
      {comparison && (
        <p className="rr-note rr-dual-seq-note" data-testid="dual-sequence-note">
          {sequenceComparisonNote(sequenceFromComparisonSide(comparison.reference), sequenceFromComparisonSide(comparison.current))}
        </p>
      )}

      <div className="rr-dual-main">
        <div className="rr-dual-panes">
          {(["reference", "current"] as const).map((side) => {
            const summary = summaryBySide?.[side] ?? null;
            const value = selectedRow ? (side === "reference" ? selectedRow.reference : selectedRow.current) : null;
            if (!summary) {
              return (
                <section className="rr-dual-pane rr-dual-pane-empty" data-testid={`dual-pane-${side}`} key={side}>
                  <header className="rr-dual-head"><span className="rr-dual-badge">{side === "reference" ? "Referencia" : "Actual"}</span></header>
                  <p className="rr-dual-state">Elegí una referencia para abrir su estudio.</p>
                </section>
              );
            }
            return (
              <ComparisonPane
                context={EMPTY_FIGURES}
                figureLabel={value && selectedRow ? figureLabel(value, selectedRow.unit) : ""}
                key={side}
                onChange={(next) => setPanes((current) => ({ ...current, [side]: next }))}
                onReturn={() => selectedRow && goTo(side, selectedRow)}
                onReturnRegion={() => selectedFinding && openFindingRegions(selectedFinding, side)}
                region={regionOverlayOf(side)}
                overlay={overlayOf[side]}
                side={side}
                sideState={sideStates[side]}
                state={panes[side]}
                summary={summary}
              />
            );
          })}
        </div>
        {comparison && (
          <div className="rr-dual-side">
            <div aria-label="Panel de la comparación" className="rr-dual-tabs" role="tablist">
              {([["differences", "Diferencias"], ["findings", "Hallazgos IA"]] as const).map(([id, label]) => (
                <button
                  aria-controls={`rr-dual-panel-${id}`}
                  aria-selected={rightTab === id}
                  className={rightTab === id ? "is-on" : ""}
                  data-testid={`dual-tab-${id}`}
                  id={`rr-dual-tab-${id}`}
                  key={id}
                  onClick={() => setRightTab(id)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div aria-labelledby="rr-dual-tab-differences" hidden={rightTab !== "differences"} id="rr-dual-panel-differences" role="tabpanel">
              <DifferencesPanel
                filter={filter}
                onFilterChange={setFilter}
                onSelect={select_}
                result={comparison}
                selectedKey={selectedKey}
              />
            </div>
            <div aria-labelledby="rr-dual-tab-findings" hidden={rightTab !== "findings"} id="rr-dual-panel-findings" role="tabpanel">
              <DualFindingsPanel
                current={comparison.current}
                currentState={currentSide}
                filter={findingFilter}
                findings={findingsComparison}
                onFilterChange={setFindingFilterChoice}
                onSelect={selectFinding}
                reference={comparison.reference}
                referenceState={referenceSide}
                selectedKey={findingKey}
                targets={regionTargets}
              />
            </div>
          </div>
        )}
      </div>
      {selectedRow && (
        <p className="sr-only" aria-live="polite">
          {selectedRow.level} {selectedRow.metric}: diferencia {formatDelta(selectedRow.deltaAbsolute)} {displayUnit(selectedRow.unit)}
        </p>
      )}
    </div>
  );
}
