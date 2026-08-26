import { multiplanarRequest } from "./multiplanarApi";
import type {
  ChatConversationDetail,
  ChatConversationHistory,
  ChatConversationSummary,
  ChatMessage,
  ChatRequest,
  ChatResponse,
} from "./contracts/chatTypes";

/**
 * Cliente para `POST /api/studies/{caseId}/chat` y `GET .../chat-conversations(/{id})` (Backend
 * Post-E50, stage 80). Nunca envía mediciones/contexto — sólo la pregunta y, si corresponde,
 * `analysisId`/`baselineCaseId` — y nunca llama al LLM directamente: siempre pasa por Spring, que
 * es quien habla con el proveedor self-hosted.
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

function requiredStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
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
    warnings: requiredStringArray(raw.warnings),
    humanReviewRequired: requiredBoolean(raw.humanReviewRequired, "humanReviewRequired"),
    notClinicalDiagnosis: requiredBoolean(raw.notClinicalDiagnosis, "notClinicalDiagnosis"),
    contextSources: requiredStringArray(raw.contextSources),
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
    messages: asArray(raw.messages).map(parseChatMessage),
  };
}

export async function sendChatMessage(caseId: string, request: ChatRequest): Promise<ChatResponse> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(caseId)}/chat`, {
    method: "POST",
    body: JSON.stringify(request),
  });
  return parseChatResponse(raw);
}

export async function getChatConversations(caseId: string): Promise<ChatConversationHistory> {
  const raw = await multiplanarRequest<unknown>(`/api/studies/${encodeURIComponent(caseId)}/chat-conversations`);
  return parseChatConversationHistory(raw);
}

export async function getChatConversation(caseId: string, conversationId: string): Promise<ChatConversationDetail> {
  const raw = await multiplanarRequest<unknown>(
    `/api/studies/${encodeURIComponent(caseId)}/chat-conversations/${encodeURIComponent(conversationId)}`,
  );
  return parseChatConversationDetail(raw);
}
