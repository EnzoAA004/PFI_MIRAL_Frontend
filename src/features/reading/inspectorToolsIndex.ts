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

/** Todos los grupos definidos, incluidos los retirados de la interfaz. La interfaz usa INSPECTOR_TOOL_GROUPS. */
export const ALL_INSPECTOR_TOOL_GROUPS: readonly { id: InspectorToolGroupId; title: string; description?: string }[] = [
  { id: "follow-up", title: "Seguimiento del paciente" },
  { id: "delivery", title: "Consulta" },
  { id: "evidence", title: "Evidencia y trazabilidad" },
  { id: "inspection", title: "Inspección técnica" },
  {
    id: "demo",
    title: "Análisis de demostración",
    description: "Circuito de producto en modo contrato. No es el análisis real que muestra el visor.",
  },
];

/** Todas las herramientas definidas, incluidas las retiradas de la interfaz. La interfaz usa INSPECTOR_TOOLS. */
export const ALL_INSPECTOR_TOOLS: readonly InspectorTool[] = [
  { id: "history", group: "follow-up", title: "Historial del paciente", hint: "Línea de tiempo de los estudios del paciente" },
  {
    id: "comparison",
    group: "follow-up",
    title: "Comparación entre estudios",
    hint: "Mediciones del análisis inicial frente a otro estudio del paciente",
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
    hint: "Preguntas sobre los resultados de este estudio, con sus fuentes y limitaciones",
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

/**
 * Herramientas retiradas de la interfaz del visor (simplificación de «Herramientas del estudio»). Solo se ocultó el
 * acceso: sus implementaciones, endpoints, datos, revisiones y el registro de auditoría siguen como estaban. Al no
 * estar en el índice no se montan, así que abrir el menú no consulta nada de ellas.
 *
 * - report: Informe y exportación.
 * - concordance, feedback, audit: grupo «Evidencia y trazabilidad».
 * - three-d, technical: grupo «Inspección técnica».
 * - demo: grupo «Análisis de demostración».
 */
export const RETIRED_INSPECTOR_TOOLS: readonly InspectorToolId[] = [
  "report",
  "concordance",
  "feedback",
  "audit",
  "three-d",
  "technical",
  "demo",
];

/** Lo que el índice ofrece hoy: historial, comparación entre estudios y asistente (los tres con datos reales del visor). */
export const INSPECTOR_TOOLS: readonly InspectorTool[] = ALL_INSPECTOR_TOOLS.filter((tool) => !RETIRED_INSPECTOR_TOOLS.includes(tool.id));

/** Solo los grupos que tienen alguna herramienta visible: no quedan encabezados vacíos. */
export const INSPECTOR_TOOL_GROUPS: readonly { id: InspectorToolGroupId; title: string; description?: string }[] =
  ALL_INSPECTOR_TOOL_GROUPS.filter((group) => INSPECTOR_TOOLS.some((tool) => tool.group === group.id));

export function inspectorToolById(id: InspectorToolId): InspectorTool {
  const tool = INSPECTOR_TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`Herramienta desconocida: ${id}`);
  return tool;
}

export function inspectorToolsInGroup(group: InspectorToolGroupId): InspectorTool[] {
  return INSPECTOR_TOOLS.filter((tool) => tool.group === group);
}
