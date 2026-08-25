import type { BackendApiError } from "../../multiplanarApi";
import type { ProductAnalysisResult } from "../../contracts/productAnalysisV1Types";

/**
 * Estado puro (reducer) del flujo de análisis de producto Post-E50 por Study. Ningún llamado de
 * red vive acá — sólo las transiciones, para que sean testeables sin mockear `fetch`.
 *
 * `error` guarda una falla de transporte/contrato (4xx/404/5xx/red). Un resultado con
 * `status: "failed"` NO produce `phase: "error"` — sigue siendo una respuesta 200 válida con
 * datos para mostrar (ver Stage 75: "failed" es dato, no excepción). Ese matiz vive en el panel,
 * no acá.
 */

export type ProductAnalysisErrorKind = "functional" | "not_found" | "upstream" | "network";

export type ProductAnalysisError = {
  kind: ProductAnalysisErrorKind;
  message: string;
  status?: number;
};

export type ProductAnalysisPhase =
  | "idle"
  | "loading_history"
  | "submitting"
  | "loading_detail"
  | "ready"
  | "error";

export type ProductAnalysisUiState = {
  phase: ProductAnalysisPhase;
  history: ProductAnalysisResult[];
  selected?: ProductAnalysisResult;
  error?: ProductAnalysisError;
};

export type ProductAnalysisAction =
  | { type: "history_requested" }
  | { type: "history_loaded"; analyses: ProductAnalysisResult[] }
  | { type: "history_failed"; error: ProductAnalysisError }
  | { type: "submit_requested" }
  | { type: "submit_succeeded"; result: ProductAnalysisResult }
  | { type: "submit_failed"; error: ProductAnalysisError }
  | { type: "detail_requested"; analysisId: string }
  | { type: "detail_loaded"; result: ProductAnalysisResult }
  | { type: "detail_failed"; error: ProductAnalysisError }
  | { type: "select_from_history"; analysisId: string };

export function initialProductAnalysisUiState(): ProductAnalysisUiState {
  return { phase: "idle", history: [] };
}

function isBackendApiErrorShaped(error: unknown): error is BackendApiError {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "BackendApiError" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

/**
 * Clasifica cualquier error atrapado (de red o `BackendApiError`) sin asumir su forma.
 *
 * Chequea la forma por duck-typing (`name === "BackendApiError"`) en vez de `instanceof` para
 * no depender en tiempo de ejecución de la clase real — este módulo es puro a propósito, sin
 * ningún import de valor, para poder testearse sin mockear `fetch`/red.
 */
export function classifyProductAnalysisError(error: unknown): ProductAnalysisError {
  if (isBackendApiErrorShaped(error)) {
    const status = error.status;
    if (status === 404) return { kind: "not_found", message: error.message, status };
    if (status === 400 || status === 422) return { kind: "functional", message: error.message, status };
    if (status >= 500 || status === 502 || status === 503 || status === 504) {
      return { kind: "upstream", message: error.message, status };
    }
    return { kind: "functional", message: error.message, status };
  }
  return { kind: "network", message: "No se pudo conectar con el Backend. Verificá tu conexión e intentá de nuevo." };
}

/** Doble click / doble submit: bloqueado mientras hay un POST en curso. */
export function canSubmit(state: ProductAnalysisUiState): boolean {
  return state.phase !== "submitting";
}

export function canRetry(state: ProductAnalysisUiState): boolean {
  return state.phase === "error";
}

export function productAnalysisReducer(state: ProductAnalysisUiState, action: ProductAnalysisAction): ProductAnalysisUiState {
  switch (action.type) {
    case "history_requested":
      return { ...state, phase: "loading_history", error: undefined };
    case "history_loaded":
      return {
        ...state,
        phase: "ready",
        history: action.analyses,
        selected: action.analyses[0] ?? state.selected,
        error: undefined,
      };
    case "history_failed":
      return { ...state, phase: "error", error: action.error };
    case "submit_requested":
      // El análisis anterior permanece visible mientras corre uno nuevo (77-E/77-F).
      return { ...state, phase: "submitting", error: undefined };
    case "submit_succeeded":
      return {
        ...state,
        phase: "ready",
        history: [action.result, ...state.history],
        selected: action.result,
        error: undefined,
      };
    case "submit_failed":
      return { ...state, phase: "error", error: action.error };
    case "detail_requested":
      return { ...state, phase: "loading_detail", error: undefined };
    case "detail_loaded":
      return { ...state, phase: "ready", selected: action.result, error: undefined };
    case "detail_failed":
      return { ...state, phase: "error", error: action.error };
    case "select_from_history": {
      const found = state.history.find((item) => item.analysisRunId === action.analysisId);
      return found ? { ...state, selected: found } : state;
    }
    default:
      return state;
  }
}
