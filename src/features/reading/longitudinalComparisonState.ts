import type { ComparableStudy } from "../../longitudinalComparisonApi";
import type { LongitudinalComparisonResult } from "../../contracts/longitudinalComparisonTypes";
import type { ProductAnalysisError } from "./productAnalysisV1State";

/**
 * Estado puro (stage 79) del selector de estudio de referencia + comparación. Ningún llamado de
 * red vive acá — sólo las transiciones, testeables sin mockear `fetch` (mismo patrón que
 * `productAnalysisV1State.ts` en las etapas 77/78).
 */

export type LongitudinalComparisonPhase = "idle" | "loading_candidates" | "loading_comparison" | "ready" | "error";

export type LongitudinalComparisonUiState = {
  phase: LongitudinalComparisonPhase;
  candidates: ComparableStudy[];
  selectedBaselineCaseId?: string;
  result?: LongitudinalComparisonResult;
  error?: ProductAnalysisError;
};

export function initialLongitudinalComparisonUiState(): LongitudinalComparisonUiState {
  return { phase: "idle", candidates: [] };
}

export function candidatesRequested(state: LongitudinalComparisonUiState): LongitudinalComparisonUiState {
  return { ...state, phase: "loading_candidates", error: undefined };
}

/** 79-U: el estudio actual nunca aparece como su propio candidato de referencia. */
export function excludeCurrentCase(studies: ComparableStudy[], excludeCaseId: string): ComparableStudy[] {
  return studies.filter((study) => study.caseId !== excludeCaseId);
}

export function candidatesLoaded(state: LongitudinalComparisonUiState, candidates: ComparableStudy[]): LongitudinalComparisonUiState {
  return { ...state, phase: "ready", candidates };
}

export function candidatesFailed(state: LongitudinalComparisonUiState, error: ProductAnalysisError): LongitudinalComparisonUiState {
  return { ...state, phase: "error", error };
}

export function baselineCleared(state: LongitudinalComparisonUiState): LongitudinalComparisonUiState {
  return { ...state, selectedBaselineCaseId: undefined, result: undefined, error: undefined };
}

export function comparisonRequested(state: LongitudinalComparisonUiState, baselineCaseId: string): LongitudinalComparisonUiState {
  return { ...state, phase: "loading_comparison", selectedBaselineCaseId: baselineCaseId, error: undefined };
}

export function comparisonLoaded(state: LongitudinalComparisonUiState, result: LongitudinalComparisonResult): LongitudinalComparisonUiState {
  return { ...state, phase: "ready", result };
}

export function comparisonFailed(state: LongitudinalComparisonUiState, error: ProductAnalysisError): LongitudinalComparisonUiState {
  return { ...state, phase: "error", result: undefined, error };
}

/** Cambiar de baseline siempre recarga — nunca reutiliza el resultado del baseline anterior (79-W "switching baseline reloads"). */
export function isSwitchingBaseline(state: LongitudinalComparisonUiState, nextBaselineCaseId: string): boolean {
  return state.selectedBaselineCaseId !== nextBaselineCaseId;
}
