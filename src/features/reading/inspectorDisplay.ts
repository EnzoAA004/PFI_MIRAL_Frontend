/**
 * Textos y reglas de presentación del panel derecho de la sala de lectura.
 *
 * Todo lo que acá se decide es presentación: ninguna regla cambia lo que se guarda ni las
 * transiciones del backend. Es lógica pura para poder probarla sin navegador.
 */

/** "5 mediciones", "1 medición", "Sin mediciones": un número solo no dice qué cuenta. */
export function measurementCountLabel(count: number): string {
  if (!count) return "Sin mediciones";
  return count === 1 ? "1 medición" : `${count} mediciones`;
}

/* ------------------------------------------------------------------ hallazgos discales */

export type DiscScopeInput = {
  findingType: string;
  label: string;
  deploymentStatus?: string;
};

const NON_BINARY_TYPES = new Set(["pfirrmann_grade", "modic_change"]);

const TYPE_NAMES: Record<string, string> = {
  disc_bulging: "abombamiento",
  disc_narrowing: "estrechamiento",
  upper_endplate_change: "cambio del platillo superior",
  lower_endplate_change: "cambio del platillo inferior",
  disc_herniation: "hernia",
  spondylolisthesis: "espondilolistesis",
  modic_change: "cambio Modic",
};

export type DiscClassificationScope = {
  /** Grado de Pfirrmann tal como lo informa el contrato, aparte del resto. */
  pfirrmann: string | null;
  evaluated: string[];
  present: string[];
  absent: string[];
  /** Una frase que dice qué se evaluó, nunca "normal". */
  summary: string;
  /** Qué clasificaciones entran en la frase anterior. */
  scopeNote: string | null;
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/**
 * Resume las clasificaciones del disco SIN concluir normalidad: "ausente" se dice solo
 * sobre las clasificaciones que el contrato informó para ese nivel. Un nivel sin ninguna
 * no se presenta como negativo: el contrato no distingue "no evaluado" de "no disponible".
 */
export function discClassificationScope(findings: readonly DiscScopeInput[]): DiscClassificationScope {
  const pfirrmann = findings.find((finding) => finding.findingType === "pfirrmann_grade")?.label ?? null;
  const binary = findings.filter(
    (finding) => !NON_BINARY_TYPES.has(finding.findingType) && finding.deploymentStatus !== "not_product_supported",
  );
  const evaluated = binary.map((finding) => finding.findingType);
  const present = binary.filter((finding) => finding.label === "present").map((finding) => finding.findingType);
  const absent = binary.filter((finding) => finding.label === "absent" || finding.label === "none").map((finding) => finding.findingType);

  if (!evaluated.length) {
    return {
      pfirrmann,
      evaluated,
      present,
      absent,
      summary: "Sin clasificaciones informadas",
      scopeNote: null,
    };
  }
  const names = evaluated.map((type) => TYPE_NAMES[type] ?? type);
  const scopeNote = `Clasificaciones evaluadas: ${joinNames(names)}. Que figuren como ausentes no descarta otras alteraciones del disco.`;
  const summary = present.length === 0
    ? (evaluated.length === 1 ? "Ausente en la clasificación evaluada" : `Ausente en las ${evaluated.length} clasificaciones evaluadas`)
    : `Presente en ${present.length} de ${evaluated.length} clasificaciones evaluadas`;
  return { pfirrmann, evaluated, present, absent, summary, scopeNote };
}

/* ------------------------------------------------------------------------------ revisión */

export type PanelReviewStatus = "pendiente" | "observado" | "aceptado" | "descartado" | string;

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  observado: "Observado",
  aceptado: "Finalizado",
  descartado: "Descartado",
};

export const REVIEW_NOTE_MIN_LENGTH = 5;

export type ReviewActionState = {
  draftLabel: string;
  draftDisabled: boolean;
  draftReason: string | null;
  confirmLabel: string;
  confirmDisabled: boolean;
  /** Motivo visible junto al botón; nunca solo en un tooltip. */
  confirmReason: string | null;
  /** Aviso (no bloquea) sobre lo que el backend va a exigir al confirmar. */
  notesHint: string | null;
  lockedNotice: string | null;
};

/**
 * Qué dice y qué permite cada acción de la revisión. Conserva las reglas existentes:
 * "Confirmar" sigue deshabilitado con el estado Pendiente o mientras se guarda, y
 * Observado/Descartado siguen exigiendo una nota de 5 caracteres (lo valida el guardado).
 */
