import { useCallback, useState } from "react";
import { getChatConversation, getChatConversations, sendChatMessage } from "../../chatApi";
import type { ChatConversationSummary } from "../../contracts/chatTypes";
import { classifyProductAnalysisError } from "./productAnalysisV1State";
import {
  answerReceived,
  canSend,
  conversationLoaded,
  initialChatUiState,
  newConversationStarted,
  questionSent,
  requestFailed,
  shouldSubmitQuestion,
} from "./chatState";

/**
 * Stage 80/81: orquesta el asistente contextual para el Study actualmente abierto (`caseId`).
 * Nunca envía mediciones/contexto — sólo la pregunta y, si corresponde, `analysisId`/
 * `baselineCaseId`/`conversationId` — y nunca calcula nada localmente: la respuesta siempre viene
 * del Backend.
 *
 * Stage 81-C: mientras `state.conversationId` exista, cada nueva pregunta continúa esa misma
 * conversación automáticamente (multi-turno) -- `startNewConversation()` es la única forma de
 * volver a una conversación nueva (81-D: "Nueva conversación").
 */
export function useChat(caseId: string) {
  const [state, setState] = useState(initialChatUiState);

  const ask = useCallback(
    async (question: string, options?: { analysisId?: string; baselineCaseId?: string }) => {
      if (!canSend(state)) return; // 80-Y: doble submit bloqueado mientras hay una consulta en curso.
      if (!shouldSubmitQuestion(question)) return;
      const trimmed = question.trim();
      const conversationId = state.conversationId;
      setState((current) => questionSent(current, trimmed));
      try {
        const response = await sendChatMessage(caseId, {
          question: trimmed,
          analysisId: options?.analysisId,
          baselineCaseId: options?.baselineCaseId,
          conversationId,
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

  const startNewConversation = useCallback(() => {
    setState(newConversationStarted());
  }, []);

  const listConversations = useCallback(async (): Promise<ChatConversationSummary[]> => {
    const history = await getChatConversations(caseId);
    return history.conversations;
  }, [caseId]);

  return { state, canSend: canSend(state), ask, loadConversation, startNewConversation, listConversations };
}
