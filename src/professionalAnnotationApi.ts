import type { EvidenceGeometry, EvidenceGeometryType } from "./contracts/visualEvidenceTypes";
import { parseEvidenceGeometry } from "./studyReportApi";
import { multiplanarRequest } from "./multiplanarApi";

/**
 * EXT-04B5: client for the two new professional-annotation write endpoints
 * (`EvidenceRegionAnnotationController`, Backend `extensions/ext-04b5-professional-annotations-backend`).
 * Deliberately never sends `origin`/`authoredBy`/`reviewedBy` — the Backend derives identity from
 * the JWT and rejects a client-declared `origin=ai` at the DTO level (`CreateProfessionalEvidenceRegionRequestDto`
 * has no `origin` field at all). Mirrors `studyReportApi.ts`'s tolerant-parsing convention, reusing
 * the same `parseEvidenceGeometry` so a malformed response geometry never crashes the caller.
 */

export class ProfessionalAnnotationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfessionalAnnotationContractError";
  }
}

export type CreateProfessionalEvidenceRegionRequest = {
  plane: "sagittal" | "axial" | null;
  level: string | null;
  structure: string | null;
  sliceIndex: number | null;
  geometryType: EvidenceGeometryType;
  geometry: Record<string, unknown>;
  label: string | null;
  note: string | null;
};

export type CorrectEvidenceRegionRequest = {
  geometryType: EvidenceGeometryType;
  geometry: Record<string, unknown>;
  comment: string | null;
};

export type EvidenceRegionResponse = {
  evidenceId: string;
  analysisRunId: string;
  plane: string | null;
  level: string | null;
  structure: string | null;
  sliceIndex: number | null;
  origin: "ai" | "professional";
  geometryType: EvidenceGeometryType;
  geometry: EvidenceGeometry;
  label: string | null;
  experimental: boolean;
  createdAt: string;
};

export type EvidenceRegionCorrectionResponse = {
  correctionId: string;
  evidenceRegionId: string;
  analysisRunId: string;
  originalGeometryType: EvidenceGeometryType;
  originalGeometry: EvidenceGeometry;
  correctedGeometryType: EvidenceGeometryType;
  correctedGeometry: EvidenceGeometry;
  comment: string | null;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function requiredText(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ProfessionalAnnotationContractError(`Respuesta inválida: falta ${field}.`);
  }
  return value;
}

function nullableText(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  return typeof value === "string" ? value : null;
}

function nullableInteger(raw: Record<string, unknown>, field: string): number | null {
  const value = raw[field];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredGeometryType(raw: Record<string, unknown>, field: string): EvidenceGeometryType {
  const value = raw[field];
  if (value !== "BBOX" && value !== "ELLIPSE" && value !== "POLYGON" && value !== "MASK_REFERENCE") {
    throw new ProfessionalAnnotationContractError(`Respuesta inválida: ${field} no es un tipo de geometría conocido.`);
  }
  return value;
}

function requiredGeometry(raw: Record<string, unknown>, typeField: string, geometryField: string): EvidenceGeometry {
  const geometry = parseEvidenceGeometry(raw[typeField], raw[geometryField]);
  if (!geometry) throw new ProfessionalAnnotationContractError(`Respuesta inválida: ${geometryField} no coincide con ${typeField}.`);
  return geometry;
}

export function parseEvidenceRegionResponse(value: unknown): EvidenceRegionResponse {
  const raw = asRecord(value);
  if (!raw) throw new ProfessionalAnnotationContractError("Respuesta vacía al crear/leer la región.");
  const origin = raw.origin;
  if (origin !== "ai" && origin !== "professional") {
    throw new ProfessionalAnnotationContractError("Respuesta inválida: origin desconocido.");
  }
  return {
    evidenceId: requiredText(raw, "evidenceId"),
    analysisRunId: requiredText(raw, "analysisRunId"),
    plane: nullableText(raw, "plane"),
    level: nullableText(raw, "level"),
    structure: nullableText(raw, "structure"),
    sliceIndex: nullableInteger(raw, "sliceIndex"),
    origin,
    geometryType: requiredGeometryType(raw, "geometryType"),
    geometry: requiredGeometry(raw, "geometryType", "geometry"),
    label: nullableText(raw, "label"),
    experimental: raw.experimental === true,
    createdAt: requiredText(raw, "createdAt"),
  };
}

export function parseEvidenceRegionCorrectionResponse(value: unknown): EvidenceRegionCorrectionResponse {
  const raw = asRecord(value);
  if (!raw) throw new ProfessionalAnnotationContractError("Respuesta vacía al corregir la región.");
  return {
    correctionId: requiredText(raw, "correctionId"),
    evidenceRegionId: requiredText(raw, "evidenceRegionId"),
    analysisRunId: requiredText(raw, "analysisRunId"),
    originalGeometryType: requiredGeometryType(raw, "originalGeometryType"),
    originalGeometry: requiredGeometry(raw, "originalGeometryType", "originalGeometry"),
    correctedGeometryType: requiredGeometryType(raw, "correctedGeometryType"),
    correctedGeometry: requiredGeometry(raw, "correctedGeometryType", "correctedGeometry"),
    comment: nullableText(raw, "comment"),
    createdAt: requiredText(raw, "createdAt"),
  };
}

function evidenceRegionsPath(caseId: string, analysisRunId: string): string {
  return `/api/studies/${encodeURIComponent(caseId)}/product-analyses/${encodeURIComponent(analysisRunId)}/evidence-regions`;
}

export async function createProfessionalEvidenceRegion(
  caseId: string,
  analysisRunId: string,
  request: CreateProfessionalEvidenceRegionRequest,
): Promise<EvidenceRegionResponse> {
  const raw = await multiplanarRequest<unknown>(evidenceRegionsPath(caseId, analysisRunId), {
    method: "POST",
    body: JSON.stringify(request),
  });
  return parseEvidenceRegionResponse(raw);
}

export async function correctEvidenceRegion(
  caseId: string,
  analysisRunId: string,
  regionId: string,
  request: CorrectEvidenceRegionRequest,
): Promise<EvidenceRegionCorrectionResponse> {
  const raw = await multiplanarRequest<unknown>(`${evidenceRegionsPath(caseId, analysisRunId)}/${encodeURIComponent(regionId)}/corrections`, {
    method: "POST",
    body: JSON.stringify(request),
  });
  return parseEvidenceRegionCorrectionResponse(raw);
}
