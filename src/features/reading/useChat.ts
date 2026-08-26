import { useCallback, useState } from "react";
import { getChatConversation, sendChatMessage } from "../../chatApi";
import { classifyProductAnalysisError } from "./productAnalysisV1State";
import { answerReceived, canSend, conversationLoaded, initialChatUiState, questionSent, requestFailed, shouldSubmitQuestion } from "./chatState";

/**
 * Stage 80: orquesta el asistente contextual para el Study actualmente abierto (`caseId`).
 * Nunca envía mediciones/contexto — sólo la pregunta y, si corresponde, `analysisId`/
 * `baselineCaseId` — y nunca calcula nada localmente: la respuesta siempre viene del Backend.
 */
export function useChat(caseId: string) {
  const [state, setState] = useState(initialChatUiState);

  const ask = useCallback(
    async (question: string, options?: { analysisId?: string; baselineCaseId?: string }) => {
      if (!canSend(state)) return; // 80-Y: doble submit bloqueado mientras hay una consulta en curso.
      if (!shouldSubmitQuestion(question)) return;
      const trimmed = question.trim();
      setState((current) => questionSent(current, trimmed));
      try {
        const response = await sendChatMessage(caseId, {
          question: trimmed,
          analysisId: options?.analysisId,
          baselineCaseId: options?.baselineCaseId,
        });
        setState((current) => answerReceived(current, response));
      } catch (error) {
        setState((current) => requestFailed(current, classifyProductAnalysisError(error)));
      }
    },
    [caseId, state],
  );

  const loadConversation = useCallback(
    async (conversationId: string) => {
      try {
        const detail = await getChatConversation(caseId, conversationId);
        setState((current) => conversationLoaded(current, detail));
      } catch (error) {
        setState((current) => requestFailed(current, classifyProductAnalysisError(error)));
      }
    },
    [caseId],
  );

  return { state, canSend: canSend(state), ask, loadConversation };
}
