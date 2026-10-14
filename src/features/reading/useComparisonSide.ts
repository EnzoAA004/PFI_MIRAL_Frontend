import { useEffect, useMemo, useState } from "react";
import { normalizeRun } from "../../api";
import { normalizeSelectedRunForReview, resolvePersistedPlaneWorkspace, selectReviewableRunFromDetail, type PersistedPlaneWorkspace } from "../../appDataGuards";
import type { AiRunResponse, StudyArchiveSeries, StudyDetailResponse } from "../../appTypes";
import { fetchStudyDetail } from "../../studyApi";
import { checkExpectedRun } from "./dualComparisonLogic";
import { seriesFromPlaneRun, type PersistedStudySeries } from "./planeSeries";

/**
 * Un lado de la comparación visual: el estudio, la corrida que se muestra y sus series.
 *
 * El estudio abierto reutiliza lo que el visor individual ya tiene cargado, para que sea exactamente la corrida
 * que el médico venía mirando. La referencia se carga con el mismo camino que usa la aplicación para abrir un
 * estudio (detalle persistido → corrida revisable → plano), así que imágenes y trazos salen de los mismos
 * datos que en el visor individual.
 *
 * La corrida cargada tiene que ser la que usó la comparación. Si no lo es, se informa y no se muestra otra en
 * silencio: sería mezclar imágenes de una corrida con valores de otra.
 */
export type ComparisonSideData = {
  caseId: string;
  runId: string | null;
  run: AiRunResponse;
  archiveSeries: StudyArchiveSeries[];
  workspaces: Record<"sagittal" | "axial", PersistedPlaneWorkspace>;
  analyzed: Record<"sagittal" | "axial", PersistedStudySeries | null>;
};

export type ComparisonSideState =
  | { status: "idle" }
  | { status: "loading"; caseId: string }
  | { status: "ready"; data: ComparisonSideData }
  | { status: "error"; caseId: string; message: string };

export function buildSideData(caseId: string, run: AiRunResponse, archiveSeries: StudyArchiveSeries[]): ComparisonSideData {
  const sagittal = resolvePersistedPlaneWorkspace(run, "sagittal");
  const axial = resolvePersistedPlaneWorkspace(run, "axial");
  return {
    caseId,
    runId: run.runId ?? null,
    run,
    archiveSeries,
    workspaces: { sagittal, axial },
    analyzed: { sagittal: seriesFromPlaneRun(run, sagittal), axial: seriesFromPlaneRun(run, axial) },
  };
}

/** Referencia: carga independiente, con descarte de respuestas tardías (cambiar de estudio no mezcla datos). */
export function useReferenceSide(caseId: string | null, expectedRunId: string | null): ComparisonSideState {
  const [state, setState] = useState<ComparisonSideState>({ status: "idle" });

  useEffect(() => {
    if (!caseId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", caseId });
    fetchStudyDetail({ caseId })
      .then((detail: StudyDetailResponse) => {
        if (cancelled) return;
        const reviewable = selectReviewableRunFromDetail(detail);
        if (!reviewable) {
          setState({ status: "error", caseId, message: `El estudio ${caseId} no tiene una corrida persistida que mostrar.` });
          return;
        }
        const { safeRun } = normalizeSelectedRunForReview(reviewable, false, normalizeRun);
        if (!safeRun) {
          setState({ status: "error", caseId, message: `La corrida de ${caseId} no cumple el contrato del visor.` });
          return;
        }
        const data = buildSideData(caseId, safeRun, detail.archiveSeries ?? []);
        const mismatch = checkExpectedRun(data, expectedRunId);
        setState(mismatch ? { status: "error", caseId, message: mismatch } : { status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", caseId, message: `No se pudo cargar el estudio ${caseId}: ${error instanceof Error ? error.message : "error desconocido"}.` });
      });
    return () => { cancelled = true; };
  }, [caseId, expectedRunId]);

  return state;
}

/** Estudio abierto: se arma una vez con lo que el visor individual ya tiene. */
export function useCurrentSide(caseId: string, run: AiRunResponse, archiveSeries: StudyArchiveSeries[], expectedRunId: string | null): ComparisonSideState {
  return useMemo<ComparisonSideState>(() => {
    const data = buildSideData(caseId, run, archiveSeries);
    const mismatch = checkExpectedRun(data, expectedRunId);
    return mismatch ? { status: "error", caseId, message: mismatch } : { status: "ready", data };
  }, [archiveSeries, caseId, expectedRunId, run]);
}
