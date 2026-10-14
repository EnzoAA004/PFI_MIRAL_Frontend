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
  confidence?: number;
};

/** Las cuatro clasificaciones binarias que el contrato informa por disco (Pfirrmann va aparte). */
export const DISC_CLASSIFICATION_TYPES = [
  "disc_bulging",
  "disc_narrowing",
  "upper_endplate_change",
  "lower_endplate_change",
] as const;

export const DISC_CLASSIFICATION_NAMES: Record<string, string> = {
  disc_bulging: "Abombamiento discal",
  disc_narrowing: "Estrechamiento discal",
  upper_endplate_change: "Cambio del platillo superior",
  lower_endplate_change: "Cambio del platillo inferior",
};

/** Se dice una sola vez, debajo de la tabla: el conteo no es una medida de gravedad ni de normalidad. */
export const DISC_COUNT_NOTE =
  "El conteo corresponde a las clasificaciones evaluadas (abombamiento, estrechamiento y cambio de platillo superior e inferior). No expresa gravedad ni normalidad.";

export type DiscClassificationRow = {
  type: string;
  name: string;
  /** `missing` = el contrato no trae el dato (o no es un valor válido): nunca cuenta como negativo. */
  result: "present" | "absent" | "missing";
  /** Valor crudo cuando no es válido, para mostrarlo tal cual. */
  rawLabel: string | null;
  confidence: number | null;
  deploymentStatus: string | null;
};

const isBinary = (label: string) => label === "present" || label === "absent";

/** Una fila por cada clasificación esperada; la que falta se rotula como sin dato, no como ausente. */
export function discClassificationRows(findings: readonly DiscScopeInput[]): DiscClassificationRow[] {
  return DISC_CLASSIFICATION_TYPES.map((type) => {
    const found = findings.find((finding) => finding.findingType === type && finding.deploymentStatus !== "not_product_supported");
    const valid = found !== undefined && isBinary(found.label);
    return {
      type,
      name: DISC_CLASSIFICATION_NAMES[type],
      result: valid ? (found.label as "present" | "absent") : "missing",
      rawLabel: found !== undefined && !valid ? found.label : null,
      confidence: found !== undefined && typeof found.confidence === "number" ? found.confidence : null,
      deploymentStatus: found?.deploymentStatus ?? null,
    };
  });
}

export type DiscPositivesSummary = {
  /** "2 de 4" solo con las cuatro clasificaciones válidas; si no, se dice cuántas se evaluaron. */
  text: string;
  complete: boolean;
  positives: number;
  evaluated: number;
  missing: string[];
  /** Detalle de lo que falta, para mostrarlo junto al conteo. */
  missingText: string | null;
  pfirrmann: string | null;
};

/**
 * Resumen de "clasificaciones positivas" de un disco. "n de 4" exige las cuatro con datos válidos;
 * los datos faltantes nunca se cuentan como negativos y se muestran como ausencia explícita.
 */
export function discPositivesSummary(findings: readonly DiscScopeInput[]): DiscPositivesSummary {
  const rows = discClassificationRows(findings);
  const valid = rows.filter((row) => row.result !== "missing");
  const positives = valid.filter((row) => row.result === "present").length;
  const missing = rows.filter((row) => row.result === "missing").map((row) => row.name);
  const pfirrmann = findings.find((finding) => finding.findingType === "pfirrmann_grade")?.label ?? null;
  const complete = valid.length === DISC_CLASSIFICATION_TYPES.length;
  if (complete) {
    return { text: `${positives} de ${DISC_CLASSIFICATION_TYPES.length}`, complete, positives, evaluated: valid.length, missing, missingText: null, pfirrmann };
  }
  if (!valid.length) {
    return { text: "Sin datos", complete, positives: 0, evaluated: 0, missing, missingText: "No hay clasificaciones informadas", pfirrmann };
  }
  return {
    text: `${positives} de ${valid.length} evaluadas`,
    complete,
    positives,
    evaluated: valid.length,
    missing,
    missingText: `Sin dato: ${missing.join(", ").toLowerCase()}`,
    pfirrmann,
  };
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
    draftLabel: "Guardar borrador",
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

/** Una línea que identifica qué análisis se revisa. */
export const REVIEW_ONE_LINER = "Revisás el análisis inicial del estudio (el de Mediciones y Hallazgos IA).";

export const REVIEW_SCOPE_COVERS = [
  "las mediciones de esta corrida y las correcciones que hagas",
  "los hallazgos discales de esta corrida, que se revisan como conjunto",
  "las notas de revisión y las anotaciones",
];

export const REVIEW_SCOPE_EXCLUDES = "No incluye el análisis de demostración, que tiene su propia revisión.";

/** Aviso breve cuando hay algo sin guardar: dónde se guarda y qué falta agregar. */
export function annotationsPendingNotice(input: { unsaved: boolean; draftText: string }): string | null {
  const draft = input.draftText.trim().length > 0;
  if (draft && input.unsaved) return "Hay un texto sin agregar y anotaciones sin guardar. Se guardan con «Guardar borrador» o al confirmar.";
  if (draft) return "Hay un texto escrito sin agregar a la lista de anotaciones.";
  if (input.unsaved) return "Hay anotaciones sin guardar. Se guardan junto con la revisión («Guardar borrador» o al confirmar).";
  return null;
}

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

/** Etiqueta breve junto a la edad. La explicación completa va en la ayuda desplegable. */
export function ageProvenanceShort(provenance: string | null | undefined): string {
  if (provenance === "calculated") return "Calculada";
  if (provenance === "reported") return "Declarada";
  return "Procedencia no informada";
}

export function ageProvenanceHelp(provenance: string | null | undefined): string {
  if (provenance === "calculated") {
    return "La edad se calculó al cargar el estudio con la fecha de nacimiento del paciente y la fecha de este estudio.";
  }
  if (provenance === "reported") {
    return "La edad la declaró quien cargó el estudio; no se calculó con una fecha de nacimiento.";
  }
  return "El estudio no registra cómo se obtuvo la edad.";
}

export const CONTEXT_HELP_NOTES = [
  "Es el contexto de este estudio al momento de cargarlo: la edad no se recalcula con datos actuales del paciente.",
  "Estos datos no se envían al asistente.",
];

/**
 * Filas del contexto del estudio. La edad es la guardada para ESE estudio: no se recalcula
 * con la fecha actual ni con datos actuales del paciente. `null` = no informado.
 */
export function clinicalContextRows(context: ContextFieldInput | null, provenance: string | null | undefined): ContextRow[] {
  const ageValue = context?.ageAtStudy == null ? null : `${context.ageAtStudy} años · ${ageProvenanceShort(provenance)}`;
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
 * Informe y asistente leen el circuito de producto (el "análisis de demostración"), no las mediciones que
 * muestra el visor: todavía no están conectados. Se dice donde se usan para que un resultado vacío no se lea
 * como "el estudio no tiene mediciones". La comparación entre estudios ya lee el análisis inicial real y
 * declara su propia fuente (ver initialComparisonDisplay.ts).
 */
export const REPORT_SOURCE_NOTE =
  "Fuente: el análisis de demostración registrado para el estudio, no las mediciones del visor. Sus niveles y mediciones pueden estar vacíos aunque el visor muestre valores.";
export const ASSISTANT_SOURCE_NOTE =
  "Fuente: el análisis de demostración y la revisión registrada. No recibe las mediciones del visor ni el contexto clínico del estudio. Puede estar deshabilitado en este entorno.";
