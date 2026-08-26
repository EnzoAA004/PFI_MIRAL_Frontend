import { useEffect, useState } from "react";
import { useChat } from "./useChat";
import { shouldSubmitQuestion } from "./chatState";
import type { ChatConversationSummary } from "../../contracts/chatTypes";
import {
  CHAT_CONVERSATIONS_EMPTY_TEXT,
  CHAT_DISCLAIMER,
  CHAT_EMPTY_STATE_TEXT,
  CHAT_NEW_CONVERSATION_LABEL,
  CHAT_SENDING_TEXT,
  SUGGESTED_QUESTIONS,
  displayContextSource,
  displayConversationLabel,
} from "./chatDisplay";

type Props = {
  caseId: string;
};

/**
 * "Asistente" (stage 80) — chat contextual sobre el Study actualmente abierto. Vive dentro de la
 * pestaña "Más" de `StudyReviewView`, junto a "Evolución" (stage 79) — no se agregó como una
 * quinta pestaña de `ReviewInspector` para no romper su convención de exactamente cuatro
 * pestañas fijas (80-X: "NO hacer chatbot flotante global").
 *
 * El texto del asistente se renderiza siempre como texto plano de React (nunca
 * `dangerouslySetInnerHTML`) — ver 80-AB: "preferir texto plano inicialmente".
 */
export function ChatPanel({ caseId }: Props) {
  const { state, canSend, ask, loadConversation, startNewConversation, listConversations } = useChat(caseId);
  const [draft, setDraft] = useState("");
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((result) => {
        if (!cancelled) setConversations(result);
      })
      .catch(() => {
        // 81-D: un historial de conversaciones que no carga no debe romper el chat -- el
        // selector simplemente queda vacío, la conversación actual sigue funcionando.
      });
    return () => {
      cancelled = true;
    };
  }, [listConversations, state.conversationId]);

  function submit() {
    if (!shouldSubmitQuestion(draft)) return;
    void ask(draft);
    setDraft("");
  }

  return (
    <div className="chat-panel">
      <p className="rr-note">{CHAT_DISCLAIMER}</p>

      <div className="chat-conversations-bar">
        <label htmlFor={`chat-conversation-select-${caseId}`} className="rr-note">
          Conversaciones
        </label>
        <select
          id={`chat-conversation-select-${caseId}`}
          aria-label="Conversaciones"
          value={state.conversationId ?? ""}
          onChange={(event) => {
            if (event.target.value) void loadConversation(event.target.value);
          }}
        >
          <option value="">
            {conversations.length === 0 ? CHAT_CONVERSATIONS_EMPTY_TEXT : "Seleccionar conversación"}
          </option>
          {conversations.map((conversation) => (
            <option key={conversation.conversationId} value={conversation.conversationId}>
              {displayConversationLabel(conversation.createdAt)}
            </option>
          ))}
        </select>
        <button className="rr-more-action" type="button" onClick={startNewConversation}>
          {CHAT_NEW_CONVERSATION_LABEL}
        </button>
      </div>

      <div className="chat-messages" role="log" aria-live="polite">
        {state.messages.length === 0 && <p className="rr-findings-empty">{CHAT_EMPTY_STATE_TEXT}</p>}
        {state.messages.map((message) => (
          <article key={message.id} className={`chat-message chat-message-${message.role.toLowerCase()}`}>
            <p>{message.content}</p>
            {message.contextSources && message.contextSources.length > 0 && (
              <p className="rr-note">
                Fuentes: {message.contextSources.map(displayContextSource).join(", ")}
              </p>
            )}
          </article>
        ))}
        {state.phase === "sending" && <p className="rr-note" role="status">{CHAT_SENDING_TEXT}</p>}
      </div>

      {state.phase === "error" && state.error && (
        <p className="rr-disc-contract-error" role="alert">{state.error.message}</p>
      )}

      {state.messages.length === 0 && (
        <div className="chat-suggested-questions">
          {SUGGESTED_QUESTIONS.map((question) => (
            <button
              key={question}
              className="rr-more-action"
              type="button"
              disabled={!canSend}
              onClick={() => void ask(question)}
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <textarea
          aria-label="Escribir una pregunta"
          value={draft}
          disabled={!canSend}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button className="rr-more-action" type="button" disabled={!canSend || !shouldSubmitQuestion(draft)} onClick={submit}>
          Enviar
        </button>
      </div>
    </div>
  );
}
