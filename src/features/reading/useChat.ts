import { useCallback, useEffect, useRef, useState } from "react";
import { getChatContext, getChatConversation, getChatConversations, sendChatMessage } from "../../chatApi";
import type { ChatContextInfo, ChatConversationSummary, ChatScope } from "../../contracts/chatTypes";
import { classifyChatError } from "./chatDisplay";
import {
  answerReceived,
  canSend,
  chatScopeKey,
  conversationLoaded,
  initialChatUiState,
  newConversationStarted,
  questionSent,
  requestFailed,
  retryPrepared,
  shouldSubmitQuestion,
  type ChatError,
} from "./chatState";

/**
 * Orquesta el asistente para UN ámbito (corrida, o par de corridas del visor dual). Nunca envía mediciones ni contexto:
 * solo la pregunta y el ámbito. Nunca calcula nada: lo que responde viene del Backend.
 *
 * Respuestas tardías: cada consulta recuerda el ámbito con que salió. Si al volver el ámbito activo es otro (cambió el
 * estudio, la corrida o la referencia), la respuesta se descarta: no se muestra ni se guarda en la conversación actual.
 * El panel además se monta con `key` = ámbito, así que un ámbito nuevo siempre empieza con estado limpio.
 */
export function useChat(scope: ChatScope) {
  const scopeKey = chatScopeKey(scope);
  const scopeRef = useRef(scope);
  const scopeKeyRef = useRef(scopeKey);
  scopeRef.current = scope;
  scopeKeyRef.current = scopeKey;

  const [state, setState] = useState(initialChatUiState);
  const [info, setInfo] = useState<ChatContextInfo | null>(null);
  const [infoError, setInfoError] = useState<ChatError | null>(null);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);

  /** Datos que respaldarían una pregunta ahora (huella, faltantes, estado del modelo). No consulta al modelo de lenguaje. */
  const refreshInfo = useCallback(async () => {
    const requestedKey = scopeKeyRef.current;
    try {
      const next = await getChatContext(scopeRef.current);
      if (scopeKeyRef.current !== requestedKey) return;
      setInfo(next);
      setInfoError(null);
    } catch (error) {
      if (scopeKeyRef.current !== requestedKey) return;
      setInfo(null);
      setInfoError(classifyChatError(error));
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    const requestedKey = scopeKeyRef.current;
    try {
      const history = await getChatConversations(scopeRef.current);
      if (scopeKeyRef.current === requestedKey) setConversations(history.conversations);
    } catch {
      // Un historial que no carga no rompe el chat: el selector queda vacío y la conversación actual sigue funcionando.
      if (scopeKeyRef.current === requestedKey) setConversations([]);
    }
  }, []);

  useEffect(() => {
    setState(initialChatUiState());
    setInfo(null);
    setInfoError(null);
    setConversations([]);
    void refreshInfo();
    void refreshConversations();
  }, [scopeKey, refreshInfo, refreshConversations]);

  const send = useCallback(
    async (question: string, base: typeof state) => {
      const requestedKey = scopeKeyRef.current;
      const requestedScope = scopeRef.current;
      setState(questionSent(base, question));
      try {
        const response = await sendChatMessage(requestedScope, question, base.conversationId);
        if (scopeKeyRef.current !== requestedKey) return; // respuesta tardía de otro ámbito: se descarta
        setState((current) => answerReceived(current, response));
        void refreshInfo();
        void refreshConversations();
      } catch (error) {
        if (scopeKeyRef.current !== requestedKey) return;
        setState((current) => requestFailed(current, classifyChatError(error)));
        void refreshInfo();
      }
    },
    [refreshConversations, refreshInfo],
  );

  const ask = useCallback(
    async (question: string) => {
      if (!canSend(state) || !shouldSubmitQuestion(question)) return;
      await send(question.trim(), state);
    },
    [send, state],
  );

  const retry = useCallback(async () => {
    const prepared = retryPrepared(state);
    if (!prepared || !canSend(state)) return;
    await send(prepared.question, prepared.state);
  }, [send, state]);

  const loadConversation = useCallback(async (conversationId: string) => {
    const requestedKey = scopeKeyRef.current;
    try {
      const detail = await getChatConversation(scopeRef.current.caseId, conversationId);
      if (scopeKeyRef.current !== requestedKey) return;
      setState((current) => conversationLoaded(current, detail));
    } catch (error) {
      if (scopeKeyRef.current !== requestedKey) return;
      setState((current) => requestFailed(current, classifyChatError(error)));
    }
  }, []);

  const startNewConversation = useCallback(() => setState(newConversationStarted()), []);

  return {
    state,
    info,
    infoError,
    conversations,
    canSend: canSend(state),
    ask,
    retry,
    loadConversation,
    startNewConversation,
    refreshInfo,
  };
}
