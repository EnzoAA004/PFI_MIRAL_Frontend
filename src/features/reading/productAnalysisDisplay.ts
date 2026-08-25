/**
 * Presentación pura para el análisis de producto Post-E50 (`pfi.ai-product-result.v1`).
 * Ninguna función de acá cambia el valor contractual persistido — sólo eligen qué texto
 * mostrar. El dato crudo (`level`, `areaMm2`, etc.) sigue disponible tal cual en el estado.
 *
 * Nunca usar las palabras "diagnóstico confirmado"/"diagnóstico automático"/"normal" (sin
 * matices) acá — ver `productAnalysisV1-tests.mjs`, test "sin diagnóstico indebido".
 */

const KNOWN_WARNING_LABELS: Record<string, string> = {
  "67B2_RUNTIME_PARITY_NOT_PROVEN": "Localización automática de nivel no disponible en esta versión.",
  "67C_RUNTIME_PARITY_NOT_PROVEN": "Emparejamiento automático sagital-axial no disponible en esta versión.",
};

/** Mapea un código de warning a texto entendible; un código desconocido nunca rompe la UI. */
export function displayProductAnalysisWarning(code: string): string {
  return KNOWN_WARNING_LABELS[code] ?? code;
}

export const DISC_LEVEL_UNASSIGNED_TEXT = "Nivel no asignado automáticamente.";

/** `level` puede ser `null` por contrato — nunca se muestra "null"/"undefined"/un valor inventado. */
export function displayDiscLevel(level: string | null): string {
  return level ?? DISC_LEVEL_UNASSIGNED_TEXT;
}

const LOCALIZATION_STATUS_TEXT: Record<string, string> = {
  localized: "Nivel localizado.",
  abstained: "El sistema se abstuvo de asignar un nivel.",
  unavailable: "Localización automática no disponible.",
  not_requested: "Localización automática no solicitada.",
};

/** 67B2. `localized` sigue mostrando el nivel (vía `displayDiscLevel`); esto es el estado. */
export function displayLocalizationStatus(status: string | null): string {
  if (!status) return LOCALIZATION_STATUS_TEXT.unavailable;
  return LOCALIZATION_STATUS_TEXT[status] ?? "Estado de localización no reconocido.";
}

const AXIAL_PAIRING_STATUS_TEXT: Record<string, string> = {
  paired: "Emparejamiento sagital-axial disponible.",
  adapter_pending: "Emparejamiento sagital-axial pendiente.",
  experimental: "Emparejamiento sagital-axial experimental.",
  unavailable: "Emparejamiento sagital-axial no disponible.",
  rejected: "Emparejamiento sagital-axial rechazado.",
  not_requested: "Emparejamiento sagital-axial no solicitado.",
};

/**
 * 67C. Nunca incluye la palabra "Validado" cuando `validated=false` — eso sería mostrar un
 * badge de confianza que el propio contrato niega explícitamente.
 */
export function displayAxialPairingStatus(
  status: string | null,
  options: { validated: boolean; experimental: boolean; reviewRequired: boolean },
): string {
  const base = status ? AXIAL_PAIRING_STATUS_TEXT[status] ?? "Estado de emparejamiento no reconocido." : AXIAL_PAIRING_STATUS_TEXT.unavailable;
  if (options.experimental) return `${base} Resultado experimental: requiere revisión profesional.`;
  if (options.reviewRequired) return `${base} Requiere revisión profesional.`;
  return base;
}

/**
 * P10.7. `blocked_preprocessing_parity` es "capability no disponible", nunca "sin hallazgos"/
 * "normal" — mostrar eso sería inventar un resultado clínico negativo que nadie calculó.
 */
export function displayDegenerativeFindingsStatus(status: string | null): string {
  if (!status || status === "blocked_preprocessing_parity") {
    return "Evaluación automática de hallazgos degenerativos no disponible en esta versión.";
  }
  return "Estado de hallazgos degenerativos no reconocido.";
}

const REVIEW_STATUS_TEXT: Record<string, string> = {
  pending: "Pendiente de revisión.",
  in_review: "En revisión.",
  completed: "Revisión completada.",
};

export function displayReviewStatus(review: { required: boolean; status: string }): string {
  if (!review.required) return "No requiere revisión profesional.";
  return REVIEW_STATUS_TEXT[review.status] ?? "Pendiente de revisión.";
}

export const MORPHOMETRY_DISCLAIMER = "Mediciones automáticas sujetas a revisión profesional.";

export const PRODUCT_ANALYSIS_EMPTY_HISTORY_TEXT = "No hay análisis registrados para este estudio.";

export const PRODUCT_ANALYSIS_PROCESSING_TEXT = "Procesando estudio...";

/** Redondea sólo para mostrar — el valor crudo persistido no se toca en el estado. */
export function formatLengthMm(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} mm`;
}

export function formatAreaMm2(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} mm²`;
}