export function reviewActionState(input: { status: PanelReviewStatus; saving: boolean; locked: boolean; notes: string }): ReviewActionState {
  const { status, saving, locked, notes } = input;
  const confirmLabel = status === "aceptado"
    ? "Finalizar y aprobar estudio"
    : status === "observado"
      ? "Marcar como observado"
      : status === "descartado"
        ? "Descartar estudio"
        : "Confirmar estado";
  const needsNote = status === "observado" || status === "descartado";
  const noteTooShort = needsNote && notes.trim().length < REVIEW_NOTE_MIN_LENGTH;

  let confirmReason: string | null = null;
  if (saving) confirmReason = "Guardando la revisión…";
  else if (status === "pendiente") {
    confirmReason = "Elegí Observado, Finalizado o Descartado para confirmar. «Guardar borrador» conserva la revisión como pendiente.";
  }

  return {
    draftLabel: "Guardar borrador (queda pendiente)",
    draftDisabled: saving,
    draftReason: saving ? "Guardando la revisión…" : null,
    confirmLabel,
    confirmDisabled: saving || status === "pendiente",
    confirmReason,
    notesHint: noteTooShort
      ? `${REVIEW_STATUS_LABELS[status]} requiere una nota de revisión de al menos ${REVIEW_NOTE_MIN_LENGTH} caracteres.`
      : null,
    lockedNotice: locked
      ? "El estudio está finalizado: los valores de las mediciones quedan bloqueados. Cambiar el estado vuelve a guardar la revisión."
      : null,
  };
}

export const REVIEW_SCOPE_COVERS = [
  "las mediciones de esta corrida y las correcciones que hagas",
  "los hallazgos discales de esta corrida, que se revisan como conjunto",
  "las notas de revisión y las anotaciones",
];

export const REVIEW_SCOPE_EXCLUDES = "No incluye el análisis de demostración, que tiene su propia revisión.";

/* ------------------------------------------------------------------------------ contexto */

export const NOT_REPORTED = "No informado";

export type ContextFieldInput = {
  ageAtStudy: number | null;
  clinicalReason: string | null;
  symptoms: string | null;
  symptomDuration: string | null;
  relevantHistory: string | null;
};

export type ContextRow = { key: string; label: string; value: string | null };

/**
 * Filas del contexto del estudio. La edad es la guardada para ESE estudio: no se recalcula
 * con la fecha actual ni con datos actuales del paciente. `null` = no informado.
 */
export function clinicalContextRows(context: ContextFieldInput | null, ageProvenanceText: string): ContextRow[] {
  const ageValue = context?.ageAtStudy == null ? null : `${context.ageAtStudy} años · ${ageProvenanceText}`;
  return [
    { key: "age", label: "Edad al estudio", value: ageValue },
    { key: "reason", label: "Motivo del estudio", value: context?.clinicalReason ?? null },
    { key: "symptoms", label: "Síntomas", value: context?.symptoms ?? null },
    { key: "duration", label: "Evolución", value: context?.symptomDuration ?? null },
    { key: "history", label: "Antecedentes", value: context?.relevantHistory ?? null },
  ];
}

export function hasAnyClinicalContext(rows: readonly ContextRow[]): boolean {
  return rows.some((row) => row.value !== null);
}

/* ------------------------------------------------------------- fuente de cada consumidor */

/*
 * Informe, comparación y asistente leen el circuito de producto (el "análisis de demostración"),
 * no las mediciones que muestra el visor: todavía no están conectados. Se dice donde se usan
 * para que un resultado vacío no se lea como "el estudio no tiene mediciones".
 */
export const COMPARISON_SOURCE_NOTE =
  "Fuente: el análisis de demostración de cada estudio, no las mediciones que ves en el visor (todavía no están conectadas a esta comparación). Si ese análisis no tiene valores comparables, la tabla queda vacía.";
export const REPORT_SOURCE_NOTE =
  "Fuente: el análisis de demostración registrado para el estudio, no las mediciones del visor. Sus niveles y mediciones pueden estar vacíos aunque el visor muestre valores.";
export const ASSISTANT_SOURCE_NOTE =
  "Fuente: el análisis de demostración y la revisión registrada. No recibe las mediciones del visor ni el contexto clínico del estudio. Puede estar deshabilitado en este entorno.";
