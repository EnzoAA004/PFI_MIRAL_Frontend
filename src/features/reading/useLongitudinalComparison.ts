import { useCallback, useEffect, useState } from "react";
import { getComparableStudies, getLongitudinalComparison } from "../../longitudinalComparisonApi";
import { classifyProductAnalysisError } from "./productAnalysisV1State";
import {
  baselineCleared,
  candidatesFailed,
  candidatesLoaded,
  candidatesRequested,
  comparisonFailed,
  comparisonLoaded,
  comparisonRequested,
  excludeCurrentCase,
  initialLongitudinalComparisonUiState,
} from "./longitudinalComparisonState";

/**
 * Stage 79: orquesta la comparación longitudinal para el Study actualmente abierto (`caseId`).
 * Carga los Studies candidatos del mismo paciente (`subjectRef`) al entrar; al elegir uno, llama
 * al Backend para el cálculo determinístico. Nunca calcula un delta en el Frontend — siempre usa
 * el resultado del Backend tal cual (79-D/79-J).
 */
export function useLongitudinalComparison(caseId: string, subjectRef: string | null, initialBaselineCaseId?: string) {
  const [state, setState] = useState(initialLongitudinalComparisonUiState);

  const loadCandidates = useCallback(async () => {
    if (!subjectRef) {
      setState((current) => candidatesLoaded(current, []));
      return;
    }
    setState(candidatesRequested);
    try {
      const studies = await getComparableStudies(subjectRef, caseId);
      setState((current) => candidatesLoaded(current, excludeCurrentCase(studies, caseId)));
    } catch (error) {
      setState((current) => candidatesFailed(current, classifyProductAnalysisError(error)));
    }
  }, [caseId, subjectRef]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const selectBaseline = useCallback(
    async (baselineCaseId: string) => {
      if (!baselineCaseId) {
        setState(baselineCleared);
        return;
      }
      setState((current) => comparisonRequested(current, baselineCaseId));
      try {
        const result = await getLongitudinalComparison(caseId, baselineCaseId);
        setState((current) => comparisonLoaded(current, result));
      } catch (error) {
        setState((current) => comparisonFailed(current, classifyProductAnalysisError(error)));
      }
    },
    [caseId],
  );

  // Stage 84-T: "Comparar" desde el historial del paciente reutiliza este mismo hook -- sólo
  // preselecciona el baseline una vez que los candidatos cargaron, nunca calcula nada acá.
  useEffect(() => {
    if (!initialBaselineCaseId) return;
    if (state.phase !== "ready") return;
    if (!state.candidates.some((candidate) => candidate.caseId === initialBaselineCaseId)) return;
    if (state.selectedBaselineCaseId === initialBaselineCaseId) return;
    void selectBaseline(initialBaselineCaseId);
  }, [initialBaselineCaseId, state.phase, state.candidates]);

  return { state, selectBaseline, reloadCandidates: loadCandidates };
}
