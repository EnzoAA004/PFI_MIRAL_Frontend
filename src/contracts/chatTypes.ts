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
  contextVersion?: string | null;
  outdated?: boolean;
  draftStatus?: "DRAFT_PENDING_REVIEW" | "DRAFT_OUTDATED" | null;
};

/**
 * Stage 81-C: `conversationId` es opcional. `undefined`/`null` inicia una conversación nueva
 * (comportamiento de stage 80, sin cambios). Un valor existente continúa esa conversación --
 * el Backend valida que pertenezca al Study antes de agregar el turno.
 */
export type ChatRequest = {
  question: string;
  analysisId?: string;
  baselineCaseId?: string;
  conversationId?: string;
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
  contextVersion?: string | null;
  draftStatus?: "DRAFT_PENDING_REVIEW" | "DRAFT_OUTDATED" | null;
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
