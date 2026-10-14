/**
 * Índice de "Herramientas del estudio": todo lo que el panel ofrecía fuera de Resultados, Revisión y
 * Contexto, agrupado por propósito. Es la única lista: el índice y el contenido salen de acá, así que
 * una función no puede quedar sin acceso por olvido (hay una prueba que lo comprueba).
 */

export type InspectorToolId =
  | "history"
  | "comparison"
  | "report"
  | "assistant"
  | "concordance"
  | "feedback"
  | "audit"
  | "three-d"
  | "technical"
  | "demo";

export type InspectorToolGroupId = "follow-up" | "delivery" | "evidence" | "inspection" | "demo";

export type InspectorTool = {
  id: InspectorToolId;
  group: InspectorToolGroupId;
  title: string;
  /** Una línea en el índice: para qué sirve. */
  hint: string;
  /** Aviso de procedencia que se ve ya en el índice, cuando la herramienta no lee el análisis real del visor. */
  provenance?: string;
};

export const INSPECTOR_TOOL_GROUPS: readonly { id: InspectorToolGroupId; title: string; description?: string }[] = [
  { id: "follow-up", title: "Seguimiento del paciente" },
  { id: "delivery", title: "Informe y consulta" },
  { id: "evidence", title: "Evidencia y trazabilidad" },
  { id: "inspection", title: "Inspección técnica" },
  {
    id: "demo",
    title: "Análisis de demostración",
    description: "Circuito de producto en modo contrato. No es el análisis real que muestra el visor.",
  },
];

export const INSPECTOR_TOOLS: readonly InspectorTool[] = [
  { id: "history", group: "follow-up", title: "Historial del paciente", hint: "Línea de tiempo de los estudios del paciente" },
  {
    id: "comparison",
    group: "follow-up",
    title: "Comparación entre estudios",
    hint: "Compara con otro estudio del paciente",
    provenance: "Usa el análisis de demostración",
  },
  {
    id: "report",
    group: "delivery",
    title: "Informe y exportación",
    hint: "Informe estructurado, PDF/JSON y DICOM",
    provenance: "Usa el análisis de demostración",
  },
  {
    id: "assistant",
    group: "delivery",
    title: "Asistente",
    hint: "Chat con el contexto disponible",
    provenance: "Usa el análisis de demostración; no recibe contexto clínico",
  },
  { id: "concordance", group: "evidence", title: "Concordancia de evidencia", hint: "Compara hallazgos de lote y clasificación subarticular" },
  { id: "feedback", group: "evidence", title: "Feedback y curación", hint: "Curación de material para datasets futuros" },
  { id: "audit", group: "evidence", title: "Auditoría", hint: "Últimos eventos del estudio" },
  { id: "three-d", group: "inspection", title: "Reconstrucción 3D", hint: "Proxy 3D experimental de la columna" },
  { id: "technical", group: "inspection", title: "Detalles técnicos", hint: "Modo de inferencia, modelo y datos de la corrida" },
  {
    id: "demo",
    group: "demo",
    title: "Resultados y revisión del análisis de demostración",
    hint: "Historial, correcciones y revisión propios de esta corrida",
  },
];

export function inspectorToolById(id: InspectorToolId): InspectorTool {
  const tool = INSPECTOR_TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`Herramienta desconocida: ${id}`);
  return tool;
}

export function inspectorToolsInGroup(group: InspectorToolGroupId): InspectorTool[] {
  return INSPECTOR_TOOLS.filter((tool) => tool.group === group);
}
