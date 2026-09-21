import { useState } from "react";
import { requestSubarticularExplanation, type SubarticularExplainResult } from "../../multiplanarApi";
import type { SubarticularRoiDraft } from "./subarticularRoi";

/**
 * EXT-03: "Mapa de activación" — Grad-CAM heatmap for the subarticular classifier's own
 * prediction on the ROI a professional already marked. Off by default (a professional must
 * deliberately toggle it on). Never labeled "zona de la patología" or "explicación causal" —
 * always "mapa de activación asociado a la predicción", plus the Backend's own two disclaimers
 * rendered verbatim (the general safety one and the layer-scope one explaining this only covers
 * the visual branch of the model, not the side/level embeddings).
 */
export function ActivationMapPanel({
  inputId, roiDraft,
}: {
  inputId: string | null;
  roiDraft: SubarticularRoiDraft | null;
}) {
  const [enabled, setEnabled] = useState(false);
  const [opacity, setOpacity] = useState(0.6);
  const [result, setResult] = useState<SubarticularExplainResult | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  const canRequest = Boolean(inputId && roiDraft?.side && roiDraft?.level);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    if (!next || result || !canRequest || !inputId || !roiDraft || !roiDraft.side || !roiDraft.level) return;
    setPhase("loading");
    setError("");
    try {
      const explanation = await requestSubarticularExplanation({
        inputId,
        instanceNumber: roiDraft.instanceNumber,
        x: roiDraft.x,
        y: roiDraft.y,
        side: roiDraft.side,
        level: roiDraft.level,
      });
      setResult(explanation);
      setPhase("ready");
    } catch (thrown) {
      setPhase("error");
      setError(thrown instanceof Error ? thrown.message : "No se pudo calcular el mapa de activación.");
    }
  }

  return (
    <div className="activation-map-panel">
      <label className="activation-map-toggle">
        <input type="checkbox" checked={enabled} onChange={() => void toggle()} disabled={!canRequest} data-testid="activation-map-toggle" />
        Mapa de activación asociado a la predicción
      </label>
      {!canRequest && <p className="rr-note">Marcá un punto con lado y nivel para poder calcular el mapa.</p>}
      {enabled && phase === "loading" && <p className="rr-note">Calculando mapa de activación...</p>}
      {enabled && phase === "error" && <p className="rr-note rr-export-error">{error}</p>}
      {enabled && phase === "ready" && result && (
        <div className="activation-map-result">
          <div className="activation-map-image-wrap">
            <img
              className="activation-map-image"
              src={`data:image/png;base64,${result.heatmapPng}`}
              alt="Mapa de activación"
              style={{ opacity }}
              data-testid="activation-map-image"
            />
          </div>
          <label className="activation-map-opacity">
            Opacidad
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              data-testid="activation-map-opacity"
            />
          </label>
          <p className="rr-note">{result.disclaimer}</p>
          <p className="rr-note">{result.layerDisclaimer}</p>
        </div>
      )}
    </div>
  );
}
