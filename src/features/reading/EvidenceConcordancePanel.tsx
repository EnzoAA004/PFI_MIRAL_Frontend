import { useState } from "react";
import { evaluateConcordance, displayConcordanceSentence, type ConcordanceResult, type EvidenceItemInput } from "../../concordanceApi";
import type { DegenerativeFinding } from "./degenerativeFindings";

/**
 * EXT-01: "Concordancia de evidencia" — compara las dos clasificaciones genuinamente independientes
 * que este producto puede producir para el mismo (nivel, lado, fenómeno): una corrida por lote de
 * hallazgos degenerativos de nivel de disco y una clasificación de ROI subarticular a demanda (ambas
 * instancias reales de `DegenerativeFindingsV1Dto`, ver la auditoría del Backend). Nunca afirma "confirmado por dos
 * IAs" — siempre la oración neutral "las fuentes de evidencia son X según la regla Y".
 */
export function EvidenceConcordancePanel({
  caseId, batchFindings, roiFindings,
}: {
  caseId: string;
  batchFindings: DegenerativeFinding[];
  roiFindings: DegenerativeFinding[];
}) {
  const [results, setResults] = useState<ConcordanceResult[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  function toEvidenceItem(finding: DegenerativeFinding, source: string): EvidenceItemInput {
    return {
      id: finding.findingId,
      source,
      modelId: finding.modelId,
      level: finding.level,
      side: finding.side,
      phenomenon: finding.findingType,
      finding: finding.label,
      experimental: finding.researchOnly,
      reviewStatus: finding.reviewStatus,
    };
  }

  async function runConcordance() {
    setPhase("loading");
    setError("");
    try {
      const evidence = [
        ...batchFindings.map((finding) => toEvidenceItem(finding, "disc_level_batch")),
        ...roiFindings.map((finding) => toEvidenceItem(finding, "subarticular_roi")),
      ];
      const computed = await evaluateConcordance(caseId, evidence);
      setResults(computed);
      setPhase("ready");
    } catch (thrown) {
      setPhase("error");
      setError(thrown instanceof Error ? thrown.message : "No se pudo calcular la concordancia de evidencia.");
    }
  }

  const totalAvailable = batchFindings.length + roiFindings.length;

  return (
    <div className="concordance-panel">
      <p className="rr-note">
        Compara únicamente fuentes de evidencia realmente equiparables: mismo fenómeno, mismo
        nivel y mismo lado. Nunca combina hallazgos de tipos distintos ni infiere un diagnóstico.
      </p>
      <button type="button" onClick={() => void runConcordance()} disabled={totalAvailable === 0} data-testid="concordance-run-button">
        Calcular concordancia
      </button>
      {totalAvailable === 0 && <p className="rr-note" data-testid="concordance-no-evidence">Sin hallazgos clasificados disponibles todavía para comparar.</p>}
      {phase === "loading" && <p className="rr-note">Calculando...</p>}
      {phase === "error" && <p className="rr-note rr-export-error">{error}</p>}
      {phase === "ready" && results && (
        results.length === 0 ? (
          <p className="rr-note" data-testid="concordance-empty">Sin grupos de evidencia comparables.</p>
        ) : (
          <ul className="concordance-results-list" data-testid="concordance-results-list">
            {results.map((result, index) => (
              <li key={index} className={`concordance-result concordance-result-${result.state.toLowerCase()}`}>
                {displayConcordanceSentence(result)}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
