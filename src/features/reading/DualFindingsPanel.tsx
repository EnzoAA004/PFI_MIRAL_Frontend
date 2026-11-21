import { useMemo } from "react";
import type { AiRunResponse } from "../../appTypes";
import type { ComparisonStudySide } from "../../contracts/initialAnalysisComparisonTypes";
import { DiscDegenerativeFindingsPanel } from "./DiscDegenerativeFindingsPanel";
import {
  DiscDegenerativeContractError,
  parsePersistedDiscDegenerativeFindings,
  type DiscFinding,
} from "./discDegenerativeFindings";
import { describeAnalysis, describeSide } from "./initialComparisonDisplay";
import { SIDE_TITLE } from "./ComparisonPane";
import type { ComparisonSideState } from "./useComparisonSide";
import type { Side } from "./dualComparisonLogic";

/**
 * Hallazgos IA de cada estudio, uno debajo del otro y con su procedencia.
 *
 * Es solo lectura y no compara: no hay un comparador automático de clasificaciones. Un estudio sin hallazgos
 * guardados dice "no tiene datos", que no es lo mismo que "no hay hallazgos": nunca se presenta una falta de
 * dato como ausencia de hallazgo.
 */

type Snapshot = { findings: DiscFinding[]; unavailable?: string; contractError?: string };

export function discSnapshotOf(run: AiRunResponse): Snapshot {
  const snapshot = run.metricsSnapshot as Record<string, unknown> | undefined;
  if (!snapshot?.discDegenerativeFindings) {
    return { findings: [], unavailable: "Esta corrida no tiene hallazgos discales persistidos: no hay datos para este estudio." };
  }
  try {
    return { findings: parsePersistedDiscDegenerativeFindings(snapshot) };
  } catch (error) {
    return {
      findings: [],
      contractError: error instanceof DiscDegenerativeContractError
        ? error.message
        : "El snapshot persistido no coincide con el formato de hallazgos discales.",
    };
  }
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
};

export function DualFindingsPanel({ reference, current, referenceState, currentState }: Props) {
  return (
    <div className="rr-dual-findings" data-testid="dual-findings">
      <p className="rr-note">
        Resultados de cada estudio por separado. Esta etapa no compara clasificaciones entre estudios, y la falta de datos
        de un estudio no equivale a que no haya hallazgos.
      </p>
      {reference
        ? <SideFindings side="reference" sideState={referenceState} summary={reference} />
        : <p className="rr-note">Elegí una referencia para ver sus hallazgos.</p>}
      <SideFindings side="current" sideState={currentState} summary={current} />
    </div>
  );
}
