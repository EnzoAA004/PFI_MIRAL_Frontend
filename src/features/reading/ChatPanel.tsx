import { useState } from "react";
import type { ChatScope } from "../../contracts/chatTypes";
import { useChat } from "./useChat";
import { chatScopeKey, connectionState, isPairScope, isStaleAnswer, shouldSubmitQuestion } from "./chatState";
import {
  CHAT_CONVERSATIONS_EMPTY_TEXT,
  CHAT_DISCLAIMER,
  CHAT_EMPTY_STATE_TEXT,
  CHAT_NEW_CONVERSATION_LABEL,
  CHAT_NO_FINDINGS_COMPARISON_TEXT,
  CHAT_ORIGIN_LABELS,
  CHAT_SENDING_TEXT,
  CHAT_STALE_TEXT,
  CHAT_SUGGESTED_HINT,
  CHAT_SUGGESTED_TITLE,
  connectionLabel,
  displayContextSource,
  displayConversationLabel,
  modelAvailabilityNote,
  shownOfTotalLabel,
  sourceLabel,
  suggestedQuestions,
} from "./chatDisplay";

type Props = {
  scope: ChatScope;
};

/**
 * «Asistente»: preguntas sobre los resultados REALES del estudio abierto o, desde el visor dual, sobre las diferencias
 * entre A (referencia) y B (actual). El Backend arma el contexto con la corrida exacta; acá solo se muestra qué datos se
 * están usando, el estado del modelo, la respuesta con sus fuentes y los errores con posibilidad de reintentar.
 *
 * Se monta con `key` = ámbito: otro estudio, otra corrida u otra referencia empieza con una conversación limpia (nunca se
 * mezclan mensajes). El texto del asistente se renderiza siempre como texto plano de React.
 */
export function ChatPanel({ scope }: Props) {
  return <ChatPanelBody key={chatScopeKey(scope)} scope={scope} />;
}

