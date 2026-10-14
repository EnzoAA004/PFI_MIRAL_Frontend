import type { InitialComparisonCandidates, InitialComparisonResult } from "../../contracts/initialAnalysisComparisonTypes";

/**
 * Estado de la herramienta "Comparación entre estudios" (análisis inicial). Es lógica pura, para poder
 * probar sobre todo una cosa: si se cambia de referencia mientras una respuesta anterior todavía viaja,
 * la respuesta tardía NO se muestra. Cada pedido lleva un número y solo el último activo puede escribir.
 */

export type ComparisonError = { code: string | null; message: string };

export type InitialComparisonUiState = {
  phase: "loading_candidates" | "ready" | "loading_comparison" | "error";
  candidates: InitialComparisonCandidates | null;
  candidatesError: ComparisonError | null;
  selectedCaseId: string | null;
  comparison: InitialComparisonResult | null;
  comparisonError: ComparisonError | null;
  /** Número del único pedido de comparación cuya respuesta se acepta. */
  activeRequest: number;
};

export type InitialComparisonAction =
  | { type: "candidates_requested" }
  | { type: "candidates_loaded"; candidates: InitialComparisonCandidates }
  | { type: "candidates_failed"; error: ComparisonError }
  | { type: "comparison_requested"; caseId: string; requestId: number }
  | { type: "comparison_loaded"; requestId: number; result: InitialComparisonResult }
  | { type: "comparison_failed"; requestId: number; error: ComparisonError }
  | { type: "selection_cleared" };

export const initialComparisonUiState: InitialComparisonUiState = {
  phase: "loading_candidates",
  candidates: null,
  candidatesError: null,
  selectedCaseId: null,
  comparison: null,
  comparisonError: null,
  activeRequest: 0,
};

export function initialComparisonReducer(state: InitialComparisonUiState, action: InitialComparisonAction): InitialComparisonUiState {
  switch (action.type) {
    case "candidates_requested":
      return { ...initialComparisonUiState, activeRequest: state.activeRequest + 1 };
    case "candidates_loaded":
      return { ...state, phase: "ready", candidates: action.candidates, candidatesError: null };
    case "candidates_failed":
      return { ...state, phase: "error", candidates: null, candidatesError: action.error };
    case "comparison_requested":
      return {
        ...state,
        phase: "loading_comparison",
        selectedCaseId: action.caseId,
        comparison: null,
        comparisonError: null,
        activeRequest: action.requestId,
      };
    case "comparison_loaded":
      // Respuesta de un pedido que ya no es el activo (se eligió otra referencia, o se limpió): se descarta.
      if (action.requestId !== state.activeRequest || action.result.reference.caseId !== state.selectedCaseId) return state;
      return { ...state, phase: "ready", comparison: action.result, comparisonError: null };
    case "comparison_failed":
      if (action.requestId !== state.activeRequest) return state;
      return { ...state, phase: "ready", comparison: null, comparisonError: action.error };
    case "selection_cleared":
      return { ...state, phase: "ready", selectedCaseId: null, comparison: null, comparisonError: null, activeRequest: state.activeRequest + 1 };
    default:
      return state;
  }
}

/** Qué decir cuando no hay nada que comparar: tres situaciones distintas, tres mensajes distintos. */
export type EmptyKind = "current_without_measurements" | "no_other_studies" | "no_usable_candidates" | null;

export function emptyKindOf(candidates: InitialComparisonCandidates | null): EmptyKind {
  if (!candidates) return null;
  if (candidates.current.usableMeasurementCount === 0) return "current_without_measurements";
  if (candidates.candidates.length === 0) return "no_other_studies";
  if (!candidates.candidates.some((candidate) => candidate.eligible)) return "no_usable_candidates";
  return null;
}
