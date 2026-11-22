import { multiplanarRequest } from "./multiplanarApi";

/**
 * EXT-05: cliente de la superficie de curación de feedback profesional construida sobre el
 * `ProfessionalFeedbackCandidate` de solo captura de EXT-07D/EXT-04B5. Deliberadamente nunca envía un `curatorId` — el
 * Backend siempre lo deriva del JWT (el propio patrón de derivación de identidad de
 * `EvidenceRegionAnnotationController`, reutilizado textualmente por `ProfessionalFeedbackController.curate`).
 */

export const FEEDBACK_CANDIDATE_STATUSES = ["captured", "eligible_for_curation", "excluded", "curated"] as const;
export type FeedbackCandidateStatus = (typeof FEEDBACK_CANDIDATE_STATUSES)[number];

export type ProfessionalFeedbackCandidate = {
  id: string;
  caseId: string;
  analysisRunId: string;
  source: string;
  correctionId: string;
  level: string | null;
  plane: string | null;
  structure: string | null;
  metric: string | null;
  geometryType: string | null;
  aiOriginalValue: number | null;
  aiOriginalGeometry: Record<string, unknown> | null;
  professionalValue: number | null;
  professionalGeometry: Record<string, unknown> | null;
  modelId: string | null;
  modelSha256: string | null;
  pipelineVersion: string | null;
  note: string | null;
  status: FeedbackCandidateStatus | string;
  correctedAt: string;
  capturedAt: string;
  curatedAt: string | null;
  exclusionReason: string | null;
};

export type FeedbackCandidateFilter = {
  state?: string;
  type?: string;
  level?: string;
  plane?: string;
  model?: string;
  from?: string;
  to?: string;
};

function query(filter?: FeedbackCandidateFilter): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  if (filter.state) params.set("state", filter.state);
  if (filter.type) params.set("type", filter.type);
  if (filter.level) params.set("level", filter.level);
  if (filter.plane) params.set("plane", filter.plane);
  if (filter.model) params.set("model", filter.model);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function captureFeedback(caseId: string): Promise<ProfessionalFeedbackCandidate[]> {
  return multiplanarRequest<ProfessionalFeedbackCandidate[]>(`/api/studies/${encodeURIComponent(caseId)}/feedback/capture`, { method: "POST" });
}

export function listFeedbackCandidates(caseId: string, filter?: FeedbackCandidateFilter): Promise<ProfessionalFeedbackCandidate[]> {
  return multiplanarRequest<ProfessionalFeedbackCandidate[]>(`/api/studies/${encodeURIComponent(caseId)}/feedback-candidates${query(filter)}`);
}

export type CandidateStatusChange = {
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  note: string | null;
  changedAt: string;
};

export function getFeedbackCandidateHistory(candidateId: string): Promise<CandidateStatusChange[]> {
  return multiplanarRequest<CandidateStatusChange[]>(`/api/feedback-candidates/${encodeURIComponent(candidateId)}/history`);
}

export function curateFeedbackCandidate(candidateId: string, status: FeedbackCandidateStatus, reason?: string, note?: string): Promise<ProfessionalFeedbackCandidate> {
  return multiplanarRequest<ProfessionalFeedbackCandidate>(`/api/feedback-candidates/${encodeURIComponent(candidateId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason: reason ?? null, note: note ?? null }),
  });
}

export type FeedbackDatasetExport = {
  schemaVersion: string;
  exportedAt: string;
  candidateCount: number;
  sourceModelVersions: string[];
  records: ProfessionalFeedbackCandidate[];
  manifestChecksum: string;
};

export function exportFeedbackDataset(caseId: string, filter?: FeedbackCandidateFilter): Promise<FeedbackDatasetExport> {
  return multiplanarRequest<FeedbackDatasetExport>(`/api/studies/${encodeURIComponent(caseId)}/feedback/export${query(filter)}`);
}

/** Delta numérico para un candidato originado en una medición; null cuando falta algún lado o la fuente no es una medición. */
export function feedbackValueDelta(candidate: ProfessionalFeedbackCandidate): number | null {
  if (candidate.aiOriginalValue === null || candidate.professionalValue === null) return null;
  return candidate.professionalValue - candidate.aiOriginalValue;
}

const SOURCE_LABELS: Record<string, string> = {
  measurement: "Medición corregida",
  evidence_region: "Región de evidencia corregida",
  professional_new_finding: "Hallazgo creado por profesional",
  rejected_ai_suggestion: "Sugerencia de IA rechazada",
};

export function displayFeedbackSource(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

const STATUS_LABELS: Record<string, string> = {
  captured: "Capturado",
  eligible_for_curation: "Elegible para curación",
  excluded: "Excluido",
  curated: "Curado",
};

export function displayFeedbackStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
