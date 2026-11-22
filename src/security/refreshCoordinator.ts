/**
 * Coordinación single-flight para el refresh de sesión (P10-C.1 §3). Cada
 * sitio de llamada de refresh (api.ts, multiplanarApi.ts, studyApi.ts,
 * subjectHistoryApi.ts, pipelineContractApi.ts, reviewPersistenceApi.ts)
 * llama a authClient.refreshDoctorSession(), que pasa por este
 * coordinador para que los 401 concurrentes compartan un único refresh en vuelo en lugar de
 * competir en intercambios separados de refresh token.
 */

let inFlight: Promise<unknown> | null = null;

export function coordinateRefresh<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight) return inFlight as Promise<T>;
  const promise = run().finally(() => {
    inFlight = null;
  });
  inFlight = promise;
  return promise;
}
