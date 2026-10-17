import type {
  ChatContextInfo,
  ChatConversationDetail,
  ChatMessageRole,
  ChatReference,
  ChatResponse,
  ChatScope,
} from "../../contracts/chatTypes";

/**
 * Estado puro del asistente. Ningún llamado de red vive acá: se puede probar sin React ni fetch.
 *
 * Una conversación pertenece a UN ámbito (una corrida, o el par de corridas del visor dual). `chatScopeKey` es la
 * identidad de ese ámbito y la usan el hook (para descartar respuestas tardías de otro estudio o de otra referencia) y
 * el panel (para volver a empezar al cambiarlo).
 */

export type ChatPhase = "idle" | "sending" | "error";

export type ChatErrorKind = "disabled" | "unavailable" | "timeout" | "scope" | "forbidden" | "network" | "other";

export type ChatError = {
  kind: ChatErrorKind;
  message: string;
  /** Reintentar tiene sentido salvo que el asistente esté apagado, el ámbito no exista o no haya permiso. */
  retryable: boolean;
};

export type ChatDisplayMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  /** Huella de los datos con que se respondió (solo respuestas del asistente). */
  fingerprint?: string | null;
  references?: ChatReference[];
  warnings?: string[];
};

export type ChatUiState = {
  phase: ChatPhase;
  conversationId?: string;
  messages: ChatDisplayMessage[];
  error?: ChatError;
  /** La última pregunta enviada: es la que se reintenta si falla. */
  lastQuestion?: string;
};

export function chatScopeKey(scope: ChatScope): string {
  return [scope.caseId, scope.runId, scope.referenceCaseId ?? "", scope.referenceRunId ?? ""].join("|");
}

export function isPairScope(scope: ChatScope): boolean {
  return Boolean(scope.referenceCaseId && scope.referenceRunId);
}

export function initialChatUiState(): ChatUiState {
  return { phase: "idle", messages: [] };
}

/** La pregunta del usuario se agrega de inmediato (optimista) y se conserva aunque la consulta falle. */
export function questionSent(state: ChatUiState, question: string): ChatUiState {
  return {
    ...state,
    phase: "sending",
    error: undefined,
    lastQuestion: question,
    messages: [...state.messages, { id: `pending-${state.messages.length}`, role: "USER", content: question }],
  };
}

export function answerReceived(state: ChatUiState, response: ChatResponse): ChatUiState {
  return {
    ...state,
    phase: "idle",
    conversationId: response.conversationId,
    error: undefined,
    messages: [
      ...state.messages,
      {
        id: response.messageId,
        role: "ASSISTANT",
        content: response.answer,
        fingerprint: response.contextFingerprint,
        references: response.references,
        warnings: response.warnings,
      },
    ],
  };
}

/** La pregunta optimista NO se borra tras un error: sigue visible lo que se preguntó y se puede reintentar. */
export function requestFailed(state: ChatUiState, error: ChatError): ChatUiState {
  return { ...state, phase: "error", error };
}

/**
 * Reintento: la pregunta fallida ya está en pantalla, así que se saca antes de volver a enviarla (no se duplica).
 */
export function retryPrepared(state: ChatUiState): { state: ChatUiState; question: string } | null {
  if (state.phase !== "error" || !state.lastQuestion) return null;
  const last = state.messages[state.messages.length - 1];
  const messages = last && last.role === "USER" && last.content === state.lastQuestion ? state.messages.slice(0, -1) : state.messages;
  return { state: { ...state, messages, error: undefined, phase: "idle" }, question: state.lastQuestion };
}

export function conversationLoaded(state: ChatUiState, detail: ChatConversationDetail): ChatUiState {
  return {
    ...state,
    phase: "idle",
    conversationId: detail.conversationId,
    error: undefined,
    messages: detail.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      fingerprint: message.role === "ASSISTANT" ? message.contextFingerprint : undefined,
      references: message.references,
    })),
  };
}

/** Doble submit bloqueado mientras hay una consulta en curso. */
export function canSend(state: ChatUiState): boolean {
  return state.phase !== "sending";
}

export function newConversationStarted(): ChatUiState {
  return initialChatUiState();
}

/** Solo rechaza una pregunta en blanco; el largo máximo lo valida el Backend (400 controlado). */
export function shouldSubmitQuestion(question: string): boolean {
  return question.trim().length > 0;
}

/**
 * Una respuesta del asistente es «basada en datos anteriores» cuando su huella no es la del contexto actual (cambiaron
 * correcciones o contexto clínico desde entonces). Sin huella actual conocida no se afirma nada.
 */
export function isStaleAnswer(message: ChatDisplayMessage, currentFingerprint: string | null | undefined): boolean {
  if (message.role !== "ASSISTANT" || !currentFingerprint) return false;
  return message.fingerprint !== currentFingerprint;
}

/** Estado de la conexión con el modelo, a partir de lo que informó el Backend (o de por qué no pudo informar). */
export type ConnectionState =
  | { kind: "checking" }
  | { kind: "ready"; model: string }
  | { kind: "disabled" }
  | { kind: "offline"; model: string }
  | { kind: "scope_error"; message: string };

export function connectionState(info: ChatContextInfo | null, infoError: ChatError | null): ConnectionState {
  if (infoError) {
    return infoError.kind === "scope" || infoError.kind === "forbidden"
      ? { kind: "scope_error", message: infoError.message }
      : { kind: "offline", model: "" };
  }
  if (!info) return { kind: "checking" };
  if (!info.provider.enabled) return { kind: "disabled" };
  return info.provider.available ? { kind: "ready", model: info.provider.model } : { kind: "offline", model: info.provider.model };
}

/** ¿Se puede prometer una comparación de hallazgos P10.7 para este ámbito? Solo en un par que las tenga de los dos lados. */
export function promisesFindingsComparison(scope: ChatScope, info: ChatContextInfo | null): boolean {
  return isPairScope(scope) && Boolean(info?.scope.findingsComparable);
}
