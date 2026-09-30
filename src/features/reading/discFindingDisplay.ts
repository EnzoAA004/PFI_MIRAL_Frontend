import type { DeploymentStatus, DiscFindingType, DiscSeriesRole } from "./discDegenerativeFindings";

export const DISC_FINDING_LABELS: Record<DiscFindingType, string> = {
  disc_bulging: "Abombamiento discal",
  disc_narrowing: "Estrechamiento discal",
  upper_endplate_change: "Cambio del platillo superior",
  lower_endplate_change: "Cambio del platillo inferior",
  pfirrmann_grade: "Grado de Pfirrmann",
  modic_change: "Cambio Modic",
  disc_herniation: "Hernia discal",
  spondylolisthesis: "Espondilolistesis",
};

export const DEPLOYMENT_LABELS: Record<DeploymentStatus, string> = {
  supported_internal: "Validación interna",
  experimental: "Experimental",
  not_product_supported: "Investigación",
};

export const DEPLOYMENT_NOTES: Record<DeploymentStatus, string> = {
  supported_internal:
    "Evaluado sobre el conjunto interno del proyecto. No cuenta con validación externa.",
  experimental:
    "Resultado experimental visible únicamente para revisión profesional.",
  not_product_supported:
    "Resultado de investigación. No es una capacidad soportada para producto y se conserva separada únicamente para análisis y trazabilidad.",
};

const DISC_FINDING_VALUE_LABELS: Record<string, string> = {
  present: "Presente",
  absent: "Ausente",
};

/** Traduce sólo la presentación; el valor contractual permanece intacto. */
export function displayDiscFindingValue(value: string): string {
  return DISC_FINDING_VALUE_LABELS[value] ?? value;
}

/**
 * La confianza del hallazgo, con el mismo formato que ya usan las mediciones
 * (`formatTechnicalConfidence`): un porcentaje con un decimal y coma decimal.
 *
 * Una corrida sin confianza informada lo dice en vez de mostrar un guion: el
 * lector tiene que poder distinguir "el modelo no estaba seguro" de "esta corrida
 * no publica ese dato", y las corridas anteriores a este cambio son del segundo
 * tipo.
 */
export function displayDiscFindingConfidence(value?: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1).replace(".", ",")} %`
    : "Confianza no informada";
}

export function startsCollapsed(status: DeploymentStatus): boolean {
  return status === "not_product_supported";
}

export const DEPLOYMENT_ORDER: DeploymentStatus[] = [
  "supported_internal",
  "experimental",
  "not_product_supported",
];

export const DISC_FINDINGS_NOTICE =
  "Resultado generado por IA y sujeto a revisión profesional. No constituye un diagnóstico clínico autónomo.";

export const DISC_SERIES_ROLE_LABELS: Record<DiscSeriesRole, string> = {
  sagittal_t1: "Sagital T1",
  sagittal_t2: "Sagital T2",
};

/**
 * Qué afirma la marca sobre el corte.
 *
 * Se dice donde se la ofrece y no solo en el aviso general: el que va a mirar la
 * cruz sobre la imagen la lee como "acá está lo que encontró". El modelo clasifica
 * sobre una ventana centrada en el disco y no segmenta lesión, así que la marca
 * ubica lo evaluado, no la extensión del hallazgo.
 */
export const DISC_REGION_NOTICE =
  "La marca señala la región que se evaluó para este nivel, no la extensión del hallazgo.";
