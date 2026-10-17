import { multiplanarRequest } from "../../multiplanarApi";
import type { PreReportEdits, PreReportView } from "./prereportTypes";

/**
 * Cliente del preinforme. Ninguna de estas llamadas modifica la revisión del estudio, sus correcciones ni sus predicciones:
 * `GET` no escribe y `PUT`/`POST` escriben solo el borrador del preinforme.
 */

export class PreReportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreReportContractError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Valida lo imprescindible (fail-closed): sin esto el documento podría armarse con datos a medias. */
export function parsePreReportView(value: unknown): PreReportView {
  const raw = asRecord(value);
  const generated = asRecord(raw?.generated);
  if (!raw || !generated || generated.schema !== "pfi.prereport.v1") throw new PreReportContractError("Contrato de preinforme inválido: esquema inesperado.");
  for (const field of ["measurements", "findings", "levels", "series", "annotations", "omitted", "limitations"]) {
    if (!Array.isArray(generated[field])) throw new PreReportContractError(`Contrato de preinforme inválido: falta ${field}.`);
  }
  if (typeof raw.fingerprint !== "string" || !raw.fingerprint) throw new PreReportContractError("Contrato de preinforme inválido: falta la huella de las fuentes.");
  const draft = raw.draft === null || raw.draft === undefined ? null : asRecord(raw.draft);
  if (raw.draft && (!draft || typeof draft.version !== "number" || !asRecord(draft.generated) || !asRecord(draft.edits))) {
    throw new PreReportContractError("Contrato de preinforme inválido: borrador mal formado.");
  }
  return {
    generated: generated as unknown as PreReportView["generated"],
    fingerprint: raw.fingerprint,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date().toISOString(),
    usable: raw.usable === true,
    draft: draft as unknown as PreReportView["draft"],
    stale: raw.stale === true,
    changes: Array.isArray(raw.changes) ? (raw.changes as PreReportView["changes"]) : [],
    orphanedEdits: Array.isArray(raw.orphanedEdits) ? (raw.orphanedEdits as string[]) : [],
  };
}

const base = (caseId: string) => `/api/studies/${encodeURIComponent(caseId)}/prereport`;
const query = (runId: string) => `?runId=${encodeURIComponent(runId)}`;

export async function getPreReport(caseId: string, runId: string): Promise<PreReportView> {
  return parsePreReportView(await multiplanarRequest<unknown>(`${base(caseId)}${query(runId)}`));
}

export async function savePreReport(caseId: string, runId: string, expectedVersion: number | null, edits: PreReportEdits): Promise<PreReportView> {
  return parsePreReportView(await multiplanarRequest<unknown>(`${base(caseId)}${query(runId)}`, {
    method: "PUT",
    body: JSON.stringify({ expectedVersion, edits }),
  }));
}

/** Actualización EXPLÍCITA de las fuentes: conserva las ediciones. */
export async function updatePreReportSources(caseId: string, runId: string, expectedVersion: number): Promise<PreReportView> {
  return parsePreReportView(await multiplanarRequest<unknown>(`${base(caseId)}/update-sources${query(runId)}`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  }));
}
