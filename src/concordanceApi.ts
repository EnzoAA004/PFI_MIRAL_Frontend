import { multiplanarRequest } from "./multiplanarApi";

/**
 * EXT-01: cliente del endpoint de concordancia sin estado. Nunca envía una afirmación diagnóstica; el
 * request solo lleva evidencia que quien llama ya tiene (de hallazgos por lote de niveles de disco,
 * clasificaciones de ROI subarticular a demanda, mediciones o estado de revisión).
 */

export type EvidenceItemInput = {
  id: string;
  source: string;
  modelId?: string | null;
  pipelineVersion?: string | null;
  level?: string | null;
  side?: string | null;
  plane?: string | null;
  phenomenon: string;
  finding?: string | null;
  value?: number | null;
  confidence?: number | null;
  experimental?: boolean;
  reviewStatus?: string | null;
};

export const CONCORDANCE_STATES = ["CONCORDANT", "PARTIALLY_CONCORDANT", "DISCREPANT", "INSUFFICIENT_EVIDENCE", "NOT_COMPARABLE"] as const;
export type ConcordanceState = (typeof CONCORDANCE_STATES)[number];

export type ConcordanceResult = {
  state: ConcordanceState | string;
  reasonCode: string;
  comparedEvidenceIds: string[];
  ruleVersion: string;
};

export function evaluateConcordance(caseId: string, evidence: EvidenceItemInput[]): Promise<ConcordanceResult[]> {
  return multiplanarRequest<ConcordanceResult[]>(`/api/studies/${encodeURIComponent(caseId)}/analytics/concordance`, {
    method: "POST",
    body: JSON.stringify({ evidence }),
  });
}

const STATE_LABELS: Record<string, string> = {
  CONCORDANT: "Concordante",
  PARTIALLY_CONCORDANT: "Parcialmente concordante",
  DISCREPANT: "Discrepante",
  INSUFFICIENT_EVIDENCE: "Evidencia insuficiente",
  NOT_COMPARABLE: "No comparable",
};

export function displayConcordanceState(state: string): string {
  return STATE_LABELS[state] ?? state;
}

const REASON_LABELS: Record<string, string> = {
  SAME_FINDING: "Mismo hallazgo en todas las fuentes",
  ADJACENT_SEVERITY_STEP: "Un escalón de diferencia en la severidad informada",
  SEVERITY_SPREAD_TWO_OR_MORE_STEPS: "Dos o más escalones de diferencia en la severidad informada",
  DIFFERENT_NON_ORDINAL_FINDINGS: "Hallazgos distintos sin una escala ordinal común",
  SINGLE_SOURCE_ONLY: "Solo una fuente de evidencia disponible",
  MIXED_CATEGORICAL_AND_NUMERIC_EVIDENCE: "Se mezclan evidencia categórica y numérica: no son comparables",
  NUMERIC_CONCORDANCE_RULE_NOT_DEFINED_IN_V1: "Aún no existe una regla de concordancia numérica definida",
};

export function displayConcordanceReason(reasonCode: string): string {
  return REASON_LABELS[reasonCode] ?? reasonCode;
}

/**
 * La oración neutral y no diagnóstica que esta funcionalidad siempre debe usar — "concordante según la
 * regla X", nunca "confirmado por dos IAs" (requisito explícito de EXT-01).
 */
export function displayConcordanceSentence(result: ConcordanceResult): string {
  return `Las fuentes de evidencia son ${displayConcordanceState(result.state).toLowerCase()} según la regla ${result.ruleVersion} (${displayConcordanceReason(result.reasonCode)}).`;
}
