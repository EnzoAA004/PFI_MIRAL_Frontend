/**
 * Reglas puras de la vista "Nuevo estudio".
 *
 * Viven fuera del componente para poder probarlas sin renderizar: son las que
 * deciden qué se puede hacer, qué falta y cuándo una respuesta tardía ya no vale.
 */

/**
 * Misma regla que aplica el backend al identificador de caso.
 *
 * Se repite acá a propósito: el backend la valida porque es quien no puede confiar en
 * el cliente, y la pantalla la valida porque el médico tiene que enterarse mientras
 * escribe y no después de elegir el archivo. Un error que aparece recién al subir
 * obliga a rehacer el paso entero sin decir qué carácter sobraba.
 */
export const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function caseIdError(value: string): string {
  if (!value) return "";
  if (!/^[A-Za-z0-9]/.test(value)) return "Tiene que empezar con una letra o un número.";
  if (value.length > 80) return "Máximo 80 caracteres.";
  const invalid = [...value].find((character) => !/[A-Za-z0-9._:-]/.test(character));
  if (invalid) {
    // Se nombra el carácter que sobra: "caracteres inválidos" obliga a adivinar cuál.
    return invalid === " "
      ? "No puede llevar espacios. Usá guion o guion bajo."
      : `El carácter «${invalid}» no está permitido. Usá letras, números, punto, guion, guion bajo o dos puntos.`;
  }
  return CASE_ID_PATTERN.test(value) ? "" : "Formato no permitido.";
}

export type RequestToken = { readonly slot: string; readonly id: number; readonly generation: number };

/**
 * Decide si la respuesta de una carga todavía corresponde a lo que el médico tiene en
 * pantalla.
 *
 * Cada carga pide un token por "casillero" (el ZIP, el sagital, el axial). Una
 * respuesta solo se aplica si es la última pedida para su casillero y si el ID del
 * estudio no cambió desde entonces: si no, una respuesta lenta de un archivo A pisaría
 * al B elegido después, o dejaría asociada a un ID nuevo una imagen subida con el viejo.
 */
export function createRequestGate() {
  let generation = 0;
  const latest = new Map<string, number>();
  return {
    begin(slot: string): RequestToken {
      const id = (latest.get(slot) ?? 0) + 1;
      latest.set(slot, id);
      return { slot, id, generation };
    },
    isCurrent(token: RequestToken): boolean {
      return token.generation === generation && latest.get(token.slot) === token.id;
    },
    /** Invalida todo lo pendiente (cambio de ID, salida de la vista). */
    invalidateAll(): void {
      generation += 1;
    },
    /** Invalida lo pendiente de un casillero (se descartó su archivo). */
    invalidate(slot: string): void {
      latest.set(slot, (latest.get(slot) ?? 0) + 1);
    },
  };
}

/** Qué impide cargar imágenes, dicho junto al botón de carga. */
export function uploadBlockerMessage(normalizedCaseId: string, caseIdIssue: string): string {
  return !normalizedCaseId || caseIdIssue ? "Ingresá un ID de estudio válido para cargar las imágenes" : "";
}

export type AnalyzeBlockerInput = {
  running: boolean;
  normalizedCaseId: string;
  caseIdIssue: string;
  uploading: boolean;
  zipLoaded: boolean;
  sagittalInputId?: string;
  /** Error de la edad declarada (vacio si no hay). */
  ageIssue?: string;
};

/** Qué falta para habilitar "Analizar estudio". Vacío = se puede analizar. */
export function analyzeBlockerMessage(input: AnalyzeBlockerInput): string {
  if (input.running) return "";
  if (!input.normalizedCaseId) return "Falta el ID del estudio.";
  if (input.caseIdIssue) return "El ID del estudio no es válido.";
  if (input.ageIssue) return input.ageIssue;
  if (input.uploading) return "Esperá a que termine la carga de las imágenes.";
  if (!input.sagittalInputId) {
    return input.zipLoaded
      ? "El ZIP cargado no incluye una serie sagital."
      : "Falta cargar el ZIP del estudio (o un archivo sagital).";
  }
  return "";
}

export type UnsavedWorkInput = {
  caseId: string;
  description: string;
  studyDate: string;
  reviewPriority: string;
  /** Paciente elegido o creado en esta pantalla. */
  patientSelected: boolean;
  /** Edad declarada o cualquier texto clinico escrito. */
  contextFilled: boolean;
  hasLoadedFiles: boolean;
  analysisPersisted: boolean;
};

/**
 * Hay algo que se perdería al salir. Con la corrida ya guardada no hay nada que perder:
 * el estudio existe en el servidor y se abre desde la lista.
 */
