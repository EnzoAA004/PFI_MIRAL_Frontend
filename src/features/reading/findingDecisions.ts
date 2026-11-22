import { useCallback, useEffect, useState } from "react";
import { multiplanarRequest } from "../../multiplanarApi";

/**
 * Decisión del profesional sobre un hallazgo propuesto por la IA: aceptado, rechazado o dudoso.
 * Sin decisión = "sin revisar". No modifica la predicción original ni el estado de revisión del estudio.
 */
export type FindingDecisionValue = "aceptado" | "rechazado" | "dudoso";

export const FINDING_DECISION_VALUES: FindingDecisionValue[] = ["aceptado", "dudoso", "rechazado"];

export const FINDING_DECISION_ACTION_LABELS: Record<FindingDecisionValue, string> = {
  aceptado: "Aceptar",
  dudoso: "Dudoso",
  rechazado: "Rechazar",
};

export const FINDING_DECISION_STATE_LABELS: Record<FindingDecisionValue, string> = {
  aceptado: "Aceptado por el profesional",
  dudoso: "Marcado como dudoso por el profesional",
  rechazado: "Rechazado por el profesional",
};

export type FindingDecisionMap = Record<string, FindingDecisionValue>;

/** Misma clave que usa el preinforme para el hallazgo (`f:` + findingId). */
export function findingDecisionKey(findingId: string): string {
  return `f:${findingId}`;
}

function isDecision(value: unknown): value is FindingDecisionValue {
  return value === "aceptado" || value === "rechazado" || value === "dudoso";
}

/** Fail-closed: lo que no tiene el formato esperado se descarta, nunca se interpreta. */
export function parseFindingDecisions(value: unknown): FindingDecisionMap {
  const result: FindingDecisionMap = {};
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.findingKey === "string" && entry.findingKey && isDecision(entry.decision)) {
      result[entry.findingKey] = entry.decision;
    }
  }
  return result;
}

const base = (caseId: string, runId: string) =>
  `/api/studies/${encodeURIComponent(caseId)}/finding-decisions?runId=${encodeURIComponent(runId)}`;

export async function getFindingDecisions(caseId: string, runId: string): Promise<FindingDecisionMap> {
  return parseFindingDecisions(await multiplanarRequest<unknown>(base(caseId, runId)));
}

export async function putFindingDecision(
  caseId: string,
  runId: string,
  findingKey: string,
  decision: FindingDecisionValue | null,
): Promise<FindingDecisionMap> {
  return parseFindingDecisions(
    await multiplanarRequest<unknown>(base(caseId, runId), {
      method: "PUT",
      body: JSON.stringify({ findingKey, decision }),
    }),
  );
}

export type FindingDecisionsState = {
  decisions: FindingDecisionMap;
  /** Clave del hallazgo que se está guardando ahora. */
  busyKey: string | null;
  error: string;
  /** `null` quita la decisión. */
  decide: (findingKey: string, decision: FindingDecisionValue | null) => Promise<void>;
};

/** Carga las decisiones de la corrida y las guarda de a una. Sin caseId/runId no hace nada. */
export function useFindingDecisions(caseId: string | undefined, runId: string | undefined): FindingDecisionsState {
  const [decisions, setDecisions] = useState<FindingDecisionMap>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDecisions({});
    setError("");
    if (!caseId || !runId) return undefined;
    let cancelled = false;
    getFindingDecisions(caseId, runId)
      .then((loaded) => { if (!cancelled) setDecisions(loaded); })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? `No se pudieron cargar tus decisiones: ${loadError.message}` : "No se pudieron cargar tus decisiones.");
      });
    return () => { cancelled = true; };
  }, [caseId, runId]);

  const decide = useCallback(async (findingKey: string, decision: FindingDecisionValue | null) => {
    if (!caseId || !runId) return;
    setBusyKey(findingKey);
    setError("");
    try {
      setDecisions(await putFindingDecision(caseId, runId, findingKey, decision));
    } catch (saveError) {
      setError(saveError instanceof Error ? `No se guardó la decisión: ${saveError.message}` : "No se guardó la decisión.");
    } finally {
      setBusyKey(null);
    }
  }, [caseId, runId]);

  return { decisions, busyKey, error, decide };
}
