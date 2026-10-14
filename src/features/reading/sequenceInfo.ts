/*
 * Secuencia (ponderación) de una serie y de dónde sale ese dato.
 *
 * `user_declared` es lo que dijo quien cargó el archivo; `auto_detected` es lo que leyó la ingesta de un
 * estudio DICOM (descripción de la serie o tiempo de eco). Ninguna es una validación del modelo, y el texto
 * libre de «Otra» nunca se interpreta como ponderación. Todo dato ausente o incoherente es desconocido: no se
 * completa con T2 ni se deduce del nombre del archivo.
 */
export type SequenceValue = "unknown" | "t1" | "t2" | "other";
export type SequenceSource = "unknown" | "user_declared" | "auto_detected";

export type SequenceInfo = {
  value: SequenceValue;
  source: SequenceSource;
  description: string;
};

export const MAX_SEQUENCE_DESCRIPTION = 80;
export const UNKNOWN_SEQUENCE: SequenceInfo = { value: "unknown", source: "unknown", description: "" };

/** Lo que se elige en el selector de la carga. */
export type SequenceChoice = { value: SequenceValue; description: string };
export const DEFAULT_SEQUENCE_CHOICE: SequenceChoice = { value: "unknown", description: "" };

const VALUES: readonly SequenceValue[] = ["unknown", "t1", "t2", "other"];
const SOURCES: readonly SequenceSource[] = ["unknown", "user_declared", "auto_detected"];

function lower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Misma regla que el Backend: cualquier cosa que no sea una pareja valor/procedencia válida es desconocida. */
export function parseSequenceInfo(raw: unknown): SequenceInfo {
  if (!raw || typeof raw !== "object") return UNKNOWN_SEQUENCE;
  const record = raw as Record<string, unknown>;
  const value = lower(record.value);
  const source = lower(record.source);
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!VALUES.includes(value as SequenceValue) || !SOURCES.includes(source as SequenceSource)) return UNKNOWN_SEQUENCE;
  if (source === "unknown" || value === "unknown") return UNKNOWN_SEQUENCE;
  if (value === "t1" || value === "t2") return { value, source: source as SequenceSource, description: "" };
  if (source === "user_declared" && description && description.length <= MAX_SEQUENCE_DESCRIPTION) {
    return { value: "other", source: "user_declared", description };
  }
  return UNKNOWN_SEQUENCE;
}

/**
 * Secuencia de una fila del catálogo del estudio (`weighting`): la ponderación que leyó la ingesta de un zip
 * DICOM. Antes de existir la procedencia ese era su único origen, así que t1/t2 se lee como detectado.
 */
export function sequenceFromWeighting(weighting: unknown): SequenceInfo {
  const value = lower(weighting);
  return value === "t1" || value === "t2" ? { value, source: "auto_detected", description: "" } : UNKNOWN_SEQUENCE;
}

/**
 * Fila del catálogo del estudio con su procedencia (`sequenceSource`). Una fila anterior a la procedencia trae solo
 * `weighting`; t1/t2 sin procedencia se lee como detectado, y cualquier otra cosa como desconocida.
 */
export function sequenceFromStored(weighting: unknown, source: unknown, description: unknown): SequenceInfo {
  const provenance = lower(source);
  if (!provenance) return sequenceFromWeighting(weighting);
  return parseSequenceInfo({ value: weighting, source: provenance, description });
}

export function isKnownSequence(info: SequenceInfo): boolean {
  return info.value !== "unknown";
}

/** «T1», «T2», «Otra: STIR sagital» o «Sin informar». */
export function sequenceLabel(info: SequenceInfo): string {
  if (info.value === "t1") return "T1";
  if (info.value === "t2") return "T2";
  if (info.value === "other") return info.description ? `Otra: ${info.description}` : "Otra";
  return "Sin informar";
}

export function sequenceProvenanceLabel(info: SequenceInfo): string {
  if (info.source === "user_declared") return "declarada por el usuario";
  if (info.source === "auto_detected") return "detectada del estudio DICOM";
  return "";
}

/** «T1 · declarada por el usuario», o «Sin informar». */
export function sequenceText(info: SequenceInfo): string {
  const provenance = sequenceProvenanceLabel(info);
  return provenance ? `${sequenceLabel(info)} · ${provenance}` : sequenceLabel(info);
}

