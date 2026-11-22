/** Modelo de presentación de errores seguros (P10-C.1 §6). */

export type SafeFrontendError = {
  message: string;
  status?: number;
  code?: string;
  traceId?: string;
  suggestedAction?: "login" | "contact_admin" | "retry_later" | "check_input" | undefined;
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Revisá los datos ingresados: hay campos incompletos o no son válidos.",
  401: "La sesión venció o no es válida. Iniciá sesión nuevamente.",
  403: "No tenés permiso para realizar esta acción.",
  404: "El recurso solicitado no está disponible.",
  409: "Hay un conflicto con el estado actual del recurso.",
  413: "El archivo es demasiado grande.",
  415: "El formato del archivo no está permitido.",
  422: "Los datos enviados no cumplen el contrato esperado.",
  429: "Se realizaron demasiadas solicitudes. Esperá un momento e intentá de nuevo.",
};

export function fallbackForStatus(status?: number): string {
  if (status === undefined) return "No se pudo completar la operación.";
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status >= 500) return "El servicio no está disponible temporalmente. Intentá más tarde.";
  return "No se pudo completar la operación.";
}

function suggestedActionForStatus(status?: number): SafeFrontendError["suggestedAction"] {
  if (status === 401) return "login";
  if (status === 403) return "contact_admin";
  if (status === 413 || status === 415 || status === 422) return "check_input";
  if (status === 429) return "retry_later";
  if (status !== undefined && status >= 500) return "retry_later";
  return undefined;
}

// Patrones que indican que una excepción cruda de upstream, un stack trace, SQL, un path,
// un token o markup se filtró en un mensaje en lugar de uno curado. Nunca
// renderizar un mensaje que coincida con estos; recurrir al mapeo basado en el status.
const UNSAFE_MESSAGE_PATTERNS: RegExp[] = [
  /Exception/i,
  /Traceback/i,
  /\bat\s+[\w.$]+\(/,
  /\bSELECT\b[\s\S]*\bFROM\b/i,
  /jdbc:/i,
  /postgres(?:ql)?:\/\//i,
  /DATABASE_URL/i,
  /[A-Za-z]:\\/,
  /\/tmp\//,
  /\/app\//,
  /\/content\//,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // token con forma de JWT
  /<html/i,
  /<!DOCTYPE/i,
  /^\s*\{[\s\S]*"[a-zA-Z]+"\s*:/, // body JSON crudo filtrándose como texto
];

export function isUnsafeErrorText(text: string): boolean {
  return UNSAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

const FIELD_LABELS: Record<string, string> = {
  email: "Correo",
  password: "Contraseña",
  currentPassword: "Contraseña actual",
  newPassword: "Nueva contraseña",
  fullName: "Nombre completo",
  licenseNumber: "Matrícula",
  specialty: "Especialidad",
  institution: "Institución",
  challengeId: "Código de verificación",
  code: "Código de verificación",
  patientReference: "Código de paciente",
  firstName: "Nombre",
  lastName: "Apellido",
  dateOfBirth: "Fecha de nacimiento",
  caseId: "ID de caso",
};

/** El backend informa "campo: mensaje en inglés"; se traduce a una indicación que el usuario pueda seguir. */
function humanizeValidationMessage(candidate?: string): string | undefined {
  const field = candidate?.match(/^([A-Za-z0-9_.\[\]]+):/)?.[1]?.split(".").pop();
  const label = field ? FIELD_LABELS[field] : undefined;
  return label ? `Revisá el campo «${label}»: está vacío o no tiene un formato válido.` : undefined;
}

/** Elige un mensaje curado del backend cuando es seguro, de lo contrario el mapeo fijo por status. */
export function toSafeFrontendError(status: number | undefined, options: { code?: string; traceId?: string; candidateMessage?: string } = {}): SafeFrontendError {
  const { code, traceId, candidateMessage } = options;
  const safeCandidate = code === "VALIDATION_ERROR"
    ? humanizeValidationMessage(candidateMessage)
    : candidateMessage && !isUnsafeErrorText(candidateMessage) ? candidateMessage : undefined;
  return {
    message: safeCandidate ?? fallbackForStatus(status),
    status,
    code,
    traceId,
    suggestedAction: suggestedActionForStatus(status),
  };
}
