import type { Priority, StudyMetadataInput } from "./appTypes";
import type { ResolvedAge } from "./studyAge";

export type StudyMetadataDraft = {
  subjectRef: string;
  studyDate: string;
  modality: string;
  description: string;
  reviewPriority: "low" | "medium" | "high";
  /* Opcionales: el dialogo de metadata de la sala de lectura no los maneja y no se toca. */
  patientId?: string;
  /** Edad que el usuario declara; vacia = no declara (se calcula si hay con que). */
  ageDeclared?: string;
  clinicalReason?: string;
  symptoms?: string;
  symptomDuration?: string;
  relevantHistory?: string;
};

export const subjectRefErrorMessage = "La referencia debe ser un código de-identificado de entre 3 y 64 caracteres, sin espacios.";

export function priorityToBackend(priority?: Priority | "low" | "medium" | "high"): StudyMetadataInput["reviewPriority"] {
  if (priority === "alta" || priority === "high") return "high";
  if (priority === "baja" || priority === "low") return "low";
  return "medium";
}

export function priorityFromBackend(priority?: StudyMetadataInput["reviewPriority"]): Priority {
  if (priority === "high") return "alta";
  if (priority === "low") return "baja";
  return "media";
}

export function validateSubjectRef(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length < 3 || trimmed.length > 64) return subjectRefErrorMessage;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return subjectRefErrorMessage;
  return null;
}

function textOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

/** `age` ya viene resuelta (ver studyAge.ts): aca no se calcula ni se elige entre valores. */
export function normalizeStudyMetadataInput(draft: StudyMetadataDraft, age?: ResolvedAge): StudyMetadataInput {
  const subjectRef = draft.subjectRef.trim();
  const description = draft.description.trim();
  const input: StudyMetadataInput = {
    subjectRef: subjectRef || null,
    studyDate: draft.studyDate || null,
    modality: draft.modality || null,
    description: description || null,
    reviewPriority: draft.reviewPriority,
  };
  // El paciente y el contexto clinico viajan solo si hay algo: el payload de un estudio sin
  // ellos queda identico al de siempre.
  const optional: Partial<StudyMetadataInput> = {
    patientId: textOrNull(draft.patientId),
    ageAtStudy: age?.value ?? null,
    ageProvenance: age?.provenance ?? null,
    clinicalReason: textOrNull(draft.clinicalReason),
    symptoms: textOrNull(draft.symptoms),
    symptomDuration: textOrNull(draft.symptomDuration),
    relevantHistory: textOrNull(draft.relevantHistory),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== null && value !== undefined) (input as Record<string, unknown>)[key] = value;
  }
  return input;
}

/** Borrador de la vista Nuevo estudio: todos los campos presentes. */
export type NewStudyDraft = Required<StudyMetadataDraft>;

export function emptyStudyMetadataDraft(priority: StudyMetadataInput["reviewPriority"] = "medium"): StudyMetadataDraft {
  return {
    subjectRef: "",
    studyDate: "",
    modality: "",
    description: "",
    reviewPriority: priority,
    patientId: "",
    ageDeclared: "",
    clinicalReason: "",
    symptoms: "",
    symptomDuration: "",
    relevantHistory: "",
  };
}

export function emptyNewStudyDraft(priority: StudyMetadataInput["reviewPriority"] = "medium"): NewStudyDraft {
  return { ...emptyStudyMetadataDraft(priority), patientId: "", ageDeclared: "", clinicalReason: "", symptoms: "", symptomDuration: "", relevantHistory: "" };
}
