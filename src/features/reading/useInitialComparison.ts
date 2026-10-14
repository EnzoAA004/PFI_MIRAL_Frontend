import { useCallback, useEffect, useReducer, useRef } from "react";
import { BackendApiError } from "../../multiplanarApi";
import { getInitialComparison, getInitialComparisonCandidates } from "../../initialAnalysisComparisonApi";
import {
  initialComparisonReducer,
  initialComparisonUiState,
  type ComparisonError,
} from "./initialComparisonState";

function toError(error: unknown): ComparisonError {
  if (error instanceof BackendApiError) return { code: error.code ?? null, message: error.message };
  if (error instanceof Error) return { code: null, message: error.message };
  return { code: null, message: "No se pudo completar la comparación." };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Orquesta "Comparación entre estudios" (análisis inicial) para el estudio abierto.
 *
 * - Lee, no escribe: ningún pedido dispara un análisis ni un modelo.
 * - `currentRunId` es la corrida que el visor muestra; el Backend consulta esa y no otra.
 * - Cada elección de referencia cancela el pedido anterior y lleva un número: una respuesta tardía de una
 *   elección previa no puede pisar a la actual (ver `initialComparisonReducer`).
 * - Nunca calcula una diferencia: usa lo que devuelve el Backend.
 */
export function useInitialComparison(caseId: string, currentRunId: string | null) {
  const [state, dispatch] = useReducer(initialComparisonReducer, initialComparisonUiState);
  const counter = useRef(0);
  const comparisonAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    comparisonAbort.current?.abort();
    dispatch({ type: "candidates_requested" });
    getInitialComparisonCandidates(caseId, currentRunId, controller.signal)
      .then((candidates) => {
        if (!controller.signal.aborted) dispatch({ type: "candidates_loaded", candidates });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbort(error)) dispatch({ type: "candidates_failed", error: toError(error) });
      });
    return () => {
      controller.abort();
      comparisonAbort.current?.abort();
    };
  }, [caseId, currentRunId]);

  const select = useCallback(
    (referenceCaseId: string) => {
      comparisonAbort.current?.abort();
      if (!referenceCaseId) {
        dispatch({ type: "selection_cleared" });
        return;
      }
      counter.current += 1;
      const requestId = counter.current;
      const controller = new AbortController();
      comparisonAbort.current = controller;
      dispatch({ type: "comparison_requested", caseId: referenceCaseId, requestId });
      getInitialComparison(caseId, referenceCaseId, currentRunId, null, controller.signal)
        .then((result) => dispatch({ type: "comparison_loaded", requestId, result }))
        .catch((error: unknown) => {
          if (!isAbort(error)) dispatch({ type: "comparison_failed", requestId, error: toError(error) });
        });
    },
    [caseId, currentRunId],
  );

  return { state, select };
}
