/**
 * Contrato del asistente sobre los resultados REALES (`POST /api/studies/{caseId}/chat`, `GET .../chat-context`,
 * `GET .../chat-conversations(/{id})`). El Frontend nunca envía mediciones, hallazgos ni contexto clínico: solo la pregunta
 * y QUÉ datos usar (la corrida que muestra el visor, o el par de corridas del visor dual). El servidor valida y arma todo.
 */

export type ChatMessageRole = "USER" | "ASSISTANT";

/** Qué datos respaldan una conversación: una corrida de un estudio, o el par (actual B, referencia A) del visor dual. */
export type ChatScope = {
  caseId: string;
  runId: string;
  referenceCaseId?: string | null;
  referenceRunId?: string | null;
};

export type ChatReference = { ref: string; label: string };

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  model: string | null;
  provider: string | null;
  promptVersion: string | null;
  /** Huella de los datos con que se respondió. Distinta de la actual = respuesta basada en datos anteriores. */
  contextFingerprint: string | null;
  references: ChatReference[];
};

export type ChatRequest = {
  question: string;
  runId: string;
  referenceCaseId?: string;
  referenceRunId?: string;
  conversationId?: string;
};

export type ChatResponseScope = {
  kind: "study" | "pair";
  runId: string;
  referenceCaseId: string | null;
  referenceRunId: string | null;
  /** `false` en un par sin hallazgos P10.7 en los dos lados: no hay comparación de hallazgos y no se promete. */
  findingsComparable: boolean;
};

/** `humanReviewRequired`/`notClinicalDiagnosis` son siempre `true`: los define el Backend, nunca el modelo. */
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
  references: ChatReference[];
  removedReferences: number;
  contextFingerprint: string;
  scope: ChatResponseScope;
  elapsedMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** El proveedor cortó la respuesta por el límite de longitud: puede estar incompleta. */
  truncated: boolean;
};

export type ChatProviderStatus = { enabled: boolean; available: boolean; model: string };

/** Lo que respaldaría una pregunta ahora, sin consultar al modelo. `contextText` es exactamente lo que recibiría el proveedor. */
export type ChatContextInfo = {
  scope: ChatResponseScope;
  contextFingerprint: string;
  promptVersion: string;
  contextSources: string[];
  missing: string[];
  elementCount: number;
  contextText: string;
  provider: ChatProviderStatus;
};

export type ChatConversationSummary = {
  conversationId: string;
  createdAt: string;
  messageCount: number;
};

export type ChatConversationHistory = {
  caseId: string;
  scopeKey: string;
  conversations: ChatConversationSummary[];
};

export type ChatConversationDetail = {
  conversationId: string;
  caseId: string;
  createdAt: string;
  scopeKey: string;
  runId: string | null;
  referenceRunId: string | null;
  messages: ChatMessage[];
};
