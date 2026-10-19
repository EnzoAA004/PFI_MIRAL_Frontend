/**
 * Por qué falló la carga de un recurso (estudio, paciente) y qué se le dice a quien usa el sistema.
 *
 * Cada causa tiene su propio título y su propia salida: «no encontrado» no se reintenta, un servicio caído sí, una sesión
 * vencida pide volver a ingresar y un dato con formato inesperado se explica como tal. El detalle técnico (código HTTP, traza)
 * va aparte y plegado: ayuda a diagnosticar y nunca es la explicación principal. Nunca incluye tokens ni cabeceras.
 */

export type LoadFailureKind = "not_found" | "forbidden" | "session" | "service" | "contract" | "no_runs";

export type LoadFailure = {
  kind: LoadFailureKind;
  title: string;
  message: string;
  /** Código HTTP y traza, solo para diagnóstico. */
  detail: string | null;
  /** ¿Tiene sentido ofrecer «Reintentar»? */
  retryable: boolean;
};

type ErrorLike = { name?: unknown; status?: unknown; traceId?: unknown; message?: unknown; path?: unknown };

function describe(error: ErrorLike): string | null {
  const parts: string[] = [];
  if (typeof error.status === "number") parts.push(`HTTP ${error.status}`);
  if (typeof error.path === "string" && error.path) parts.push(error.path);
  if (typeof error.traceId === "string" && error.traceId) parts.push(`traza ${error.traceId}`);
  return parts.length ? parts.join(" · ") : null;
}

export function classifyLoadFailure(error: unknown, subject: "estudio" | "paciente", id: string): LoadFailure {
  const shaped = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const detail = describe(shaped);
  const status = typeof shaped.status === "number" ? shaped.status : null;
  const article = subject === "estudio" ? "el estudio" : "el paciente";
  const title404 = subject === "estudio" ? "Estudio no encontrado" : "Paciente no encontrado";
  if (status === 404) {
    return { kind: "not_found", title: title404, message: `No existe ${article} «${id}» o no tenés acceso a él. Revisá el enlace o buscalo desde la lista.`, detail, retryable: false };
  }
  if (status === 403) {
    return { kind: "forbidden", title: "Sin permisos", message: `Tu cuenta no tiene permiso para ver ${article} «${id}».`, detail, retryable: false };
  }
  if (status === 401) {
    return { kind: "session", title: "Tu sesión venció", message: "Ingresá de nuevo para continuar.", detail, retryable: false };
  }
  if (shaped.name === "ContractError") {
    return { kind: "contract", title: "Los datos recibidos no tienen el formato esperado", message: `No se pudo mostrar ${article} «${id}». Avisá al equipo con el detalle técnico.`, detail: detail ?? (typeof shaped.message === "string" ? shaped.message : null), retryable: true };
  }
  // Sin código HTTP (red caída) o 5xx: el servicio no respondió.
  return { kind: "service", title: subject === "estudio" ? "No se pudo cargar el estudio" : "No se pudo cargar el paciente", message: "El servicio no respondió. Verificá tu conexión y reintentá.", detail, retryable: true };
}

export function noRunsFailure(caseId: string): LoadFailure {
  return {
    kind: "no_runs",
    title: "El estudio todavía no tiene análisis",
    message: `El estudio «${caseId}» existe pero no tiene una corrida de análisis para revisar. Podés volver a la lista o cargar sus imágenes de nuevo desde «Nuevo estudio».`,
    detail: null,
    retryable: false,
  };
}

export function contractIssueFailure(message: string): LoadFailure {
  return { kind: "contract", title: "Los datos recibidos no tienen el formato esperado", message: "No se pudo mostrar el estudio. Avisá al equipo con el detalle técnico.", detail: message, retryable: true };
}

/** Un paciente con referencia válida: existe (sin estudios) o no existe, según la búsqueda de pacientes por referencia exacta. */
export function patientWithoutStudiesState(subjectRef: string, patientReferences: string[]): "exists_without_studies" | "not_found" {
  const wanted = subjectRef.trim().toLowerCase();
  return patientReferences.some((reference) => reference.trim().toLowerCase() === wanted) ? "exists_without_studies" : "not_found";
}
