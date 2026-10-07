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
};

/** Qué falta para habilitar "Analizar estudio". Vacío = se puede analizar. */
export function analyzeBlockerMessage(input: AnalyzeBlockerInput): string {
  if (input.running) return "";
  if (!input.normalizedCaseId) return "Falta el ID del estudio.";
  if (input.caseIdIssue) return "El ID del estudio no es válido.";
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
  subjectRef: string;
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
    || input.subjectRef.trim()
    || input.hasLoadedFiles,
  );
}
