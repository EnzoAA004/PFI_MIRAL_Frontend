/**
 * Presentación pura para el asistente contextual (stage 80). Ninguna función de acá inventa una
 * respuesta ni afirma un diagnóstico — sólo etiquetas y textos fijos, no clínicos.
 */

export const CHAT_DISCLAIMER =
  "Asistente contextual. Resume información disponible en el sistema y no reemplaza la revisión profesional.";

export const CHAT_EMPTY_STATE_TEXT = "Todavía no hay mensajes en esta conversación.";

export const CHAT_SENDING_TEXT = "Consultando…";

export const CHAT_PROVIDER_UNAVAILABLE_TEXT = "El asistente conversacional no está disponible en este momento.";

export const CHAT_QUESTION_BLANK_TEXT = "Escribí una pregunta antes de enviar.";

export const SUGGESTED_QUESTIONS: string[] = [
  "¿Qué mediciones están disponibles?",
  "¿Qué resultados están pendientes de revisión?",
  "¿Qué cambió respecto del estudio anterior?",
  "¿Qué mediciones fueron corregidas profesionalmente?",
];

const CONTEXT_SOURCE_LABELS: Record<string, string> = {
  current_analysis: "Análisis actual",
  professional_review: "Revisión profesional",
  professional_correction: "Corrección profesional",
  longitudinal_comparison: "Comparación longitudinal",
};

/** Un contextSource desconocido nunca rompe la UI -- se muestra tal cual. */
export function displayContextSource(source: string): string {
  return CONTEXT_SOURCE_LABELS[source] ?? source;
}
