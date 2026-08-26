/**
 * Contrato de `POST /api/studies/{caseId}/chat` y `GET .../chat-conversations(/{id})` — Backend
 * Post-E50, stage 80. El Frontend nunca envía contexto/mediciones — sólo la pregunta y,
 * opcionalmente, qué análisis/baseline usar; Spring resuelve todo lo demás server-side.
 */

export type ChatMessageRole = "USER" | "ASSISTANT";

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  model: string | null;
  provider: string | null;
  promptVersion: string | null;
};

export type ChatRequest = {
  question: string;
  analysisId?: string;
  baselineCaseId?: string;
};

/** `humanReviewRequired`/`notClinicalDiagnosis` son siempre `true` — los define el Backend, nunca el modelo. */
export type ChatResponse = {
  answer: string;
  conversationId: string;
  messageId: string;
  model: string;
  provider: string;
  promptVersion: string;
  generatedAt: string;
  warnings: string[];
  humanReviewRequired: boolean;
  notClinicalDiagnosis: boolean;
  contextSources: string[];
};

export type ChatConversationSummary = {
  conversationId: string;
  createdAt: string;
  messageCount: number;
};

export type ChatConversationHistory = {
  caseId: string;
  conversations: ChatConversationSummary[];
};

export type ChatConversationDetail = {
  conversationId: string;
  caseId: string;
  createdAt: string;
  messages: ChatMessage[];
};
