import type { ChatContextInfo, ChatScope } from "../../contracts/chatTypes";
import type { ChatError } from "./chatState";
import { isPairScope, promisesFindingsComparison } from "./chatState";

/**
 * Presentación pura del asistente. Ninguna función de acá inventa una respuesta ni afirma un diagnóstico: solo etiquetas y
 * textos fijos, no clínicos.
 */

export const CHAT_DISCLAIMER =
  "El asistente muestra datos registrados del sistema (no ve las imágenes): el modelo solo interpreta qué consulta pedís y las cifras, niveles y referencias salen del sistema. Requiere revisión profesional y no es un diagnóstico.";

/** Tres cosas distintas que no se confunden: el modelo conectado, la fuente de datos disponible y la respuesta respaldada. */
export const CHAT_ORIGIN_LABELS: Record<"supported" | "out_of_scope" | "legacy", string> = {
  supported: "Respuesta respaldada por datos registrados",
  out_of_scope: "Fuera del alcance: no cita datos registrados",
  legacy: "Respuesta libre anterior: no verificada con el modo acotado",
};

export const CHAT_SUGGESTED_TITLE = "Consultas disponibles";
export const CHAT_SUGGESTED_HINT = "También podés escribir una pregunta: solo se responde con datos registrados.";

export const CHAT_EMPTY_STATE_TEXT = "Todavía no hay mensajes en esta conversación.";
export const CHAT_SENDING_TEXT = "Preparando la respuesta con los datos registrados… puede tardar unos segundos.";
export const CHAT_QUESTION_BLANK_TEXT = "Escribí una pregunta antes de enviar.";
export const CHAT_NEW_CONVERSATION_LABEL = "Nueva conversación";
export const CHAT_CONVERSATIONS_EMPTY_TEXT = "Todavía no hay conversaciones anteriores.";
export const CHAT_STALE_TEXT = "Respuesta basada en datos anteriores: las correcciones o el contexto clínico cambiaron desde entonces.";
export const CHAT_NO_FINDINGS_COMPARISON_TEXT =
  "Este par no tiene hallazgos P10.7 en los dos estudios: no hay comparación de hallazgos. El asistente puede explicar las diferencias numéricas.";

/**
 * Consultas que el asistente responde en este ámbito: las define el servidor (el texto exacto de cada una se resuelve sin
 * consultar al modelo). Sin información todavía no se sugiere nada; nunca se ofrece una comparación de clasificaciones en un
 * par que no las tiene en los dos lados.
 */
export function suggestedQuestions(scope: ChatScope, info: ChatContextInfo | null): string[] {
  if (!info) return [];
  return info.suggestedQuestions
    .filter((question) => question.intent !== "LIST_FINDING_CHANGES" || promisesFindingsComparison(scope, info))
    .filter((question) => isPairScope(scope) || !question.intent.startsWith("LIST_DIFFERENCES"))
    .map((question) => question.text);
}

const CONTEXT_SOURCE_LABELS: Record<string, string> = {
  current_analysis: "Análisis del visor",
  reference_analysis: "Análisis de la referencia",
  professional_correction: "Corrección profesional",
  clinical_context: "Contexto clínico",
  clinical_context_a: "Contexto clínico de A",
  clinical_context_b: "Contexto clínico de B",
  numeric_comparison: "Comparación de mediciones",
  findings_comparison: "Comparación de hallazgos P10.7",
};

/** Una fuente desconocida nunca rompe la UI: se muestra tal cual. */
export function displayContextSource(source: string): string {
  return CONTEXT_SOURCE_LABELS[source] ?? source;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Etiqueta corta del selector de conversaciones: «Hoy HH:MM» o «DD/MM HH:MM». Una fecha inválida cae al ISO crudo. */
export function displayConversationLabel(createdAtIso: string, now: Date = new Date()): string {
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) return createdAtIso;
  const time = `${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}`;
  const sameDay =
    createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth() && createdAt.getDate() === now.getDate();
  return sameDay ? `Hoy ${time}` : `${pad2(createdAt.getDate())}/${pad2(createdAt.getMonth() + 1)} ${time}`;
}