export function hasUnsavedWork(input: UnsavedWorkInput): boolean {
  if (input.analysisPersisted) return false;
  return Boolean(
    input.caseId.trim()
    || input.description.trim()
    || input.studyDate
    || input.reviewPriority !== "medium"
    || input.patientSelected
    || input.contextFilled
    || input.hasLoadedFiles,
  );
}

/* ------------------------------------------------------------------------------------------
 * Pasos de "Nuevo estudio": 1 Paciente y estudio, 2 Imágenes, 3 Contexto y revisión.
 *
 * Lógica pura: qué paso está completo, cuál se puede visitar y qué falta para continuar.
 * Cambiar de paso nunca analiza ni crea nada: solo mueve la vista, y los datos y las cargas
 * viven por encima de los pasos.
 * ---------------------------------------------------------------------------------------- */

export type StepId = "study" | "images" | "context";

export const STEP_ORDER: StepId[] = ["study", "images", "context"];

export const STEP_LABEL: Record<StepId, string> = {
  study: "Paciente y estudio",
  images: "Imágenes",
  context: "Contexto y revisión",
};

export type StepState = "current" | "complete" | "pending";

export type StepStatus = {
  id: StepId;
  label: string;
  state: StepState;
  /** Se puede ir a este paso desde la navegación. */
  reachable: boolean;
  /** Qué hay que rehacer o qué está pasando, en una línea. Vacío si nada. */
  note: string;
};

export type StepsInput = {
  active: StepId;
  /** ID del estudio válido. */
  studyReady: boolean;
  /** Hay una serie sagital cargada y no hay cargas en curso. */
  imagesReady: boolean;
  /** Una modificación (el ID) descartó imágenes ya cargadas. */
  imagesInvalidated: boolean;
  uploading: boolean;
};

export function computeSteps(input: StepsInput): StepStatus[] {
  const studyComplete = input.studyReady;
  const imagesComplete = input.studyReady && input.imagesReady;
  const complete: Record<StepId, boolean> = { study: studyComplete, images: imagesComplete, context: false };
  const reachable: Record<StepId, boolean> = {
    study: true,
    images: input.studyReady,
    context: input.studyReady && input.imagesReady,
  };
  return STEP_ORDER.map((id) => {
    const state: StepState = id === input.active ? "current" : complete[id] ? "complete" : "pending";
    let note = "";
    if (id === "images") {
      if (input.uploading) note = "Cargando…";
      else if (input.imagesInvalidated && !imagesComplete) note = "Hay que volver a cargarlas";
    }
    return { id, label: STEP_LABEL[id], state, reachable: reachable[id], note };
  });
}

export function nextStep(id: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(id);
  return index >= 0 && index < STEP_ORDER.length - 1 ? STEP_ORDER[index + 1] : null;
}

export function previousStep(id: StepId): StepId | null {
  const index = STEP_ORDER.indexOf(id);
  return index > 0 ? STEP_ORDER[index - 1] : null;
}

export type ContinueInput = Omit<AnalyzeBlockerInput, "ageIssue">;

/** Qué falta para avanzar desde un paso. Vacío = se puede continuar. */
export function continueBlockerMessage(step: StepId, input: ContinueInput): string {
  if (step === "study") {
    if (!input.normalizedCaseId) return "Falta el ID del estudio.";
    if (input.caseIdIssue) return "El ID del estudio no es válido.";
    return "";
  }
  if (step === "images") return analyzeBlockerMessage({ ...input, running: false });
  return "";
}

export type ImagesStatus = {
  state: "none" | "uploading" | "loaded" | "error" | "invalidated";
  /** Texto corto para el resumen. */
  label: string;
};

/**
 * Estado de las imágenes para mostrar: una selección local no es una carga completada. Solo
 * "loaded" significa que el servidor respondió y hay una serie sagital utilizable.
 */
export function describeImagesStatus(input: {
  uploading: boolean;
  zipStatus: "idle" | "uploading" | "uploaded" | "error";
  planeErrors: boolean;
  sagittalInputId?: string;
  seriesCount?: number;
  invalidated: boolean;
}): ImagesStatus {
  if (input.uploading) return { state: "uploading", label: "Cargando…" };
  if (input.sagittalInputId) {
    return {
      state: "loaded",
      label: input.seriesCount ? `Cargadas · ${input.seriesCount} ${input.seriesCount === 1 ? "serie" : "series"}` : "Cargadas",
    };
  }
  if (input.invalidated) return { state: "invalidated", label: "Hay que volver a cargarlas" };
  if (input.zipStatus === "error" || input.planeErrors) return { state: "error", label: "No se cargaron" };
  return { state: "none", label: "Sin cargar" };
}
