import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useAuthenticatedImageUrl } from "../../authenticatedAssets";
import type { EvidenceGeometry, VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import {
  correctEvidenceRegion,
  ProfessionalAnnotationContractError,
  type EvidenceRegionCorrectionResponse,
} from "../../professionalAnnotationApi";
import { displayReportPlane } from "./studyReportDisplay";
import { resolveEvidenceBaseImageUrl } from "./EvidenceRegionOverlay";
import {
  bboxHandlePositions,
  geometryToRequestMap,
  isGraphicallyEditable,
  moveBbox,
  moveEllipseCenter,
  pointFromClient,
  resizeBboxHandle,
  resizeEllipseRadius,
  type BboxHandle,
  type EllipseAxis,
} from "./evidenceRegionEditing";
import {
  EXPERIMENTAL_BADGE_TEXT,
  NO_BASE_IMAGE_MESSAGE,
  evidenceAriaLabel,
  evidenceVisualGroup,
  displayEvidenceReviewStatus,
  displayEvidenceSource,
} from "./visualEvidenceDisplay";

/**
 * EXT-04B5: read-only by default (renders exactly like `EvidenceRegionOverlay`); a professional
 * must deliberately click "Editar anotación" to enter edit mode. Only BBOX/ELLIPSE become
 * draggable — see `isGraphicallyEditable`. Nothing is written to the Backend until "Guardar
 * corrección" is pressed; "Cancelar" discards the local draft with no network call at all
 * ("no autosave durante el arrastre", per the EXT-04B5 spec).
 *
 * The red stroke used for a professional's draft is the same "región señalada" documented in
 * `EvidenceRegionOverlay`/`EXT_04B_FRONTEND_VISUAL_EVIDENCE.md` — never a severity signal, and
 * never the only cue: the caption below always carries the origin/label/review-status text too.
 */
type DragState =
  | { kind: "move"; geometryType: "BBOX" | "ELLIPSE"; startPoint: { x: number; y: number }; startGeometry: EvidenceGeometry }
  | { kind: "bbox-resize"; handle: BboxHandle }
  | { kind: "ellipse-resize"; axis: EllipseAxis };

type Props = {
  item: VisualEvidenceItem;
  caseId: string;
  analysisRunId: string | null;
  onSaved: (correction: EvidenceRegionCorrectionResponse) => void;
};

export function EvidenceRegionEditor({ item, caseId, analysisRunId, onSaved }: Props) {
  const group = evidenceVisualGroup(item.source);
  const imageUrl = resolveEvidenceBaseImageUrl(item);
  const image = useAuthenticatedImageUrl(imageUrl);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EvidenceGeometry | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = analysisRunId !== null && isGraphicallyEditable(item.geometry.type);

  function beginEdit() {
    setDraft(item.geometry);
    setComment("");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
    dragRef.current = null;
    setError(null);
  }

  function rectOf(frame: HTMLDivElement) {
    return frame.getBoundingClientRect();
  }

  function onFramePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame || !draft) return;
    const point = pointFromClient(rectOf(frame), event.clientX, event.clientY);
    if (!point) return;
    if (drag.kind === "move" && draft.type === "BBOX") {
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      if (drag.startGeometry.type === "BBOX") setDraft(moveBbox(drag.startGeometry, dx, dy));
      return;
    }
    if (drag.kind === "move" && draft.type === "ELLIPSE") {
      setDraft(moveEllipseCenter(draft, point));
      return;
    }
    if (drag.kind === "bbox-resize" && draft.type === "BBOX") {
      setDraft(resizeBboxHandle(draft, drag.handle, point));
      return;
    }
    if (drag.kind === "ellipse-resize" && draft.type === "ELLIPSE") {
      setDraft(resizeEllipseRadius(draft, drag.axis, point));
    }
  }

  function releaseDrag(event: ReactPointerEvent) {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // El navegador puede haberla liberado antes (mismo patrón que MriSliceViewer).
    }
  }

  function startMove(event: ReactPointerEvent<SVGElement | HTMLDivElement>) {
    if (!draft) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const frame = frameRef.current;
    const point = frame ? pointFromClient(rectOf(frame), event.clientX, event.clientY) : null;
    dragRef.current = { kind: "move", geometryType: draft.type as "BBOX" | "ELLIPSE", startPoint: point ?? { x: 0, y: 0 }, startGeometry: draft };
  }

  function startBboxResize(event: ReactPointerEvent<SVGCircleElement>, handle: BboxHandle) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "bbox-resize", handle };
  }

  function startEllipseResize(event: ReactPointerEvent<SVGCircleElement>, axis: EllipseAxis) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "ellipse-resize", axis };
  }

  async function save() {
    if (!draft || !analysisRunId) return;
    setSaving(true);
    setError(null);
    try {
      const correction = await correctEvidenceRegion(caseId, analysisRunId, item.evidenceId, {
        geometryType: draft.type,
        geometry: geometryToRequestMap(draft),
        comment: comment.trim() ? comment.trim() : null,
      });
      setEditing(false);
      setDraft(null);
      onSaved(correction);
    } catch (thrown) {
      setError(thrown instanceof ProfessionalAnnotationContractError || thrown instanceof Error
        ? `No se pudo guardar la corrección: ${thrown.message}`
        : "No se pudo guardar la corrección.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <figure
      className={`evidence-region-figure evidence-region-${group}${item.experimental ? " is-experimental" : ""}`}
      aria-label={evidenceAriaLabel(item)}
    >
      <div
        className={`evidence-region-frame${editing ? " is-editing" : ""}`}
        ref={frameRef}
        onPointerMove={editing ? onFramePointerMove : undefined}
      >
        {image.state === "loaded" && image.url ? (
          <img className="evidence-region-base-img" data-testid="evidence-region-base-img" src={image.url} alt="" draggable={false} />
        ) : (
          <div className="evidence-region-no-base" data-testid="evidence-region-no-base" aria-hidden="true">
            <span>{image.state === "loading" ? "Cargando imagen base..." : NO_BASE_IMAGE_MESSAGE}</span>
          </div>
        )}
        <svg className="evidence-region-overlay" viewBox="0 0 256 256" preserveAspectRatio="none" style={editing ? { pointerEvents: "auto" } : undefined}>
          {!editing && <ReadOnlyShape geometry={item.geometry} group={group} />}
          {editing && draft && (
            <DraftShape
              geometry={draft}
              onMoveStart={startMove}
              onBboxHandleStart={startBboxResize}
              onEllipseHandleStart={startEllipseResize}
              onPointerUp={releaseDrag}
            />
          )}
        </svg>
      </div>
      <figcaption className="evidence-region-caption">
        <span className={`evidence-region-badge evidence-region-badge-${group}`}>{displayEvidenceSource(item.source)}</span>
        {item.experimental && <span className="evidence-region-badge evidence-region-badge-experimental">{EXPERIMENTAL_BADGE_TEXT}</span>}
        <span className="evidence-region-meta">
          {item.level ?? "Sin nivel"} · {displayReportPlane(item.plane)}
          {item.structure ? ` · ${item.structure}` : ""} · {displayEvidenceReviewStatus(item.reviewStatus)}
        </span>
        <span className="evidence-region-label">{item.label}</span>
        {item.warning && <span className="evidence-region-warning">{item.warning}</span>}
        {/* Nota de seguridad EXT-04B5: el trazo rojo en edición señala "región marcada por un
            profesional", nunca gravedad ni urgencia — el texto lo dice explícitamente y no solo
            el color, igual que el resto de esta figura. */}
        {editing && <span className="evidence-region-safety-note">Región señalada — no indica gravedad clínica.</span>}
        <div className="evidence-region-edit-actions">
          {!editing && editable && (
            <button type="button" className="evidence-region-edit-button" onClick={beginEdit} data-testid={`evidence-edit-${item.evidenceId}`}>
              Editar anotación
            </button>
          )}
          {!editing && !editable && item.geometry.type !== "MASK_REFERENCE" && (
            <span className="evidence-region-edit-disabled-note">
              {analysisRunId === null
                ? "Edición no disponible: este informe no identifica una corrida activa."
                : "POLYGON no es editable gráficamente en esta iteración."}
            </span>
          )}
          {!editing && item.geometry.type === "MASK_REFERENCE" && (
            <span className="evidence-region-edit-disabled-note">MASK_REFERENCE no es editable: es una máscara ráster, no una figura vectorial.</span>
          )}
          {editing && (
            <>
              <label className="evidence-region-comment-label">
                Nota (opcional)
                <input
                  type="text"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  data-testid={`evidence-comment-${item.evidenceId}`}
                  disabled={saving}
                />
              </label>
              <button type="button" onClick={() => void save()} disabled={saving} data-testid={`evidence-save-${item.evidenceId}`}>
                {saving ? "Guardando…" : "Guardar corrección"}
              </button>
              <button type="button" onClick={cancelEdit} disabled={saving} data-testid={`evidence-cancel-${item.evidenceId}`}>
                Cancelar
              </button>
            </>
          )}
        </div>
        {error && <span className="evidence-region-warning" role="alert">{error}</span>}
      </figcaption>
    </figure>
  );
}

function ReadOnlyShape({ geometry, group }: { geometry: EvidenceGeometry; group: "ai" | "professional" }) {
  const className = `evidence-region-shape evidence-region-shape-${group}`;
  if (geometry.type === "BBOX") return <rect className={className} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />;
  if (geometry.type === "ELLIPSE") return <ellipse className={className} cx={geometry.centerX} cy={geometry.centerY} rx={geometry.radiusX} ry={geometry.radiusY} />;
  if (geometry.type === "POLYGON") return <polygon className={className} points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} />;
  return null;
}