export function displayElapsed(elapsedMs: number): string {
  return elapsedMs < 1000 ? `${Math.round(elapsedMs)} ms` : `${(elapsedMs / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Mensaje claro para cada fallo, a partir del código del Backend o del tipo de error. Nunca expone infraestructura. */
export function classifyChatError(error: unknown): ChatError {
  const shaped = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null;
  if (shaped && shaped.name === "BackendApiError" && typeof shaped.status === "number") {
    const code = typeof shaped.code === "string" ? shaped.code : "";
    const status = shaped.status;
    if (code === "LLM_PROVIDER_DISABLED") {
      return { kind: "disabled", message: "El asistente no está habilitado en este entorno.", retryable: false };
    }
    if (code === "LLM_PROVIDER_TIMEOUT" || status === 504) {
      return { kind: "timeout", message: "El modelo tardó demasiado en responder. Podés reintentar o hacer una pregunta más corta.", retryable: true };
    }
    if (code === "LLM_PROVIDER_UNAVAILABLE" || code === "LLM_CONTRACT_VIOLATION" || status === 502 || status === 503) {
      return { kind: "unavailable", message: "El modelo local no está disponible o no respondió bien. Verificá que esté encendido y reintentá.", retryable: true };
    }
    if (status === 403) return { kind: "forbidden", message: "No tenés permisos para usar el asistente.", retryable: false };
    if (status === 401) return { kind: "forbidden", message: "La sesión no es válida. Volvé a iniciar sesión.", retryable: false };
    if (status === 404 || code.startsWith("CHAT_RUN") || code.startsWith("CHAT_CONVERSATION")) {
      return { kind: "scope", message: "No se encontró el estudio, el análisis o la conversación indicados. No se usó ningún otro.", retryable: false };
    }
    return { kind: "other", message: typeof shaped.message === "string" && shaped.message ? shaped.message : "No se pudo completar la consulta.", retryable: status >= 500 };
  }
  return { kind: "network", message: "No se pudo conectar con el Backend. Verificá tu conexión e intentá de nuevo.", retryable: true };
}

export function connectionLabel(kind: "checking" | "ready" | "disabled" | "offline" | "scope_error", model: string): string {
  switch (kind) {
    case "checking": return "Comprobando el modelo…";
    case "ready": return `Modelo local conectado${model ? ` (${model})` : ""}`;
    case "disabled": return "Asistente apagado en este entorno";
    case "offline": return "Sin conexión con el modelo local";
    case "scope_error": return "No se pudo preparar el contexto";
  }
}

/** Qué se puede hacer según el estado del modelo: las consultas disponibles no lo necesitan; las preguntas libres sí. */
export function modelAvailabilityNote(kind: "checking" | "ready" | "disabled" | "offline" | "scope_error"): string | null {
  if (kind === "disabled" || kind === "offline") return "Las consultas disponibles siguen funcionando sin el modelo; las preguntas escritas necesitan que esté conectado.";
  return null;
}

/** Fuente de datos: independiente del estado del modelo. */
export function sourceLabel(info: ChatContextInfo | null): string {
  if (!info) return "Comprobando los datos disponibles…";
  return info.elementCount > 0
    ? `Datos registrados disponibles (${info.elementCount} elementos citables)`
    : "No hay datos registrados disponibles para este ámbito";
}

/** Una respuesta que muestra un subconjunto lo dice: «Mostrando X de N». */
export function shownOfTotalLabel(shown: number | null | undefined, total: number | null | undefined): string | null {
  if (shown == null || total == null || total <= 0 || shown >= total) return null;
  return `Se muestran ${shown} de ${total}`;
}
