import type { ChatConversationDetail, ChatMessageRole, ChatResponse } from "../../contracts/chatTypes";
import type { ProductAnalysisError } from "./productAnalysisV1State";

/**
 * Estado puro (stage 80) del asistente contextual. Ningún llamado de red vive acá — mismo patrón
 * que `productAnalysisV1State.ts`/`longitudinalComparisonState.ts` en las etapas 77-79.
 */

export type ChatPhase = "idle" | "sending" | "success" | "error";

export type ChatDisplayMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  contextSources?: string[];
};

export type ChatUiState = {
  phase: ChatPhase;
  conversationId?: string;
  messages: ChatDisplayMessage[];
  error?: ProductAnalysisError;
};

export function initialChatUiState(): ChatUiState {
  return { phase: "idle", messages: [] };
}

/** El mensaje del usuario se agrega de inmediato (optimista) — se ve mientras se espera la respuesta. */
export function questionSent(state: ChatUiState, question: string): ChatUiState {
  return {
    ...state,
    phase: "sending",
    error: undefined,
    messages: [...state.messages, { id: `pending-${state.messages.length}`, role: "USER", content: question }],
  };
}

export function answerReceived(state: ChatUiState, response: ChatResponse): ChatUiState {
  return {
    ...state,
    phase: "success",
    conversationId: response.conversationId,
    error: undefined,
    messages: [
      ...state.messages,
      { id: response.messageId, role: "ASSISTANT", content: response.answer, contextSources: response.contextSources },
    ],
  };
}

/** El mensaje optimista del usuario NUNCA se borra tras un error -- sigue visible lo que preguntó. */
export function requestFailed(state: ChatUiState, error: ProductAnalysisError): ChatUiState {
  return { ...state, phase: "error", error };
}

export function conversationLoaded(state: ChatUiState, detail: ChatConversationDetail): ChatUiState {
  return {
    ...state,
    phase: "success",
    conversationId: detail.conversationId,
    error: undefined,
    messages: detail.messages.map((message) => ({ id: message.id, role: message.role, content: message.content })),
  };
}

/** Stage 80-Y: doble submit bloqueado mientras hay una consulta en curso. */
export function canSend(state: ChatUiState): boolean {
  return state.phase !== "sending";
}

/**
 * Sólo rechaza una pregunta en blanco client-side (80-M ya valida longitud server-side, y el
 * Frontend no le agrega un segundo límite arbitrario -- una pregunta larga se envía igual y, si
 * excede el máximo del Backend, vuelve como un 400 controlado).
 */
export function shouldSubmitQuestion(question: string): boolean {
  return question.trim().length > 0;
}