function DraftShape({
  geometry, onMoveStart, onBboxHandleStart, onEllipseHandleStart, onPointerUp,
}: {
  geometry: EvidenceGeometry;
  onMoveStart: (event: ReactPointerEvent<SVGElement>) => void;
  onBboxHandleStart: (event: ReactPointerEvent<SVGCircleElement>, handle: BboxHandle) => void;
  onEllipseHandleStart: (event: ReactPointerEvent<SVGCircleElement>, axis: EllipseAxis) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
}) {
  const handleRadius = 4;
  if (geometry.type === "BBOX") {
    const handles = bboxHandlePositions(geometry);
    return (
      <>
        <rect
          className="evidence-region-shape evidence-region-shape-draft"
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          onPointerDown={onMoveStart}
          onPointerUp={onPointerUp}
        />
        {(Object.keys(handles) as BboxHandle[]).map((handle) => (
          <circle
            key={handle}
            className="evidence-region-handle"
            cx={handles[handle].x}
            cy={handles[handle].y}
            r={handleRadius}
            onPointerDown={(event) => onBboxHandleStart(event, handle)}
            onPointerUp={onPointerUp}
          />
        ))}
      </>
    );
  }
  if (geometry.type === "ELLIPSE") {
    return (
      <>
        <ellipse
          className="evidence-region-shape evidence-region-shape-draft"
          cx={geometry.centerX}
          cy={geometry.centerY}
          rx={geometry.radiusX}
          ry={geometry.radiusY}
          onPointerDown={onMoveStart}
          onPointerUp={onPointerUp}
        />
        <circle
          className="evidence-region-handle"
          cx={geometry.centerX + geometry.radiusX}
          cy={geometry.centerY}
          r={handleRadius}
          onPointerDown={(event) => onEllipseHandleStart(event, "x")}
          onPointerUp={onPointerUp}
        />
        <circle
          className="evidence-region-handle"
          cx={geometry.centerX}
          cy={geometry.centerY + geometry.radiusY}
          r={handleRadius}
          onPointerDown={(event) => onEllipseHandleStart(event, "y")}
          onPointerUp={onPointerUp}
        />
      </>
    );
  }
  return null;
}
