import { useCallback, useEffect, useReducer } from "react";
import {
  correctProductAnalysisMeasurement,
  getProductAnalyses,
  getProductAnalysis,
  reviewProductAnalysisDiscLevel,
  reviewProductAnalysisRun,
  startProductAnalysis,
} from "../../productAnalysisV1Api";
import type {
  ProductAnalysisCorrectionRequest,
  ProductAnalysisReviewRequest,
  ProductAnalysisStartRequest,
} from "../../contracts/productAnalysisV1Types";
import {
  canMutate,
  canRetry,
  canSubmit,
  classifyProductAnalysisError,
  initialProductAnalysisUiState,
  productAnalysisReducer,
} from "./productAnalysisV1State";

/**
 * Orquesta el análisis de producto Post-E50 para un Study (`caseId`): carga el historial al
 * entrar, permite lanzar un análisis nuevo, abrir el detalle de uno persistido, y (stage 78)
 * revisar/corregir un análisis ya persistido.
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

  /** Stage 78-B: acepta/observa/rechaza la corrida completa. 78-U: doble click no dispara dos revisiones. */
  const reviewRun = useCallback(
    async (analysisId: string, request: ProductAnalysisReviewRequest) => {
      if (!canMutate(state)) return;
      dispatch({ type: "mutation_requested" });
      try {
        const result = await reviewProductAnalysisRun(caseId, analysisId, request);
        dispatch({ type: "mutation_succeeded", result });
      } catch (error) {
        dispatch({ type: "mutation_failed", error: classifyProductAnalysisError(error) });
      }
    },
    [caseId, state],
  );

  /** Stage 78-C: acepta/observa/rechaza un nivel discal puntual. */
  const reviewDiscLevel = useCallback(
    async (analysisId: string, discLevelId: string, request: ProductAnalysisReviewRequest) => {
      if (!canMutate(state)) return;
      dispatch({ type: "mutation_requested" });
      try {
        const result = await reviewProductAnalysisDiscLevel(caseId, analysisId, discLevelId, request);
        dispatch({ type: "mutation_succeeded", result });
      } catch (error) {
        dispatch({ type: "mutation_failed", error: classifyProductAnalysisError(error) });
      }
    },
    [caseId, state],
  );

  /** Stage 78-D: agrega una corrección; el valor automático permanece visible junto al corregido. */
  const correctMeasurement = useCallback(
    async (analysisId: string, measurementId: string, request: ProductAnalysisCorrectionRequest) => {
      if (!canMutate(state)) return;
      dispatch({ type: "mutation_requested" });
      try {
        const result = await correctProductAnalysisMeasurement(caseId, analysisId, measurementId, request);
        dispatch({ type: "mutation_succeeded", result });
      } catch (error) {
        dispatch({ type: "mutation_failed", error: classifyProductAnalysisError(error) });
      }
    },
    [caseId, state],
  );

  return {
    state,
    canSubmit: canSubmit(state),
    canRetry: canRetry(state),
    canMutate: canMutate(state),
    analyze,
    openAnalysis,
    retry,
    reviewRun,
    reviewDiscLevel,
    correctMeasurement,
    reloadHistory: loadHistory,
  };
}
