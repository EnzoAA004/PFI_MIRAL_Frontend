import { useMemo } from "react";
import type { AiRunResponse } from "../../appTypes";
import type { ComparisonStudySide } from "../../contracts/initialAnalysisComparisonTypes";
import { DiscDegenerativeFindingsPanel } from "./DiscDegenerativeFindingsPanel";
import { DualFindingsComparison } from "./DualFindingsComparison";
import {
  sideFromSnapshot,
  type ComparisonSide,
  type FindingsComparison,
  type FindingsFilter,
  type FindingsSide,
  type RegionTarget,
  type SideSeriesInfo,
} from "./discFindingsComparison";
import {
  DiscDegenerativeContractError,
  parsePersistedDiscDegenerativeFindingsLenient,
  type DiscFinding,
  type RejectedDiscFinding,
} from "./discDegenerativeFindings";
import { describeAnalysis, describeSide } from "./initialComparisonDisplay";
import { SIDE_TITLE } from "./ComparisonPane";
import type { ComparisonSideState } from "./useComparisonSide";
import type { Side } from "./dualComparisonLogic";

/**
 * Hallazgos IA del visor dual: la vista principal es la comparación por disco y clasificación; el detalle original
 * de cada estudio, con su procedencia, queda a un clic.
 *
 * Es solo lectura. Un estudio sin hallazgos guardados dice "no tiene datos", que no es lo mismo que "no hay
 * hallazgos": nunca se presenta una falta de dato como ausencia de hallazgo.
 */

type Snapshot = { findings: DiscFinding[]; rejected?: RejectedDiscFinding[]; unavailable?: string; contractError?: string };

export function discSnapshotOf(run: AiRunResponse): Snapshot {
  const snapshot = run.metricsSnapshot as Record<string, unknown> | undefined;
  if (!snapshot?.discDegenerativeFindings) {
    return { findings: [], unavailable: "Esta corrida no tiene hallazgos discales persistidos: no hay datos para este estudio." };
  }
  try {
    return parsePersistedDiscDegenerativeFindingsLenient(snapshot);
  } catch (error) {
    return {
      findings: [],
      contractError: error instanceof DiscDegenerativeContractError
        ? error.message
        : "El snapshot persistido no coincide con el formato de hallazgos discales.",
    };
  }
}

/** Los hallazgos de un lado para comparar: solo si lo cargado es el estudio y la corrida de la comparación. */
export function findingsSideFor(sideState: ComparisonSideState, expected: { caseId: string; runId: string | null }): FindingsSide {
  if (sideState.status === "ready") {
    return sideFromSnapshot({ caseId: sideState.data.caseId, runId: sideState.data.runId }, expected, discSnapshotOf(sideState.data.run));
  }
  if (sideState.status === "error") {
    return sideState.caseId === expected.caseId
      ? { status: "failed", reason: sideState.message }
      : { status: "pending", reason: "Lo que falló no es el estudio de la comparación actual." };
  }
  return { status: "pending", reason: sideState.status === "loading" ? "Cargando el estudio…" : "Todavía no hay un estudio en este lado." };
}

function seriesLabelOf(series: { description: string; weighting: string }) {
  const weighting = series.weighting === "t1" || series.weighting === "t2" ? series.weighting.toUpperCase() : "";
  const description = series.description.trim();
  if (description && weighting) return `${description} · ${weighting}`;
  return description || weighting || "Serie sin descripción";
}

/** Lo que el visor de un lado tiene cargado en el plano sagital, que es donde P10.7 evalúa los discos. */
export function sagittalSeriesInfoOf(sideState: ComparisonSideState): SideSeriesInfo | null {
  if (sideState.status !== "ready") return null;
  const analyzed = sideState.data.analyzed.sagittal;
  return {
    analyzedInputId: analyzed?.sourceInputId ?? null,
    analyzedTotal: Math.max(analyzed?.sliceCount ?? 0, 0),
    archive: sideState.data.archiveSeries
      .filter((item) => item.plane === "sagittal" && !item.multiplanar)
      .map((item) => ({ inputId: item.inputId, sliceCount: item.sliceCount, label: seriesLabelOf(item) })),
  };
}

function SideFindings({ side, summary, sideState }: { side: Side; summary: ComparisonStudySide; sideState: ComparisonSideState }) {
  const run = sideState.status === "ready" ? sideState.data.run : null;
  const snapshot = useMemo(() => (run ? discSnapshotOf(run) : null), [run]);
  return (
    <section className="rr-dual-findings-side" data-side={side} data-testid={`dual-findings-${side}`}>
      <h4>
        {SIDE_TITLE[side]} · {describeSide(summary)}
      </h4>
      <p className="rr-note">Hallazgos asistidos por IA de {describeAnalysis(summary)}.</p>
      {sideState.status === "loading" && <p className="rr-note" role="status">Cargando el estudio {sideState.caseId}…</p>}
      {sideState.status === "error" && <p className="rr-note rr-note-warn" role="alert">{sideState.message}</p>}
      {sideState.status === "idle" && <p className="rr-note">Elegí una referencia para ver sus hallazgos.</p>}
      {snapshot && (
        <DiscDegenerativeFindingsPanel
          contractError={snapshot.contractError}
          findings={snapshot.findings}
          rejectedCount={snapshot.rejected?.length ?? 0}
          unavailableReason={snapshot.unavailable}
        />
      )}
    </section>
  );
}

type Props = {
  reference: ComparisonStudySide | null;
  current: ComparisonStudySide;
  referenceState: ComparisonSideState;
  currentState: ComparisonSideState;
  findings: FindingsComparison | null;
  filter: FindingsFilter;
  onFilterChange: (filter: FindingsFilter) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  targets: Record<ComparisonSide, RegionTarget | null>;
};

export function DualFindingsPanel({ reference, current, referenceState, currentState, findings, filter, onFilterChange, selectedKey, onSelect, targets }: Props) {
  return (
    <div className="rr-dual-findings" data-testid="dual-findings">
      {reference && findings ? (
        <DualFindingsComparison
          comparison={findings}
          current={current}
          filter={filter}
          onFilterChange={onFilterChange}
          onSelect={onSelect}
          reference={reference}
          selectedKey={selectedKey}
          targets={targets}
        />
      ) : (
        <p className="rr-note">Elegí una referencia para comparar sus hallazgos con los del estudio actual.</p>
      )}
      <details className="rr-dual-findings-originals" data-testid="dual-findings-originals">
        <summary>Detalle original de cada estudio</summary>
        <p className="rr-note">
          Resultados de cada estudio por separado, tal como los guardó su corrida. La falta de datos de un estudio no equivale a que no
          haya hallazgos.
        </p>
        {reference
          ? <SideFindings side="reference" sideState={referenceState} summary={reference} />
          : <p className="rr-note">Elegí una referencia para ver sus hallazgos.</p>}
        <SideFindings side="current" sideState={currentState} summary={current} />
      </details>
    </div>
  );
}
