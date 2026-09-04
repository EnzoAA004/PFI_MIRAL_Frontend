import { useAuthenticatedImageUrl } from "../../authenticatedAssets";
import type { VisualEvidenceItem } from "../../contracts/visualEvidenceTypes";
import { displayReportPlane } from "./studyReportDisplay";
import {
  EXPERIMENTAL_BADGE_TEXT,
  NO_BASE_IMAGE_MESSAGE,
  evidenceAriaLabel,
  evidenceBaseImageSliceUrl,
  evidenceMaskAssetUrl,
  evidenceVisualGroup,
  displayEvidenceReviewStatus,
  displayEvidenceSource,
} from "./visualEvidenceDisplay";

/**
 * EXT-04B3/EXT-04B3.5: read-only rendering of one `VisualEvidenceItem` — BBOX/ELLIPSE/POLYGON as
 * SVG shapes over a real base slice image, MASK_REFERENCE as its own authenticated raster asset.
 * No drawing, drag, resize, or region-creation interaction of any kind (that is EXT-04B5); this
 * component never accepts an `onChange`-shaped prop.
 *
 * Reuses `MeasurementLayer.tsx`'s own convention for the canonical basis: an SVG with
 * `viewBox="0 0 256 256"` and `preserveAspectRatio="none"`, absolutely positioned over its
 * container (`.evidence-region-overlay` mirrors `.mri-measure-layer` in `reading.css`) — the
 * browser does the 0..256-to-viewport scaling, so this component never computes a CSS pixel
 * position itself and keeps working if the container is resized.
 *
 * The base image (either the MASK_REFERENCE asset or the EXT-04B3.5 `baseImage` slice) is
 * fetched through `useAuthenticatedImageUrl` — the same authenticated-fetch/object-URL/cache
 * mechanism `MriSliceViewer.tsx` already uses for every other protected asset. A plain
 * `<img src={backendUrl}>` would send no `Authorization` header and simply fail against a real
 * Backend; reusing this hook instead of a bare `<img>` was a real bug fixed while wiring
 * EXT-04B3.5 (a raw `<img>` had shipped for MASK_REFERENCE in the EXT-04B3 iteration, before any
 * base image was reachable end-to-end enough to expose the gap).
 */
export function EvidenceRegionOverlay({ item }: { item: VisualEvidenceItem }) {
  const group = evidenceVisualGroup(item.source);
  const imageUrl = resolveEvidenceBaseImageUrl(item);
  const image = useAuthenticatedImageUrl(imageUrl);

  return (
    <figure
      className={`evidence-region-figure evidence-region-${group}${item.experimental ? " is-experimental" : ""}`}
      aria-label={evidenceAriaLabel(item)}
    >
      {/* role="img" ya lo anuncia un lector de pantalla sin necesitar foco de teclado:
          no es interactivo (solo lectura, EXT-04B3), así que no lleva tabIndex. */}
      <div className="evidence-region-frame" role="img" aria-label={evidenceAriaLabel(item)}>
        {image.state === "loaded" && image.url ? (
          <img
            className="evidence-region-base-img"
            data-testid="evidence-region-base-img"
            src={image.url}
            alt=""
            draggable={false}
          />
        ) : (
          <div className="evidence-region-no-base" data-testid="evidence-region-no-base" aria-hidden="true">
            <span>{image.state === "loading" ? "Cargando imagen base..." : NO_BASE_IMAGE_MESSAGE}</span>
          </div>
        )}
        <svg className="evidence-region-overlay" viewBox="0 0 256 256" preserveAspectRatio="none" aria-hidden="true">
          <EvidenceGeometryShape item={item} />
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
      </figcaption>
    </figure>
  );
}

/**
 * MASK_REFERENCE's own asset takes precedence when present — the mask IS the base image for
 * that geometry, per the existing EXT-04B2 design. Otherwise falls back to the EXT-04B3.5
 * `baseImage` slice reference when the Backend resolved one. Returns `undefined` (never a
 * guessed URL) when neither applies — `useAuthenticatedImageUrl(undefined)` reports `"idle"`,
 * which this component renders as the neutral fallback message.
 */
export function resolveEvidenceBaseImageUrl(item: VisualEvidenceItem): string | undefined {
  if (item.geometry.type === "MASK_REFERENCE") return evidenceMaskAssetUrl(item.geometry);
  if (item.baseImage) return evidenceBaseImageSliceUrl(item.baseImage);
  return undefined;
}

function EvidenceGeometryShape({ item }: { item: VisualEvidenceItem }) {
  const geometry = item.geometry;
  const className = `evidence-region-shape evidence-region-shape-${evidenceVisualGroup(item.source)}`;
  if (geometry.type === "BBOX") {
    return <rect className={className} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />;
  }
  if (geometry.type === "ELLIPSE") {
    return <ellipse className={className} cx={geometry.centerX} cy={geometry.centerY} rx={geometry.radiusX} ry={geometry.radiusY} />;
  }
  if (geometry.type === "POLYGON") {
    return <polygon className={className} points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} />;
  }
  // MASK_REFERENCE: the mask itself is the already-composited raster image (`evidence-region-base-img`
  // above) — there is no additional vector shape to draw on top of it here.
  return null;
}
