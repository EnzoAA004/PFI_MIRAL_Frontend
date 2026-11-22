import { useCallback, useEffect, useState } from "react";
import {
  captureFeedback,
  curateFeedbackCandidate,
  displayFeedbackSource,
  displayFeedbackStatus,
  exportFeedbackDataset,
  feedbackValueDelta,
  listFeedbackCandidates,
  type FeedbackCandidateStatus,
  type ProfessionalFeedbackCandidate,
} from "../../professionalFeedbackCurationApi";

/**
 * EXT-05: "Feedback / Curación" — convierte los candidatos de solo captura que EXT-07D/EXT-04B5 ya
 * producen en un paso explícito de curación humana. Nunca entrena nada, nunca eleva automáticamente el estado de un
 * candidato; cada acción acá es un clic deliberado de un profesional autenticado
 * (aplicado del lado del Backend por `RoleAuthorizationService.requireProfessional`, no reimplementado
 * acá) que se agrega al historial append-only propio de `ProfessionalFeedbackCaptureService`.
 */
export function FeedbackCurationPanel({ caseId }: { caseId: string }) {
  const [candidates, setCandidates] = useState<ProfessionalFeedbackCandidate[]>([]);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [exportError, setExportError] = useState("");

  const refresh = useCallback(() => {
    setPhase("loading");
    setError("");
    listFeedbackCandidates(caseId, { state: stateFilter || undefined, type: typeFilter || undefined })
      .then((rows) => {
        setCandidates(rows);
        setPhase("ready");
      })
      .catch((thrown: unknown) => {
        setPhase("error");
        setError(thrown instanceof Error ? thrown.message : "No se pudieron cargar los candidatos de feedback.");
      });
  }, [caseId, stateFilter, typeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runCapture() {
    setError("");
    try {
      await captureFeedback(caseId);
      refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? `No se pudo capturar feedback nuevo: ${thrown.message}` : "No se pudo capturar feedback nuevo.");
    }
  }

  async function curate(id: string, status: FeedbackCandidateStatus) {
    setBusyId(id);
    setError("");
    try {
      await curateFeedbackCandidate(id, status, status === "excluded" ? reasonDrafts[id] : undefined);
      refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? `No se pudo actualizar el estado: ${thrown.message}` : "No se pudo actualizar el estado.");
    } finally {
      setBusyId(null);
    }
  }

  async function runExport() {
    setExportError("");
    try {
      const dataset = await exportFeedbackDataset(caseId, { state: stateFilter || undefined, type: typeFilter || undefined });
      const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `feedback-dataset-${caseId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (thrown) {
      setExportError(thrown instanceof Error ? `No se pudo exportar: ${thrown.message}` : "No se pudo exportar el dataset de feedback.");
    }
  }

  return (
    <div className="feedback-curation-panel">
      <p className="rr-note">
        Candidatos de feedback ya capturados por el sistema (correcciones profesionales, regiones
        creadas, sugerencias rechazadas). Curar acá NO reentrena el modelo: solo clasifica material
        para una eventual curación de dataset futura, siempre con intervención humana.
      </p>
      <div className="feedback-curation-actions">
        <button type="button" onClick={() => void runCapture()} data-testid="feedback-capture-button">
          Capturar feedback nuevo
        </button>
        <button type="button" onClick={() => void runExport()} data-testid="feedback-export-button">
          Exportar dataset (JSON)
        </button>
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} data-testid="feedback-filter-state">
          <option value="">Todos los estados</option>
          <option value="captured">Capturado</option>
          <option value="eligible_for_curation">Elegible para curación</option>
          <option value="excluded">Excluido</option>
          <option value="curated">Curado</option>
        </select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} data-testid="feedback-filter-type">
          <option value="">Todos los tipos</option>
          <option value="measurement">Medición</option>
          <option value="evidence_region">Región de evidencia</option>
          <option value="professional_new_finding">Hallazgo profesional</option>
          <option value="rejected_ai_suggestion">Sugerencia rechazada</option>
        </select>
      </div>
      {exportError && <p className="rr-note rr-export-error">{exportError}</p>}
      {phase === "loading" && <p className="rr-note">Cargando candidatos...</p>}
      {phase === "error" && <p className="rr-note rr-export-error">{error}</p>}
      {phase === "ready" && candidates.length === 0 && <p className="rr-note" data-testid="feedback-empty">No hay candidatos de feedback para este estudio con los filtros elegidos.</p>}
      {phase === "ready" && candidates.length > 0 && (
        <table className="feedback-curation-table" data-testid="feedback-candidate-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Nivel / Plano</th>
              <th>AI original</th>
              <th>Profesional</th>
              <th>Delta</th>
              <th>Modelo</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const delta = feedbackValueDelta(candidate);
              return (
                <tr key={candidate.id} data-testid={`feedback-row-${candidate.id}`}>
                  <td>{displayFeedbackSource(candidate.source)}</td>
                  <td>{candidate.level ?? "—"} · {candidate.plane ?? "—"}</td>
                  <td>{candidate.aiOriginalValue ?? (candidate.aiOriginalGeometry ? candidate.geometryType : "—")}</td>
                  <td>{candidate.professionalValue ?? (candidate.professionalGeometry ? candidate.geometryType : "—")}</td>
                  <td>{delta === null ? "—" : delta.toFixed(2)}</td>
                  <td>{candidate.modelId ?? "—"}</td>
                  <td>
                    {displayFeedbackStatus(candidate.status)}
                    {candidate.status === "excluded" && candidate.exclusionReason && (
                      <span className="feedback-exclusion-reason"> — {candidate.exclusionReason}</span>
                    )}
                  </td>
                  <td className="feedback-curation-row-actions">
                    <button type="button" disabled={busyId === candidate.id} onClick={() => void curate(candidate.id, "eligible_for_curation")} data-testid={`feedback-eligible-${candidate.id}`}>
                      Marcar elegible
                    </button>
                    <input
                      type="text"
                      placeholder="Motivo de exclusión"
                      value={reasonDrafts[candidate.id] ?? ""}
                      onChange={(event) => setReasonDrafts((current) => ({ ...current, [candidate.id]: event.target.value }))}
                      data-testid={`feedback-exclusion-reason-${candidate.id}`}
                    />
                    <button type="button" disabled={busyId === candidate.id} onClick={() => void curate(candidate.id, "excluded")} data-testid={`feedback-exclude-${candidate.id}`}>
                      Excluir
                    </button>
                    <button type="button" disabled={busyId === candidate.id} onClick={() => void curate(candidate.id, "curated")} data-testid={`feedback-curate-${candidate.id}`}>
                      Marcar curado
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
