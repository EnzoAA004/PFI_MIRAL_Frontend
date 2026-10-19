import { multiplanarRequest } from "./multiplanarApi";
import type {
  ChatContextInfo,
  ChatConversationDetail,
  ChatConversationHistory,
  ChatConversationSummary,
  ChatMessage,
  ChatReference,
  ChatRequest,
  ChatResponse,
  ChatResponseScope,
  ChatScope,
  ChatMode,
  ChatSuggestedQuestion,
} from "./contracts/chatTypes";

/**
 * Cliente del asistente sobre los resultados reales. Nunca envía mediciones ni contexto: solo la pregunta y el ámbito
 * (corrida o par de corridas). Nunca llama al modelo directamente: siempre pasa por el Backend, que valida el estudio, la
 * corrida y el rol, arma el contexto y habla con el proveedor local.
 */

export class ChatContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatContractError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChatContractError(`Contrato de chat inválido: falta ${field}.`);
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ChatContractError(`Contrato de chat inválido: ${field} no es booleano.`);
  }
  return value;
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMode(value: unknown): ChatMode {
  return value === "structured" ? "structured" : "free";
}

function parseSuggested(value: unknown): ChatSuggestedQuestion[] {
  const result: ChatSuggestedQuestion[] = [];
  for (const item of asArray(value)) {
    const raw = asRecord(item);
    if (raw && typeof raw.text === "string" && raw.text.trim() && typeof raw.intent === "string") result.push({ text: raw.text, intent: raw.intent });
  }
  return result;
}

function parseReferences(value: unknown): ChatReference[] {
  const references: ChatReference[] = [];
  for (const item of asArray(value)) {
    const raw = asRecord(item);
    if (raw && typeof raw.ref === "string" && typeof raw.label === "string") references.push({ ref: raw.ref, label: raw.label });
  }
  return references;
}

function parseScope(value: unknown): ChatResponseScope {
  const raw = asRecord(value);
  if (!raw || (raw.kind !== "study" && raw.kind !== "pair")) throw new ChatContractError("Contrato de chat inválido: ámbito desconocido.");
  return {
    kind: raw.kind,
    runId: requiredText(raw.runId, "scope.runId"),
    referenceCaseId: nullableText(raw.referenceCaseId),
    referenceRunId: nullableText(raw.referenceRunId),
    findingsComparable: requiredBoolean(raw.findingsComparable, "scope.findingsComparable"),
  };
}

/** Parseo estricto, fail-closed: los safety flags faltantes nunca se completan con un default. */
export function parseChatResponse(value: unknown): ChatResponse {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de chat inválido: respuesta vacía.");
  return {
    answer: requiredText(raw.answer, "answer"),
    conversationId: requiredText(raw.conversationId, "conversationId"),
    messageId: requiredText(raw.messageId, "messageId"),
    model: requiredText(raw.model, "model"),
    provider: requiredText(raw.provider, "provider"),
    promptVersion: requiredText(raw.promptVersion, "promptVersion"),
    generatedAt: requiredText(raw.generatedAt, "generatedAt"),
    warnings: stringArray(raw.warnings),
    humanReviewRequired: requiredBoolean(raw.humanReviewRequired, "humanReviewRequired"),
    notClinicalDiagnosis: requiredBoolean(raw.notClinicalDiagnosis, "notClinicalDiagnosis"),
    contextSources: stringArray(raw.contextSources),
    references: parseReferences(raw.references),
    removedReferences: typeof raw.removedReferences === "number" ? raw.removedReferences : 0,
    contextFingerprint: requiredText(raw.contextFingerprint, "contextFingerprint"),
    scope: parseScope(raw.scope),
    elapsedMs: typeof raw.elapsedMs === "number" ? raw.elapsedMs : 0,
    promptTokens: nullableNumber(raw.promptTokens),
    completionTokens: nullableNumber(raw.completionTokens),
    truncated: raw.truncated === true,
    mode: parseMode(raw.mode),
    intent: nullableText(raw.intent),
    shownCount: nullableNumber(raw.shownCount),
    totalCount: nullableNumber(raw.totalCount),
    // Fail-closed: sin la marca explícita del servidor, la respuesta no se presenta como respaldada.
    answerSupported: raw.answerSupported === true,
  };
}

