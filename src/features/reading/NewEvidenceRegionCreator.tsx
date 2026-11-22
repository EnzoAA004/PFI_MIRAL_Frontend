import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAuthenticatedImageUrl } from "../../authenticatedAssets";
import type { EvidenceGeometry, EvidenceGeometryType } from "../../contracts/visualEvidenceTypes";
import {
  createProfessionalEvidenceRegion,
  ProfessionalAnnotationContractError,
  type EvidenceRegionResponse,
} from "../../professionalAnnotationApi";
import { evidenceBaseImageSliceUrl, NO_BASE_IMAGE_MESSAGE } from "./visualEvidenceDisplay";
import { defaultBbox, defaultEllipse, geometryToRequestMap, moveBbox, moveEllipseCenter, pointFromClient } from "./evidenceRegionEditing";

/**
 * EXT-04B5: "Nueva región" — un profesional dibuja desde cero un BBOX o ELLIPSE nuevo y lo guarda
 * como `origin=professional` (el Backend deriva `origin`; este cliente nunca envía uno). Dibuja
 * sobre el slice actual del plano activo, el mismo endpoint autenticado de slices por el que ya se resuelve el
 * `baseImage` del propio reporte (`evidenceBaseImageSliceUrl`) — sin un nuevo mecanismo de assets.
 *
 * Flow: elegir tipo → arrastrar para ubicar/ajustar → confirmar con etiqueta/nota opcional →
 * guardar. No se envía nada hasta "Guardar región" — no hay autoguardado mientras se arrastra.
 */
type Props = {
  caseId: string;
  analysisRunId: string | null;
  plane: "sagittal" | "axial";
  inputId: string | null;
  sliceIndex: number | null;
  onCreated: (region: EvidenceRegionResponse) => void;
};

export function NewEvidenceRegionCreator({ caseId, analysisRunId, plane, inputId, sliceIndex, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [geometryType, setGeometryType] = useState<Extract<EvidenceGeometryType, "BBOX" | "ELLIPSE">>("BBOX");
  const [geometry, setGeometry] = useState<EvidenceGeometry>(defaultBbox());
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const imageUrl = inputId !== null && sliceIndex !== null ? evidenceBaseImageSliceUrl({ inputId, sliceIndex }) : undefined;
  const image = useAuthenticatedImageUrl(imageUrl);
  const canCreate = analysisRunId !== null;

  function startCreating() {
    setGeometryType("BBOX");
    setGeometry(defaultBbox());
    setLabel("");
    setNote("");
    setError(null);
    setOpen(true);
  }

  function cancel() {
    setOpen(false);
    draggingRef.current = false;
  }

  function selectType(type: Extract<EvidenceGeometryType, "BBOX" | "ELLIPSE">) {
    setGeometryType(type);
    setGeometry(type === "BBOX" ? defaultBbox() : defaultEllipse());
  }

  function recenterAt(point: { x: number; y: number }) {
    setGeometry((current) => {
      if (current.type === "BBOX") return moveBbox(current, point.x - (current.x + current.width / 2), point.y - (current.y + current.height / 2));
      if (current.type === "ELLIPSE") return moveEllipseCenter(current, point);
      return current;
    });
  }

  function onFramePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    const point = pointFromClient(frame.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    recenterAt(point);
  }

  function onFramePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    const point = pointFromClient(frame.getBoundingClientRect(), event.clientX, event.clientY);
    if (!point) return;
    recenterAt(point);
  }

  function onFramePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // El navegador puede haberla liberado antes.
    }
  }

  async function save() {
    if (!analysisRunId) return;
    setSaving(true);
    setError(null);
    try {
      const region = await createProfessionalEvidenceRegion(caseId, analysisRunId, {
        plane,
        level: null,
        structure: null,
        sliceIndex,
        geometryType,
        geometry: geometryToRequestMap(geometry),
        label: label.trim() ? label.trim() : null,
        note: note.trim() ? note.trim() : null,
      });
      setOpen(false);
      onCreated(region);
    } catch (thrown) {
      setError(thrown instanceof ProfessionalAnnotationContractError || thrown instanceof Error
        ? `No se pudo crear la región: ${thrown.message}`
        : "No se pudo crear la región.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="evidence-region-new-button" onClick={startCreating} disabled={!canCreate} data-testid="evidence-new-region-button">
        Nueva región
      </button>
    );
  }

  return (
    <div className="evidence-region-new-card" data-testid="evidence-new-region-card">
      <div className="evidence-region-new-type">
        <label>
          <input type="radio" name="new-evidence-geometry-type" checked={geometryType === "BBOX"} onChange={() => selectType("BBOX")} />
          Rectángulo
        </label>
        <label>
          <input type="radio" name="new-evidence-geometry-type" checked={geometryType === "ELLIPSE"} onChange={() => selectType("ELLIPSE")} />
          Elipse
        </label>
      </div>
      <div
        className="evidence-region-frame evidence-region-new-frame"
        ref={frameRef}
        onPointerDown={onFramePointerDown}
        onPointerMove={onFramePointerMove}
        onPointerUp={onFramePointerUp}
      >
        {image.state === "loaded" && image.url ? (
          <img className="evidence-region-base-img" src={image.url} alt="" draggable={false} />
        ) : (
          <div className="evidence-region-no-base" aria-hidden="true">
            <span>{image.state === "loading" ? "Cargando imagen base..." : NO_BASE_IMAGE_MESSAGE}</span>
          </div>
        )}
        <svg className="evidence-region-overlay" viewBox="0 0 256 256" preserveAspectRatio="none">
          {geometry.type === "BBOX" && <rect className="evidence-region-shape evidence-region-shape-draft" x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />}
          {geometry.type === "ELLIPSE" && <ellipse className="evidence-region-shape evidence-region-shape-draft" cx={geometry.centerX} cy={geometry.centerY} rx={geometry.radiusX} ry={geometry.radiusY} />}
        </svg>
      </div>
      <p className="evidence-region-safety-note">Región señalada — no indica gravedad clínica.</p>
      <label className="evidence-region-comment-label">
        Etiqueta (opcional)
        <input type="text" value={label} onChange={(event) => setLabel(event.target.value)} data-testid="evidence-new-region-label" disabled={saving} />
      </label>
      <label className="evidence-region-comment-label">
        Nota (opcional)
        <input type="text" value={note} onChange={(event) => setNote(event.target.value)} data-testid="evidence-new-region-note" disabled={saving} />
      </label>
      <div className="evidence-region-edit-actions">
        <button type="button" onClick={() => void save()} disabled={saving} data-testid="evidence-new-region-save">
          {saving ? "Guardando…" : "Guardar región"}
        </button>
        <button type="button" onClick={cancel} disabled={saving} data-testid="evidence-new-region-cancel">
          Cancelar
        </button>
      </div>
      {error && <p className="evidence-region-warning" role="alert">{error}</p>}
    </div>
  );
}