/** Aclaración corta para el tooltip: qué significa la procedencia. */
export function sequenceProvenanceHint(info: SequenceInfo): string {
  if (info.source === "user_declared") {
    return "Lo declaró quien cargó el archivo. No es una detección automática ni una validación del modelo.";
  }
  if (info.source === "auto_detected") return "Se leyó de la descripción de la serie del estudio DICOM.";
  return "Nadie informó la secuencia de esta serie y no se pudo detectar.";
}

/** Secuencia de la comparación: lo que publica el Backend en cada lado. */
export function sequenceFromComparisonSide(side: {
  sagittalSequence: string | null;
  sagittalSequenceSource?: string | null;
  sagittalSequenceDescription?: string | null;
}): SequenceInfo {
  return parseSequenceInfo({
    value: side.sagittalSequence,
    source: side.sagittalSequenceSource,
    description: side.sagittalSequenceDescription,
  });
}

/** Lo que se envía al cargar: sin declaración (o «Desconocida») no viaja nada y todo sigue como siempre. */
export function declarationFields(choice: SequenceChoice): { sequence?: string; sequenceDescription?: string } {
  if (choice.value === "unknown") return {};
  if (choice.value === "other") return { sequence: "other", sequenceDescription: choice.description.trim() };
  return { sequence: choice.value };
}

/** Por qué la declaración no se puede enviar (o cadena vacía). Solo «Otra» exige descripción. */
export function declarationIssue(choice: SequenceChoice): string {
  if (choice.value !== "other") return "";
  const text = choice.description.trim();
  if (!text) return "Describí la secuencia (por ejemplo, STIR sagital).";
  if (text.length > MAX_SEQUENCE_DESCRIPTION) return `La descripción admite hasta ${MAX_SEQUENCE_DESCRIPTION} caracteres.`;
  return "";
}

/** Clave estable de una declaración, para saber si lo cargado corresponde a lo que el selector muestra hoy. */
export function declarationKey(choice: SequenceChoice): string {
  return choice.value === "other" ? `other:${choice.description.trim()}` : choice.value;
}

/** ¿Dos lados coinciden de forma que el comparador pueda usarlos? Solo T1/T2 iguales; «Otra» nunca. */
export function sequencesMatch(a: SequenceInfo, b: SequenceInfo): boolean {
  return (a.value === "t1" || a.value === "t2") && a.value === b.value;
}

/**
 * Secuencia de un plano de una corrida persistida: lo que la corrida publicó en `input.sequence`. Una corrida
 * anterior (sin el dato) cae al catálogo del estudio si lo conoce; si no, desconocida.
 */
export function sequenceOfPlaneRun(planeInput: unknown, catalogueWeighting?: unknown): SequenceInfo {
  const input = planeInput && typeof planeInput === "object" ? planeInput as Record<string, unknown> : undefined;
  if (input && "sequence" in input && input.sequence && typeof input.sequence === "object") {
    return parseSequenceInfo(input.sequence);
  }
  return sequenceFromWeighting(catalogueWeighting);
}

/**
 * Qué dice la comparación sobre la secuencia de los dos lados. Cuando coinciden en T1/T2 aclara qué es esa
 * coincidencia (una declaración o una detección) y qué no garantiza. Si falta en un lado, o alguno es «Otra»,
 * lo dice sin tratar «desconocida» ni «Otra» como iguales.
 */
export function sequenceComparisonNote(reference: SequenceInfo, current: SequenceInfo): string {
  if (sequencesMatch(reference, current)) {
    const declared = reference.source === "user_declared" || current.source === "user_declared";
    return `Secuencia sagital ${sequenceLabel(current)} en ambos estudios (referencia: ${sequenceProvenanceLabel(reference)}; actual: ${sequenceProvenanceLabel(current)}). `
      + (declared ? "Es una declaración, no una detección automática ni una validación del modelo. " : "")
      + "Coincidir en ponderación no garantiza el mismo protocolo, equipo, resolución ni corte.";
  }
  if (!isKnownSequence(reference) || !isKnownSequence(current)) {
    return "La secuencia sagital no está informada en uno de los estudios: sin ese dato no se puede demostrar que se midió sobre la misma.";
  }
  if (reference.value === "other" || current.value === "other") {
    return "Una de las series está declarada como «Otra»: no se puede demostrar que sea la misma secuencia que la del otro estudio.";
  }
  return `Secuencias distintas (${sequenceLabel(reference)} en la referencia, ${sequenceLabel(current)} en el estudio abierto).`;
}