function ChatPanelBody({ scope }: Props) {
  const { state, info, infoError, conversations, canSend, ask, retry, loadConversation, startNewConversation } = useChat(scope);
  const [draft, setDraft] = useState("");
  const pair = isPairScope(scope);
  const connection = connectionState(info, infoError);
  const modelReady = connection.kind === "ready";
  const currentFingerprint = info?.contextFingerprint ?? null;
  const questions = suggestedQuestions(scope, info);

  function submit() {
    if (!shouldSubmitQuestion(draft)) return;
    void ask(draft);
    setDraft("");
  }

  return (
    <div className="chat-panel" data-testid="assistant-panel" data-scope={pair ? "pair" : "study"}>
      <div className="chat-scope" data-testid="assistant-scope">
        {pair ? (
          <>
            <strong>Comparación A / B</strong>
            <span>A = Referencia ({scope.referenceCaseId}) · B = Actual ({scope.caseId})</span>
          </>
        ) : (
          <>
            <strong>Estudio abierto</strong>
            <span>{scope.caseId} · análisis que muestra el visor</span>
          </>
        )}
        {info && info.contextSources.length > 0 && (
          <span className="rr-note">Datos usados: {info.contextSources.map(displayContextSource).join(", ")}</span>
        )}
      </div>

      <p className={`chat-connection chat-connection-${connection.kind}`} data-testid="assistant-connection" role="status">
        {connectionLabel(connection.kind, connection.kind === "ready" || connection.kind === "offline" ? connection.model : "")}
        {connection.kind === "scope_error" && `: ${connection.message}`}
      </p>
      <p className="rr-note" data-testid="assistant-source">{sourceLabel(info)}</p>
      {modelAvailabilityNote(connection.kind) && <p className="rr-note" data-testid="assistant-model-note">{modelAvailabilityNote(connection.kind)}</p>}

      {pair && info && !info.scope.findingsComparable && (
        <p className="rr-note" data-testid="assistant-no-findings-note">{CHAT_NO_FINDINGS_COMPARISON_TEXT}</p>
      )}
      {info && info.missing.length > 0 && (
        <p className="rr-note" data-testid="assistant-missing">Datos ausentes que el asistente no puede inventar: {info.missing.join("; ")}.</p>
      )}
      <p className="rr-note" data-testid="assistant-disclaimer">{CHAT_DISCLAIMER}</p>

      {info && (
        <details className="chat-context" data-testid="assistant-context-details">
          <summary>Ver los datos registrados que usa el asistente ({info.elementCount} elementos citables)</summary>
          <pre className="chat-context-text">{info.contextText}</pre>
        </details>
      )}

      <div className="chat-conversations-bar">
        <label htmlFor="chat-conversation-select" className="rr-note">Conversaciones de este {pair ? "par" : "análisis"}</label>
        <select
          id="chat-conversation-select"
          aria-label="Conversaciones"
          value={state.conversationId ?? ""}
          onChange={(event) => {
            if (event.target.value) void loadConversation(event.target.value);
          }}
        >
          <option value="">{conversations.length === 0 ? CHAT_CONVERSATIONS_EMPTY_TEXT : "Seleccionar conversación"}</option>
          {conversations.map((conversation) => (
            <option key={conversation.conversationId} value={conversation.conversationId}>
              {displayConversationLabel(conversation.createdAt)}
            </option>
          ))}
        </select>
        <button className="rr-more-action" type="button" onClick={startNewConversation}>{CHAT_NEW_CONVERSATION_LABEL}</button>
      </div>

      <div className="chat-messages" role="log" aria-live="polite" data-testid="assistant-messages">
        {state.messages.length === 0 && <p className="rr-findings-empty">{CHAT_EMPTY_STATE_TEXT}</p>}
        {state.messages.map((message) => (
          <article key={message.id} className={`chat-message chat-message-${message.role.toLowerCase()}`} data-testid={`assistant-message-${message.role.toLowerCase()}`}>
            {message.content.split("\n").map((line, index) => <p className="chat-line" key={index}>{line}</p>)}
            {message.role === "ASSISTANT" && message.origin && (
              <p className={`rr-note chat-origin chat-origin-${message.origin}`} data-testid="assistant-origin" data-origin={message.origin}>
                {CHAT_ORIGIN_LABELS[message.origin]}
                {message.origin === "supported" && message.references && message.references.length > 0 ? ` · ${message.references.length} ${message.references.length === 1 ? "referencia" : "referencias"}` : ""}
                {shownOfTotalLabel(message.shown, message.total) ? ` · ${shownOfTotalLabel(message.shown, message.total)}` : ""}
              </p>
            )}
            {isStaleAnswer(message, currentFingerprint) && <p className="rr-note chat-stale" data-testid="assistant-stale">{CHAT_STALE_TEXT}</p>}
            {message.references && message.references.length > 0 && (
              <ul className="chat-references" data-testid="assistant-references">
                {message.references.map((reference) => (
                  <li key={reference.ref}><code>[{reference.ref}]</code> {reference.label}</li>
                ))}
              </ul>
            )}
            {message.warnings?.map((warning) => <p key={warning} className="rr-note">{warning}</p>)}
          </article>
        ))}
        {state.phase === "sending" && <p className="rr-note" role="status" data-testid="assistant-sending">{CHAT_SENDING_TEXT}</p>}
      </div>

      {state.phase === "error" && state.error && (
        <div className="rr-disc-contract-error" role="alert" data-testid="assistant-error">
          <p>{state.error.message}</p>
          {state.error.retryable && <button className="rr-more-action" type="button" onClick={() => void retry()}>Reintentar</button>}
        </div>
      )}

      {state.messages.length === 0 && (
        <div className="chat-suggested-questions" data-testid="assistant-suggestions">
          <p className="rr-note chat-suggested-title">{CHAT_SUGGESTED_TITLE}</p>
          {questions.map((question) => (
            <button key={question} className="rr-more-action" type="button" disabled={!canSend} onClick={() => void ask(question)}>
              {question}
            </button>
          ))}
          <p className="rr-note">{CHAT_SUGGESTED_HINT}</p>
        </div>
      )}

      <div className="chat-input-row">
        <textarea
          aria-label="Escribir una pregunta"
          placeholder="Escribí tu pregunta sobre este estudio…"
          rows={3}
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
        <button className="rr-more-action" type="button" disabled={!canSend || !shouldSubmitQuestion(draft)} onClick={submit}>Enviar</button>
      </div>
    </div>
  );
}
