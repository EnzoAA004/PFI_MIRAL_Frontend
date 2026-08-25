import { useCallback, useEffect, useReducer } from "react";
import { getProductAnalyses, getProductAnalysis, startProductAnalysis } from "../../productAnalysisV1Api";
import type { ProductAnalysisStartRequest } from "../../contracts/productAnalysisV1Types";
import {
  canRetry,
  canSubmit,
  classifyProductAnalysisError,
  initialProductAnalysisUiState,
  productAnalysisReducer,
} from "./productAnalysisV1State";

/**
 * Orquesta el análisis de producto Post-E50 para un Study (`caseId`): carga el historial al
 * entrar, permite lanzar un análisis nuevo, y permite abrir el detalle de uno persistido.
 *
 * Nunca llama a FastAPI directamente — todo pasa por `productAnalysisV1Api.ts`, que sólo habla
 * con Spring Boot. El componente que use este hook sólo necesita conocer `caseId`.
 */
export function useProductAnalysisV1(caseId: string) {
  const [state, dispatch] = useReducer(productAnalysisReducer, undefined, initialProductAnalysisUiState);

  const loadHistory = useCallback(async () => {
    dispatch({ type: "history_requested" });
    try {
      const history = await getProductAnalyses(caseId);
      dispatch({ type: "history_loaded", analyses: history.analyses });
    } catch (error) {
      dispatch({ type: "history_failed", error: classifyProductAnalysisError(error) });
    }
  }, [caseId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const analyze = useCallback(
    async (request?: ProductAnalysisStartRequest) => {
      if (!canSubmit(state)) return; // 77-U: doble click no dispara una segunda corrida.
      dispatch({ type: "submit_requested" });
      try {
        const result = await startProductAnalysis(caseId, request);
        dispatch({ type: "submit_succeeded", result });
      } catch (error) {
        dispatch({ type: "submit_failed", error: classifyProductAnalysisError(error) });
      }
    },
    [caseId, state],
  );

  const openAnalysis = useCallback(
    async (analysisId: string) => {
      dispatch({ type: "detail_requested", analysisId });
      try {
        const result = await getProductAnalysis(caseId, analysisId);
        dispatch({ type: "detail_loaded", result });
      } catch (error) {
        dispatch({ type: "detail_failed", error: classifyProductAnalysisError(error) });
      }
    },
    [caseId],
  );

  /** Reintento manual explícito (77-T): nunca automático, siempre a pedido del usuario. */
  const retry = useCallback(() => {
    if (!canRetry(state)) return;
    void analyze();
  }, [analyze, state]);

  return {
    state,
    canSubmit: canSubmit(state),
    canRetry: canRetry(state),
    analyze,
    openAnalysis,
    retry,
    reloadHistory: loadHistory,
  };
}