export function parseChatContextInfo(value: unknown): ChatContextInfo {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de contexto inválido: respuesta vacía.");
  const provider = asRecord(raw.provider);
  if (!provider) throw new ChatContractError("Contrato de contexto inválido: falta el estado del proveedor.");
  return {
    scope: parseScope(raw.scope),
    contextFingerprint: requiredText(raw.contextFingerprint, "contextFingerprint"),
    promptVersion: requiredText(raw.promptVersion, "promptVersion"),
    contextSources: stringArray(raw.contextSources),
    missing: stringArray(raw.missing),
    elementCount: typeof raw.elementCount === "number" ? raw.elementCount : 0,
    contextText: requiredText(raw.contextText, "contextText"),
    provider: {
      enabled: requiredBoolean(provider.enabled, "provider.enabled"),
      available: requiredBoolean(provider.available, "provider.available"),
      model: typeof provider.model === "string" ? provider.model : "",
    },
    mode: parseMode(raw.mode),
    suggestedQuestions: parseSuggested(raw.suggestedQuestions),
  };
}

function parseChatMessage(value: unknown): ChatMessage {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de chat inválido: mensaje mal formado.");
  return {
    id: requiredText(raw.id, "messages[].id"),
    role: requiredText(raw.role, "messages[].role") as ChatMessage["role"],
    content: requiredText(raw.content, "messages[].content"),
    createdAt: requiredText(raw.createdAt, "messages[].createdAt"),
    model: nullableText(raw.model),
    provider: nullableText(raw.provider),
    promptVersion: nullableText(raw.promptVersion),
    contextFingerprint: nullableText(raw.contextFingerprint),
    references: parseReferences(raw.references),
  };
}

function parseConversationSummary(value: unknown): ChatConversationSummary {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de chat inválido: conversación mal formada.");
  return {
    conversationId: requiredText(raw.conversationId, "conversations[].conversationId"),
    createdAt: requiredText(raw.createdAt, "conversations[].createdAt"),
    messageCount: typeof raw.messageCount === "number" ? raw.messageCount : 0,
  };
}

export function parseChatConversationHistory(value: unknown): ChatConversationHistory {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de historial de chat inválido: respuesta vacía.");
  return {
    caseId: requiredText(raw.caseId, "caseId"),
    scopeKey: requiredText(raw.scopeKey, "scopeKey"),
    conversations: asArray(raw.conversations).map(parseConversationSummary),
  };
}

export function parseChatConversationDetail(value: unknown): ChatConversationDetail {
  const raw = asRecord(value);
  if (!raw) throw new ChatContractError("Contrato de conversación inválido: respuesta vacía.");
  return {
    conversationId: requiredText(raw.conversationId, "conversationId"),
    caseId: requiredText(raw.caseId, "caseId"),
    createdAt: requiredText(raw.createdAt, "createdAt"),
    scopeKey: requiredText(raw.scopeKey, "scopeKey"),
    runId: nullableText(raw.runId),
    referenceRunId: nullableText(raw.referenceRunId),
    messages: asArray(raw.messages).map(parseChatMessage),
  };
}

/** Parámetros de consulta del ámbito. La corrida es siempre explícita: el servidor no elige otra en silencio. */
function scopeQuery(scope: ChatScope, includeReferenceCase: boolean): string {
  const params = new URLSearchParams();
  params.set("runId", scope.runId);
  if (scope.referenceRunId) params.set("referenceRunId", scope.referenceRunId);
  if (includeReferenceCase && scope.referenceCaseId) params.set("referenceCaseId", scope.referenceCaseId);
  return params.toString();
}

export function chatRequestFor(scope: ChatScope, question: string, conversationId?: string): ChatRequest {
  const request: ChatRequest = { question, runId: scope.runId };
  if (scope.referenceCaseId && scope.referenceRunId) {
    request.referenceCaseId = scope.referenceCaseId;
    request.referenceRunId = scope.referenceRunId;
  }
  if (conversationId) request.conversationId = conversationId;
  return request;
}

export async function sendChatMessage(scope: ChatScope, question: string, conversationId?: string): Promise<ChatResponse> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(scope.caseId)}/chat`, {
    method: "POST",
    body: JSON.stringify(chatRequestFor(scope, question, conversationId)),
  });
  return parseChatResponse(raw);
}

export async function getChatContext(scope: ChatScope): Promise<ChatContextInfo> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(scope.caseId)}/chat-context?${scopeQuery(scope, true)}`);
  return parseChatContextInfo(raw);
}

export async function getChatConversations(scope: ChatScope): Promise<ChatConversationHistory> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(scope.caseId)}/chat-conversations?${scopeQuery(scope, false)}`);
  return parseChatConversationHistory(raw);
}

export async function getChatConversation(caseId: string, conversationId: string): Promise<ChatConversationDetail> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/chat-conversations/${encodeURIComponent(conversationId)}`,
  );
  return parseChatConversationDetail(raw);
}
